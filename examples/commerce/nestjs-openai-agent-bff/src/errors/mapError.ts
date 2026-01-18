import { z } from 'zod';
import { AppError } from './AppError.js';
import { MalformedToolArgsError } from '../agent/agentRunner.js';

/**
 * Check if an error is an OpenAI API error.
 * OpenAI SDK errors have specific properties we can check.
 */
function isOpenAiError(error: unknown): error is Error & {
  status?: number;
  code?: string;
  type?: string;
} {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  return (
    name === 'APIError' ||
    name === 'BadRequestError' ||
    name === 'AuthenticationError' ||
    name === 'PermissionDeniedError' ||
    name === 'NotFoundError' ||
    name === 'ConflictError' ||
    name === 'UnprocessableEntityError' ||
    name === 'RateLimitError' ||
    name === 'InternalServerError' ||
    name === 'APIConnectionError' ||
    name === 'APITimeoutError' ||
    name === 'APIConnectionTimeoutError'
  );
}

/**
 * Check if an error is an abort error (from AbortController).
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      (error as Error & { code?: string }).code === 'ABORT_ERR' ||
      (error as Error & { code?: string }).code === 'ERR_ABORTED'
    );
  }
  return false;
}

/**
 * Check if an error is a network/fetch error.
 */
function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.name === 'TypeError' ||
    error.name === 'FetchError' ||
    message.includes('fetch failed') ||
    message.includes('network') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('enotfound') ||
    message.includes('socket hang up')
  );
}

/**
 * Check if an error message indicates an OAuth failure.
 */
function isOAuthError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('oauth') ||
    message.includes('token') ||
    message.includes('authentication') ||
    message.includes('unauthorized') ||
    message.includes('401')
  );
}

/**
 * Check if an error message indicates an MCP error.
 */
function isMcpError(error: Error): boolean {
  const message = error.message;
  return (
    message.includes('MCP') ||
    message.includes('mcp') ||
    message.includes('JSON-RPC')
  );
}

/**
 * Parse MCP error details from error message.
 */
