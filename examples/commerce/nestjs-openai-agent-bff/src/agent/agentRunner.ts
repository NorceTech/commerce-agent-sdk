import { z } from 'zod';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAiClient, ToolDefinition, OpenAiResponse } from '../openai/OpenAiClient.js';
import { Tool } from './tools.js';
import { config } from '../config.js';
import type { McpState, ToolContext, WorkingMemory, PendingAction } from '../session/sessionTypes.js';
import type { ProductCard, ComparisonBlock, RefinementAction } from '../http/responseTypes.js';
import { SYSTEM_PROMPT, MAX_ROUNDS_FALLBACK_RESPONSE, MALFORMED_TOOL_ARGS_ERROR, buildProductMemoryContext } from './prompts.js';
import { resolveCandidate, looksLikeSelectionIntent, buildResolverHint, resolveVariantChoice, buildVariantResolverHint } from './referenceResolver.js';
import {
  looksLikeCompareIntent,
  selectCompareCandidates,
  buildCompareHint,
  buildComparison,
  normalizeProductForComparison,
  summarizeComparison,
  applyHighlightsToItems,
  MAX_COMPARE,
  CompareProductData,
} from './compare/index.js';
import { isCartMutationTool, buildConfirmationMessage } from './confirmation.js';
import { getToolDisplayName } from './toolDisplayNames.js';
import { buildDevStatus } from './statusMessages.js';
import { StageId } from './statusCopy.js';
import {
  getLocalizedStageMessage,
  getLocalizedToolDisplayName,
  getLocalizedToolStartMessage,
  getLocalizedToolEndMessage,
  getLocalizedRoundMessage,
  type StatusLanguage,
  DEFAULT_STATUS_LANGUAGE,
} from '../i18n/statusI18n.js';
import type { VariantAvailabilitySummary, NormalizedProductDetails } from './product/index.js';
import { normalizeProductGet } from './product/normalizeProductGet.js';
import {
  checkVariantPreflight,
  type VariantPreflightResult,
} from './variants/index.js';
import type { VariantChoice } from '../session/sessionTypes.js';
import pino from 'pino';

const logger = pino({ name: 'agentRunner' });

/**
 * Message type for conversation history.
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Tool trace entry for debugging.
 * 
 * Context injection fields:
 * - effectiveContext: The context actually used for the MCP call (from caller/httpContext)
 * - modelContextIgnored: True if the model tried to provide context that was ignored
 * - modelProvidedContextPreview: Safe preview of what the model tried to provide (if ignored)
 */
export interface ToolTraceEntry {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  blockedByPolicy?: boolean;
  pendingActionCreated?: boolean;
  pendingActionExecuted?: boolean;
  /** The effective context used for the MCP call (from caller/httpContext, never from model) */
  effectiveContext?: { cultureCode?: string; currencyCode?: string };
  /** True if the model tried to provide context that was ignored (defense in depth) */
  modelContextIgnored?: boolean;
  /** Safe preview of what the model tried to provide (only if modelContextIgnored is true) */
  modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
  /** Query simplification metadata for product_search (originalQuery, effectiveQuery, fallback attempts) */
  querySimplification?: {
    originalQuery: string;
    effectiveQuery: string;
    wasSimplified: boolean;
    droppedTokens?: string[];
    fallbackRetryAttempted?: boolean;
    broadenedQuery?: string;
  };
  /** Availability counts for product_search results (derived from onHand data) */
  availabilityCounts?: {
    inStockCount: number;
    outOfStockCount: number;
    inactiveCount: number;
    unknownCount: number;
  };
  /** Count of results with thumbnailImageKey present (for debugging) */
  thumbnailsPresentCount?: number;
}

/**
 * Information about a blocked cart mutation that needs confirmation.
 */
export interface BlockedCartMutation {
  kind: 'cart_add_item' | 'cart_set_item_quantity' | 'cart_remove_item';
  args: Record<string, unknown>;
}

/**
 * Information about variant disambiguation needed before cart mutation.
 */
export interface VariantDisambiguation {
  /** Message asking user to choose a variant */
  message: string;
  /** Variant choices to store in working memory */
  variantChoices: VariantChoice[];
  /** Parent product ID for reference */
  parentProductId: string;
  /** Product name for context */
  productName?: string;
}

/**
 * Result of running an agent turn.
 */
export interface AgentTurnResult {
  message: string;
  toolTrace: ToolTraceEntry[];
  roundsUsed: number;
  hitMaxRounds: boolean;
  collectedCards: ProductCard[];
  selectedProductIds: string[];
  searchCandidates: SearchCandidate[];
  comparison?: ComparisonBlock;
  compareDebug?: {
    productIds: string[];
    productGetCallCount: number;
  };
  blockedCartMutation?: BlockedCartMutation;
  /** Variant disambiguation needed before cart mutation can proceed */
  variantDisambiguation?: VariantDisambiguation;
  /** Variant availability summaries per productId from product_get calls */
  variantSummaries?: Map<string, VariantAvailabilitySummary>;
  /** Structured refinement actions for search fallback scenarios */
  refinements?: RefinementAction[];
}

