import { NorceTokenProvider } from '../../norce/NorceTokenProvider.js';
import { NorceMcpClient } from '../../norce/NorceMcpClient.js';
import {
  CART_GET,
  CART_ADD_ITEM,
  CART_SET_ITEM_QUANTITY,
  CART_REMOVE_ITEM,
} from '../../norce/mcpToolNames.js';
import type { McpState, ToolContext, CartState, CartStateItem } from '../../session/sessionTypes.js';
import { MAX_CART_ITEMS_IN_SESSION } from '../../session/sessionTypes.js';
import type { CartSummary, CartItem, CartPrice } from '../../http/responseTypes.js';
import type {
  CartGetArgs,
  CartAddItemArgs,
  CartSetItemQuantityArgs,
  CartRemoveItemArgs,
} from './cartSchemas.js';
import { buildMcpArgs } from '../context/index.js';

/**
 * Maximum number of cart items to return to avoid token blowups.
 */
const MAX_CART_ITEMS = 20;

/**
 * Dependencies required by cart tool handlers.
 */
export interface CartHandlerDependencies {
  tokenProvider: NorceTokenProvider;
  mcpClient: NorceMcpClient;
}

/**
 * Normalized cart item structure.
 */
export interface NormalizedCartItem {
  lineItemId?: string;
  productId: string;
  partNo?: string;
  name?: string;
  quantity: number;
  unitPrice?: string;
  totalPrice?: string;
  currency?: string;
  imageUrl?: string;
}

/**
 * Normalized cart structure returned from handlers.
 */
export interface NormalizedCart {
  id?: string;
  /**
   * The basket ID for cart operations.
   * Extracted from response.basketId or response.id (coerced to string).
   * Used by cart.get to retrieve the correct basket.
   */
  basketId?: string;
  itemCount: number;
  totalQuantity: number;
  items: NormalizedCartItem[];
  subtotal?: string;
  currency?: string;
}

/**
 * Result from cart handlers.
 */
export interface CartResult {
  cart: NormalizedCart;
}

/**
 * Extracts a string value from an object field, handling various types.
 */
function extractString(obj: Record<string, unknown>, ...fields: string[]): string | undefined {
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}

/**
 * Parses a basketId value to a number for MCP calls.
 * The Norce MCP server expects basketId as a number, not a string.
 * 
 * @param value - The basketId value (string or number)
 * @returns The basketId as a number, or undefined if invalid
 */
export function parseBasketIdToNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    // Already a number - validate it's a safe integer
    if (Number.isSafeInteger(value) && value > 0) {
      return value;
    }
    return undefined;
  }
  if (typeof value === 'string') {
    // Parse string to number - must be a valid positive integer
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      // Not a numeric string (e.g., 'basket-123')
      return undefined;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

/**
 * Extracts a number value from an object field.
 */
function extractNumber(obj: Record<string, unknown>, ...fields: string[]): number | undefined {
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Normalizes a raw cart item from MCP response.
 * 
 * MCP cart.get response items have the format:
 * { lineNo, partNo, name, quantity, imageKey, ... }
 * 
 * We extract productId from partNo (primary) or other ID fields as fallback.
 */
function normalizeCartItem(item: unknown): NormalizedCartItem | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return null;
  }

  const itemObj = item as Record<string, unknown>;

  // MCP cart.get returns partNo as the primary identifier
  // Try partNo first, then fall back to other ID fields
  const partNo = extractString(itemObj, 'partNo', 'sku', 'articleNumber');
  const productId = partNo || extractString(itemObj, 'productId', 'id');
  
  if (!productId) {
    return null;
  }

  const quantity = extractNumber(itemObj, 'quantity', 'qty') ?? 0;

  const normalized: NormalizedCartItem = {
    productId,
    quantity,
  };

  // Extract lineNo/lineItemId for line identification
  const lineItemId = extractString(itemObj, 'lineNo', 'lineItemId', 'lineId');
  if (lineItemId) {
    normalized.lineItemId = lineItemId;
  }

  // Store partNo separately if different from productId
  if (partNo && partNo !== productId) {
    normalized.partNo = partNo;
  } else if (partNo) {
    normalized.partNo = partNo;
  }

  const name = extractString(itemObj, 'name', 'title', 'productName', 'displayName');
  if (name) {
    normalized.name = name;
  }

  const unitPrice = extractString(itemObj, 'unitPrice', 'price');
  if (unitPrice) {
    normalized.unitPrice = unitPrice;
  }

  const totalPrice = extractString(itemObj, 'totalPrice', 'lineTotal', 'total');
  if (totalPrice) {
    normalized.totalPrice = totalPrice;
  }

  const currency = extractString(itemObj, 'currency', 'currencyCode');
  if (currency) {
    normalized.currency = currency;
  }

  // MCP returns imageKey, not imageUrl - store as-is (relative URL)
  const imageUrl = extractString(itemObj, 'imageKey', 'imageUrl', 'image', 'thumbnailUrl');
  if (imageUrl) {
    normalized.imageUrl = imageUrl;
  }

  return normalized;
}

