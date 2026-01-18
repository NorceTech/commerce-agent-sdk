import type { FastifyReply } from 'fastify';
import type { ChatResponse, ErrorEnvelope } from './responseTypes.js';
import { config } from '../config.js';

/**
 * SSE event types for the streaming endpoint.
 * 
 * - status: User-facing status messages (e.g., "Searching the catalog…")
 * - dev_status: Developer-oriented status messages (only emitted when debug=1)
 * - tool_start: Emitted when a tool begins execution
 * - tool_end: Emitted when a tool completes execution
 * - delta: Streams partial assistant text
 * - final: The complete ChatResponse (terminal event)
 * - error: Error information
 */
export type SseEventType = 'status' | 'dev_status' | 'tool_start' | 'tool_end' | 'delta' | 'final' | 'error';

/**
 * Status event data - indicates current processing state (user-facing).
 */
export interface StatusEventData {
  message: string;
}

/**
 * Developer status event data - detailed progress info for debugging.
 * Only emitted when debug mode is enabled (?debug=1).
 */
export interface DevStatusEventData {
  message: string;
  round: number;
  [key: string]: unknown;
}

/**
 * Tool start event data - emitted when a tool begins execution.
 */
export interface ToolStartEventData {
  tool: string;
  displayName: string;
  args: unknown;
}

/**
 * Tool end event data - emitted when a tool completes execution.
 */
export interface ToolEndEventData {
  tool: string;
  displayName: string;
  ok: boolean;
  resultSummary?: unknown;
  error?: string;
}

/**
 * Delta event data - streams partial assistant text.
 */
export interface DeltaEventData {
  text: string;
}

/**
 * Final event data - the complete ChatResponse.
 */
export type FinalEventData = ChatResponse;

/**
 * Error event data - emitted when an error occurs.
 * Uses the same ErrorEnvelope format as the chat endpoint for consistency.
 */
export type ErrorEventData = ErrorEnvelope;

/**
 * Union type for all SSE event data types.
 */
export type SseEventData =
  | StatusEventData
  | DevStatusEventData
  | ToolStartEventData
  | ToolEndEventData
  | DeltaEventData
  | FinalEventData
  | ErrorEventData;

/**
 * SSE event structure.
 */
export interface SseEvent {
  event: SseEventType;
  data: SseEventData;
}

/**
 * Formats an SSE event into the proper wire format.
 * Format: "event: <type>\ndata: <json>\n\n"
 * 
 * @param event - The event type
 * @param data - The event data (will be JSON stringified)
 * @returns Formatted SSE string
 */
export function formatSseEvent(event: SseEventType, data: SseEventData): string {
  const jsonData = JSON.stringify(data);
  return `event: ${event}\ndata: ${jsonData}\n\n`;
}

/**
 * SSE writer helper for streaming responses.
 * Provides methods to emit different event types and ensures proper termination.
 */
export class SseWriter {
  private reply: FastifyReply;
  private terminated = false;
  private origin?: string;

  constructor(reply: FastifyReply, origin?: string) {
    this.reply = reply;
    this.origin = origin;
  }

  /**
   * Initialize the SSE response with proper headers.
   * Includes CORS headers since writeHead bypasses Fastify's CORS middleware.
   */
  init(): void {
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };

    // Add CORS headers for allowed origins
    // This is necessary because writeHead bypasses Fastify's CORS middleware
    if (this.origin && config.cors.origins.includes(this.origin)) {
      headers['Access-Control-Allow-Origin'] = this.origin;
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    } else if (!this.origin) {
      // For requests without origin (curl, server-to-server), allow all
      headers['Access-Control-Allow-Origin'] = '*';
      headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    }

    this.reply.raw.writeHead(200, headers);
  }

  /**
   * Write raw data to the response stream.
   */
  private write(data: string): void {
    if (this.terminated) {
      return;
    }
    this.reply.raw.write(data);
  }

  /**
   * Emit a status event (user-facing).
   */
  status(message: string): void {
    const data: StatusEventData = { message };
    this.write(formatSseEvent('status', data));
  }

  /**
   * Emit a dev_status event (developer-oriented).
   * Only call this when debug mode is enabled.
   */
  devStatus(data: DevStatusEventData): void {
    this.write(formatSseEvent('dev_status', data));
  }

  /**
   * Emit a tool_start event.
   */
  toolStart(tool: string, displayName: string, args: unknown): void {
    const data: ToolStartEventData = { tool, displayName, args };
    this.write(formatSseEvent('tool_start', data));
  }

  /**
   * Emit a tool_end event.
   */
  toolEnd(tool: string, displayName: string, ok: boolean, resultSummary?: unknown, error?: string): void {
    const data: ToolEndEventData = { tool, displayName, ok };
    if (resultSummary !== undefined) {
      data.resultSummary = resultSummary;
    }
    if (error !== undefined) {
      data.error = error;
    }
    this.write(formatSseEvent('tool_end', data));
  }

  /**
   * Emit a delta event with partial text.
   */
  delta(text: string): void {
    const data: DeltaEventData = { text };
    this.write(formatSseEvent('delta', data));
  }

  /**
   * Emit the final event with the complete response.
   * This terminates the stream.
   */
  final(response: ChatResponse): void {
    if (this.terminated) {
      return;
    }
    this.write(formatSseEvent('final', response));
    this.terminate();
  }

  /**
   * Emit an error event without terminating the stream.
   * Use this when you want to emit error followed by final.
   */
  error(errorData: ErrorEventData): void {
    if (this.terminated) {
      return;
    }
    this.write(formatSseEvent('error', errorData));
  }

  /**
   * Emit an error event and terminate the stream.
   * Use this when you want to emit error as the terminal event.
   */
  errorAndTerminate(errorData: ErrorEventData): void {
    if (this.terminated) {
      return;
    }
    this.write(formatSseEvent('error', errorData));
    this.terminate();
  }

  /**
   * Terminate the stream.
   */
  private terminate(): void {
    if (this.terminated) {
      return;
    }
    this.terminated = true;
    this.reply.raw.end();
  }

  /**
   * Check if the stream has been terminated.
   */
  isTerminated(): boolean {
    return this.terminated;
  }
}

/**
 * Callbacks for streaming agent execution.
 * These are invoked during the agent turn to emit SSE events.
 */
export interface StreamingCallbacks {
  onStatus?: (message: string) => void;
  onDevStatus?: (data: DevStatusEventData) => void;
  onToolStart?: (tool: string, displayName: string, args: unknown) => void;
  onToolEnd?: (tool: string, displayName: string, ok: boolean, resultSummary?: unknown, error?: string) => void;
  onDelta?: (text: string) => void;
}
