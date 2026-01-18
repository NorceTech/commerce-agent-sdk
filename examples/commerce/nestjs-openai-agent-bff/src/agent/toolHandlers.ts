import { NorceTokenProvider } from '../norce/NorceTokenProvider.js';
import { NorceMcpClient } from '../norce/NorceMcpClient.js';
import { PRODUCT_SEARCH, PRODUCT_GET } from '../norce/mcpToolNames.js';
import type { McpState, ToolContext } from '../session/sessionTypes.js';
import { config } from '../config.js';
import type { ProductCard } from '../http/responseTypes.js';
import {
  normalizeProductSearchResult,
  normalizeProductGetResult,
  normalizeProductSearchResultToCards,
  normalizeProductGetResultToCard,
  type NormalizedSearchResult,
  type NormalizedProductDetail,
} from './normalize.js';
import { buildMcpArgs, type BuildMcpArgsResult } from './context/index.js';
import {
  normalizeProductGet,
  extractVariantAvailabilitySummary,
  type NormalizedProductDetails,
  type NormalizedVariant,
  type VariantAvailabilitySummary,
} from './product/index.js';
import { 
  simplifySearchQueryWithDetails, 
  broadenSearchQuery, 
  buildEmptySearchRefinements,
  buildEmptySearchMessage,
  type SimplifyResult,
  type SearchAttemptInfo,
} from './search/index.js';
import type { RefinementAction } from '../http/refinementTypes.js';

export type { ToolContext };

export {
  createCartGetHandler,
  createCartAddItemHandler,
  createCartSetItemQuantityHandler,
  createCartRemoveItemHandler,
  normalizeCartResult,
  type CartHandlerDependencies,
  type NormalizedCartItem,
  type NormalizedCart,
  type CartResult,
} from './cart/cartHandlers.js';

export {
  cartGetSchema,
  cartAddItemSchema,
  cartSetItemQuantitySchema,
  cartRemoveItemSchema,
  type CartGetArgs,
  type CartAddItemArgs,
  type CartSetItemQuantityArgs,
  type CartRemoveItemArgs,
} from './cart/cartSchemas.js';

/**
 * Arguments for product_search tool (from OpenAI).
 * Note: context here comes from OpenAI tool call arguments, not from the HTTP request.
 * Note: statusSeed is BFF-controlled via NORCE_STATUS_SEED env var; any LLM-provided value is ignored.
 */
export interface ProductSearchArgs {
  query: string;
  filters?: Record<string, unknown>;
  pageSize?: number;
  context?: ToolContext;
  statusSeed?: string;
}

/**
 * Arguments for product_get tool (from OpenAI).
 * Note: context here comes from OpenAI tool call arguments, not from the HTTP request.
 */
export interface ProductGetArgs {
  productId?: string;
  partNo?: string;
  context?: ToolContext;
}

/**
 * Dependencies required by tool handlers.
 */
export interface ToolHandlerDependencies {
  tokenProvider: NorceTokenProvider;
  mcpClient: NorceMcpClient;
}

/**
 * Result from product_search handler including both raw data and cards.
 */
export interface ProductSearchResult {
  items: NormalizedSearchResult['items'];
  totalCount?: number;
  truncated: boolean;
  cards: ProductCard[];
}

/**
 * Result from product_get handler including both raw data and card.
 */
export interface ProductGetResult {
  raw: NormalizedProductDetail | null;
  card: ProductCard | null;
  /** Normalized product details including variant-level data */
  normalized: NormalizedProductDetails | null;
  /** Compact variant availability summary for working memory */
  variantSummary: VariantAvailabilitySummary | null;
}

/**
 * Metadata about query simplification for debugging.
 */
