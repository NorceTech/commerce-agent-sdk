import { fetch } from 'undici';
import type { McpState } from '../session/sessionTypes.js';
import pino from 'pino';
import { withTimeout } from '../http/timeout.js';
import { retryAsync } from '../http/retry.js';
import { isMcpRetryable } from '../http/retryPolicy.js';
import { config } from '../config.js';

const logger = pino({ name: 'NorceMcpClient' });

/**
 * JSON-RPC request structure for MCP protocol.
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * JSON-RPC response structure from MCP server.
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Options for NorceMcpClient constructor.
 */
export interface NorceMcpClientOptions {
  baseUrl: string;
}

/**
 * Schema definition for an MCP tool parameter.
 */
export interface McpToolInputSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

/**
 * Definition of a single MCP tool from tools/list response.
 */
export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: McpToolInputSchema;
}

/**
 * Result from MCP tools/list request.
 */
export interface McpToolsListResult {
  tools: McpToolDefinition[];
}

/**
 * NorceMcpClient implements the Streamable HTTP JSON-RPC protocol for Norce MCP.
 *
 * Features:
 * - Session initialization with JSON-RPC initialize + notifications/initialized
 * - mcp-session-id header management for session continuity
 * - Proper JSON-RPC id incrementing via state.nextRpcId
 * - Authorization and application-id headers on all requests
 */
export class NorceMcpClient {
  private readonly baseUrl: string;

  constructor(options: NorceMcpClientOptions) {
    this.baseUrl = options.baseUrl;
  }