function parseMcpErrorDetails(message: string): {
  type: 'transport' | 'protocol' | 'tool';
  status?: number;
  errorCode?: number;
  toolName?: string;
} {
  // Check for HTTP status errors: "status=500"
  const statusMatch = message.match(/status=(\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

  // Check for JSON-RPC error codes: "(code: -32600)"
  const codeMatch = message.match(/\(code:\s*(-?\d+)\)/);
  const errorCode = codeMatch ? parseInt(codeMatch[1], 10) : undefined;

  // Check for tool name: "toolName=product.search"
  const toolNameMatch = message.match(/toolName=([^\s,)]+)/);
  const toolName = toolNameMatch ? toolNameMatch[1] : undefined;

  // Determine error type
  if (message.includes('MCP request failed') || message.includes('Failed to parse MCP response')) {
    // Transport/HTTP level errors
    if (status && status >= 400) {
      return { type: 'transport', status };
    }
    return { type: 'protocol', status };
  }

  if (message.includes('MCP initialize failed')) {
    return { type: 'protocol', errorCode };
  }

  if (message.includes('MCP tool call failed')) {
    return { type: 'tool', errorCode, toolName };
  }

  // Default to transport for network-level issues
  return { type: 'transport', status };
}

/**
 * Map an unknown error to an AppError.
 * This function handles errors from various sources:
 * - Zod validation errors
 * - MalformedToolArgsError
 * - OpenAI SDK errors
 * - OAuth errors
 * - MCP errors (transport, protocol, tool)
 * - Timeout/abort errors
 * - Network errors
 * - Generic errors
 */
export function mapError(error: unknown): AppError {
  // Already an AppError - return as-is
  if (error instanceof AppError) {
    return error;
  }

  // Zod validation errors
  if (error instanceof z.ZodError) {
    const messages = error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`
    );
    return AppError.validation(messages.join(', '), {
      issues: error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    }, error);
  }

  // MalformedToolArgsError from agent
  if (error instanceof MalformedToolArgsError) {
    return AppError.validationToolArgs(
      error.toolName,
      error.parseError,
      error
    );
  }

  // Handle non-Error objects
  if (!(error instanceof Error)) {
    const message = typeof error === 'string' ? error : 'Unknown error';
    return AppError.internal(message);
  }

  // Abort/timeout errors
  if (isAbortError(error)) {
    return AppError.timeout('request', 0, error);
  }

  // OpenAI SDK errors
  if (isOpenAiError(error)) {
    const status = error.status;
    const code = error.code;
    const type = error.type;

    // Rate limit errors
    if (error.name === 'RateLimitError' || status === 429) {
      return AppError.openaiRateLimit(error);
    }

    // Timeout errors - use dedicated OPENAI_TIMEOUT category
    // APITimeoutError is thrown when the request times out
    // APIConnectionTimeoutError is a subclass for connection-level timeouts
    if (error.name === 'APITimeoutError' || error.name === 'APIConnectionTimeoutError') {
      return AppError.openaiTimeout(undefined, error);
    }

    // Connection errors (non-timeout)
    if (error.name === 'APIConnectionError') {
      // Check if this is actually a timeout error (message contains "timed out")
      if (error.message.toLowerCase().includes('timed out') || error.message.toLowerCase().includes('timeout')) {
        return AppError.openaiTimeout(undefined, error);
      }
      return AppError.openai('Connection to OpenAI failed', { code }, error);
    }

    // Bad request errors (invalid tool schema, etc.)
    if (error.name === 'BadRequestError' || status === 400) {
      const message = error.message.toLowerCase();
      if (message.includes('tool') || message.includes('function') || message.includes('schema')) {
        return AppError.openaiToolSchema(error.message, error);
      }
      return AppError.validation(error.message, { openaiError: true, type }, error);
    }

    // Authentication errors
    if (error.name === 'AuthenticationError' || status === 401) {
      return AppError.openai('OpenAI authentication failed', { code }, error);
    }

    // Server errors
    if (error.name === 'InternalServerError' || (status && status >= 500)) {
      return AppError.openai('OpenAI service error', { status, code }, error);
    }

    // Generic OpenAI error
    return AppError.openai(error.message, { status, code, type }, error);
  }

  // Network errors (before checking specific error types)
  if (isNetworkError(error)) {
    return AppError.mcpTransport(error.message, {}, error);
  }

  // OAuth errors
  if (isOAuthError(error)) {
    const message = error.message;
    if (message.includes('401') || message.includes('unauthorized')) {
      return AppError.oauthTokenInvalid(message, error);
    }
    return AppError.oauthTokenFetch(message, error);
  }

  // MCP errors
  if (isMcpError(error)) {
    const details = parseMcpErrorDetails(error.message);

    switch (details.type) {
      case 'transport':
        if (details.status) {
          return AppError.mcpTransportHttp(details.status, error.message, error);
        }
        return AppError.mcpTransport(error.message, {}, error);

      case 'protocol':
        if (error.message.includes('initialize')) {
          return AppError.mcpProtocolInit(error.message, error);
        }
        return AppError.mcpProtocol(error.message, { errorCode: details.errorCode }, error);

      case 'tool':
        return AppError.mcpTool(
          details.toolName || 'unknown',
          details.errorCode || -1,
          error.message,
          error
        );
    }
  }

  // Generic error fallback
  return AppError.internal(error.message, error);
}

/**
 * Sanitize error details for logging.
 * Removes sensitive information like tokens and secrets.
 */
export function sanitizeForLogging(
  details: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!details) return undefined;

  const sanitized: Record<string, unknown> = {};
  const sensitiveKeys = [
    'token',
    'secret',
    'password',
    'apikey',
    'api_key',
    'authorization',
    'bearer',
    'credential',
  ];

  for (const [key, value] of Object.entries(details)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = sensitiveKeys.some((sk) => lowerKey.includes(sk));

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      sanitized[key] = value.substring(0, 500) + '...[truncated]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeForLogging(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
