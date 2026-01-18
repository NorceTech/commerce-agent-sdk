import { z } from 'zod';
import { ISessionStore } from '../session/ISessionStore.js';
import { SessionState, LastResultItem, ShortlistItem, SearchCandidateRecord, ToolContext, PendingAction, CartMutationKind, CartState, PendingActionStatus } from '../session/sessionTypes.js';
import { AgentRunner, ConversationMessage, StreamingCallbacks, AgentTurnResult, ToolTraceEntry } from '../agent/agentRunner.js';
import { getToolDisplayName } from '../agent/toolDisplayNames.js';
import { config } from '../config.js';
import type { ChatResponse, ToolTraceItem, ProductCard, PendingActionInfo, CartSummary, ChoiceSet, ConfirmationBlock } from '../http/responseTypes.js';
import { safeParseChatResponse } from '../http/chatResponseSchema.js';
import { AppError, mapError } from '../errors/index.js';
import { MAX_LAST_RESULTS } from '../agent/referenceResolver.js';
import type { RunStore, RunRecord, ToolTraceItem as RunToolTraceItem, RunRoute } from '../debug/index.js';
import { dropOrSummarizeContext, sanitizeToolArgs, capString, sanitizeErrorDetails } from '../debug/index.js';
import { isAffirmation, isRejection, buildConfirmationMessage } from '../agent/confirmation.js';
import { buildConfirmationBlock, buildLocalizedConfirmationText, buildLocalizedPendingActionReminder, getLocalizedCancelledMessage, getLocalizedCompletedMessage } from '../i18n/index.js';
import { Tool } from '../agent/tools.js';
import { normalizeCartResult, normalizedCartToSummary, normalizedCartToState, cartStateToSummary, NormalizedCart } from '../agent/cart/cartHandlers.js';
import type { VariantAvailabilitySummary, ProductGetOnHand } from '../agent/product/index.js';
import { deriveAvailabilityFromOnHand } from '../agent/normalize.js';
import { createVariantChoiceSet, createActiveChoiceSet } from '../http/choiceTypes.js';

/**
 * Validates a ChatResponse object against the canonical schema.
 * If validation fails, logs the error and returns a safe fallback response.
 * 
 * @param response - The response object to validate
 * @param turnId - The turn ID to use in the fallback response
 * @param sessionId - The session ID to use in the fallback response
 * @returns The validated response or a safe fallback
 */
function validateAndSanitizeResponse(
  response: ChatResponse,
  turnId: string,
  sessionId: string
): ChatResponse {
  const result = safeParseChatResponse(response);
  if (result.success) {
    return response;
  }
  
  // Log validation error for debugging (but don't leak to client)
  console.error('ChatResponse validation failed:', result.error.issues);
  
  // Return a safe fallback response that will always validate
  return {
    turnId,
    sessionId,
    text: response.text || 'An error occurred while processing your request.',
  };
}

const CART_TOOLS = ['cart_get', 'cart_add_item', 'cart_set_item_quantity', 'cart_remove_item'];

