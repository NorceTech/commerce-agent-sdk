/**
 * Error categories for the application.
 * These categories provide actionable classification of errors.
 */
export type ErrorCategory =
  | 'OPENAI'
  | 'OAUTH'
  | 'MCP_TRANSPORT'
  | 'MCP_PROTOCOL'
  | 'MCP_TOOL'
  | 'VALIDATION'
  | 'AUTHZ'
  | 'TIMEOUT'
  | 'INTERNAL';

/**
 * Error codes for more specific error identification.
 * Format: CATEGORY_SPECIFIC_ERROR
 */
export type ErrorCode =
  | 'OPENAI_API_ERROR'
  | 'OPENAI_RATE_LIMIT'
  | 'OPENAI_INVALID_RESPONSE'
  | 'OPENAI_TOOL_SCHEMA_ERROR'
  | 'OPENAI_TIMEOUT'
  | 'OAUTH_TOKEN_FETCH_FAILED'
  | 'OAUTH_TOKEN_INVALID'
  | 'OAUTH_TOKEN_EXPIRED'
  | 'MCP_TRANSPORT_NETWORK_ERROR'
  | 'MCP_TRANSPORT_TIMEOUT'
  | 'MCP_TRANSPORT_HTTP_ERROR'
  | 'MCP_PROTOCOL_INVALID_RESPONSE'
  | 'MCP_PROTOCOL_INIT_FAILED'
  | 'MCP_TOOL_EXECUTION_FAILED'
  | 'MCP_TOOL_NOT_FOUND'
  | 'VALIDATION_REQUEST_INVALID'
  | 'VALIDATION_TOOL_ARGS_INVALID'
  | 'VALIDATION_CONTEXT_INVALID'
  | 'AUTHZ_UNAUTHORIZED'
  | 'AUTHZ_FORBIDDEN'
  | 'TIMEOUT_REQUEST'
  | 'TIMEOUT_OPERATION'
  | 'INTERNAL_ERROR'
  | 'INTERNAL_AGENT_ERROR';

/**
 * Options for creating an AppError.
 */
export interface AppErrorOptions {
  category: ErrorCategory;
  code: ErrorCode;
  httpStatus: number;
  safeMessage: string;
  details?: Record<string, unknown>;
  cause?: Error;
}

/**
 * Structured error response payload for API responses.
 */
export interface ErrorPayload {
  error: {
    category: ErrorCategory;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

/**
 * AppError is the base error class for all application errors.
 * It provides structured error information with category, code, HTTP status,
 * and a safe message suitable for client responses.
 */
export class AppError extends Error {
  readonly category: ErrorCategory;
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly safeMessage: string;
  readonly details?: Record<string, unknown>;
  override readonly cause?: Error;

  constructor(options: AppErrorOptions) {
    super(options.safeMessage);
    this.name = 'AppError';
    this.category = options.category;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.safeMessage = options.safeMessage;
    this.details = options.details;
    this.cause = options.cause;

    Object.setPrototypeOf(this, AppError.prototype);
  }

  /**
   * Convert the error to a structured payload for API responses.
   */
  toPayload(requestId?: string): ErrorPayload {
    const payload: ErrorPayload = {
      error: {
        category: this.category,
        code: this.code,
        message: this.safeMessage,
      },
    };

    if (this.details && Object.keys(this.details).length > 0) {
      payload.error.details = this.details;
    }

    if (requestId) {
      payload.requestId = requestId;
    }

    return payload;
  }

  /**
   * Create a validation error for invalid request data.
   */
  static validation(
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'VALIDATION',
      code: 'VALIDATION_REQUEST_INVALID',
      httpStatus: 400,
      safeMessage: message,
      details,
      cause,
    });
  }

