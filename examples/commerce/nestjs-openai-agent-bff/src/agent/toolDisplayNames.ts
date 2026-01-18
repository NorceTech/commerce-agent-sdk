/**
 * Tool display name registry for UI-friendly names.
 * Maps internal tool names to user-facing display names for streamed events.
 *
 * Internal tool names are preserved for debug/toolTrace purposes.
 * Display names are used in SSE events intended for end users.
 */
export const TOOL_DISPLAY_NAME: Record<string, string> = {
  product_search: 'Searching products',
  product_get: 'Fetching product details',
  cart_get: 'Checking your cart',
  cart_add_item: 'Adding to cart',
  cart_set_item_quantity: 'Updating cart',
  cart_remove_item: 'Removing from cart',
};

/**
 * Get the UI-friendly display name for a tool.
 * Falls back to the original tool name if no display name is defined.
 *
 * @param toolName - The internal tool name
 * @returns The UI-friendly display name, or the original tool name if unknown
 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAME[toolName] ?? toolName;
}