/**
 * Compact representation of a search candidate for working memory.
 * Stored from the FULL product.search response (not just capped cards).
 */
export interface SearchCandidate {
  productId: string;
  title: string;
  currency?: string;
  price?: string;
  imageUrl?: string;
  attributes?: Record<string, string>;
  /** Product-level availability status derived from onHand data */
  availabilityStatus?: 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';
  /** On-hand quantity (product-level) */
  onHandValue?: number;
}

/**
 * Custom error for malformed tool arguments.
 */
export class MalformedToolArgsError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly rawArgs: string,
    public readonly parseError: string
  ) {
    super(`Malformed arguments for tool ${toolName}: ${parseError}`);
    this.name = 'MalformedToolArgsError';
  }
}

/**
 * Options for creating an AgentRunner.
 */
export interface AgentRunnerOptions {
  tools: Tool[];
  openaiClient?: OpenAiClient;
  openaiApiKey?: string;
  model?: string;
  systemPrompt?: string;
  maxRounds?: number;
  maxToolCallsPerRound?: number;
}

/**
 * Developer status event data for streaming.
 */
export interface DevStatusData {
  message: string;
  round: number;
  [key: string]: unknown;
}

/**
 * Callbacks for streaming agent execution.
 * These are invoked during the agent turn to emit SSE events.
 */
export interface StreamingCallbacks {
  onStatus?: (message: string) => void;
  onDevStatus?: (data: DevStatusData) => void;
  onToolStart?: (tool: string, displayName: string, args: unknown) => void;
  onToolEnd?: (tool: string, displayName: string, ok: boolean, resultSummary?: unknown, error?: string) => void;
  onDelta?: (text: string) => void;
}

/**
 * AgentRunner orchestrates the agent loop with bounded iterations.
 * 
 * Features:
 * - Bounded execution (max rounds, max tool calls per round)
 * - Tool call detection and execution
 * - Malformed tool argument handling
 * - Debug tool trace collection
 */
export class AgentRunner {
  private readonly openaiClient: OpenAiClient;
  private readonly tools: Map<string, Tool>;
  private readonly toolDefinitions: ToolDefinition[];
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxRounds: number;
  private readonly maxToolCallsPerRound: number;

  constructor(options: AgentRunnerOptions) {
    const apiKey = options.openaiApiKey || config.openai.apiKey;
    
    this.openaiClient = options.openaiClient || new OpenAiClient({
      apiKey,
      defaultModel: options.model || config.openai.model,
    });
    
    this.tools = new Map(options.tools.map((tool) => [tool.name, tool]));
    this.model = options.model || config.openai.model;
    this.systemPrompt = options.systemPrompt || SYSTEM_PROMPT;
    this.maxRounds = options.maxRounds ?? config.agent.maxRounds;
    this.maxToolCallsPerRound = options.maxToolCallsPerRound ?? config.agent.maxToolCallsPerRound;

    this.toolDefinitions = options.tools.map((tool) => {
      const jsonSchema = z.toJSONSchema(tool.parameters);
      // Remove $schema property as OpenAI doesn't need it
      const { $schema, ...parameters } = jsonSchema as Record<string, unknown>;
      return {
        name: tool.name,
        description: tool.description,
        parameters: parameters as Record<string, unknown>,
      };
    });

    // Log tools payload for debugging
    if (config.debug) {
      logger.debug({ tools: this.toolDefinitions }, 'Tool definitions for OpenAI');
    }
  }

  /**
   * Get the tools map for direct tool execution.
   * Used by chatHandler for executing pending actions.
   */
  getTools(): Map<string, Tool> {
    return this.tools;
  }