  /**
   * Ensure the MCP session is initialized.
   * If state.sessionId is already set, this is a no-op.
   * Otherwise, sends initialize + notifications/initialized and stores the session ID.
   *
   * @param state - The MCP state object (will be mutated to store sessionId)
   * @param accessToken - OAuth access token for authorization
   * @param applicationId - Application ID for the request (passed per call, not stored)
   */
  async ensureInitialized(state: McpState, accessToken: string, applicationId: string): Promise<void> {
    if (state.sessionId) {
      return;
    }

    const initializeRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: state.nextRpcId++,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'nc-commerce-agent-poc',
          version: '1.0.0',
        },
      },
    };

    const initResponse = await this.sendRequest(initializeRequest, accessToken, undefined, applicationId);

    const sessionId = initResponse.sessionId;

    if (initResponse.response.error) {
      throw new Error(
        `MCP initialize failed: ${initResponse.response.error.message} (code: ${initResponse.response.error.code})`
      );
    }

    const initializedNotification: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    };

    await this.sendRequest(initializedNotification, accessToken, sessionId, applicationId);

    if (sessionId) {
      state.sessionId = sessionId;
    }
  }

  /**
   * List all available MCP tools.
   * Ensures the session is initialized first, then sends the tools/list request.
   *
   * @param state - The MCP state object
   * @param accessToken - OAuth access token for authorization
   * @param applicationId - Application ID for the request (passed per call, not stored)
   * @returns The tools list response containing tool definitions
   */
  async listTools(
    state: McpState,
    accessToken: string,
    applicationId: string
  ): Promise<McpToolsListResult> {
    await this.ensureInitialized(state, accessToken, applicationId);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: state.nextRpcId++,
      method: 'tools/list',
    };

    const { response, sessionId } = await this.sendRequest(request, accessToken, state.sessionId, applicationId);

    if (sessionId && !state.sessionId) {
      state.sessionId = sessionId;
    }

    if (response.error) {
      throw new Error(
        `MCP tools/list failed: ${response.error.message} (code: ${response.error.code})`
      );
    }

    return response.result as McpToolsListResult;
  }

  /**
   * Call an MCP tool.
   * Ensures the session is initialized first, then sends the tools/call request.
   * Retries on transient errors (network issues, 502/503/504) with exponential backoff.
   *
   * @param state - The MCP state object
   * @param toolName - Name of the tool to call (e.g., 'product.search')
   * @param args - Arguments to pass to the tool
   * @param accessToken - OAuth access token for authorization
   * @param applicationId - Application ID for the request (passed per call, not stored)
   * @returns The result from the tool call
   */
  async callTool(
    state: McpState,
    toolName: string,
    args: Record<string, unknown>,
    accessToken: string,
    applicationId: string
  ): Promise<unknown> {
    await this.ensureInitialized(state, accessToken, applicationId);

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: state.nextRpcId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    const { response, sessionId } = await retryAsync(
      () => this.sendRequest(request, accessToken, state.sessionId, applicationId),
      {
        retries: config.retry.maxAttempts,
        baseDelayMs: config.retry.baseDelayMs,
        jitter: config.retry.jitterMs,
        shouldRetry: isMcpRetryable,
        label: `MCP tools/call ${toolName}`,
      }
    );

    if (sessionId && !state.sessionId) {
      state.sessionId = sessionId;
    }

    if (response.error) {
      throw new Error(
        `MCP tool call failed: ${response.error.message} (code: ${response.error.code})`
      );
    }

    return response.result;
  }

  /**
   * Send a JSON-RPC request to the MCP server.
   *
   * @param request - The JSON-RPC request to send
   * @param accessToken - OAuth access token for authorization
   * @param sessionId - Optional MCP session ID to include in headers
   * @param applicationId - Application ID for the request header
   * @returns The JSON-RPC response and any session ID from response headers
   */
  private async sendRequest(
    request: JsonRpcRequest,
    accessToken: string,
    sessionId: string | undefined,
    applicationId: string
  ): Promise<{ response: JsonRpcResponse; sessionId: string | undefined }> {
    // Safeguard: non-notification methods must have an id
    const isNotification = request.method.startsWith('notifications/');
    if (!isNotification && request.id === undefined) {
      throw new Error(
        `Bug: JSON-RPC request for method '${request.method}' is missing an id. ` +
        `Only notifications should omit id.`
      );
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
      'application-id': applicationId,
    };

    if (sessionId) {
      headers['mcp-session-id'] = sessionId;
    }

    const response = await withTimeout(
      (signal) => fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal,
      }),
      config.timeouts.mcpCallMs,
      `MCP ${request.method}`
    );

    const contentType = response.headers.get('content-type') ?? '';
    const responseSessionId = response.headers.get('mcp-session-id') ?? undefined;

    // Handle non-OK responses with debug-safe error info (except 202)
    if (!response.ok && response.status !== 202) {
      const errorBody = await response.text().catch(() => 'Unable to read error body');
      const bodySnippet = errorBody.substring(0, 2000);
      throw new Error(
        `MCP request failed: status=${response.status}, content-type=${contentType}, body=${bodySnippet}`
      );
    }

    // HTTP 202 Accepted: per MCP Streamable HTTP spec, this is expected for
    // JSON-RPC notifications (no id) - server acknowledges but has no response body
    if (response.status === 202) {
      return {
        response: { jsonrpc: '2.0', result: { accepted: true } },
        sessionId: responseSessionId,
      };
    }

    // Read body as text first for better error diagnostics
    const rawBody = await response.text();

    let jsonResponse: JsonRpcResponse;
    try {
      if (contentType.includes('text/event-stream')) {
        jsonResponse = this.parseSSEResponse(rawBody, request.id);
      } else {
        // Default to JSON parsing (handles application/json and other types)
        jsonResponse = JSON.parse(rawBody) as JsonRpcResponse;
      }
    } catch (error) {
      const bodySnippet = rawBody.substring(0, 2000);
      const toolName = request.method === 'tools/call' 
        ? (request.params?.name as string | undefined) 
        : undefined;
      logger.error(
        { 
          status: response.status, 
          contentType, 
          bodySnippet,
          method: request.method,
          id: request.id,
          ...(toolName && { toolName }),
        },
        'Failed to parse MCP response'
      );
      throw new Error(
        `Failed to parse MCP response: status=${response.status}, content-type=${contentType}, ` +
        `method=${request.method}, id=${request.id}` +
        (toolName ? `, toolName=${toolName}` : '') +
        `, body=${bodySnippet}`
      );
    }

    return {
      response: jsonResponse,
      sessionId: responseSessionId,
    };
  }

  /**
   * Parse SSE (Server-Sent Events) response body into JSON-RPC response.
   * 
   * SSE format: lines starting with "data:" contain JSON payloads,
   * events are separated by blank lines.
   * 
   * @param rawBody - The raw SSE response body
   * @param requestId - The JSON-RPC request ID to match (undefined for notifications)
   * @returns The matching JSON-RPC response or the last parsed object
   */
  private parseSSEResponse(rawBody: string, requestId: number | undefined): JsonRpcResponse {
    const lines = rawBody.split('\n');
    const parsedObjects: JsonRpcResponse[] = [];

    for (const line of lines) {
      // Skip empty lines and SSE comments (lines starting with :)
      if (!line.trim() || line.startsWith(':')) {
        continue;
      }

      // Extract data from "data:" lines
      if (line.startsWith('data:')) {
        const payload = line.substring(5).trim();
        
        // Skip non-JSON payloads like [DONE]
        if (!payload || payload === '[DONE]') {
          continue;
        }

        try {
          const parsed = JSON.parse(payload) as JsonRpcResponse;
          parsedObjects.push(parsed);
        } catch {
          // Skip lines that aren't valid JSON
          continue;
        }
      }
    }

    if (parsedObjects.length === 0) {
      throw new Error('No valid JSON-RPC responses found in SSE stream');
    }

    // If request has an ID, try to find matching response
    if (requestId !== undefined) {
      const matchingResponse = parsedObjects.find(obj => obj.id === requestId);
      if (matchingResponse) {
        return matchingResponse;
      }
    }

    // Return the last parsed object as fallback
    return parsedObjects[parsedObjects.length - 1];
  }
}