/**
 * Normalizes raw cart data from MCP response into a stable internal shape.
 * Caps the number of items to prevent token blowups.
 */
export function normalizeCartResult(result: unknown): NormalizedCart {
  if (!result || typeof result !== 'object') {
    return {
      itemCount: 0,
      totalQuantity: 0,
      items: [],
    };
  }

  const resultObj = result as Record<string, unknown>;

  let rawItems: unknown[] = [];
  let cartId: string | undefined;
  let basketId: string | undefined;
  let subtotal: string | undefined;
  let currency: string | undefined;

  if (Array.isArray(resultObj.content)) {
    const content = resultObj.content as Array<{ type?: string; text?: string }>;
    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (parsed && typeof parsed === 'object') {
            // Support multiple wrapper keys: cart, basket (MCP cart.addItem uses basket)
            let cartData: Record<string, unknown>;
            if (parsed.cart && typeof parsed.cart === 'object') {
              cartData = parsed.cart;
            } else if (parsed.basket && typeof parsed.basket === 'object') {
              cartData = parsed.basket;
            } else {
              cartData = parsed;
            }

            if (Array.isArray(cartData.items)) {
              rawItems = cartData.items;
            } else if (Array.isArray(cartData.lineItems)) {
              rawItems = cartData.lineItems;
            } else if (Array.isArray(cartData.cartItems)) {
              rawItems = cartData.cartItems;
            } else if (Array.isArray(parsed)) {
              rawItems = parsed;
            }

            // Extract IDs from both the wrapper (parsed) and the cart data
            // MCP cart.addItem returns basketId at root level and inside basket
            cartId = extractString(cartData, 'cartId', 'id', 'basketId') 
              || extractString(parsed, 'cartId', 'id', 'basketId');
            basketId = extractString(cartData, 'basketId', 'id')
              || extractString(parsed, 'basketId', 'id');
            subtotal = extractString(cartData, 'subtotal', 'total', 'grandTotal');
            currency = extractString(cartData, 'currency', 'currencyCode');
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  } else if (resultObj.cart && typeof resultObj.cart === 'object') {
    const cartData = resultObj.cart as Record<string, unknown>;
    if (Array.isArray(cartData.items)) {
      rawItems = cartData.items;
    } else if (Array.isArray(cartData.lineItems)) {
      rawItems = cartData.lineItems;
    }
    cartId = extractString(cartData, 'cartId', 'id', 'basketId');
    basketId = extractString(cartData, 'basketId', 'id');
    subtotal = extractString(cartData, 'subtotal', 'total', 'grandTotal');
    currency = extractString(cartData, 'currency', 'currencyCode');
  } else if (Array.isArray(resultObj.items)) {
    rawItems = resultObj.items;
    cartId = extractString(resultObj, 'cartId', 'id', 'basketId');
    basketId = extractString(resultObj, 'basketId', 'id');
    subtotal = extractString(resultObj, 'subtotal', 'total', 'grandTotal');
    currency = extractString(resultObj, 'currency', 'currencyCode');
  } else if (Array.isArray(resultObj.lineItems)) {
    rawItems = resultObj.lineItems;
    cartId = extractString(resultObj, 'cartId', 'id', 'basketId');
    basketId = extractString(resultObj, 'basketId', 'id');
    subtotal = extractString(resultObj, 'subtotal', 'total', 'grandTotal');
    currency = extractString(resultObj, 'currency', 'currencyCode');
  } else if (Array.isArray(result)) {
    rawItems = result;
  }

  const items: NormalizedCartItem[] = [];
  let totalQuantity = 0;

  for (const rawItem of rawItems) {
    if (items.length >= MAX_CART_ITEMS) {
      break;
    }
    const normalized = normalizeCartItem(rawItem);
    if (normalized) {
      items.push(normalized);
      totalQuantity += normalized.quantity;
    }
  }

  const cart: NormalizedCart = {
    itemCount: items.length,
    totalQuantity,
    items,
  };

  if (cartId) {
    cart.id = cartId;
  }
  if (basketId) {
    cart.basketId = basketId;
  }
  if (subtotal) {
    cart.subtotal = subtotal;
  }
  if (currency) {
    cart.currency = currency;
  }

  return cart;
}

/**
 * Parses a price string into a numeric amount.
 * Handles various formats like "12 990 kr", "12990", "$99.99", etc.
 */
function parsePriceAmount(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  
  const cleaned = priceStr.replace(/[^\d.,]/g, '').replace(',', '.');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Converts a NormalizedCartItem to a CartItem for the response.
 */
function normalizedItemToCartItem(item: NormalizedCartItem): CartItem {
  const cartItem: CartItem = {
    productId: item.productId,
    quantity: item.quantity,
  };

  if (item.name) {
    cartItem.name = item.name;
  }

  if (item.unitPrice || item.totalPrice || item.currency) {
    const price: CartPrice = {};
    const priceStr = item.unitPrice || item.totalPrice;
    if (priceStr) {
      price.amount = parsePriceAmount(priceStr);
      price.formatted = priceStr;
    }
    if (item.currency) {
      price.currency = item.currency;
    }
    if (price.amount !== undefined || price.currency || price.formatted) {
      cartItem.price = price;
    }
  }

  return cartItem;
}

/**
 * Converts a NormalizedCart to a CartSummary for the API response.
 * This is the widget-ready format returned in /v1/chat and /v1/chat/stream responses.
 * 
 * @param normalizedCart - The normalized cart from MCP response
 * @returns CartSummary for the API response
 */
export function normalizedCartToSummary(normalizedCart: NormalizedCart): CartSummary {
  const items: CartItem[] = normalizedCart.items.map(normalizedItemToCartItem);

  const summary: CartSummary = {
    itemCount: normalizedCart.itemCount,
    items,
  };

  if (normalizedCart.id) {
    summary.cartId = normalizedCart.id;
  }

  if (normalizedCart.subtotal || normalizedCart.currency) {
    const subtotalPrice: CartPrice = {};
    if (normalizedCart.subtotal) {
      subtotalPrice.amount = parsePriceAmount(normalizedCart.subtotal);
      subtotalPrice.formatted = normalizedCart.subtotal;
    }
    if (normalizedCart.currency) {
      subtotalPrice.currency = normalizedCart.currency;
    }
    if (subtotalPrice.amount !== undefined || subtotalPrice.currency || subtotalPrice.formatted) {
      summary.totals = {
        subtotal: subtotalPrice,
      };
    }
  }

  return summary;
}

/**
 * Converts a NormalizedCart to a CartState for session storage.
 * Caps items at MAX_CART_ITEMS_IN_SESSION to prevent token blowups.
 * 
 * @param normalizedCart - The normalized cart from MCP response
 * @returns CartState for session storage
 */
export function normalizedCartToState(normalizedCart: NormalizedCart): CartState {
  const items: CartStateItem[] = normalizedCart.items
    .slice(0, MAX_CART_ITEMS_IN_SESSION)
    .map((item): CartStateItem => {
      const stateItem: CartStateItem = {
        productId: item.productId,
        quantity: item.quantity,
      };

      if (item.name) {
        stateItem.name = item.name;
      }

      if (item.unitPrice || item.totalPrice || item.currency) {
        const priceStr = item.unitPrice || item.totalPrice;
        stateItem.price = {};
        if (priceStr) {
          stateItem.price.amount = parsePriceAmount(priceStr);
          stateItem.price.formatted = priceStr;
        }
        if (item.currency) {
          stateItem.price.currency = item.currency;
        }
      }

      return stateItem;
    });

  const state: CartState = {
    itemCount: Math.min(normalizedCart.itemCount, MAX_CART_ITEMS_IN_SESSION),
    items,
  };

  if (normalizedCart.id) {
    state.cartId = normalizedCart.id;
  }

  if (normalizedCart.basketId) {
    state.basketId = normalizedCart.basketId;
  }

  if (normalizedCart.subtotal || normalizedCart.currency) {
    state.totals = {};
    if (normalizedCart.subtotal) {
      state.totals.subtotal = {
        amount: parsePriceAmount(normalizedCart.subtotal),
        formatted: normalizedCart.subtotal,
      };
      if (normalizedCart.currency) {
        state.totals.subtotal.currency = normalizedCart.currency;
      }
    }
  }

  return state;
}

/**
 * Converts a CartState (from session) to a CartSummary (for response).
 * Used when returning cart data from session without making a new MCP call.
 * 
 * @param cartState - The cart state from session
 * @returns CartSummary for the API response
 */
export function cartStateToSummary(cartState: CartState): CartSummary {
  const items: CartItem[] = cartState.items.map((item): CartItem => {
    const cartItem: CartItem = {
      productId: item.productId,
      quantity: item.quantity,
    };

    if (item.name) {
      cartItem.name = item.name;
    }

    if (item.price) {
      cartItem.price = { ...item.price };
    }

    return cartItem;
  });

  const summary: CartSummary = {
    itemCount: cartState.itemCount,
    items,
  };

  if (cartState.cartId) {
    summary.cartId = cartState.cartId;
  }

  if (cartState.totals) {
    summary.totals = {};
    if (cartState.totals.subtotal) {
      summary.totals.subtotal = { ...cartState.totals.subtotal };
    }
    if (cartState.totals.total) {
      summary.totals.total = { ...cartState.totals.total };
    }
  }

  return summary;
}

/**
 * Result from cart handlers including context injection metadata.
 */
export interface CartHandlerResult extends CartResult {
  /** Metadata about context injection for debugging */
  contextInjection?: {
    effectiveContext?: ToolContext;
    modelContextIgnored: boolean;
    modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
  };
}

/**
 * Creates a cart_get handler that fetches Norce token and calls MCP cart.get tool.
 *
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * basketId handling:
 * - basketId is injected from httpContext.basketId (from session state)
 * - If args.basketId is provided (optional for debug), it takes precedence
 * - If no basketId is available, returns an empty cart with "No active basket yet"
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for cart_get
 */
export function createCartGetHandler(deps: CartHandlerDependencies) {
  return async (args: CartGetArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<CartHandlerResult> => {
    if (!applicationId) {
      throw new Error('applicationId is required for cart_get');
    }

    // Determine basketId: prefer args.basketId (debug), else httpContext.basketId (from session)
    const argsObj = args as Record<string, unknown>;
    const rawBasketId = argsObj.basketId ?? httpContext?.basketId;
    
    // Parse basketId to number - MCP server expects basketId as a number, not a string
    const basketId = parseBasketIdToNumber(rawBasketId);

    // If no valid basketId is available, return an empty cart without calling MCP
    if (!basketId) {
      const emptyCart: NormalizedCart = {
        itemCount: 0,
        totalQuantity: 0,
        items: [],
      };
      return {
        cart: emptyCart,
        contextInjection: {
          effectiveContext: httpContext,
          modelContextIgnored: false,
        },
      };
    }

    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Build MCP args with basketId as number (MCP server expects number, not string)
    const baseArgs: Record<string, unknown> = {
      basketId,
    };

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: argsObj.context },
      httpContext
    );

    const result = await deps.mcpClient.callTool(
      mcpState,
      CART_GET,
      contextResult.mcpArgs,
      accessToken,
      applicationId
    );

    const cart = normalizeCartResult(result);

    return {
      cart,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
    };
  };
}

/**
 * Creates a cart_add_item handler that fetches Norce token and calls MCP cart.addItem tool.
 *
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for cart_add_item
 */
export function createCartAddItemHandler(deps: CartHandlerDependencies) {
  return async (args: CartAddItemArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<CartHandlerResult> => {
    if (!applicationId) {
      throw new Error('applicationId is required for cart_add_item');
    }
    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Build base args without context
    // NOTE: MCP cart.addItem expects partNo (not productId) as the item identifier
    // NOTE: clientIp is REQUIRED for cart.addItem - without it, the add is a silent no-op
    const baseArgs: Record<string, unknown> = {
      partNo: args.partNo,
      quantity: args.quantity,
    };

    // Add basketId from httpContext if available (for adding to existing cart)
    // basketId MUST be sent as a number, not a string - MCP server validates this
    const basketId = parseBasketIdToNumber(httpContext?.basketId);
    if (basketId !== undefined) {
      baseArgs.basketId = basketId;
    }

    // Add clientIp from httpContext (required for cart.addItem)
    // clientIp MUST come from server request context, NOT from model args
    if (httpContext?.clientIp) {
      baseArgs.clientIp = httpContext.clientIp;
    }

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: (args as Record<string, unknown>).context },
      httpContext
    );

    const result = await deps.mcpClient.callTool(
      mcpState,
      CART_ADD_ITEM,
      contextResult.mcpArgs,
      accessToken,
      applicationId
    );

    const cart = normalizeCartResult(result);

    return {
      cart,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
    };
  };
}

