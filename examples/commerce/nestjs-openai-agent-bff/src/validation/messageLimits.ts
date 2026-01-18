import { AppError } from '../errors/index.js';

/**
 * Limits configuration for message validation.
 */
export interface MessageLimits {
  maxChars: number;
  maxTokensEst: number;
}

/**
 * Estimates the number of tokens in a text string.
 * Uses a simple heuristic: tokens ~ chars / 4.
 * This is a fast approximation that works well for most text.
 * 
 * @param text - The text to estimate tokens for
 * @returns The estimated number of tokens (ceiling)
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

/**
 * Enforces message limits by checking character count and estimated tokens.
 * Throws an AppError with 413 status if limits are exceeded.
 * 
 * @param message - The message to validate
 * @param limits - The limits to enforce
 * @throws AppError if message exceeds character or token limits
 */
export function enforceMessageLimits(message: string, limits: MessageLimits): void {
  if (message.length > limits.maxChars) {
    throw new AppError({
      category: 'VALIDATION',
      code: 'VALIDATION_REQUEST_INVALID',
      httpStatus: 413,
      safeMessage: 'Message too long',
      details: {
        maxChars: limits.maxChars,
        maxTokensEst: limits.maxTokensEst,
        actualChars: message.length,
      },
    });
  }

  const estimatedTokens = estimateTokens(message);
  if (estimatedTokens > limits.maxTokensEst) {
    throw new AppError({
      category: 'VALIDATION',
      code: 'VALIDATION_REQUEST_INVALID',
      httpStatus: 413,
      safeMessage: 'Message too long (estimated tokens exceeded)',
      details: {
        maxChars: limits.maxChars,
        maxTokensEst: limits.maxTokensEst,
        actualTokensEst: estimatedTokens,
      },
    });
  }
}
