/**
 * Simple confirmation classifier for cart mutation gating.
 * Used for safe gating - does not use OpenAI, just simple pattern matching.
 */

/**
 * Patterns that indicate user affirmation/confirmation.
 * Case-insensitive matching.
 * Includes both English and Swedish patterns for localization support.
 */
const AFFIRMATION_PATTERNS = [
  // English patterns
  /^y$/i,
  /^yes$/i,
  /^ok$/i,
  /^okay$/i,
  /^confirm$/i,
  /^sure$/i,
  /^yep$/i,
  /^yeah$/i,
  /^go ahead$/i,
  /^do it$/i,
  /^please$/i,
  /^please do$/i,
  // Swedish patterns
  /^ja$/i,
  /^japp$/i,
  /^jo$/i,
  /^visst$/i,
  /^absolut$/i,
  /^självklart$/i,
  /^gör det$/i,
  /^kör$/i,
];

/**
 * Patterns that indicate user rejection/cancellation.
 * Case-insensitive matching.
 * Includes both English and Swedish patterns for localization support.
 */
const REJECTION_PATTERNS = [
  // English patterns
  /^n$/i,
  /^no$/i,
  /^cancel$/i,
  /^stop$/i,
  /^nope$/i,
  /^nah$/i,
  /^don't$/i,
  /^dont$/i,
  /^never mind$/i,
  /^nevermind$/i,
  // Swedish patterns
  /^nej$/i,
  /^nä$/i,
  /^nää$/i,
  /^avbryt$/i,
  /^stopp$/i,
  /^strunt$/i,
  /^glöm det$/i,
];

/**
 * Checks if the user's message is an affirmation (yes/confirm/ok).
 * Used for confirming pending cart mutations.
 * 
 * @param text - The user's message text
 * @returns true if the message is an affirmation
 */
export function isAffirmation(text: string): boolean {
  const trimmed = text.trim();
  return AFFIRMATION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * Checks if the user's message is a rejection (no/cancel/stop).
 * Used for cancelling pending cart mutations.
 * 
 * @param text - The user's message text
 * @returns true if the message is a rejection
 */
export function isRejection(text: string): boolean {
  const trimmed = text.trim();
  return REJECTION_PATTERNS.some(pattern => pattern.test(trimmed));
}

/**
 * List of cart mutation tool names that require confirmation.
 */
export const CART_MUTATION_TOOLS = [
  'cart_add_item',
  'cart_set_item_quantity',
  'cart_remove_item',
] as const;

/**
 * Checks if a tool name is a cart mutation tool that requires confirmation.
 * 
 * @param toolName - The name of the tool
 * @returns true if the tool is a cart mutation tool
 */
export function isCartMutationTool(toolName: string): boolean {
  return (CART_MUTATION_TOOLS as readonly string[]).includes(toolName);
}

/**
 * Builds a deterministic confirmation message for a pending cart action.
 * Does not use LLM - generates a simple, clear message.
 * 
 * @param kind - The type of cart mutation
 * @param args - The arguments for the mutation
 * @returns A confirmation message string
 */
export function buildConfirmationMessage(
  kind: 'cart_add_item' | 'cart_set_item_quantity' | 'cart_remove_item',
  args: Record<string, unknown>
): string {
  // NOTE: cart_add_item uses partNo as the item identifier (not productId)
  // Other cart tools may still use productId or lineItemId
  const partNo = args.partNo as string | undefined;
  const productId = args.productId as string | undefined;
  const quantity = args.quantity as number | undefined;

  switch (kind) {
    case 'cart_add_item': {
      const qty = quantity ?? 1;
      // Prefer partNo for cart_add_item (MCP cart.addItem expects partNo)
      const identifier = partNo || productId;
      if (identifier) {
        return `I can add ${qty} x item ${identifier} to your cart. Confirm? (yes/no)`;
      }
      return `I can add an item to your cart. Confirm? (yes/no)`;
    }
    case 'cart_set_item_quantity': {
      if (productId && quantity !== undefined) {
        return `I can set the quantity of product ${productId} to ${quantity} in your cart. Confirm? (yes/no)`;
      }
      return `I can update the quantity of an item in your cart. Confirm? (yes/no)`;
    }
    case 'cart_remove_item': {
      if (productId) {
        return `I can remove product ${productId} from your cart. Confirm? (yes/no)`;
      }
      return `I can remove an item from your cart. Confirm? (yes/no)`;
    }
    default:
      return `I need your confirmation to proceed with this cart action. Confirm? (yes/no)`;
  }
}