export interface QuerySimplificationMetadata {
  /** The original query from the model */
  originalQuery: string;
  /** The effective query sent to MCP (after simplification) */
  effectiveQuery: string;
  /** Whether the query was simplified */
  wasSimplified: boolean;
  /** Tokens that were dropped during simplification */
  droppedTokens?: string[];
  /** Whether a fallback broaden retry was attempted */
  fallbackRetryAttempted?: boolean;
  /** The broadened query used for retry (if applicable) */
  broadenedQuery?: string;
}

/**
 * Result from product_search handler including context injection metadata.
 */
export interface ProductSearchHandlerResult extends ProductSearchResult {
  /** Metadata about context injection for debugging */
  contextInjection?: {
    effectiveContext?: ToolContext;
    modelContextIgnored: boolean;
    modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
  };
  /** Metadata about query simplification for debugging */
  querySimplification?: QuerySimplificationMetadata;
  /** Structured refinement actions when search returns 0 results */
  refinements?: RefinementAction[];
  /** User-friendly message for empty search results */
  emptySearchMessage?: string;
}

/**
 * Creates a product_search handler that fetches Norce token and calls MCP product.search tool.
 * 
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for product_search
 */
export function createProductSearchHandler(deps: ToolHandlerDependencies) {
  return async (args: ProductSearchArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<ProductSearchHandlerResult> => {
    if (!applicationId) {
      throw new Error('applicationId is required for product_search');
    }
    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Apply query simplifier guardrail to prevent "Google-style" complex queries
    const simplifyResult = simplifySearchQueryWithDetails(args.query);
    const effectiveQuery = simplifyResult.simplified || args.query.trim().split(/\s+/)[0] || 'product';

    // Build base args without context, using simplified query
    const baseArgs: Record<string, unknown> = {
      query: effectiveQuery,
    };

    if (args.filters) {
      baseArgs.filters = args.filters;
    }

    if (args.pageSize !== undefined) {
      baseArgs.pageSize = args.pageSize;
    }

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: args.context },
      httpContext
    );

    // Inject statusSeed from config (BFF-controlled, env wins over any LLM-provided value)
    // If configured statusSeed is non-empty, add it to MCP args; otherwise omit entirely
    const configuredStatusSeed = config.norce.mcp.statusSeed;
    const mcpArgsWithStatusSeed = { ...contextResult.mcpArgs } as Record<string, unknown>;
    if (configuredStatusSeed) {
      mcpArgsWithStatusSeed.statusSeed = configuredStatusSeed;
    }

    let result = await deps.mcpClient.callTool(
      mcpState,
      PRODUCT_SEARCH,
      mcpArgsWithStatusSeed,
      accessToken,
      applicationId
    );

    let normalized = normalizeProductSearchResult(result);
    let cards = normalizeProductSearchResultToCards(result);

    // Track fallback retry metadata
    let fallbackRetryAttempted = false;
    let broadenedQuery: string | undefined;

    // Fallback broaden logic: if search returns 0 results and query has multiple words, retry with first word
    if (normalized.items.length === 0) {
      const broaderQuery = broadenSearchQuery(effectiveQuery);
      if (broaderQuery) {
        fallbackRetryAttempted = true;
        broadenedQuery = broaderQuery;

        // Build new args with broadened query
        const broadenedArgs: Record<string, unknown> = {
          query: broaderQuery,
        };

        if (args.filters) {
          broadenedArgs.filters = args.filters;
        }

        if (args.pageSize !== undefined) {
          broadenedArgs.pageSize = args.pageSize;
        }

        // Use buildMcpArgs to inject context
        const broadenedContextResult = buildMcpArgs(
          { ...broadenedArgs, context: args.context },
          httpContext
        );

        // Inject statusSeed from config for broadened query as well
        const broadenedMcpArgsWithStatusSeed = { ...broadenedContextResult.mcpArgs } as Record<string, unknown>;
        if (configuredStatusSeed) {
          broadenedMcpArgsWithStatusSeed.statusSeed = configuredStatusSeed;
        }

        // Retry with broadened query
        result = await deps.mcpClient.callTool(
          mcpState,
          PRODUCT_SEARCH,
          broadenedMcpArgsWithStatusSeed,
          accessToken,
          applicationId
        );

        normalized = normalizeProductSearchResult(result);
        cards = normalizeProductSearchResultToCards(result);
      }
    }

    // Build query simplification metadata for debugging
    const querySimplification: QuerySimplificationMetadata = {
      originalQuery: args.query,
      effectiveQuery: fallbackRetryAttempted && broadenedQuery ? broadenedQuery : effectiveQuery,
      wasSimplified: simplifyResult.wasSimplified,
      droppedTokens: simplifyResult.droppedTokens.length > 0 ? simplifyResult.droppedTokens : undefined,
      fallbackRetryAttempted,
      broadenedQuery,
    };

    // Build search attempt info for refinement generation
    const searchAttemptInfo: SearchAttemptInfo = {
      originalQuery: args.query,
      effectiveQuery: fallbackRetryAttempted && broadenedQuery ? broadenedQuery : effectiveQuery,
      wasSimplified: simplifyResult.wasSimplified,
      droppedTokens: simplifyResult.droppedTokens.length > 0 ? simplifyResult.droppedTokens : undefined,
      fallbackRetryAttempted,
      broadenedQuery,
      resultCount: normalized.items.length,
    };

    // Build refinements if search returned 0 results
    const refinements = normalized.items.length === 0 
      ? buildEmptySearchRefinements(searchAttemptInfo)
      : undefined;
    
    // Build empty search message if applicable
    const emptySearchMessage = normalized.items.length === 0
      ? buildEmptySearchMessage(searchAttemptInfo)
      : undefined;

    return {
      items: normalized.items,
      totalCount: normalized.totalCount,
      truncated: normalized.truncated,
      cards,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
      querySimplification,
      refinements,
      emptySearchMessage,
    };
  };
}

