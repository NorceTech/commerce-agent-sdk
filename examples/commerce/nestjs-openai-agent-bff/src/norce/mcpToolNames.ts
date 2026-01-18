/**
 * Canonical MCP tool names for Norce Commerce.
 *
 * These constants define the exact tool names used in MCP JSON-RPC calls.
 * All MCP tool calls should reference these constants instead of inline string literals
 * to ensure consistency and make it easier to update tool names if they change.
 *
 * Tool names can be verified by running: npm run mcp:tools
 */

/** Search for products in the Norce catalog */
export const PRODUCT_SEARCH = 'product.search';

/** Get detailed information about a specific product */
export const PRODUCT_GET = 'product.get';

/** Get the current cart contents */
export const CART_GET = 'cart.get';

/** Add an item to the cart */
export const CART_ADD_ITEM = 'cart.addItem';

/** Set the quantity of an item in the cart */
export const CART_SET_ITEM_QUANTITY = 'cart.setItemQuantity';

/** Remove an item from the cart */
export const CART_REMOVE_ITEM = 'cart.removeItem';

/**
 * All available MCP tool names as a readonly array.
 * Useful for validation or iteration.
 */
export const ALL_MCP_TOOLS = [
  PRODUCT_SEARCH,
  PRODUCT_GET,
  CART_GET,
  CART_ADD_ITEM,
  CART_SET_ITEM_QUANTITY,
  CART_REMOVE_ITEM,
] as const;

/**
 * Type representing valid MCP tool names.
 */
export type McpToolName = (typeof ALL_MCP_TOOLS)[number];
