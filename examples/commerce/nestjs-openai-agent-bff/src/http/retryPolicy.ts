import { AppError } from '../errors/AppError.js';
import { mapError } from '../errors/mapError.js';

/**
 * Determines if an error is retryable for MCP calls.
 * 
 * Retryable errors:
 * - MCP_TRANSPORT errors (network issues, 502/503/504)
 * - TIMEOUT errors
 * 
 * Non-retryable errors:
 * - VALIDATION errors (bad request data)
 * - MCP_TOOL errors (tool execution failures)
 * - MCP_PROTOCOL errors (protocol issues)
 * - OAUTH errors (authentication issues)
 * 
 * @param error - The error to check
 * @returns true if the error should trigger a retry
 */
export function isMcpRetryable(error: unknown): boolean {
  const appError = error instanceof AppError ? error : mapError(error);
  
  // Only retry transient transport errors
  if (appError.category === 'MCP_TRANSPORT') {
    // Check if it's a retryable HTTP status (502, 503, 504)
    const httpStatus = appError.details?.httpStatus as number | undefined;
    if (httpStatus !== undefined) {
      return httpStatus === 502 || httpStatus === 503 || httpStatus === 504;
    }
    // Network errors (no HTTP status) are retryable
    return appError.code === 'MCP_TRANSPORT_NETWORK_ERROR';
  }
  
  // Timeout errors are retryable
  if (appError.category === 'TIMEOUT') {
    return true;
  }
  
  // All other errors are not retryable:
  // - VALIDATION: bad request data, won't succeed on retry
  // - MCP_TOOL: tool execution failed, likely a business logic error
  // - MCP_PROTOCOL: protocol issues, unlikely to resolve on retry
  // - OAUTH: authentication issues, need to fix credentials
  // - OPENAI: handled separately
  // - INTERNAL: unexpected errors
  return false;
}

/**
 * Determines if an error is retryable for OpenAI calls.
 * 
 * Retryable errors:
 * - Rate limit errors (429)
 * - Server errors (5xx)
 * - Timeout errors
 * 
 * Non-retryable errors:
 * - VALIDATION errors
 * - Tool schema errors
 * - Authentication errors
 * 
 * @param error - The error to check
 * @returns true if the error should trigger a retry
 */
export function isOpenAiRetryable(error: unknown): boolean {
  const appError = error instanceof AppError ? error : mapError(error);
  
  // Rate limit errors are retryable
  if (appError.code === 'OPENAI_RATE_LIMIT') {
    return true;
  }
  
  // Timeout errors are retryable (both generic TIMEOUT and OPENAI_TIMEOUT)
  if (appError.category === 'TIMEOUT') {
    return true;
  }
  
  // OpenAI timeout errors are retryable
  if (appError.code === 'OPENAI_TIMEOUT') {
    return true;
  }
  
  // Generic OpenAI API errors with 5xx status are retryable
  if (appError.category === 'OPENAI') {
    const status = appError.details?.status as number | undefined;
    if (status !== undefined && status >= 500) {
      return true;
    }
    // Connection errors are retryable
    if (appError.details?.code === 'ECONNREFUSED' || 
        appError.details?.code === 'ETIMEDOUT' ||
        appError.details?.code === 'ENOTFOUND') {
      return true;
    }
  }
  
  // All other errors are not retryable:
  // - VALIDATION: bad request data
  // - OPENAI_TOOL_SCHEMA_ERROR: configuration error
  // - Authentication errors
  return false;
}