function extractCartFromToolTrace(toolTrace: ToolTraceEntry[]): { cartState: CartState; cartSummary: CartSummary } | undefined {
  for (let i = toolTrace.length - 1; i >= 0; i--) {
    const entry = toolTrace[i];
    if (CART_TOOLS.includes(entry.tool) && entry.result && !entry.error && !entry.blockedByPolicy) {
      try {
        const normalizedCart = normalizeCartResult({ content: [{ type: 'text', text: JSON.stringify(entry.result) }] });
        return {
          cartState: normalizedCartToState(normalizedCart),
          cartSummary: normalizedCartToSummary(normalizedCart),
        };
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export const contextSchema = z.object({
  cultureCode: z.string().optional(),
  currencyCode: z.string().optional(),
  priceListIds: z.array(z.number()).optional(),
  salesAreaId: z.number().optional(),
  customerId: z.number().optional(),
  companyId: z.number().optional(),
});

export const chatRequestSchema = z.object({
  applicationId: z.string().min(1, 'applicationId is required').max(100, 'applicationId exceeds maximum length'),
  sessionId: z.string().min(1, 'sessionId is required').max(200, 'sessionId exceeds maximum length'),
  message: z.string().min(1, 'message is required').max(config.limits.maxMessageChars, `message exceeds maximum length of ${config.limits.maxMessageChars} characters`),
  context: contextSchema,
});

export type ChatRequestBody = z.infer<typeof chatRequestSchema>;

export interface HandleChatInput {
  applicationId: string;
  sessionId: string;
  message: string;
  context: ToolContext;
  debugEnabled?: boolean;
  callbacks?: StreamingCallbacks;
  /** Language code for localized status messages (computed once per request) */
  statusLang?: 'en' | 'sv';
}

export interface HandleChatResult {
  httpStatus: number;
  body: ChatResponse;
  agentResult?: AgentTurnResult;
  error?: AppError;
}

export interface ChatHandlerDependencies {
  sessionStore: ISessionStore;
  agentRunner: AgentRunner | null;
  runStore?: RunStore;
}

/**
 * Enriches a ProductCard with availability and dimensionHints from variant summary.
 * Uses onHand-based availability (consistent with product.search cards).
 * Mutates the card in place.
 */
function enrichCardWithVariantSummary(
  card: ProductCard,
  variantSummaries?: Map<string, VariantAvailabilitySummary>
): void {
  if (!variantSummaries) return;
  
  const summary = variantSummaries.get(card.productId);
  if (!summary) return;
  
  // Use onHand-based availability (consistent with product.search cards)
  // This derives status from onHand data: in_stock, out_of_stock, inactive, or unknown
  if (summary.onHand) {
    const availability = deriveAvailabilityFromOnHand(summary.onHand);
    card.availability = {
      status: availability.status,
      onHandValue: availability.onHandValue,
      incomingValue: availability.incomingValue,
      nextDeliveryDate: availability.nextDeliveryDate,
      leadtimeDayCount: availability.leadtimeDayCount,
    };
  } else {
    // No onHand data available - set status to unknown
    card.availability = {
      status: 'unknown',
    };
  }
  
  if (summary.availableDimensionValues && Object.keys(summary.availableDimensionValues).length > 0) {
    card.dimensionHints = summary.availableDimensionValues;
  }
}

/**
 * Priority order for availability status sorting.
 * Lower number = higher priority (shown first).
 */
const AVAILABILITY_STATUS_PRIORITY: Record<string, number> = {
  in_stock: 0,
  unknown: 1,
  out_of_stock: 2,
  inactive: 3,
};

/**
 * Sorts cards by availability status when variant summaries are known.
 * Uses onHand-based availability status (consistent with product.search cards).
 * 
 * Sorting priority:
 * 1. in_stock first (products with stock available)
 * 2. unknown next (products without availability data)
 * 3. out_of_stock next (products with no stock)
 * 4. inactive last (discontinued products)
 * 5. Within same status, sort by onHandValue desc
 * 6. Original order preserved for products with same status and onHandValue
 */
function sortCardsByAvailability(cards: ProductCard[]): ProductCard[] {
  return [...cards].sort((a, b) => {
    const aStatus = a.availability?.status ?? 'unknown';
    const bStatus = b.availability?.status ?? 'unknown';
    
    const aPriority = AVAILABILITY_STATUS_PRIORITY[aStatus] ?? 1;
    const bPriority = AVAILABILITY_STATUS_PRIORITY[bStatus] ?? 1;
    
    // Sort by status priority first
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    
    // Same status - sort by onHandValue desc (higher stock first)
    const aOnHand = a.availability?.onHandValue ?? 0;
    const bOnHand = b.availability?.onHandValue ?? 0;
    
    if (aOnHand !== bOnHand) {
      return bOnHand - aOnHand;
    }
    
    // Keep original order
    return 0;
  });
}

function buildResponseCards(
  selectedProductIds: string[],
  collectedCards: ProductCard[],
  searchCandidates: SearchCandidateRecord[],
  variantSummaries?: Map<string, VariantAvailabilitySummary>
): ProductCard[] {
  if (selectedProductIds.length === 0) {
    // Enrich collected cards with variant summaries
    for (const card of collectedCards) {
      enrichCardWithVariantSummary(card, variantSummaries);
    }
    // Sort by availability when variant summaries are known
    if (variantSummaries && variantSummaries.size > 0) {
      return sortCardsByAvailability(collectedCards);
    }
    return collectedCards;
  }

  const cardMap = new Map<string, ProductCard>();
  for (const card of collectedCards) {
    cardMap.set(card.productId, card);
  }

  const candidateMap = new Map<string, SearchCandidateRecord>();
  for (const candidate of searchCandidates) {
    candidateMap.set(candidate.productId, candidate);
  }

  const filteredCards: ProductCard[] = [];
  for (const productId of selectedProductIds) {
    const card = cardMap.get(productId);
    if (card) {
      enrichCardWithVariantSummary(card, variantSummaries);
      filteredCards.push(card);
      continue;
    }

    const candidate = candidateMap.get(productId);
    if (candidate) {
      const fallbackCard: ProductCard = {
        productId: candidate.productId,
        title: candidate.title,
      };
      if (candidate.price) fallbackCard.price = candidate.price;
      if (candidate.currency) fallbackCard.currency = candidate.currency;
      if (candidate.imageUrl) fallbackCard.imageUrl = candidate.imageUrl;
      if (candidate.attributes) fallbackCard.attributes = candidate.attributes;
      enrichCardWithVariantSummary(fallbackCard, variantSummaries);
      filteredCards.push(fallbackCard);
    }
  }

  // Sort by availability when variant summaries are known
  if (variantSummaries && variantSummaries.size > 0) {
    return sortCardsByAvailability(filteredCards);
  }

  return filteredCards;
}

function updateWorkingMemory(
  sessionData: SessionState,
  result: AgentTurnResult
): void {
  if (result.searchCandidates.length > 0) {
    const searchCandidates: SearchCandidateRecord[] = result.searchCandidates.map((c) => ({
      productId: c.productId,
      title: c.title,
      currency: c.currency,
      price: c.price,
      imageUrl: c.imageUrl,
      attributes: c.attributes,
      availabilityStatus: c.availabilityStatus,
      onHandValue: c.onHandValue,
    }));
    
    sessionData.workingMemory = {
      ...sessionData.workingMemory,
      searchCandidates,
    };
  }

  if (result.collectedCards.length > 0) {
    const lastResults: LastResultItem[] = result.collectedCards
      .slice(0, MAX_LAST_RESULTS)
      .map((card, idx): LastResultItem => {
        const item: LastResultItem = {
          index: idx + 1,
          productId: card.productId,
          name: card.title,
          brand: card.attributes?.brand,
          color: card.attributes?.color,
          price: card.price ? parseFloat(card.price) : undefined,
          currency: card.currency,
          url: card.imageUrl,
        };
        
        // Add product-level availability status if available from product.search onHand
        if (card.availability?.status) {
          item.availabilityStatus = card.availability.status;
          item.onHandValue = card.availability.onHandValue;
        }
        
        // Add variant summary if available from product_get results
        const variantSummary = result.variantSummaries?.get(card.productId);
        if (variantSummary) {
          item.buyableVariantCount = variantSummary.buyableVariantCount;
          item.inStockBuyableVariantCount = variantSummary.inStockBuyableVariantCount;
          item.availableDimensionValues = variantSummary.availableDimensionValues;
        }
        
        return item;
      });
    
    sessionData.workingMemory = {
      ...sessionData.workingMemory,
      lastResults,
    };
  } else if (result.searchCandidates.length > 0) {
    const lastResults: LastResultItem[] = result.searchCandidates
      .slice(0, MAX_LAST_RESULTS)
      .map((candidate, idx): LastResultItem => {
        const item: LastResultItem = {
          index: idx + 1,
          productId: candidate.productId,
          name: candidate.title,
          brand: candidate.attributes?.brand,
          color: candidate.attributes?.color,
          price: candidate.price ? parseFloat(candidate.price) : undefined,
          currency: candidate.currency,
          url: candidate.imageUrl,
        };
        
        // Add product-level availability status if available from product.search onHand
        if (candidate.availabilityStatus) {
          item.availabilityStatus = candidate.availabilityStatus;
          item.onHandValue = candidate.onHandValue;
        }
        
        // Add variant summary if available from product_get results
        const variantSummary = result.variantSummaries?.get(candidate.productId);
        if (variantSummary) {
          item.buyableVariantCount = variantSummary.buyableVariantCount;
          item.inStockBuyableVariantCount = variantSummary.inStockBuyableVariantCount;
          item.availableDimensionValues = variantSummary.availableDimensionValues;
        }
        
        return item;
      });
    
    sessionData.workingMemory = {
      ...sessionData.workingMemory,
      lastResults,
    };
  }

  if (result.selectedProductIds.length > 0) {
    const existingShortlist = sessionData.workingMemory?.shortlist ?? [];
    const existingIds = new Set(existingShortlist.map(s => s.productId));
    
    const cardMap = new Map(result.collectedCards.map(c => [c.productId, c.title]));
    const candidateMap = new Map(result.searchCandidates.map(c => [c.productId, c.title]));
    
    const newItems: ShortlistItem[] = result.selectedProductIds
      .filter(id => !existingIds.has(id))
      .map(id => ({
        productId: id,
        name: cardMap.get(id) ?? candidateMap.get(id),
      }));
    
    const updatedShortlist = [...existingShortlist, ...newItems].slice(0, 10);
    
    sessionData.workingMemory = {
      ...sessionData.workingMemory,
      shortlist: updatedShortlist,
    };
  }
}

function buildChatResponse(
  turnId: string,
  sessionId: string,
  result: AgentTurnResult,
  searchCandidates: SearchCandidateRecord[],
  debugEnabled: boolean,
  pendingAction?: PendingAction,
  cartSummary?: CartSummary,
  choices?: ChoiceSet,
  cultureCode?: string
): ChatResponse {
  const response: ChatResponse = {
    turnId,
    sessionId,
    text: result.message,
  };

  const responseCards = buildResponseCards(
    result.selectedProductIds,
    result.collectedCards,
    searchCandidates,
    result.variantSummaries
  );
  
  if (responseCards.length > 0) {
    response.cards = responseCards;
  }

  if (result.comparison) {
    response.comparison = result.comparison;
  }

  // Include cart summary if available
  if (cartSummary) {
    response.cart = cartSummary;
  }

  // Include pendingAction info if there's a pending cart mutation (only if status is 'pending')
  if (pendingAction && pendingAction.status === 'pending') {
    // Use localized text for the confirmation prompt
    const localizedPrompt = buildLocalizedConfirmationText(pendingAction.kind, pendingAction.args, cultureCode);
    
    // Override the text field with the localized prompt when there's a pending action
    response.text = localizedPrompt;
    
    response.pendingAction = {
      pendingActionId: pendingAction.id,
      tool: pendingAction.kind,
      description: localizedPrompt,
      createdAt: new Date(pendingAction.createdAt).toISOString(),
    };

    // Include structured confirmation block for UI to render Yes/No buttons
    response.confirmation = buildConfirmationBlock(
      pendingAction.id,
      pendingAction.kind,
      pendingAction.args,
      cultureCode
    );
  }

  // Include structured refinement actions for search fallback scenarios
  if (result.refinements && result.refinements.length > 0) {
    response.refinements = result.refinements;
  }

  // Include structured choices for disambiguation (variant selection, etc.)
  if (choices) {
    response.choices = choices;
  }

  if (debugEnabled) {
    response.debug = {
      toolTrace: result.toolTrace.map((entry): ToolTraceItem => ({
        tool: entry.tool,
        args: entry.args,
        result: entry.result,
        error: entry.error,
        blockedByPolicy: entry.blockedByPolicy,
        pendingActionCreated: entry.pendingActionCreated,
        pendingActionExecuted: entry.pendingActionExecuted,
        effectiveContext: entry.effectiveContext,
        modelContextIgnored: entry.modelContextIgnored,
        modelProvidedContextPreview: entry.modelProvidedContextPreview,
        querySimplification: entry.querySimplification,
        availabilityCounts: entry.availabilityCounts,
        thumbnailsPresentCount: entry.thumbnailsPresentCount,
      })),
    };

    if (result.compareDebug) {
      (response.debug as Record<string, unknown>).compare = result.compareDebug;
    }
  }

  return response;
}

export interface RunTracer {
  runId: string;
  startTime: number;
  toolTrace: RunToolTraceItem[];
  currentToolStart?: number;
  currentToolArgs?: Record<string, unknown>;
}

export function createRunTracer(runId: string): RunTracer {
  return {
    runId,
    startTime: Date.now(),
    toolTrace: [],
  };
}

export function buildRunRecord(
  tracer: RunTracer,
  input: HandleChatInput,
  result: HandleChatResult,
  route: RunRoute,
  model: string,
  roundsUsed: number,
  errors?: Array<{ category: string; message: string; details?: Record<string, unknown> }>
): RunRecord {
  const contextSummary = dropOrSummarizeContext(input.context);
  const endTime = Date.now();

  return {
    runId: tracer.runId,
    createdAt: tracer.startTime,
    durationMs: endTime - tracer.startTime,
    route,
    applicationId: input.applicationId,
    sessionId: input.sessionId,
    request: {
      message: capString(input.message, 500),
      contextPresent: contextSummary.contextPresent,
      contextSummary: contextSummary.contextSummary,
    },
    result: {
      status: result.httpStatus >= 200 && result.httpStatus < 300 ? 'ok' : 'error',
      httpStatus: result.httpStatus,
      textSnippet: result.body.text ? capString(result.body.text, 500) : undefined,
      responseShape: {
        hasCards: (result.body.cards?.length ?? 0) > 0,
        hasComparison: result.body.comparison !== undefined,
        toolCalls: tracer.toolTrace.length,
      },
    },
    toolTrace: tracer.toolTrace,
    openaiTrace: {
      rounds: roundsUsed,
      model,
    },
    errors: errors?.map(e => ({
      category: e.category,
      message: capString(e.message, 200),
      details: sanitizeErrorDetails(e.details),
    })),
  };
}

export async function handleChat(
  input: HandleChatInput,
  deps: ChatHandlerDependencies,
  tracer?: RunTracer
): Promise<HandleChatResult> {
  const { applicationId, sessionId, message, context, debugEnabled = false, callbacks, statusLang } = input;
  const { sessionStore, agentRunner } = deps;

  // Generate a unique turn ID for this request (UUID v4)
  const turnId = crypto.randomUUID();

  if (!agentRunner) {
    const appError = AppError.serviceUnavailable(
      'agent',
      'AI agent is not configured. Please set OPENAI_API_KEY.'
    );
    const response: ChatResponse = {
      turnId,
      sessionId,
      text: appError.safeMessage,
    };
    return {
      httpStatus: appError.httpStatus,
      body: validateAndSanitizeResponse(response, turnId, sessionId),
      error: appError,
    };
  }

  const sessionKey = `${applicationId}:${sessionId}`;
  const now = Date.now();
  const ttlMs = config.session.ttlSeconds * 1000;

  let sessionData: SessionState = await sessionStore.get(sessionKey) ?? {
    conversation: [],
    mcp: { nextRpcId: 1 },
    updatedAt: now,
    expiresAt: now + ttlMs,
    context,
  };

  sessionData.context = context;

  // Inject basketId from session into context for cart operations
  // This ensures cart.get calls have access to the basketId from previous cart.addItem calls
  const enrichedContext: ToolContext = {
    ...context,
    basketId: sessionData.cartState?.basketId,
  };

  // Handle pending action confirmation flow
  // IMPORTANT: Only block when status === 'pending' to avoid blocking after consumed/cancelled actions
  // This fixes the gating bug where consumed/cancelled actions would still block new messages
  if (sessionData.pendingAction) {
    const pendingAction = sessionData.pendingAction;
    
    // Handle idempotency: if action is already consumed/cancelled and user sends "yes" again
    if (pendingAction.status !== 'pending' && isAffirmation(message)) {
      // Action was already processed - do NOT re-execute (idempotency)
      sessionData.updatedAt = Date.now();
      sessionData.expiresAt = Date.now() + ttlMs;
      await sessionStore.set(sessionKey, sessionData);
      
      // Build response with cart summary if available
      const cartSummary = sessionData.cartState ? cartStateToSummary(sessionData.cartState) : undefined;
      
      const response: ChatResponse = {
        turnId,
        sessionId,
        text: `This action has already been ${pendingAction.status === 'consumed' ? 'completed' : 'cancelled'}. Is there anything else I can help you with?`,
      };
      
      if (cartSummary) {
        response.cart = cartSummary;
      }
      
      return {
        httpStatus: 200,
        body: validateAndSanitizeResponse(response, turnId, sessionId),
      };
    }
    
    // Only process pending actions that are still in 'pending' status
    if (pendingAction.status === 'pending' && isAffirmation(message)) {
      // User confirmed - execute the pending action
      const tool = agentRunner.getTools().get(pendingAction.kind);
      if (!tool) {
        // Clear pending action and return error
        sessionData.pendingAction = undefined;
        sessionData.updatedAt = Date.now();
        sessionData.expiresAt = Date.now() + ttlMs;
        await sessionStore.set(sessionKey, sessionData);
        
        const response: ChatResponse = {
          turnId,
          sessionId,
          text: 'Sorry, I could not execute the action. The tool is no longer available.',
        };
        return {
          httpStatus: 200,
          body: validateAndSanitizeResponse(response, turnId, sessionId),
        };
      }

      // Execute the pending action (consume-once)
      const toolTrace: ToolTraceEntry[] = [{
        tool: pendingAction.kind,
        args: pendingAction.args,
        pendingActionExecuted: true,
      }];

      try {
        callbacks?.onToolStart?.(pendingAction.kind, getToolDisplayName(pendingAction.kind), pendingAction.args);
        const result = await tool.execute(pendingAction.args, sessionData.mcp, enrichedContext, applicationId);
        toolTrace[0].result = result;
        callbacks?.onToolEnd?.(pendingAction.kind, getToolDisplayName(pendingAction.kind), true, result);

        // After cart mutation, refresh cart state via cart.get
        // This ensures we have the most up-to-date cart state after any mutation
        let cartSummary: CartSummary | undefined;
        
        // First, extract basketId from the mutation result
        // This is needed because enrichedContext.basketId hasn't been updated yet
        let basketIdFromMutation: string | undefined;
        if (result && typeof result === 'object' && 'cart' in result) {
          const mutationCart = (result as { cart: { basketId?: string } }).cart;
          basketIdFromMutation = mutationCart?.basketId;
        }
        
        const cartGetTool = agentRunner.getTools().get('cart_get');
        if (cartGetTool && basketIdFromMutation) {
          try {
            // Pass basketId directly to cart.get instead of relying on enrichedContext
            // which hasn't been updated with the basketId from the mutation yet
            const cartGetArgs = { basketId: basketIdFromMutation };
            callbacks?.onToolStart?.('cart_get', getToolDisplayName('cart_get'), cartGetArgs);
            const cartGetResult = await cartGetTool.execute(cartGetArgs, sessionData.mcp, enrichedContext, applicationId);
            callbacks?.onToolEnd?.('cart_get', getToolDisplayName('cart_get'), true, cartGetResult);
            
            // Add cart.get to tool trace for debugging
            toolTrace.push({
              tool: 'cart_get',
              args: cartGetArgs,
              result: cartGetResult,
              pendingActionExecuted: false,
            });
            
            // Extract cart data from cart.get result
            // The cart handler returns { cart: NormalizedCart }, so we can use it directly
            if (cartGetResult && typeof cartGetResult === 'object' && 'cart' in cartGetResult) {
              const cartResult = (cartGetResult as { cart: NormalizedCart }).cart;
              sessionData.cartState = normalizedCartToState(cartResult);
              cartSummary = normalizedCartToSummary(cartResult);
            }
          } catch (cartGetError) {
            // If cart.get fails, fall back to mutation result
            console.warn('Failed to refresh cart after mutation:', cartGetError);
            callbacks?.onToolEnd?.('cart_get', getToolDisplayName('cart_get'), false, undefined, cartGetError instanceof Error ? cartGetError.message : 'Unknown error');
            
            // Fall back to extracting cart data from the mutation result
            // The cart handler returns { cart: NormalizedCart }, so we can use it directly
            if (result && typeof result === 'object' && 'cart' in result) {
              const cartResult = (result as { cart: NormalizedCart }).cart;
              sessionData.cartState = normalizedCartToState(cartResult);
              cartSummary = normalizedCartToSummary(cartResult);
            }
          }
        } else {
          // If cart_get tool is not available or no basketId, fall back to mutation result
          // The cart handler returns { cart: NormalizedCart }, so we can use it directly
          if (result && typeof result === 'object' && 'cart' in result) {
            const cartResult = (result as { cart: NormalizedCart }).cart;
            sessionData.cartState = normalizedCartToState(cartResult);
            cartSummary = normalizedCartToSummary(cartResult);
          }
        }

        // Mark pending action as consumed (idempotency: do not clear, just mark as consumed)
        sessionData.pendingAction = {
          ...pendingAction,
          status: 'consumed',
          consumedAt: Date.now(),
        };
        sessionData.updatedAt = Date.now();
        sessionData.expiresAt = Date.now() + ttlMs;
        
        // Add the confirmation and result to conversation
        sessionData.conversation.push({
          role: 'user',
          content: message,
        });
        sessionData.conversation.push({
          role: 'assistant',
          content: getLocalizedCompletedMessage(context.cultureCode),
        });

        await sessionStore.set(sessionKey, sessionData);

        const response: ChatResponse = {
          turnId,
          sessionId,
          text: getLocalizedCompletedMessage(context.cultureCode),
        };

        // Include cart summary in response if available
        if (cartSummary) {
          response.cart = cartSummary;
        }

        if (debugEnabled) {
          response.debug = {
            toolTrace: toolTrace.map((entry): ToolTraceItem => ({
              tool: entry.tool,
              args: entry.args,
              result: entry.result,
              error: entry.error,
              pendingActionExecuted: entry.pendingActionExecuted,
              effectiveContext: entry.effectiveContext,
              modelContextIgnored: entry.modelContextIgnored,
              modelProvidedContextPreview: entry.modelProvidedContextPreview,
            })),
          };
        }

        return {
          httpStatus: 200,
          body: validateAndSanitizeResponse(response, turnId, sessionId),
        };
      }catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        toolTrace[0].error = errorMessage;
        callbacks?.onToolEnd?.(pendingAction.kind, getToolDisplayName(pendingAction.kind), false, undefined, errorMessage);

        // Clear pending action after failed execution
        sessionData.pendingAction = undefined;
        sessionData.updatedAt = Date.now();
        sessionData.expiresAt = Date.now() + ttlMs;
        await sessionStore.set(sessionKey, sessionData);

        const response: ChatResponse = {
          turnId,
          sessionId,
          text: `Sorry, I couldn't complete the action. Error: ${errorMessage}`,
        };

        if (debugEnabled) {
          response.debug = {
            toolTrace: toolTrace.map((entry): ToolTraceItem => ({
              tool: entry.tool,
              args: entry.args,
              result: entry.result,
              error: entry.error,
              pendingActionExecuted: entry.pendingActionExecuted,
              effectiveContext: entry.effectiveContext,
              modelContextIgnored: entry.modelContextIgnored,
              modelProvidedContextPreview: entry.modelProvidedContextPreview,
            })),
          };
        }

        return {
          httpStatus: 200,
          body: validateAndSanitizeResponse(response, turnId, sessionId),
        };
      }
    } else if (pendingAction.status === 'pending' && isRejection(message)) {
      // User rejected - mark pending action as cancelled (simpler: clear immediately)
      sessionData.pendingAction = undefined;
      sessionData.updatedAt = Date.now();
      sessionData.expiresAt = Date.now() + ttlMs;
      
      // Add the rejection to conversation
      sessionData.conversation.push({
        role: 'user',
        content: message,
      });
      sessionData.conversation.push({
        role: 'assistant',
        content: getLocalizedCancelledMessage(context.cultureCode),
      });

      await sessionStore.set(sessionKey, sessionData);

      const response: ChatResponse = {
        turnId,
        sessionId,
        text: getLocalizedCancelledMessage(context.cultureCode),
      };
      return {
        httpStatus: 200,
        body: validateAndSanitizeResponse(response, turnId, sessionId),
      };
    } else if (pendingAction.status === 'pending') {
      // User said something else while there's a pending action - ask to confirm/cancel first
      // Don't clear the pending action, just remind them
      sessionData.updatedAt = Date.now();
      sessionData.expiresAt = Date.now() + ttlMs;
      await sessionStore.set(sessionKey, sessionData);

      const response: ChatResponse = {
        turnId,
        sessionId,
        text: buildLocalizedPendingActionReminder(pendingAction.kind, pendingAction.args, context.cultureCode),
        pendingAction: {
          pendingActionId: pendingAction.id,
          tool: pendingAction.kind,
          description: buildLocalizedConfirmationText(pendingAction.kind, pendingAction.args, context.cultureCode),
          createdAt: new Date(pendingAction.createdAt).toISOString(),
        },
        confirmation: buildConfirmationBlock(
          pendingAction.id,
          pendingAction.kind,
          pendingAction.args,
          context.cultureCode
        ),
      };

      return {
        httpStatus: 200,
        body: validateAndSanitizeResponse(response, turnId, sessionId),
      };
    }
    // If pendingAction exists but is not 'pending' (consumed/cancelled) and message is not "yes",
    // fall through to normal agent processing
  }

  const wrappedCallbacks: StreamingCallbacks | undefined = callbacks ? {
    onStatus: callbacks.onStatus,
    onDevStatus: callbacks.onDevStatus,
    onToolStart: (tool, displayName, args) => {
      if (tracer) {
        tracer.currentToolStart = Date.now();
        tracer.currentToolArgs = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {};
      }
      callbacks.onToolStart?.(tool, displayName, args);
    },
    onToolEnd: (tool, displayName, ok, resultSummary, error) => {
      if (tracer) {
        const t = tracer.currentToolStart ? tracer.currentToolStart - tracer.startTime : Date.now() - tracer.startTime;
        const durationMs = tracer.currentToolStart ? Date.now() - tracer.currentToolStart : undefined;
        tracer.toolTrace.push({
          t,
          tool,
          args: sanitizeToolArgs(tracer.currentToolArgs ?? {}),
          outcome: ok ? 'ok' : 'error',
          errorMessage: error ? capString(error, 200) : undefined,
          durationMs,
        });
        tracer.currentToolStart = undefined;
        tracer.currentToolArgs = undefined;
      }
      callbacks.onToolEnd?.(tool, displayName, ok, resultSummary, error);
    },
    onDelta: callbacks.onDelta,
  } : tracer ? {
    onToolStart: (tool, _displayName, args) => {
      tracer.currentToolStart = Date.now();
      tracer.currentToolArgs = typeof args === 'object' && args !== null ? args as Record<string, unknown> : {};
    },
    onToolEnd: (tool, _displayName, ok, resultSummary, error) => {
      const t = tracer.currentToolStart ? tracer.currentToolStart - tracer.startTime : Date.now() - tracer.startTime;
      const durationMs = tracer.currentToolStart ? Date.now() - tracer.currentToolStart : undefined;
      tracer.toolTrace.push({
        t,
        tool,
        args: sanitizeToolArgs(tracer.currentToolArgs ?? {}),
        outcome: ok ? 'ok' : 'error',
        errorMessage: error ? capString(error, 200) : undefined,
        durationMs,
      });
      tracer.currentToolStart = undefined;
      tracer.currentToolArgs = undefined;
    },
  } : undefined;

  const result = await agentRunner.runAgentTurn(
    message,
    sessionData.conversation as ConversationMessage[],
    sessionData.mcp,
    enrichedContext,
    wrappedCallbacks,
    sessionData.workingMemory,
    applicationId,
    statusLang
  );

  updateWorkingMemory(sessionData, result);

  // If the agent returned a blocked cart mutation, store it as pendingAction
  if (result.blockedCartMutation) {
    sessionData.pendingAction = {
      id: crypto.randomUUID(),
      kind: result.blockedCartMutation.kind,
      args: result.blockedCartMutation.args,
      createdAt: Date.now(),
      status: 'pending',
    };
  }

  // If the agent returned variant disambiguation, store variantChoices in workingMemory
  // and create a structured ChoiceSet for the response
  let choiceSet: ChoiceSet | undefined;
  if (result.variantDisambiguation) {
    if (!sessionData.workingMemory) {
      sessionData.workingMemory = {};
    }
    sessionData.workingMemory.variantChoices = result.variantDisambiguation.variantChoices;
    sessionData.workingMemory.variantChoicesParentProductId = result.variantDisambiguation.parentProductId;

    // Create structured choice set for the response
    choiceSet = createVariantChoiceSet(
      result.variantDisambiguation.variantChoices,
      result.variantDisambiguation.parentProductId,
      result.variantDisambiguation.productName
    );

    // Store activeChoiceSet in workingMemory for deterministic resolution
    sessionData.workingMemory.activeChoiceSet = createActiveChoiceSet(
      choiceSet,
      result.variantDisambiguation.parentProductId
    );
  }

  // Extract cart data from tool trace and update session state
  let cartSummary: CartSummary | undefined;
  const cartData = extractCartFromToolTrace(result.toolTrace);
  if (cartData) {
    sessionData.cartState = cartData.cartState;
    cartSummary = cartData.cartSummary;
  } else if (sessionData.cartState) {
    cartSummary = cartStateToSummary(sessionData.cartState);
  }

  sessionData.updatedAt = Date.now();
  sessionData.expiresAt = Date.now() + ttlMs;

  await sessionStore.set(sessionKey, sessionData);

  const response = buildChatResponse(
    turnId,
    sessionId,
    result,
    sessionData.workingMemory?.searchCandidates ?? [],
    debugEnabled,
    sessionData.pendingAction,
    cartSummary,
    choiceSet,
    context.cultureCode
  );

  return {
    httpStatus: 200,
    body: validateAndSanitizeResponse(response, turnId, sessionId),
    agentResult: result,
  };
}
