import type { ToolContext } from '../session/sessionTypes.js';
import type { ContextSummary } from './runTypes.js';

const REDACT_KEYS = new Set([
  'authorization',
  'client_secret',
  'access_token',
  'token',
  'application-id',
  'api_key',
  'apikey',
  'password',
  'secret',
]);

const DEFAULT_MAX_STRING_LENGTH = 500;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ARRAY_LENGTH = 20;

function isRedactedKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[_-]/g, '');
  for (const redactKey of REDACT_KEYS) {
    const normalizedRedactKey = redactKey.toLowerCase().replace(/[_-]/g, '');
    if (lowerKey === normalizedRedactKey || lowerKey.includes(normalizedRedactKey)) {
      return true;
    }
  }
  return false;
}

export function capString(str: string, maxLength: number = DEFAULT_MAX_STRING_LENGTH): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.slice(0, maxLength) + '...';
}

export function capArrayLength<T>(arr: T[], maxLength: number = DEFAULT_MAX_ARRAY_LENGTH): T[] {
  if (arr.length <= maxLength) {
    return arr;
  }
  return arr.slice(0, maxLength);
}

export function capObjectDepth(
  obj: unknown,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  currentDepth: number = 0
): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    return capString(obj);
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (currentDepth >= maxDepth) {
    if (Array.isArray(obj)) {
      return `[Array(${obj.length})]`;
    }
    return '[Object]';
  }

  if (Array.isArray(obj)) {
    const capped = capArrayLength(obj);
    return capped.map((item) => capObjectDepth(item, maxDepth, currentDepth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = capObjectDepth(value, maxDepth, currentDepth + 1);
  }
  return result;
}

export function redactKeys(
  obj: Record<string, unknown>,
  additionalKeys: string[] = []
): Record<string, unknown> {
  const keysToRedact = new Set([...REDACT_KEYS, ...additionalKeys.map((k) => k.toLowerCase())]);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase().replace(/[_-]/g, '');
    let shouldRedact = false;

    for (const redactKey of keysToRedact) {
      const normalizedRedactKey = redactKey.toLowerCase().replace(/[_-]/g, '');
      if (lowerKey === normalizedRedactKey || lowerKey.includes(normalizedRedactKey)) {
        shouldRedact = true;
        break;
      }
    }

    if (shouldRedact) {
      result[key] = '[REDACTED]';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactKeys(value as Record<string, unknown>, additionalKeys);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export interface ContextSummaryResult {
  contextPresent: boolean;
  contextSummary?: ContextSummary;
}

export function dropOrSummarizeContext(context?: ToolContext): ContextSummaryResult {
  if (!context) {
    return { contextPresent: false };
  }

  const summary: ContextSummary = {};

  if (context.cultureCode !== undefined) {
    summary.cultureCode = context.cultureCode;
  }
  if (context.currencyCode !== undefined) {
    summary.currencyCode = context.currencyCode;
  }
  if (context.salesAreaId !== undefined) {
    summary.salesAreaId = context.salesAreaId;
  }
  if (context.priceListIds !== undefined) {
    summary.priceListIdsCount = context.priceListIds.length;
  }
  if (context.customerId !== undefined) {
    summary.customerIdPresent = true;
  }
  if (context.companyId !== undefined) {
    summary.companyIdPresent = true;
  }

  return {
    contextPresent: true,
    contextSummary: Object.keys(summary).length > 0 ? summary : undefined,
  };
}

export function sanitizeToolArgs(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (key === 'context') {
      sanitized.contextPresent = value !== undefined && value !== null;
      continue;
    }

    if (isRedactedKey(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }

    if (typeof value === 'string') {
      sanitized[key] = capString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    } else if (Array.isArray(value)) {
      sanitized[key] = capArrayLength(value).map((item) =>
        typeof item === 'object' && item !== null
          ? capObjectDepth(item, 2)
          : item
      );
    } else if (value !== null && typeof value === 'object') {
      sanitized[key] = capObjectDepth(redactKeys(value as Record<string, unknown>), 2);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

export function sanitizeErrorDetails(details?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  const sanitized = redactKeys(details);
  return capObjectDepth(sanitized, 2) as Record<string, unknown>;
}