  /**
   * Create a validation error for invalid tool arguments.
   */
  static validationToolArgs(
    toolName: string,
    parseError: string,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'VALIDATION',
      code: 'VALIDATION_TOOL_ARGS_INVALID',
      httpStatus: 400,
      safeMessage: 'The AI generated invalid tool arguments. Please try rephrasing your request.',
      details: { toolName, parseError },
      cause,
    });
  }

  /**
   * Create an OAuth error for token fetch failures.
   */
  static oauthTokenFetch(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'OAUTH',
      code: 'OAUTH_TOKEN_FETCH_FAILED',
      httpStatus: 503,
      safeMessage: 'Authentication service is temporarily unavailable. Please try again later.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create an OAuth error for invalid/expired tokens.
   */
  static oauthTokenInvalid(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'OAUTH',
      code: 'OAUTH_TOKEN_INVALID',
      httpStatus: 401,
      safeMessage: 'Authentication failed. Please try again.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create an MCP transport error for network issues.
   */
  static mcpTransport(
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'MCP_TRANSPORT',
      code: 'MCP_TRANSPORT_NETWORK_ERROR',
      httpStatus: 503,
      safeMessage: 'Unable to connect to the commerce service. Please try again later.',
      details: { originalMessage: message, ...details },
      cause,
    });
  }

  /**
   * Create an MCP transport error for HTTP errors.
   */
  static mcpTransportHttp(
    status: number,
    message: string,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'MCP_TRANSPORT',
      code: 'MCP_TRANSPORT_HTTP_ERROR',
      httpStatus: status >= 500 ? 503 : 502,
      safeMessage: 'The commerce service returned an error. Please try again later.',
      details: { httpStatus: status, originalMessage: message },
      cause,
    });
  }

  /**
   * Create an MCP protocol error for invalid responses.
   */
  static mcpProtocol(
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'MCP_PROTOCOL',
      code: 'MCP_PROTOCOL_INVALID_RESPONSE',
      httpStatus: 502,
      safeMessage: 'Received an invalid response from the commerce service.',
      details: { originalMessage: message, ...details },
      cause,
    });
  }

  /**
   * Create an MCP protocol error for initialization failures.
   */
  static mcpProtocolInit(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'MCP_PROTOCOL',
      code: 'MCP_PROTOCOL_INIT_FAILED',
      httpStatus: 503,
      safeMessage: 'Failed to initialize connection to the commerce service.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create an MCP tool error for tool execution failures.
   */
  static mcpTool(
    toolName: string,
    errorCode: number,
    message: string,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'MCP_TOOL',
      code: 'MCP_TOOL_EXECUTION_FAILED',
      httpStatus: 502,
      safeMessage: `The commerce service encountered an error while processing your request.`,
      details: { toolName, errorCode, originalMessage: message },
      cause,
    });
  }

  /**
   * Create an OpenAI API error.
   */
  static openai(
    message: string,
    details?: Record<string, unknown>,
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'OPENAI',
      code: 'OPENAI_API_ERROR',
      httpStatus: 503,
      safeMessage: 'The AI service is temporarily unavailable. Please try again later.',
      details: { originalMessage: message, ...details },
      cause,
    });
  }

  /**
   * Create an OpenAI rate limit error.
   */
  static openaiRateLimit(cause?: Error): AppError {
    return new AppError({
      category: 'OPENAI',
      code: 'OPENAI_RATE_LIMIT',
      httpStatus: 429,
      safeMessage: 'The AI service is currently busy. Please try again in a moment.',
      cause,
    });
  }

  /**
   * Create an OpenAI tool schema error.
   */
  static openaiToolSchema(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'OPENAI',
      code: 'OPENAI_TOOL_SCHEMA_ERROR',
      httpStatus: 500,
      safeMessage: 'There was a configuration error with the AI service.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create an OpenAI timeout error.
   * Used when OpenAI API requests time out (APIConnectionTimeoutError or APITimeoutError).
   * 
   * @param details - Additional details about the timeout (elapsedMs, timeoutMs, requestId, etc.)
   * @param cause - The original error that caused this timeout
   */
  static openaiTimeout(
    details?: { elapsedMs?: number; timeoutMs?: number; requestId?: string },
    cause?: Error
  ): AppError {
    return new AppError({
      category: 'OPENAI',
      code: 'OPENAI_TIMEOUT',
      httpStatus: 504,
      safeMessage: 'Model took too long to respond. Please retry.',
      details,
      cause,
    });
  }

  /**
   * Create a timeout error for request timeouts.
   */
  static timeout(operation: string, timeoutMs: number, cause?: Error): AppError {
    return new AppError({
      category: 'TIMEOUT',
      code: 'TIMEOUT_REQUEST',
      httpStatus: 504,
      safeMessage: 'The request took too long to complete. Please try again.',
      details: { operation, timeoutMs },
      cause,
    });
  }

  /**
   * Create a timeout error for operation timeouts.
   */
  static operationTimeout(operation: string, cause?: Error): AppError {
    return new AppError({
      category: 'TIMEOUT',
      code: 'TIMEOUT_OPERATION',
      httpStatus: 504,
      safeMessage: 'An operation timed out. Please try again.',
      details: { operation },
      cause,
    });
  }

  /**
   * Create an internal error for unexpected failures.
   */
  static internal(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'INTERNAL',
      code: 'INTERNAL_ERROR',
      httpStatus: 500,
      safeMessage: 'An unexpected error occurred. Please try again later.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create an internal error for agent-specific failures.
   */
  static internalAgent(message: string, cause?: Error): AppError {
    return new AppError({
      category: 'INTERNAL',
      code: 'INTERNAL_AGENT_ERROR',
      httpStatus: 500,
      safeMessage: 'The AI agent encountered an unexpected error.',
      details: { originalMessage: message },
      cause,
    });
  }

  /**
   * Create a service unavailable error.
   */
  static serviceUnavailable(service: string, message: string): AppError {
    return new AppError({
      category: 'INTERNAL',
      code: 'INTERNAL_ERROR',
      httpStatus: 503,
      safeMessage: message,
      details: { service },
    });
  }

  /**
   * Create an unauthorized error for authentication failures (401).
   */
  static unauthorized(message: string, details?: Record<string, unknown>): AppError {
    return new AppError({
      category: 'AUTHZ',
      code: 'AUTHZ_UNAUTHORIZED',
      httpStatus: 401,
      safeMessage: message,
      details,
    });
  }

  /**
   * Create a forbidden error for authorization failures (403).
   */
  static forbidden(message: string, details?: Record<string, unknown>): AppError {
    return new AppError({
      category: 'AUTHZ',
      code: 'AUTHZ_FORBIDDEN',
      httpStatus: 403,
      safeMessage: message,
      details,
    });
  }
}
