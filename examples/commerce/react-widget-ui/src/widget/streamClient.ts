import { fetchEventSource } from '@microsoft/fetch-event-source';
import type { ChatRequest, ChatResponse, DeltaEvent, ErrorEnvelope } from './types';

export interface StreamCallbacks {
  onDelta: (text: string) => void;
  onFinal: (response: ChatResponse) => void;
  onError: (error: ErrorEnvelope) => void;
  onStatus?: (message: string) => void;
  onToolStart?: (tool: string, displayName?: string) => void;
  onToolEnd?: (tool: string, ok: boolean, displayName?: string) => void;
}

export interface ChatStreamOptions {
  endpoint: string;
  token: string;
  request: ChatRequest;
  callbacks: StreamCallbacks;
  signal: AbortSignal;
}

function isDeltaEvent(data: unknown): data is DeltaEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'text' in data &&
    typeof (data as DeltaEvent).text === 'string' &&
    !('sessionId' in data)
  );
}

function isChatResponse(data: unknown): data is ChatResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'sessionId' in data &&
    'turnId' in data &&
    typeof (data as ChatResponse).sessionId === 'string' &&
    typeof (data as ChatResponse).turnId === 'string'
  );
}

function isErrorEvent(data: unknown): data is { error: ErrorEnvelope } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof (data as { error: ErrorEnvelope }).error === 'object'
  );
}

export async function chatStream(options: ChatStreamOptions): Promise<void> {
  const { endpoint, token, request, callbacks, signal } = options;
  const url = `${endpoint}/v1/chat/stream`;

  await fetchEventSource(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
    signal,
    openWhenHidden: true,
    onopen: async (response) => {
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AuthError(response.status);
        }
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
    },
    onmessage: (event) => {
      if (!event.data) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        console.warn('Failed to parse SSE data:', event.data);
        return;
      }

      const eventType = event.event || '';

      if (eventType === 'delta') {
        if (isDeltaEvent(parsed)) {
          callbacks.onDelta(parsed.text);
        }
      } else if (eventType === 'error') {
        if (isErrorEvent(parsed)) {
          callbacks.onError(parsed.error);
        }
      } else if (eventType === 'final') {
        if (isChatResponse(parsed)) {
          callbacks.onFinal(parsed);
        }
      } else if (eventType === 'status') {
        const data = parsed as { message?: string };
        if (typeof data.message === 'string' && callbacks.onStatus) {
          callbacks.onStatus(data.message);
        }
      } else if (eventType === 'tool_start') {
        const data = parsed as { tool?: string; displayName?: string };
        if (typeof data.tool === 'string' && callbacks.onToolStart) {
          callbacks.onToolStart(data.tool, data.displayName);
        }
      } else if (eventType === 'tool_end') {
        const data = parsed as { tool?: string; ok?: boolean; displayName?: string };
        if (
          typeof data.tool === 'string' &&
          typeof data.ok === 'boolean' &&
          callbacks.onToolEnd
        ) {
          callbacks.onToolEnd(data.tool, data.ok, data.displayName);
        }
      }else {
        if (isDeltaEvent(parsed)) {
          callbacks.onDelta(parsed.text);
        } else if (isChatResponse(parsed)) {
          callbacks.onFinal(parsed);
        } else if (isErrorEvent(parsed)) {
          callbacks.onError(parsed.error);
        }
      }
    },
    onerror: (err) => {
      if (err instanceof AuthError) {
        throw err;
      }
      if (signal.aborted) {
        return;
      }
      console.error('SSE error:', err);
      callbacks.onError({
        category: 'internal',
        code: 'SSE_ERROR',
        message: err instanceof Error ? err.message : 'Stream connection error',
        retryable: true,
      });
      throw err;
    },
  });
}

export class AuthError extends Error {
  status: number;
  constructor(status: number) {
    super(`Authentication failed with status ${status}`);
    this.name = 'AuthError';
    this.status = status;
  }
}