  /**
   * Run a single agent turn with bounded iterations.
   * 
   * This method:
   * 1. Appends the user message to the conversation
   * 2. Injects PRODUCT_MEMORY context if available
   * 3. Injects resolver hint if deterministic resolution succeeds
   * 4. Loops up to maxRounds times
   * 5. Calls OpenAI with tool definitions
   * 6. Executes any tool calls (up to maxToolCallsPerRound)
   * 7. Appends tool outputs to conversation
   * 8. Returns when no tool calls or bounds are hit
   * 
   * @param userMessage - The user's message
   * @param conversation - The conversation history (will be mutated)
   * @param mcpState - MCP session state for tool execution
   * @param context - Optional context for tool execution (passed through to MCP)
   * @param callbacks - Optional callbacks for streaming events
   * @param workingMemory - Optional working memory for reference resolution
   * @param applicationId - Optional application ID
   * @param statusLang - Optional language code for localized status messages
   * @returns Result containing the assistant message and debug info
   */
  async runAgentTurn(
    userMessage: string,
    conversation: ConversationMessage[],
    mcpState: McpState,
    context?: ToolContext,
    callbacks?: StreamingCallbacks,
    workingMemory?: WorkingMemory,
    applicationId?: string,
    statusLang?: 'en' | 'sv'
  ): Promise<AgentTurnResult> {
    const toolTrace: ToolTraceEntry[] = [];
    const collectedCards: ProductCard[] = [];
    const selectedProductIds: string[] = [];
    const searchCandidates: SearchCandidate[] = [];
    const productGetResults: Map<string, unknown> = new Map(); // Track raw product_get results for comparison
    const variantSummaries: Map<string, VariantAvailabilitySummary> = new Map(); // Track variant summaries per productId
    const normalizedProductDetails: Map<string, NormalizedProductDetails> = new Map(); // Track normalized product details for variant preflight
    let collectedRefinements: RefinementAction[] | undefined; // Track refinements from product_search
    let roundsUsed = 0;

    // Inject PRODUCT_MEMORY context if available (before user message)
    const productMemoryContext = buildProductMemoryContext(
      workingMemory?.lastResults,
      workingMemory?.shortlist
    );
    if (productMemoryContext) {
      conversation.push({
        role: 'system',
        content: productMemoryContext,
      });
    }

    // Try deterministic variant choice resolution first (if user has pending variant choices)
    // This handles "option 2", "#3", exact partNo/eanCode, etc. when the user is selecting a variant
    // We always try resolution when variantChoices exist, since the user might type an exact identifier
    if (workingMemory?.variantChoices && workingMemory.variantChoices.length > 0) {
      const variantResult = resolveVariantChoice(userMessage, workingMemory);
      if (variantResult) {
        const hint = buildVariantResolverHint(variantResult);
        conversation.push({
          role: 'system',
          content: hint,
        });
        if (config.debug) {
          logger.debug({ variantResult }, 'Variant resolver found match');
        }
        
        // Return early with a blocked cart mutation for the selected variant
        // This creates a pendingAction for the cart_add_item with the variant's partNo
        // NOTE: MCP cart.addItem expects partNo (not productId) as the item identifier
        if (!variantResult.partNo || variantResult.partNo.trim().length === 0) {
          // Variant is missing partNo - cannot add to cart
          // This shouldn't happen if selectBuyableVariants filters correctly, but handle gracefully
          return {
            message: `Sorry, I cannot add this variant to the cart because it's missing a part number. Please try selecting a different variant.`,
            toolTrace: [],
            roundsUsed: 0,
            hitMaxRounds: false,
            collectedCards: [],
            selectedProductIds: [],
            searchCandidates: [],
          };
        }
        
        const confirmationMessage = buildConfirmationMessage('cart_add_item', {
          partNo: variantResult.partNo,
          quantity: 1,
        });
        
        return {
          message: confirmationMessage,
          toolTrace: [],
          roundsUsed: 0,
          hitMaxRounds: false,
          collectedCards: [],
          selectedProductIds: [],
          searchCandidates: [],
          blockedCartMutation: {
            kind: 'cart_add_item',
            args: {
              partNo: variantResult.partNo,
              quantity: 1,
              // Include variantProductId for trace/debug only
              variantProductId: variantResult.variantProductId,
            },
          },
        };
      }
    }

    // Try deterministic reference resolution and inject hint if successful
    if (workingMemory && looksLikeSelectionIntent(userMessage)) {
      const resolverResult = resolveCandidate(userMessage, workingMemory);
      if (resolverResult) {
        const hint = buildResolverHint(resolverResult);
        conversation.push({
          role: 'system',
          content: hint,
        });
        if (config.debug) {
          logger.debug({ resolverResult }, 'Reference resolver found match');
        }
      }
    }

    // Detect compare intent and inject compare hint if candidates can be resolved
    let compareIntentDetected = false;
    let compareCandidateIds: string[] = [];
    if (workingMemory && looksLikeCompareIntent(userMessage)) {
      const compareCandidates = selectCompareCandidates(userMessage, workingMemory);
      if (compareCandidates && compareCandidates.productIds.length >= 2) {
        compareIntentDetected = true;
        compareCandidateIds = compareCandidates.productIds;
        const compareHint = buildCompareHint(compareCandidates);
        conversation.push({
          role: 'system',
          content: compareHint,
        });
        if (config.debug) {
          logger.debug({ compareCandidates }, 'Compare intent detected, candidates selected');
        }
      }
    }

    conversation.push({
      role: 'user',
      content: userMessage,
    });

    let lastToolName: string | undefined;
    
    for (let round = 0; round < this.maxRounds; round++) {
      roundsUsed = round + 1;
      const isFirstRound = round === 0;

      // Emit user-friendly status based on context using localized statusCopy
      const statusStage: StageId = isFirstRound ? 'thinking' : (lastToolName === 'product_search' ? 'refining' : 'thinking');
      const lang: StatusLanguage = statusLang ?? DEFAULT_STATUS_LANGUAGE;
      callbacks?.onStatus?.(getLocalizedStageMessage(lang, statusStage));
      
      // Emit developer status when debug mode is enabled (via onDevStatus callback)
      callbacks?.onDevStatus?.(buildDevStatus(roundsUsed));

      const chatMessages = this.buildChatMessages(conversation);

      const response = await this.openaiClient.runWithTools({
        input: chatMessages,
        tools: this.toolDefinitions,
        model: this.model,
      });

      if (response.toolCalls.length === 0) {
        const assistantContent = response.content || '';
        conversation.push({
          role: 'assistant',
          content: assistantContent,
        });

        callbacks?.onDelta?.(assistantContent);

        // Build comparison if we have enough product_get results
        const comparisonResult = await this.buildComparisonIfNeeded(
          compareIntentDetected,
          compareCandidateIds,
          productGetResults,
          selectedProductIds
        );

        return {
          message: assistantContent,
          toolTrace,
          roundsUsed,
          hitMaxRounds: false,
          collectedCards,
          selectedProductIds,
          searchCandidates,
          comparison: comparisonResult?.comparison,
          compareDebug: comparisonResult?.debug,
          variantSummaries: variantSummaries.size > 0 ? variantSummaries : undefined,
          refinements: collectedRefinements,
        };
      }

      const toolCallsToExecute = response.toolCalls.slice(0, this.maxToolCallsPerRound);

      const assistantMessage: ConversationMessage = {
        role: 'assistant',
        content: response.content || '',
        tool_calls: toolCallsToExecute.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        })),
      };
      conversation.push(assistantMessage);

      for (const toolCall of toolCallsToExecute) {
        const traceEntry: ToolTraceEntry = {
          tool: toolCall.name,
          args: {},
        };

        try {
          const parsedArgs = this.parseToolArguments(toolCall.name, toolCall.arguments);
          traceEntry.args = parsedArgs;

          const tool = this.tools.get(toolCall.name);
          if (!tool) {
            traceEntry.error = `Unknown tool: ${toolCall.name}`;
            callbacks?.onToolEnd?.(toolCall.name, getToolDisplayName(toolCall.name), false, undefined, `Unknown tool: ${toolCall.name}`);
            conversation.push({
              role: 'tool',
              content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
              tool_call_id: toolCall.id,
            });
            toolTrace.push(traceEntry);
            continue;
          }

          // Check if this is a cart mutation tool that requires confirmation
          if (isCartMutationTool(toolCall.name)) {
            const kind = toolCall.name as 'cart_add_item' | 'cart_set_item_quantity' | 'cart_remove_item';
            
            // For cart_add_item, perform variant preflight check
            // NOTE: cart_add_item now uses partNo instead of productId
            // If partNo is empty/missing, we need to check if there's a recently fetched product
            // that needs variant disambiguation
            const hasValidPartNo = parsedArgs.partNo && String(parsedArgs.partNo).trim().length > 0;
            const hasProductId = parsedArgs.productId && String(parsedArgs.productId).trim().length > 0;
            
            if (kind === 'cart_add_item' && (hasProductId || !hasValidPartNo)) {
              // If productId is provided, use it for preflight check
              // If partNo is empty/missing, check the most recently fetched product
              let productIdForPreflight: string | null = null;
              
              if (hasProductId) {
                productIdForPreflight = String(parsedArgs.productId);
              } else if (!hasValidPartNo && normalizedProductDetails.size > 0) {
                // Use the most recently fetched product (last entry in the map)
                const entries = Array.from(normalizedProductDetails.entries());
                productIdForPreflight = entries[entries.length - 1][0];
              }
              
              if (productIdForPreflight) {
                const preflightResult = checkVariantPreflight(productIdForPreflight, normalizedProductDetails);
              
              if (preflightResult.type === 'disambiguate') {
                // Multiple buyable variants - need user to choose
                traceEntry.blockedByPolicy = true;
                toolTrace.push(traceEntry);

                conversation.push({
                  role: 'tool',
                  content: JSON.stringify({ 
                    status: 'variant_disambiguation_required',
                    message: 'Multiple variants available. Please choose one.'
                  }),
                  tool_call_id: toolCall.id,
                });

                return {
                  message: preflightResult.message,
                  toolTrace,
                  roundsUsed,
                  hitMaxRounds: false,
                  collectedCards,
                  selectedProductIds,
                  searchCandidates,
                  variantDisambiguation: {
                    message: preflightResult.message,
                    variantChoices: preflightResult.variantChoices,
                    parentProductId: preflightResult.parentProductId,
                    productName: preflightResult.productName,
                  },
                  variantSummaries: variantSummaries.size > 0 ? variantSummaries : undefined,
                };
              } else if (preflightResult.type === 'not_buyable') {
                // Product is not buyable - return error message
                traceEntry.blockedByPolicy = true;
                traceEntry.error = preflightResult.message;
                toolTrace.push(traceEntry);

                conversation.push({
                  role: 'tool',
                  content: JSON.stringify({ 
                    status: 'not_buyable',
                    message: preflightResult.message
                  }),
                  tool_call_id: toolCall.id,
                });

                return {
                  message: preflightResult.message,
                  toolTrace,
                  roundsUsed,
                  hitMaxRounds: false,
                  collectedCards,
                  selectedProductIds,
                  searchCandidates,
                  variantSummaries: variantSummaries.size > 0 ? variantSummaries : undefined,
                };
              } else if (preflightResult.type === 'proceed') {
                // Single variant or already a variant ID - update partNo if rewritten
                if (preflightResult.rewritten && preflightResult.selectedVariant) {
                  // Update partNo to use the selected variant's partNo
                  parsedArgs.partNo = preflightResult.selectedVariant.partNo;
                  traceEntry.args = parsedArgs;
                  if (config.debug) {
                    logger.debug(
                      { originalProductId: productIdForPreflight, rewrittenPartNo: preflightResult.selectedVariant.partNo },
                      'Rewrote partNo to variant partNo'
                    );
                  }
                }
              }
              // For 'needs_fetch', we proceed with the original partNo
              // The cart operation may fail, but we let the MCP handle it
              }
            }
            
            // Block the tool execution and return early with confirmation request
            const confirmationMessage = buildConfirmationMessage(kind, parsedArgs);
            
            traceEntry.blockedByPolicy = true;
            traceEntry.pendingActionCreated = true;
            toolTrace.push(traceEntry);

            // Add a tool response indicating the action is pending confirmation
            conversation.push({
              role: 'tool',
              content: JSON.stringify({ 
                status: 'pending_confirmation',
                message: 'This action requires user confirmation before execution.'
              }),
              tool_call_id: toolCall.id,
            });

            // Return early with the blocked mutation info
            return {
              message: confirmationMessage,
              toolTrace,
              roundsUsed,
              hitMaxRounds: false,
              collectedCards,
              selectedProductIds,
              searchCandidates,
              blockedCartMutation: {
                kind,
                args: parsedArgs,
              },
              variantSummaries: variantSummaries.size > 0 ? variantSummaries : undefined,
            };
          }

          // Emit user-friendly status message for tool start using localized statusCopy
          callbacks?.onStatus?.(getLocalizedToolStartMessage(lang, toolCall.name));
          
          callbacks?.onToolStart?.(toolCall.name, getLocalizedToolDisplayName(lang, toolCall.name), parsedArgs);

          const result = await tool.execute(parsedArgs, mcpState, context, applicationId);
          traceEntry.result = result;

          // Extract context injection metadata from result if available
          // This is returned by handlers using buildMcpArgs helper
          if (result && typeof result === 'object' && 'contextInjection' in result) {
            const contextInjection = (result as Record<string, unknown>).contextInjection as {
              effectiveContext?: { cultureCode?: string; currencyCode?: string };
              modelContextIgnored: boolean;
              modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
            } | undefined;
            
            if (contextInjection) {
              if (contextInjection.effectiveContext) {
                traceEntry.effectiveContext = {
                  cultureCode: contextInjection.effectiveContext.cultureCode,
                  currencyCode: contextInjection.effectiveContext.currencyCode,
                };
              }
              traceEntry.modelContextIgnored = contextInjection.modelContextIgnored;
              if (contextInjection.modelProvidedContextPreview) {
                traceEntry.modelProvidedContextPreview = contextInjection.modelProvidedContextPreview;
              }
            }
          }

          const resultSummary = this.summarizeToolResult(result);
          callbacks?.onToolEnd?.(toolCall.name, getLocalizedToolDisplayName(lang, toolCall.name), true, resultSummary);
          
          // Emit user-friendly status message on tool_end when it adds value
          // For product_search, emit "Found some options." to provide feedback
          if (toolCall.name === 'product_search') {
            callbacks?.onStatus?.(getLocalizedToolEndMessage(lang, toolCall.name, true));
          }

          this.extractCardsFromResult(result, collectedCards);
          this.extractSearchCandidates(result, searchCandidates);
          this.extractSelectedProductId(toolCall.name, parsedArgs, selectedProductIds);

          // Extract refinements and querySimplification from product_search results
          if (toolCall.name === 'product_search') {
            if (result && typeof result === 'object') {
              // Extract refinements
              if ('refinements' in result) {
                const refinements = (result as Record<string, unknown>).refinements as RefinementAction[] | undefined;
                if (refinements && refinements.length > 0) {
                  collectedRefinements = refinements;
                }
              }
              // Extract querySimplification metadata for debug trace
              if ('querySimplification' in result) {
                const querySimplification = (result as Record<string, unknown>).querySimplification as {
                  originalQuery: string;
                  effectiveQuery: string;
                  wasSimplified: boolean;
                  droppedTokens?: string[];
                  fallbackRetryAttempted?: boolean;
                  broadenedQuery?: string;
                } | undefined;
                if (querySimplification) {
                  traceEntry.querySimplification = querySimplification;
                }
              }
              // Count items with thumbnailImageKey present for debug trace
              if ('items' in result) {
                const items = (result as Record<string, unknown>).items as Array<Record<string, unknown>> | undefined;
                if (items && Array.isArray(items)) {
                  const thumbnailsPresentCount = items.filter(
                    (item) => item && typeof item === 'object' && item.thumbnailImageKey !== undefined && item.thumbnailImageKey !== null
                  ).length;
                  traceEntry.thumbnailsPresentCount = thumbnailsPresentCount;
                }
              }
            }
          }

          // Track product_get results for comparison building, variant summaries, and variant preflight
          if (toolCall.name === 'product_get') {
            const productId = parsedArgs.productId || parsedArgs.partNo;
            if (productId) {
              productGetResults.set(String(productId), result);
              
              // Extract variant summary from product_get result
              if (result && typeof result === 'object' && 'variantSummary' in result) {
                const summary = (result as Record<string, unknown>).variantSummary as VariantAvailabilitySummary | null;
                if (summary) {
                  variantSummaries.set(String(productId), summary);
                }
              }
              
              // Extract normalized product details for variant preflight
              if (result && typeof result === 'object' && 'normalized' in result) {
                const normalized = (result as Record<string, unknown>).normalized as NormalizedProductDetails | null;
                if (normalized) {
                  normalizedProductDetails.set(String(productId), normalized);
                  // Also store by the normalized productId if different
                  if (normalized.productId && normalized.productId !== String(productId)) {
                    normalizedProductDetails.set(normalized.productId, normalized);
                  }
                }
              }
            }
          }

          conversation.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id,
          });
        } catch (error) {
          if (error instanceof MalformedToolArgsError) {
            throw error;
          }

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          traceEntry.error = errorMessage;

          callbacks?.onToolEnd?.(toolCall.name, getLocalizedToolDisplayName(lang, toolCall.name), false, undefined, errorMessage);
          
          // Emit user-friendly status message on tool_end when ok=false
          callbacks?.onStatus?.(getLocalizedToolEndMessage(lang, toolCall.name, false));

          conversation.push({
            role: 'tool',
            content: JSON.stringify({ error: errorMessage }),
            tool_call_id: toolCall.id,
          });
        }

        toolTrace.push(traceEntry);
        
        // Track last tool name for status stage determination in next round
        lastToolName = toolCall.name;
      }

      if (response.toolCalls.length > this.maxToolCallsPerRound) {
        const skippedCount = response.toolCalls.length - this.maxToolCallsPerRound;
        conversation.push({
          role: 'system',
          content: `Note: ${skippedCount} additional tool call(s) were skipped due to per-round limits.`,
        });
      }
    }

    conversation.push({
      role: 'assistant',
      content: MAX_ROUNDS_FALLBACK_RESPONSE,
    });

    // Build comparison if we have enough product_get results (even on max rounds)
    const comparisonResult = await this.buildComparisonIfNeeded(
      compareIntentDetected,
      compareCandidateIds,
      productGetResults,
      selectedProductIds
    );

    return {
      message: MAX_ROUNDS_FALLBACK_RESPONSE,
      toolTrace,
      roundsUsed,
      hitMaxRounds: true,
      collectedCards,
      selectedProductIds,
      searchCandidates,
      comparison: comparisonResult?.comparison,
      compareDebug: comparisonResult?.debug,
      variantSummaries: variantSummaries.size > 0 ? variantSummaries : undefined,
      refinements: collectedRefinements,
    };
  }

  /**
   * Parse and validate tool arguments.
   * 
   * @param toolName - Name of the tool
   * @param rawArgs - Raw JSON string of arguments
   * @returns Parsed arguments object
   * @throws MalformedToolArgsError if parsing fails
   */
  private parseToolArguments(toolName: string, rawArgs: string): Record<string, unknown> {
    let parsed: unknown;
    
    try {
      parsed = JSON.parse(rawArgs);
    } catch (error) {
      const parseError = error instanceof Error ? error.message : 'Invalid JSON';
      throw new MalformedToolArgsError(toolName, rawArgs, parseError);
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new MalformedToolArgsError(
        toolName,
        rawArgs,
        'Arguments must be a JSON object'
      );
    }

    const tool = this.tools.get(toolName);
    if (tool) {
      const result = tool.parameters.safeParse(parsed);
      if (!result.success) {
        const errorMessages = result.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ');
        throw new MalformedToolArgsError(toolName, rawArgs, errorMessages);
      }
      return result.data as Record<string, unknown>;
    }

    return parsed as Record<string, unknown>;
  }

  /**
   * Build chat messages array for OpenAI API.
   * 
   * @param conversation - The conversation history
   * @returns Array of ChatCompletionMessageParam
   */
  private buildChatMessages(conversation: ConversationMessage[]): ChatCompletionMessageParam[] {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: this.systemPrompt,
      },
    ];

    for (const msg of conversation) {
      if (msg.role === 'user') {
        messages.push({
          role: 'user',
          content: msg.content,
        });
      } else if (msg.role === 'assistant') {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: msg.tool_calls,
          });
        } else {
          messages.push({
            role: 'assistant',
            content: msg.content,
          });
        }
      } else if (msg.role === 'tool' && msg.tool_call_id) {
        messages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.tool_call_id,
        });
      } else if (msg.role === 'system') {
        messages.push({
          role: 'system',
          content: msg.content,
        });
      }
    }

    return messages;
  }

  /**
   * Extracts ProductCards from tool execution results and adds them to the collection.
   * Handles both product_search (multiple cards) and product_get (single card) results.
   * 
   * @param result - The tool execution result
   * @param collectedCards - Array to add extracted cards to
   */
  private extractCardsFromResult(result: unknown, collectedCards: ProductCard[]): void {
    if (!result || typeof result !== 'object') {
      return;
    }

    const resultObj = result as Record<string, unknown>;

    if (Array.isArray(resultObj.cards)) {
      for (const card of resultObj.cards) {
        if (this.isValidProductCard(card)) {
          collectedCards.push(card);
        }
      }
    }

    if (resultObj.card && this.isValidProductCard(resultObj.card)) {
      collectedCards.push(resultObj.card as ProductCard);
    }
  }

  /**
   * Type guard to check if an object is a valid ProductCard.
   * 
   * @param obj - Object to check
   * @returns True if the object is a valid ProductCard
   */
  private isValidProductCard(obj: unknown): obj is ProductCard {
    if (!obj || typeof obj !== 'object') {
      return false;
    }
    const card = obj as Record<string, unknown>;
    return typeof card.productId === 'string' && typeof card.title === 'string';
  }

  /**
   * Extracts search candidates from product_search results for working memory.
   * Stores the FULL list of candidates (not capped) for later filtering.
   * 
   * @param result - The tool execution result
   * @param searchCandidates - Array to add extracted candidates to
   */
  private extractSearchCandidates(result: unknown, searchCandidates: SearchCandidate[]): void {
    if (!result || typeof result !== 'object') {
      return;
    }

    const resultObj = result as Record<string, unknown>;

    // Extract from items array (raw search results)
    if (Array.isArray(resultObj.items)) {
      for (const item of resultObj.items) {
        const candidate = this.itemToSearchCandidate(item);
        if (candidate) {
          // Only add if not already present (by productId)
          if (!searchCandidates.some(c => c.productId === candidate.productId)) {
            searchCandidates.push(candidate);
          }
        }
      }
    }
  }

  /**
   * Converts a raw item to a SearchCandidate.
   * 
   * @param item - Raw item from search results
   * @returns SearchCandidate or null if conversion fails
   */
  private itemToSearchCandidate(item: unknown): SearchCandidate | null {
    if (!item || typeof item !== 'object') {
      return null;
    }

    const itemObj = item as Record<string, unknown>;
    
    // Try to extract productId from various fields
    const idFields = ['productId', 'id', 'partNo', 'productNumber', 'sku', 'code'];
    let productId: string | undefined;
    for (const field of idFields) {
      const value = itemObj[field];
      if (value !== undefined && value !== null && value !== '') {
        productId = String(value);
        break;
      }
    }

    // Try to extract title from various fields
    const titleFields = ['name', 'title', 'productName', 'displayName'];
    let title: string | undefined;
    for (const field of titleFields) {
      const value = itemObj[field];
      if (typeof value === 'string' && value.trim() !== '') {
        title = value.trim();
        break;
      }
    }

    if (!productId || !title) {
      return null;
    }

    const candidate: SearchCandidate = {
      productId,
      title,
    };

    // Extract optional fields
    if (typeof itemObj.currency === 'string') {
      candidate.currency = itemObj.currency;
    }
    
    const price = itemObj.price;
    if (typeof price === 'number') {
      candidate.price = String(price);
    } else if (typeof price === 'string') {
      candidate.price = price;
    } else if (typeof price === 'object' && price !== null) {
      const priceObj = price as Record<string, unknown>;
      const priceValue = priceObj.value ?? priceObj.amount;
      if (priceValue !== undefined) {
        candidate.price = String(priceValue);
      }
      if (typeof priceObj.currency === 'string') {
        candidate.currency = priceObj.currency;
      }
    }

    // Extract imageUrl
    const imageFields = ['imageUrl', 'image', 'primaryImage', 'thumbnailUrl'];
    for (const field of imageFields) {
      const value = itemObj[field];
      if (typeof value === 'string' && value.trim() !== '') {
        candidate.imageUrl = value.trim();
        break;
      }
    }

    // Extract attributes
    const attrs: Record<string, string> = {};
    const attrFields = ['color', 'size', 'material', 'brand', 'category'];
    for (const field of attrFields) {
      const value = itemObj[field];
      if (typeof value === 'string' && value.trim() !== '') {
        attrs[field] = value.trim();
      }
    }
    if (Object.keys(attrs).length > 0) {
      candidate.attributes = attrs;
    }

    // Extract availability data from normalized items
    const availability = itemObj.availability as { status?: string; onHandValue?: number } | undefined;
    if (availability?.status) {
      candidate.availabilityStatus = availability.status as 'in_stock' | 'out_of_stock' | 'inactive' | 'unknown';
      if (availability.onHandValue !== undefined) {
        candidate.onHandValue = availability.onHandValue;
      }
    }

    return candidate;
  }

  /**
   * Extracts selected product ID when product_get is called.
   * Adds the productId to selectedProductIds if not already present.
   * 
   * @param toolName - Name of the tool being called
   * @param args - Parsed arguments for the tool
   * @param selectedProductIds - Array to add selected product IDs to
   */
  private extractSelectedProductId(
    toolName: string,
    args: Record<string, unknown>,
    selectedProductIds: string[]
  ): void {
    if (toolName !== 'product_get') {
      return;
    }

    // Extract productId from args, normalize to string
    const productId = args.productId;
    if (productId !== undefined && productId !== null && productId !== '') {
      const idStr = String(productId);
      if (!selectedProductIds.includes(idStr)) {
        selectedProductIds.push(idStr);
      }
    }

    // Also check partNo as fallback
    const partNo = args.partNo;
    if (partNo !== undefined && partNo !== null && partNo !== '') {
      const partNoStr = String(partNo);
      if (!selectedProductIds.includes(partNoStr)) {
        selectedProductIds.push(partNoStr);
      }
    }
  }

  /**
   * Summarizes a tool result for streaming callbacks.
   * Extracts key information without sending the full payload.
   * 
   * @param result - The tool execution result
   * @returns A summary object suitable for SSE events
   */
  private summarizeToolResult(result: unknown): unknown {
    if (!result || typeof result !== 'object') {
      return result;
    }

    const resultObj = result as Record<string, unknown>;
    const summary: Record<string, unknown> = {};

    if (Array.isArray(resultObj.items)) {
      summary.itemCount = resultObj.items.length;
    }

    if (typeof resultObj.totalCount === 'number') {
      summary.totalCount = resultObj.totalCount;
    }

    if (resultObj.card && typeof resultObj.card === 'object') {
      const card = resultObj.card as Record<string, unknown>;
      summary.productId = card.productId;
      summary.title = card.title;
    }

    if (Object.keys(summary).length === 0) {
      return { success: true };
    }

    return summary;
  }

  /**
   * Builds a comparison payload if conditions are met.
   * 
   * Conditions for building comparison:
   * 1. Compare intent was detected OR we have >= 2 product_get results
   * 2. We have at least 2 product_get results to compare
   * 
   * @param compareIntentDetected - Whether compare intent was detected
   * @param compareCandidateIds - Product IDs selected for comparison
   * @param productGetResults - Map of productId to raw product_get results
   * @param selectedProductIds - All product IDs selected via product_get
   * @returns Comparison result with comparison block and debug info, or null
   */
  private async buildComparisonIfNeeded(
    compareIntentDetected: boolean,
    compareCandidateIds: string[],
    productGetResults: Map<string, unknown>,
    selectedProductIds: string[]
  ): Promise<{ comparison: ComparisonBlock; debug: { productIds: string[]; productGetCallCount: number } } | null> {
    // Determine which product IDs to use for comparison
    let productIdsToCompare: string[] = [];
    
    if (compareIntentDetected && compareCandidateIds.length >= 2) {
      // Use the pre-selected candidates from compare intent detection
      productIdsToCompare = compareCandidateIds.filter(id => productGetResults.has(id));
    } else if (productGetResults.size >= 2) {
      // Fallback: use all product_get results if we have 2+
      productIdsToCompare = selectedProductIds.filter(id => productGetResults.has(id));
    }

    // Need at least 2 products to compare
    if (productIdsToCompare.length < 2) {
      return null;
    }

    // Cap at MAX_COMPARE
    productIdsToCompare = productIdsToCompare.slice(0, MAX_COMPARE);

    // Normalize products for comparison
    const normalizedProducts: CompareProductData[] = [];
    for (const productId of productIdsToCompare) {
      const rawResult = productGetResults.get(productId);
      const normalized = normalizeProductForComparison(rawResult);
      if (normalized) {
        normalizedProducts.push(normalized);
      }
    }

    // Need at least 2 normalized products
    if (normalizedProducts.length < 2) {
      return null;
    }

    try {
      // Build the comparison
      const comparison = buildComparison(normalizedProducts);

      // Try to add highlights via summarization (optional, fails safely)
      try {
        const summaryResult = await summarizeComparison(normalizedProducts, this.openaiClient);
        if (summaryResult) {
          applyHighlightsToItems(comparison.items, summaryResult);
        }
      } catch (error) {
        // Summarization failed, but we still have the comparison table
        if (config.debug) {
          logger.debug({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Summarization failed, proceeding without highlights');
        }
      }

      return {
        comparison,
        debug: {
          productIds: productIdsToCompare,
          productGetCallCount: productGetResults.size,
        },
      };
    } catch (error) {
      // Comparison building failed
      if (config.debug) {
        logger.debug({ error: error instanceof Error ? error.message : 'Unknown error' }, 'Comparison building failed');
      }
      return null;
    }
  }

  /**
   * Legacy run method for backward compatibility.
   * 
   * @deprecated Use runAgentTurn instead
   */
  async run(
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    mcpState: McpState
  ): Promise<{ role: 'assistant'; content: string }> {
    const conversation: ConversationMessage[] = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const lastUserMessage = messages.filter((m) => m.role === 'user').pop();
    if (!lastUserMessage) {
      return {
        role: 'assistant',
        content: 'I did not receive a message. How can I help you?',
      };
    }

    conversation.pop();

    const result = await this.runAgentTurn(lastUserMessage.content, conversation, mcpState);

    return {
      role: 'assistant',
      content: result.message,
    };
  }
}