/**
 * Result from product_get handler including context injection metadata.
 */
export interface ProductGetHandlerResult extends ProductGetResult {
  /** Metadata about context injection for debugging */
  contextInjection?: {
    effectiveContext?: ToolContext;
    modelContextIgnored: boolean;
    modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
  };
}

/**
 * Creates a product_get handler that fetches Norce token and calls MCP product.get tool.
 * 
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for product_get
 */
export function createProductGetHandler(deps: ToolHandlerDependencies) {
  return async (args: ProductGetArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<ProductGetHandlerResult> => {
    if (!args.productId && !args.partNo) {
      throw new Error('Either productId or partNo must be provided');
    }

    if (!applicationId) {
      throw new Error('applicationId is required for product_get');
    }

    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Build base args without context
    const baseArgs: Record<string, unknown> = {};

    if (args.productId) {
      // MCP expects productId as number, but we keep it as string for our API
      const numericId = Number(args.productId);
      if (!isNaN(numericId)) {
        baseArgs.productId = numericId;
      } else {
        // If not a valid number, pass as-is (might be a string ID)
        baseArgs.productId = args.productId;
      }
    }

    if (args.partNo) {
      baseArgs.partNo = args.partNo;
    }

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: args.context },
      httpContext
    );

    const result = await deps.mcpClient.callTool(
      mcpState,
      PRODUCT_GET,
      contextResult.mcpArgs,
      accessToken,
      applicationId
    );

    const raw = normalizeProductGetResult(result);
    const card = normalizeProductGetResultToCard(result);

    // Normalize product with variant-level data
    const normalized = normalizeProductGet(result);
    // Pass the requested productId to extractVariantAvailabilitySummary to select the correct onHand source
    // (matching variant's onHand preferred, then root onHand)
    const requestedProductId = args.productId ? String(args.productId) : undefined;
    const variantSummary = normalized ? extractVariantAvailabilitySummary(normalized, requestedProductId) : null;

    return {
      raw,
      card,
      normalized,
      variantSummary,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
    };
  };
}
