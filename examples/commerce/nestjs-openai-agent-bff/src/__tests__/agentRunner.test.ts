import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('../config.js', () => ({
  config: {
    port: 3000,
    openai: {
      apiKey: 'test-api-key',
      model: 'gpt-4o-mini',
    },
    norce: {
      mcp: {
        baseUrl: 'https://test.api.norce.tech/mcp/commerce',
        defaultApplicationId: 'test-app-id',
        allowedApplicationIds: [],
      },
      oauth: {
        tokenUrl: 'https://test.auth.norce.tech/token',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        scope: 'test-scope',
      },
    },
    session: {
      ttlSeconds: 1800,
    },
    agent: {
      maxRounds: 6,
      maxToolCallsPerRound: 3,
    },
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import {
  AgentRunner,
  ConversationMessage,
  MalformedToolArgsError,
} from '../agent/agentRunner.js';
import { Tool } from '../agent/tools.js';
import { OpenAiClient, OpenAiResponse } from '../openai/OpenAiClient.js';
import type { McpState } from '../session/sessionTypes.js';
import { MAX_ROUNDS_FALLBACK_RESPONSE } from '../agent/prompts.js';

function createMockOpenAiClient() {
  return {
    runWithTools: vi.fn(),
  } as unknown as OpenAiClient;
}

function createMockTool(name: string, executeResult: unknown = { success: true }): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: z.object({
      query: z.string().optional(),
      context: z.object({}).passthrough().optional(),
    }),
    execute: vi.fn().mockResolvedValue(executeResult),
  };
}

function createMcpState(): McpState {
  return {
    sessionId: undefined,
    nextRpcId: 1,
  };
}

describe('AgentRunner', () => {
  describe('runAgentTurn', () => {
    let mockOpenAiClient: ReturnType<typeof createMockOpenAiClient>;
    let mcpState: McpState;

    beforeEach(() => {
      mockOpenAiClient = createMockOpenAiClient();
      mcpState = createMcpState();
      vi.clearAllMocks();
    });

    it('should return final text when OpenAI responds without tool calls', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Hello! How can I help you today?',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Hello', conversation, mcpState);

      expect(result.message).toBe('Hello! How can I help you today?');
      expect(result.toolTrace).toEqual([]);
      expect(result.roundsUsed).toBe(1);
      expect(result.hitMaxRounds).toBe(false);
    });

    it('should execute tool call and return final answer (tool-call then final flow)', async () => {
      const mockProductSearchTool = createMockTool('product_search', {
        items: [
          { id: '1', name: 'Laptop A', price: 999 },
          { id: '2', name: 'Laptop B', price: 1299 },
        ],
        totalCount: 2,
        truncated: false,
      });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_123',
            name: 'product_search',
            arguments: JSON.stringify({ query: 'laptops', context: {} }),
          },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'I found 2 laptops for you:\n1. Laptop A - $999\n2. Laptop B - $1299',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [mockProductSearchTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Show me some laptops', conversation, mcpState);

      expect(mockProductSearchTool.execute).toHaveBeenCalledTimes(1);
      expect(mockProductSearchTool.execute).toHaveBeenCalledWith(
        { query: 'laptops', context: {} },
        mcpState,
        undefined,
        undefined
      );

      expect(result.message).toBe('I found 2 laptops for you:\n1. Laptop A - $999\n2. Laptop B - $1299');
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0]).toEqual({
        tool: 'product_search',
        args: { query: 'laptops', context: {} },
        result: {
          items: [
            { id: '1', name: 'Laptop A', price: 999 },
            { id: '2', name: 'Laptop B', price: 1299 },
          ],
          totalCount: 2,
          truncated: false,
        },
        thumbnailsPresentCount: 0,
      });
      expect(result.roundsUsed).toBe(2);
      expect(result.hitMaxRounds).toBe(false);

      expect(runWithToolsMock).toHaveBeenCalledTimes(2);
    });

    it('should stop at max rounds and return fallback response', async () => {
      const mockTool = createMockTool('product_search', { items: [], totalCount: 0 });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      for (let i = 0; i < 10; i++) {
        runWithToolsMock.mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: `call_${i}`,
              name: 'product_search',
              arguments: JSON.stringify({ query: `search ${i}`, context: {} }),
            },
          ],
          finishReason: 'tool_calls',
        });
      }

      const maxRounds = 3;
      const runner = new AgentRunner({
        tools: [mockTool],
        openaiClient: mockOpenAiClient,
        maxRounds,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Find something', conversation, mcpState);

      expect(result.message).toBe(MAX_ROUNDS_FALLBACK_RESPONSE);
      expect(result.roundsUsed).toBe(maxRounds);
      expect(result.hitMaxRounds).toBe(true);

      expect(runWithToolsMock).toHaveBeenCalledTimes(maxRounds);
      expect(mockTool.execute).toHaveBeenCalledTimes(maxRounds);
    });

    it('should limit tool calls per round to maxToolCallsPerRound', async () => {
      const mockTool = createMockTool('product_search', { items: [] });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'call_1', name: 'product_search', arguments: JSON.stringify({ query: 'a' }) },
          { id: 'call_2', name: 'product_search', arguments: JSON.stringify({ query: 'b' }) },
          { id: 'call_3', name: 'product_search', arguments: JSON.stringify({ query: 'c' }) },
          { id: 'call_4', name: 'product_search', arguments: JSON.stringify({ query: 'd' }) },
          { id: 'call_5', name: 'product_search', arguments: JSON.stringify({ query: 'e' }) },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'Done searching',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [mockTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 2,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Search multiple', conversation, mcpState);

      expect(mockTool.execute).toHaveBeenCalledTimes(2);
      expect(result.toolTrace).toHaveLength(2);
      expect(result.message).toBe('Done searching');
    });

    it('should throw MalformedToolArgsError for invalid JSON arguments', async () => {
      const mockTool = createMockTool('product_search');

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_bad',
            name: 'product_search',
            arguments: 'not valid json {{{',
          },
        ],
        finishReason: 'tool_calls',
      });

      const runner = new AgentRunner({
        tools: [mockTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];

      await expect(runner.runAgentTurn('Test', conversation, mcpState)).rejects.toThrow(
        MalformedToolArgsError
      );
    });

    it('should throw MalformedToolArgsError for arguments that fail schema validation', async () => {
      const strictTool: Tool = {
        name: 'strict_tool',
        description: 'A tool with strict schema',
        parameters: z.object({
          requiredField: z.string(),
        }),
        execute: vi.fn().mockResolvedValue({ success: true }),
      };

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_invalid',
            name: 'strict_tool',
            arguments: JSON.stringify({ wrongField: 'value' }),
          },
        ],
        finishReason: 'tool_calls',
      });

      const runner = new AgentRunner({
        tools: [strictTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];

      await expect(runner.runAgentTurn('Test', conversation, mcpState)).rejects.toThrow(
        MalformedToolArgsError
      );
    });

    it('should handle unknown tool gracefully', async () => {
      const mockTool = createMockTool('product_search');

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_unknown',
            name: 'unknown_tool',
            arguments: JSON.stringify({}),
          },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'I could not find that tool',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [mockTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Use unknown tool', conversation, mcpState);

      expect(mockTool.execute).not.toHaveBeenCalled();
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0].error).toBe('Unknown tool: unknown_tool');
      expect(result.message).toBe('I could not find that tool');
    });

    it('should handle tool execution errors gracefully', async () => {
      const failingTool: Tool = {
        name: 'failing_tool',
        description: 'A tool that fails',
        parameters: z.object({}).passthrough(),
        execute: vi.fn().mockRejectedValue(new Error('Tool execution failed')),
      };

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_fail',
            name: 'failing_tool',
            arguments: JSON.stringify({}),
          },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'Sorry, there was an error',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [failingTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const result = await runner.runAgentTurn('Try failing tool', conversation, mcpState);

      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0].error).toBe('Tool execution failed');
      expect(result.message).toBe('Sorry, there was an error');
    });

    it('should append user message to conversation', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      await runner.runAgentTurn('User message', conversation, mcpState);

      expect(conversation[0]).toEqual({
        role: 'user',
        content: 'User message',
      });
    });

    it('should append assistant message to conversation', async () => {
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Assistant response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      await runner.runAgentTurn('Hello', conversation, mcpState);

      expect(conversation).toHaveLength(2);
      expect(conversation[1]).toEqual({
        role: 'assistant',
        content: 'Assistant response',
      });
    });

    it('should append tool call messages to conversation', async () => {
      const mockTool = createMockTool('product_search', { items: [] });

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_123',
            name: 'product_search',
            arguments: JSON.stringify({ query: 'test' }),
          },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'Done',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [mockTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      await runner.runAgentTurn('Search', conversation, mcpState);

      expect(conversation.some((msg) => msg.role === 'tool')).toBe(true);
      expect(conversation.some((msg) => msg.tool_calls !== undefined)).toBe(true);
    });
  });

  describe('MalformedToolArgsError', () => {
    it('should contain tool name, raw args, and parse error', () => {
      const error = new MalformedToolArgsError(
        'product_search',
        '{invalid}',
        'Unexpected token'
      );

      expect(error.toolName).toBe('product_search');
      expect(error.rawArgs).toBe('{invalid}');
      expect(error.parseError).toBe('Unexpected token');
      expect(error.name).toBe('MalformedToolArgsError');
      expect(error.message).toContain('product_search');
      expect(error.message).toContain('Unexpected token');
    });
  });

  describe('legacy run method', () => {
    it('should work with legacy message format', async () => {
      const mockOpenAiClient = createMockOpenAiClient();
      (mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: 'Legacy response',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const messages = [
        { role: 'user' as const, content: 'Hello' },
      ];

      const result = await runner.run(messages, createMcpState());

      expect(result.role).toBe('assistant');
      expect(result.content).toBe('Legacy response');
    });
  });

  describe('product_get with numeric productId', () => {
    it('should accept numeric productId and coerce to string without MalformedToolArgsError', async () => {
      const mockOpenAiClient = createMockOpenAiClient();
      
      // Import the actual productGetSchema to test the real coercion
      const { productGetSchema } = await import('../agent/tools.js');
      
      const productGetTool: Tool = {
        name: 'product_get',
        description: 'Get product details',
        parameters: productGetSchema,
        execute: vi.fn().mockResolvedValue({ id: '123', name: 'Test Product' }),
      };

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Simulate OpenAI sending numeric productId (which happens in practice)
      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_product_get',
            name: 'product_get',
            arguments: JSON.stringify({ productId: 123, context: {} }), // numeric productId
          },
        ],
        finishReason: 'tool_calls',
      });

      runWithToolsMock.mockResolvedValueOnce({
        content: 'Here is the product details',
        toolCalls: [],
        finishReason: 'stop',
      });

      const runner = new AgentRunner({
        tools: [productGetTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const mcpState = createMcpState();

      // This should NOT throw MalformedToolArgsError
      const result = await runner.runAgentTurn('Get product 123', conversation, mcpState);

      expect(result.message).toBe('Here is the product details');
      expect(result.toolTrace).toHaveLength(1);
      expect(result.toolTrace[0].error).toBeUndefined();
      
      // Verify the execute was called with coerced string productId
      expect(productGetTool.execute).toHaveBeenCalledWith(
        expect.objectContaining({ productId: '123' }), // coerced to string
        mcpState,
        undefined,
        undefined
      );
    });

    it('should reject product_get when both productId and partNo are missing', async () => {
      const mockOpenAiClient = createMockOpenAiClient();
      
      const { productGetSchema } = await import('../agent/tools.js');
      
      const productGetTool: Tool = {
        name: 'product_get',
        description: 'Get product details',
        parameters: productGetSchema,
        execute: vi.fn().mockResolvedValue({ id: '123', name: 'Test Product' }),
      };

      const runWithToolsMock = mockOpenAiClient.runWithTools as ReturnType<typeof vi.fn>;

      // Simulate OpenAI sending neither productId nor partNo
      runWithToolsMock.mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_product_get',
            name: 'product_get',
            arguments: JSON.stringify({ context: {} }), // missing both productId and partNo
          },
        ],
        finishReason: 'tool_calls',
      });

      const runner = new AgentRunner({
        tools: [productGetTool],
        openaiClient: mockOpenAiClient,
        maxRounds: 6,
        maxToolCallsPerRound: 3,
      });

      const conversation: ConversationMessage[] = [];
      const mcpState = createMcpState();

      // This should throw MalformedToolArgsError due to refine rule
      await expect(runner.runAgentTurn('Get product', conversation, mcpState)).rejects.toThrow(
        MalformedToolArgsError
      );
    });
  });
});
