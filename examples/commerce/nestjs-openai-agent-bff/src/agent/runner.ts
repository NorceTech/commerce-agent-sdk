import OpenAI from 'openai';
import { z } from 'zod';
import { Tool } from './tools.js';
import { config } from '../config.js';
import type { McpState } from '../session/sessionTypes.js';
import pino from 'pino';

const logger = pino({ name: 'runner' });

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AgentRunnerOptions {
  tools: Tool[];
  openaiApiKey?: string;
  model?: string;
  systemPrompt?: string;
}

export class AgentRunner {
  private openai: OpenAI;
  private tools: Map<string, Tool>;
  private model: string;
  private systemPrompt: string;

  constructor(options: AgentRunnerOptions) {
    const apiKey = options.openaiApiKey || config.openai.apiKey;
    if (!apiKey) {
      throw new Error('OpenAI API key is required. Set OPENAI_API_KEY environment variable.');
    }
    
    this.openai = new OpenAI({
      apiKey,
    });
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.model = options.model || config.openai.model;
    this.systemPrompt = options.systemPrompt || 'You are a helpful commerce assistant.';
  }

  async run(messages: Message[], mcpState: McpState): Promise<Message> {
    const systemMessage: OpenAI.ChatCompletionMessageParam = {
      role: 'system',
      content: this.systemPrompt,
    };

    const chatMessages: OpenAI.ChatCompletionMessageParam[] = [
      systemMessage,
      ...messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      })),
    ];

    const toolDefinitions = Array.from(this.tools.values()).map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.parameters);
      // Remove $schema property as OpenAI doesn't need it
      const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters,
        },
      };
    });

    // Log tools payload for debugging
    if (config.debug) {
      logger.debug({ tools: toolDefinitions }, 'Tool definitions for OpenAI');
    }

    let response = await this.openai.chat.completions.create({
      model: this.model,
      messages: chatMessages,
      tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
      tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
    });

    let assistantMessage = response.choices[0].message;

    // Handle tool calls
    while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      chatMessages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type !== 'function') {
          continue;
        }

        const tool = this.tools.get(toolCall.function.name);
        if (!tool) {
          continue;
        }

        const args = JSON.parse(toolCall.function.arguments);
        const result = await tool.execute(args, mcpState);

        chatMessages.push({
          role: 'tool',
          content: JSON.stringify(result),
          tool_call_id: toolCall.id,
        });
      }

      response = await this.openai.chat.completions.create({
        model: this.model,
        messages: chatMessages,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
        tool_choice: toolDefinitions.length > 0 ? 'auto' : undefined,
      });

      assistantMessage = response.choices[0].message;
    }

    return {
      role: 'assistant',
      content: assistantMessage.content || '',
    };
  }
}
