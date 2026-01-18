import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { config } from '../config.js';
import pino from 'pino';

const logger = pino({ name: 'OpenAiClient' });

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface RunWithToolsInput {
  input: ChatCompletionMessageParam[];
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  /** Whether this is a streaming call (affects timeout/retry defaults) */
  isStreaming?: boolean;
  /** Override timeout in milliseconds (uses config defaults based on isStreaming if not provided) */
  timeoutMs?: number;
  /** Override max retries (uses config defaults based on isStreaming if not provided) */
  maxRetries?: number;
  /** Route identifier for logging (e.g., '/v1/chat' or '/v1/chat/stream') */
  route?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface OpenAiResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export interface OpenAiClientOptions {
  apiKey: string;
  defaultModel?: string;
}

/**
 * Thin wrapper around OpenAI client for tool calling via the Responses API.
 * 
 * This wrapper is intentionally minimal to:
 * - Isolate OpenAI SDK usage for easier model/SDK swaps later
 * - Provide a clean interface for mocking in tests
 * - Forward model/tools/input correctly to OpenAI
 * 
 * Timeout/retry behavior:
 * - Non-streaming calls: 2 minute timeout, 2 retries (configurable via env)
 * - Streaming calls: 5 minute timeout, 0 retries (retries on streams are bad UX)
 * - Per-call overrides available via timeoutMs and maxRetries options
 */
export class OpenAiClient {
  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxRetries: number;
  private readonly streamTimeoutMs: number;
  private readonly streamMaxRetries: number;

  constructor(options: OpenAiClientOptions) {
    this.defaultTimeoutMs = config.timeouts.openaiMs;
    this.defaultMaxRetries = config.openaiRetry.maxRetries;
    this.streamTimeoutMs = config.timeouts.openaiStreamMs;
    this.streamMaxRetries = config.openaiRetry.streamMaxRetries;

    this.client = new OpenAI({
      apiKey: options.apiKey,
      timeout: this.defaultTimeoutMs,
      maxRetries: this.defaultMaxRetries,
    });
    this.defaultModel = options.defaultModel ?? 'gpt-4o-mini';

    if (config.debug) {
      logger.debug({
        defaultTimeoutMs: this.defaultTimeoutMs,
        defaultMaxRetries: this.defaultMaxRetries,
        streamTimeoutMs: this.streamTimeoutMs,
        streamMaxRetries: this.streamMaxRetries,
      }, 'OpenAI client initialized with timeout/retry config');
    }
  }

  /**
   * Run a chat completion with optional tool definitions.
   * 
   * @param options - Input messages, tool definitions, and optional model override
   * @returns Response containing content and/or tool calls
   */
  async runWithTools(options: RunWithToolsInput): Promise<OpenAiResponse> {
    const { input, tools, model, maxTokens, isStreaming, route } = options;

    // Determine effective timeout and retries based on streaming mode
    const effectiveTimeoutMs = options.timeoutMs ?? (isStreaming ? this.streamTimeoutMs : this.defaultTimeoutMs);
    const effectiveMaxRetries = options.maxRetries ?? (isStreaming ? this.streamMaxRetries : this.defaultMaxRetries);

    // Log diagnostic info at debug level
    if (config.debug) {
      logger.debug({
        route: route ?? (isStreaming ? '/v1/chat/stream' : '/v1/chat'),
        isStreaming: isStreaming ?? false,
        openaiTimeoutMsEffective: effectiveTimeoutMs,
        maxRetriesEffective: effectiveMaxRetries,
        model: model ?? this.defaultModel,
      }, 'OpenAI request starting');
    }

    const startTime = Date.now();

    const chatTools: ChatCompletionTool[] | undefined = tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    try {
      const response = await this.client.chat.completions.create(
        {
          model: model ?? this.defaultModel,
          messages: input,
          tools: chatTools,
          tool_choice: chatTools && chatTools.length > 0 ? 'auto' : undefined,
          max_tokens: maxTokens,
        },
        {
          timeout: effectiveTimeoutMs,
          maxRetries: effectiveMaxRetries,
        }
      );

      const elapsedMs = Date.now() - startTime;

      if (config.debug) {
        logger.debug({
          route: route ?? (isStreaming ? '/v1/chat/stream' : '/v1/chat'),
          elapsedMs,
          finishReason: response.choices[0]?.finish_reason,
        }, 'OpenAI request completed');
      }

      const message = response.choices[0]?.message;

      const toolCalls: ToolCall[] = (message?.tool_calls ?? [])
        .filter((tc) => tc.type === 'function')
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

      return {
        content: message?.content ?? null,
        toolCalls,
        finishReason: response.choices[0]?.finish_reason ?? null,
      };
    } catch (error) {
      const elapsedMs = Date.now() - startTime;

      // Log error details without sensitive data
      const errorInfo = error instanceof Error ? {
        name: error.name,
        message: error.message,
        status: (error as Error & { status?: number }).status,
        code: (error as Error & { code?: string }).code,
      } : { message: String(error) };

      logger.error({
        route: route ?? (isStreaming ? '/v1/chat/stream' : '/v1/chat'),
        elapsedMs,
        configuredTimeoutMs: effectiveTimeoutMs,
        configuredMaxRetries: effectiveMaxRetries,
        error: errorInfo,
      }, 'OpenAI request failed');

      throw error;
    }
  }
}
