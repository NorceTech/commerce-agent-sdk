/**
 * User-facing status copy catalog for stages and tools.
 *
 * This file is the single source of truth for all user-facing status messages
 * used by the Agent BFF while streaming. Changing copy later should be a
 * one-file edit.
 *
 * Guidelines:
 * - Keep copy short, calm, and "normal user" friendly.
 * - Avoid dev terms like "round", "tool", "RPC", "MCP".
 * - No emojis by default.
 * - Copy is in English (for now).
 */

/**
 * Stage identifiers for generic status messages.
 */
export type StageId =
  | 'start'
  | 'thinking'
  | 'searching'
  | 'refining'
  | 'details'
  | 'cart'
  | 'comparing'
  | 'finalizing';

/**
 * Known tool identifiers.
 */
export type ToolId =
  | 'product_search'
  | 'product_get'
  | 'cart_get'
  | 'cart_additem'
  | 'cart_setitemquantity'
  | 'cart_removeitem';

/**
 * Tool message phases.
 */
export type ToolPhase = 'start' | 'end';

/**
 * Status copy catalog structure.
 */
interface StatusCopyCatalog {
  stages: Record<StageId, string>;
  tools: {
    displayNames: Record<string, string>;
    startMessages: Record<string, string>;
    endMessages: {
      ok: Record<string, string>;
      fail: Record<string, string>;
    };
  };
}

/**
 * The single source of truth for all user-facing status copy.
 */
export const STATUS_COPY: StatusCopyCatalog = {
  stages: {
    start: 'Starting…',
    thinking: 'Thinking…',
    searching: 'Searching the catalog…',
    refining: 'Refining the results…',
    details: 'Checking details and availability…',
    cart: 'Updating your cart…',
    comparing: 'Preparing a comparison…',
    finalizing: 'Preparing the reply…',
  },
  tools: {
    displayNames: {
      product_search: 'Search products',
      product_get: 'Get product details',
      cart_get: 'Get cart',
      cart_additem: 'Add to cart',
      cart_add_item: 'Add to cart',
      cart_setitemquantity: 'Update quantity',
      cart_set_item_quantity: 'Update quantity',
      cart_removeitem: 'Remove item',
      cart_remove_item: 'Remove item',
    },
    startMessages: {
      product_search: 'Searching the catalog…',
      product_get: 'Checking details and availability…',
      cart_get: 'Checking your cart…',
      cart_additem: 'Adding to your cart…',
      cart_add_item: 'Adding to your cart…',
      cart_setitemquantity: 'Updating your cart…',
      cart_set_item_quantity: 'Updating your cart…',
      cart_removeitem: 'Updating your cart…',
      cart_remove_item: 'Updating your cart…',
    },
    endMessages: {
      ok: {
        product_search: 'Found some options.',
        product_get: 'Details checked.',
        cart_get: 'Cart updated.',
        cart_additem: 'Cart updated.',
        cart_add_item: 'Cart updated.',
        cart_setitemquantity: 'Cart updated.',
        cart_set_item_quantity: 'Cart updated.',
        cart_removeitem: 'Cart updated.',
        cart_remove_item: 'Cart updated.',
      },
      fail: {
        product_search: 'Search didn\'t work. Retrying…',
        product_get: 'Couldn\'t load details. Retrying…',
        cart_get: 'Couldn\'t update cart. Retrying…',
        cart_additem: 'Couldn\'t update cart. Retrying…',
        cart_add_item: 'Couldn\'t update cart. Retrying…',
        cart_setitemquantity: 'Couldn\'t update cart. Retrying…',
        cart_set_item_quantity: 'Couldn\'t update cart. Retrying…',
        cart_removeitem: 'Couldn\'t update cart. Retrying…',
        cart_remove_item: 'Couldn\'t update cart. Retrying…',
      },
    },
  },
};

/**
 * Get the user-facing status message for a given stage.
 *
 * @param stage - The stage identifier
 * @returns The user-facing status message
 */
export function getStageMessage(stage: StageId): string {
  return STATUS_COPY.stages[stage];
}

/**
 * Get the user-facing message for a tool execution phase.
 *
 * @param toolName - The internal tool name (e.g., "product_search", "cart_add_item")
 * @param phase - The phase of tool execution ("start" or "end")
 * @param ok - Whether the tool execution succeeded (only relevant for "end" phase)
 * @returns The user-facing message, or a sensible default for unknown tools
 */
export function getToolMessage(
  toolName: string,
  phase: ToolPhase,
  ok?: boolean
): string {
  const normalizedName = toolName.toLowerCase();

  if (phase === 'start') {
    return STATUS_COPY.tools.startMessages[normalizedName] ?? 'Working…';
  }

  // phase === 'end'
  const outcome = ok !== false ? 'ok' : 'fail';
  return STATUS_COPY.tools.endMessages[outcome][normalizedName] ?? (ok !== false ? 'Done.' : 'Something went wrong. Retrying…');
}

/**
 * Get the UI-friendly display name for a tool.
 *
 * @param toolName - The internal tool name
 * @returns The UI-friendly display name, or the original tool name if unknown
 */
export function getToolDisplayName(toolName: string): string {
  const normalizedName = toolName.toLowerCase();
  return STATUS_COPY.tools.displayNames[normalizedName] ?? toolName;
}

/**
 * Event types that can be used with pickStatusForEvent.
 */
export type StatusEventType =
  | 'stage_change'
  | 'tool_start'
  | 'tool_end';

/**
 * Event payload for pickStatusForEvent.
 */
export interface StatusEvent {
  type: StatusEventType;
  stage?: StageId;
  toolName?: string;
  ok?: boolean;
}

/**
 * Convenience function to pick the best status message for a given event.
 *
 * @param event - The status event
 * @returns The appropriate user-facing status message
 */
export function pickStatusForEvent(event: StatusEvent): string {
  switch (event.type) {
    case 'stage_change':
      if (event.stage) {
        return getStageMessage(event.stage);
      }
      return STATUS_COPY.stages.thinking;

    case 'tool_start':
      if (event.toolName) {
        return getToolMessage(event.toolName, 'start');
      }
      return STATUS_COPY.stages.thinking;

    case 'tool_end':
      if (event.toolName) {
        return getToolMessage(event.toolName, 'end', event.ok);
      }
      return event.ok !== false ? 'Done.' : 'Something went wrong.';

    default:
      return STATUS_COPY.stages.thinking;
  }
}
