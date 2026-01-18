/**
 * Error envelope for frontend-safe, consistent error responses.
 * The widget can use error.category + retryable to decide "retry vs rephrase" deterministically.
 */

import { z } from 'zod';
import { AppError, ErrorCategory } from '../errors/AppError.js';

/**
 * Simplified error categories for frontend consumption.
 * Maps internal error categories to frontend-safe categories.
 */
export type ErrorEnvelopeCategory = 'validation' | 'auth' | 'upstream' | 'policy' | 'internal';

/**
 * Zod schema for the error envelope.
 * This is the stable contract for error responses.
 */
export const errorEnvelopeSchema = z.object({
  category: z.enum(['validation', 'auth', 'upstream', 'policy', 'internal']),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Error envelope type inferred from the Zod schema.
 */
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Maps internal ErrorCategory to frontend-safe ErrorEnvelopeCategory.
 * 
 * Mapping:
 * - VALIDATION -> validation (bad request data, rephrase)
 * - OAUTH, AUTHZ -> auth (authentication/authorization issues)
 * - MCP_TRANSPORT, MCP_PROTOCOL, MCP_TOOL, OPENAI -> upstream (external service issues)
 * - TIMEOUT -> upstream (can retry)
 * - INTERNAL -> internal (unexpected errors)
 */
export function mapCategoryToEnvelope(category: ErrorCategory): ErrorEnvelopeCategory {
  switch (category) {
    case 'VALIDATION':
      return 'validation';
    case 'OAUTH':
    case 'AUTHZ':
      return 'auth';
    case 'MCP_TRANSPORT':
    case 'MCP_PROTOCOL':
    case 'MCP_TOOL':
    case 'OPENAI':
    case 'TIMEOUT':
      return 'upstream';
    case 'INTERNAL':
    default:
      return 'internal';
  }
}

/**
 * Determines if an error is retryable based on its category and code.
 * 
 * Retryable errors:
 * - MCP_TRANSPORT (network issues, temporary)
 * - TIMEOUT (can retry)
 * - OPENAI rate limits (429)
 * - Some MCP_PROTOCOL errors (init failures)
 * 
 * Non-retryable errors:
 * - VALIDATION (bad request data, need to rephrase)
 * - OAUTH/AUTHZ (authentication issues)
 * - MCP_TOOL (tool execution failures)
 * - INTERNAL (unexpected errors)
 */
export function isRetryable(category: ErrorCategory, code: string): boolean {
  switch (category) {
    case 'MCP_TRANSPORT':
      // Network errors and HTTP 5xx are retryable
      return true;
    case 'TIMEOUT':
      // Timeouts are retryable
      return true;
    case 'OPENAI':
      // Rate limits are retryable, other OpenAI errors may not be
      return code === 'OPENAI_RATE_LIMIT';
    case 'MCP_PROTOCOL':
      // Init failures might be retryable (temporary server issues)
      return code === 'MCP_PROTOCOL_INIT_FAILED';
    case 'VALIDATION':
    case 'OAUTH':
    case 'AUTHZ':
    case 'MCP_TOOL':
    case 'INTERNAL':
    default:
      return false;
  }
}

/**
 * List of sensitive field patterns to redact from error messages.
 */
const SENSITIVE_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /client_id/i,
  /client_secret/i,
];

/**
 * Ensures a message is safe for frontend consumption.
 * Redacts any potential secrets or sensitive information.
 */
export function ensureSafeMessage(message: string): string {
  let safeMessage = message;
  
  // Check for sensitive patterns and redact if found
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(safeMessage)) {
      // If the message contains sensitive patterns, return a generic message
      return 'An error occurred. Please try again.';
    }
  }
  
  // Truncate very long messages
  if (safeMessage.length > 500) {
    safeMessage = safeMessage.substring(0, 497) + '...';
  }
  
  return safeMessage;
}

/**
 * Sanitizes details object for frontend consumption.
 * Removes sensitive fields and truncates long values.
 */
export function sanitizeDetails(
  details: Record<string, unknown> | undefined,
  includeDetails: boolean
): Record<string, unknown> | undefined {
  if (!details || !includeDetails) {
    return undefined;
  }

  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(details)) {
    // Skip sensitive keys
    const isSensitive = SENSITIVE_PATTERNS.some(pattern => pattern.test(key));
    if (isSensitive) {
      continue;
    }
    
    // Truncate long string values
    if (typeof value === 'string' && value.length > 200) {
      sanitized[key] = value.substring(0, 197) + '...';
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects (shallow, one level)
      sanitized[key] = '[object]';
    } else {
      sanitized[key] = value;
    }
  }
  
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

/**
 * Converts an AppError to a frontend-safe ErrorEnvelope.
 * 
 * @param appError - The AppError to convert
 * @param requestId - Optional request ID to include
 * @param includeDetails - Whether to include details (typically only in debug mode)
 * @returns A frontend-safe ErrorEnvelope
 */
export function appErrorToEnvelope(
  appError: AppError,
  requestId?: string,
  includeDetails = false
): ErrorEnvelope {
  const category = mapCategoryToEnvelope(appError.category);
  const retryable = isRetryable(appError.category, appError.code);
  const message = ensureSafeMessage(appError.safeMessage);
  const details = sanitizeDetails(appError.details, includeDetails);

  const envelope: ErrorEnvelope = {
    category,
    code: appError.code,
    message,
    retryable,
  };

  if (requestId) {
    envelope.requestId = requestId;
  }

  if (details) {
    envelope.details = details;
  }

  return envelope;
}

/**
 * Creates an ErrorEnvelope directly from error properties.
 * Useful when you don't have an AppError instance.
 */
export function createErrorEnvelope(
  category: ErrorEnvelopeCategory,
  code: string,
  message: string,
  retryable: boolean,
  requestId?: string,
  details?: Record<string, unknown>
): ErrorEnvelope {
  const envelope: ErrorEnvelope = {
    category,
    code,
    message: ensureSafeMessage(message),
    retryable,
  };

  if (requestId) {
    envelope.requestId = requestId;
  }

  if (details) {
    envelope.details = details;
  }

  return envelope;
}