/**
 * Creates a cart_set_item_quantity handler that fetches Norce token and calls MCP cart.setItemQuantity tool.
 *
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for cart_set_item_quantity
 */
export function createCartSetItemQuantityHandler(deps: CartHandlerDependencies) {
  return async (args: CartSetItemQuantityArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<CartHandlerResult> => {
    if (!applicationId) {
      throw new Error('applicationId is required for cart_set_item_quantity');
    }
    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Build base args without context
    const baseArgs: Record<string, unknown> = {
      productId: args.productId,
      quantity: args.quantity,
    };

    // Add basketId from httpContext if available (for modifying existing cart)
    // basketId MUST be sent as a number, not a string - MCP server validates this
    const basketId = parseBasketIdToNumber(httpContext?.basketId);
    if (basketId !== undefined) {
      baseArgs.basketId = basketId;
    }

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: (args as Record<string, unknown>).context },
      httpContext
    );

    const result = await deps.mcpClient.callTool(
      mcpState,
      CART_SET_ITEM_QUANTITY,
      contextResult.mcpArgs,
      accessToken,
      applicationId
    );

    const cart = normalizeCartResult(result);

    return {
      cart,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
    };
  };
}

/**
 * Creates a cart_remove_item handler that fetches Norce token and calls MCP cart.removeItem tool.
 *
 * Context handling (caller-owned context enforcement):
 * - Context is ALWAYS taken from httpContext (caller-provided), NEVER from args
 * - Any context in args is ignored (defense in depth against LLM override)
 * - If httpContext is not provided, context is omitted from MCP args (no guessing)
 *
 * @param deps - Dependencies (tokenProvider, mcpClient)
 * @returns Handler function for cart_remove_item
 */
