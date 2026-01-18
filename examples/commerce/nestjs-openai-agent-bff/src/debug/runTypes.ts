import type { ErrorCategory } from '../errors/index.js';

export type RunRoute = 'POST /v1/chat' | 'POST /v1/chat/stream';

export type RunStatus = 'ok' | 'error';

export type ToolOutcome = 'ok' | 'error';

export interface ContextSummary {
  cultureCode?: string;
  currencyCode?: string;
  salesAreaId?: number;
  priceListIdsCount?: number;
  customerIdPresent?: boolean;
  companyIdPresent?: boolean;
}

export interface RunRequest {
  message: string;
  contextPresent: boolean;
  contextSummary?: ContextSummary;
}

export interface ResponseShape {
  hasCards: boolean;
  hasComparison: boolean;
  toolCalls: number;
}

export interface RunResult {
  status: RunStatus;
  httpStatus?: number;
  textSnippet?: string;
  responseShape?: ResponseShape;
}

export interface ToolTraceItem {
  t: number;
  tool: string;
  args: Record<string, unknown>;
  outcome: ToolOutcome;
  errorCategory?: string;
  errorMessage?: string;
  mcpRequestId?: number | string;
  mcpSessionIdPresent?: boolean;
  durationMs?: number;
}

export interface OpenAiTrace {
  rounds: number;
  model: string;
  finishReason?: string;
  tokens?: {
    input?: number;
    output?: number;
  };
}

export interface RunError {
  category: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface RunRecord {
  runId: string;
  createdAt: number;
  durationMs: number;
  route: RunRoute;
  applicationId: string;
  sessionId: string;
  request: RunRequest;
  result: RunResult;
  toolTrace: ToolTraceItem[];
  openaiTrace: OpenAiTrace;
  errors?: RunError[];
}

export interface RunRecordSummary {
  runId: string;
  createdAt: number;
  applicationId: string;
  sessionId: string;
  status: RunStatus;
  durationMs: number;
  toolCalls: number;
  textSnippet?: string;
}

export interface ListRunsOptions {
  limit?: number;
  applicationId?: string;
  sessionId?: string;
}

export interface RunStoreOptions {
  maxRuns: number;
  ttlMs: number;
}

export function toRunRecordSummary(record: RunRecord): RunRecordSummary {
  return {
    runId: record.runId,
    createdAt: record.createdAt,
    applicationId: record.applicationId,
    sessionId: record.sessionId,
    status: record.result.status,
    durationMs: record.durationMs,
    toolCalls: record.toolTrace.length,
    textSnippet: record.result.textSnippet,
  };
}
