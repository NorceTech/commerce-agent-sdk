import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());
const MockOpenAIConstructor = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
      constructor(...args: unknown[]) {
        MockOpenAIConstructor(...args);
      }
    },
  };
});

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
    timeouts: {
      oauthMs: 5000,
      mcpCallMs: 10000,
      openaiMs: 120000,
      openaiStreamMs: 300000,
    },
    retry: {
      maxAttempts: 2,
      baseDelayMs: 500,
      jitterMs: 200,
    },
    openaiRetry: {
      maxRetries: 2,
      streamMaxRetries: 0,
    },
    debug: false,
    limits: {
      bodyLimitBytes: 131072,
      maxMessageChars: 4000,
      maxMessageTokensEst: 1200,
    },
  },
}));

import { OpenAiClient } from '../openai/OpenAiClient.js';

describe('OpenAiClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create OpenAI client with provided API key and timeout/retry config', () => {
      new OpenAiClient({ apiKey: 'test-api-key' });

      expect(MockOpenAIConstructor).toHaveBeenCalledWith({
        apiKey: 'test-api-key',
        timeout: 120000,
        maxRetries: 2,
      });
    });

    it('should use default model gpt-4o-mini when not specified', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Hello', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      await client.runWithTools({
        input: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o-mini',
        }),
        expect.objectContaining({
          timeout: 120000,
          maxRetries: 2,
        })
      );
    });
  });

  describe('runWithTools', () => {
    it('should forward input messages correctly to OpenAI', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Response', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      const inputMessages = [
        { role: 'system' as const, content: 'You are a helpful assistant' },
        { role: 'user' as const, content: 'Hello' },
      ];

      await client.runWithTools({ input: inputMessages });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: inputMessages,
        }),
        expect.objectContaining({
          timeout: 120000,
          maxRetries: 2,
        })
      );
    });

    it('should forward tools correctly to OpenAI', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Response', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      const tools = [
        {
          name: 'search_products',
          description: 'Search for products',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ];

      await client.runWithTools({
        input: [{ role: 'user', content: 'Search for laptops' }],
        tools,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'search_products',
                description: 'Search for products',
                parameters: {
                  type: 'object',
                  properties: {
                    query: { type: 'string' },
                  },
                  required: ['query'],
                },
              },
            },
          ],
          tool_choice: 'auto',
        }),
        expect.objectContaining({
          timeout: 120000,
          maxRetries: 2,
        })
      );
    });

    it('should forward model override correctly to OpenAI', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Response', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({
        apiKey: 'test-api-key',
        defaultModel: 'gpt-4o',
      });

      await client.runWithTools({
        input: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4-turbo',
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4-turbo',
        }),
        expect.objectContaining({
          timeout: 120000,
          maxRetries: 2,
        })
      );
    });

    it('should return content from OpenAI response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Hello, how can I help you?', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      const response = await client.runWithTools({
        input: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello, how can I help you?');
      expect(response.toolCalls).toEqual([]);
      expect(response.finishReason).toBe('stop');
    });

    it('should return tool calls from OpenAI response', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'search_products',
                    arguments: '{"query":"laptops"}',
                  },
                },
                {
                  id: 'call_456',
                  type: 'function',
                  function: {
                    name: 'get_product',
                    arguments: '{"productId":"abc123"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      const response = await client.runWithTools({
        input: [{ role: 'user', content: 'Search for laptops' }],
        tools: [
          {
            name: 'search_products',
            description: 'Search for products',
            parameters: { type: 'object', properties: { query: { type: 'string' } } },
          },
        ],
      });

      expect(response.content).toBeNull();
      expect(response.toolCalls).toEqual([
        {
          id: 'call_123',
          name: 'search_products',
          arguments: '{"query":"laptops"}',
        },
        {
          id: 'call_456',
          name: 'get_product',
          arguments: '{"productId":"abc123"}',
        },
      ]);
      expect(response.finishReason).toBe('tool_calls');
    });

    it('should not set tool_choice when no tools are provided', async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: { content: 'Response', tool_calls: undefined },
            finish_reason: 'stop',
          },
        ],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      await client.runWithTools({
        input: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: undefined,
          tool_choice: undefined,
        }),
        expect.objectContaining({
          timeout: 120000,
          maxRetries: 2,
        })
      );
    });

    it('should handle empty choices array gracefully', async () => {
      mockCreate.mockResolvedValue({
        choices: [],
      });

      const client = new OpenAiClient({ apiKey: 'test-api-key' });
      const response = await client.runWithTools({
        input: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBeNull();
      expect(response.toolCalls).toEqual([]);
      expect(response.finishReason).toBeNull();
    });
  });
});