export function createCartRemoveItemHandler(deps: CartHandlerDependencies) {
  return async (args: CartRemoveItemArgs, mcpState: McpState, httpContext?: ToolContext, applicationId?: string): Promise<CartHandlerResult> => {
    if (!applicationId) {
      throw new Error('applicationId is required for cart_remove_item');
    }
    const accessToken = await deps.tokenProvider.getAccessToken(applicationId);

    // Build base args without context
    const baseArgs: Record<string, unknown> = {
      productId: args.productId,
    };

    // Add basketId from httpContext if available (for modifying existing cart)
    // basketId MUST be sent as a number, not a string - MCP server validates this
    const basketId = parseBasketIdToNumber(httpContext?.basketId);
    if (basketId !== undefined) {
      baseArgs.basketId = basketId;
    }

    // Use buildMcpArgs to inject context from httpContext only (ignores any context in args)
    const contextResult = buildMcpArgs(
      { ...baseArgs, context: (args as Record<string, unknown>).context },
      httpContext
    );

    const result = await deps.mcpClient.callTool(
      mcpState,
      CART_REMOVE_ITEM,
      contextResult.mcpArgs,
      accessToken,
      applicationId
    );

    const cart = normalizeCartResult(result);

    return {
      cart,
      contextInjection: {
        effectiveContext: contextResult.effectiveContext,
        modelContextIgnored: contextResult.modelContextIgnored,
        modelProvidedContextPreview: contextResult.modelProvidedContextPreview,
      },
    };
  };
}
