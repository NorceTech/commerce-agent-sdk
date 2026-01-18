/**
 * Choice types for structured disambiguation in chat responses.
 * These types enable the widget to render choices as buttons and handle user selections.
 */

import { z } from 'zod';

/**
 * Maximum number of options to include in a choice set.
 */
export const MAX_CHOICE_OPTIONS = 6;

/**
 * Minimum number of options to include in a choice set.
 */
export const MIN_CHOICE_OPTIONS = 3;

/**
 * The kind of choice set being presented.
 * - variant: Variant disambiguation (e.g., size/color selection)
 * - product: Product selection from search results
 * - generic: Any other type of choice
 */
export type ChoiceKind = 'variant' | 'product' | 'generic';

/**
 * Metadata for a choice option.
 * Contains additional information that may be useful for rendering or processing.
 */
export interface ChoiceOptionMeta {
  /** Stock on hand quantity */
  onHand?: number;
  /** Whether the option is buyable */
  isBuyable?: boolean;
  /** Dimension values map (e.g., { "Color": "Blue", "Size": "M" }) */
  dimsMap?: Record<string, string>;
  /** Part number for cart operations */
  partNo?: string;
  /** Whether the option is in stock */
  inStock?: boolean;
  /** Any additional metadata */
  [key: string]: unknown;
}

/**
 * A single option in a choice set.
 */
export interface ChoiceOption {
  /** Unique identifier for this option (e.g., variantProductId) */
  id: string;
  /** Human-readable label for display */
  label: string;
  /** Optional metadata for the option */
  meta?: ChoiceOptionMeta;
}

/**
 * A structured choice set for disambiguation.
 * Returned in ChatResponse when the agent needs user input to proceed.
 */
export interface ChoiceSet {
  /** Unique identifier for this choice set */
  id: string;
  /** The kind of choice being presented */
  kind: ChoiceKind;
  /** Prompt text explaining what the user should choose */
  prompt: string;
  /** Array of options to choose from (3-6 options) */
  options: ChoiceOption[];
}

/**
 * Active choice set stored in session state.
 * Used for deterministic resolution of "option N" references.
 */
export interface ActiveChoiceSet {
  /** Unique identifier for this choice set */
  id: string;
  /** The kind of choice being presented */
  kind: ChoiceKind;
  /** Array of options with their IDs for resolution */
  options: ChoiceOption[];
  /** Timestamp when the choice set was created */
  createdAt: number;
  /** Parent product ID (for variant choices) */
  parentProductId?: string;
}

// Zod Schemas

/**
 * Zod schema for choice option metadata.
 */
export const choiceOptionMetaSchema = z.object({
  onHand: z.number().optional(),
  isBuyable: z.boolean().optional(),
  dimsMap: z.record(z.string(), z.string()).optional(),
  partNo: z.string().optional(),
  inStock: z.boolean().optional(),
}).passthrough();

/**
 * Zod schema for a single choice option.
 */
export const choiceOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  meta: choiceOptionMetaSchema.optional(),
});

/**
 * Zod schema for choice kind.
 */
export const choiceKindSchema = z.enum(['variant', 'product', 'generic']);

/**
 * Zod schema for a choice set.
 */
export const choiceSetSchema = z.object({
  id: z.string().min(1),
  kind: choiceKindSchema,
  prompt: z.string().min(1),
  options: z.array(choiceOptionSchema).min(1).max(MAX_CHOICE_OPTIONS),
});

/**
 * Zod schema for active choice set in session state.
 */
export const activeChoiceSetSchema = z.object({
  id: z.string().min(1),
  kind: choiceKindSchema,
  options: z.array(choiceOptionSchema).min(1).max(MAX_CHOICE_OPTIONS),
  createdAt: z.number(),
  parentProductId: z.string().optional(),
});

/**
 * Type inferred from the choice set schema.
 */
export type ChoiceSetSchema = z.infer<typeof choiceSetSchema>;

/**
 * Type inferred from the active choice set schema.
 */
export type ActiveChoiceSetSchema = z.infer<typeof activeChoiceSetSchema>;

/**
 * Validates a choice set against the schema.
 * @param choiceSet - The choice set to validate
 * @returns The validated choice set
 * @throws ZodError if validation fails
 */
export function validateChoiceSet(choiceSet: unknown): ChoiceSetSchema {
  return choiceSetSchema.parse(choiceSet);
}

/**
 * Safely validates a choice set against the schema.
 * @param choiceSet - The choice set to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeParseChoiceSet(choiceSet: unknown) {
  return choiceSetSchema.safeParse(choiceSet);
}

/**
 * Creates a ChoiceSet from variant choices for disambiguation.
 * @param variantChoices - Array of variant choices from variant preflight
 * @param parentProductId - The parent product ID
 * @param productName - Optional product name for context
 * @returns A ChoiceSet for variant disambiguation
 */
export function createVariantChoiceSet(
  variantChoices: Array<{
    index: number;
    variantProductId: string;
    label: string;
    dimsMap?: Record<string, string>;
    onHand?: number;
    isBuyable?: boolean;
    partNo?: string;
  }>,
  parentProductId: string,
  productName?: string
): ChoiceSet {
  const id = `variant-${parentProductId}-${Date.now()}`;
  const prompt = productName
    ? `"${productName}" comes in multiple variants. Which one would you like?`
    : 'This product comes in multiple variants. Which one would you like?';

  const options: ChoiceOption[] = variantChoices
    .slice(0, MAX_CHOICE_OPTIONS)
    .map((choice): ChoiceOption => ({
      id: choice.variantProductId,
      label: choice.label,
      meta: {
        onHand: choice.onHand,
        isBuyable: choice.isBuyable,
        dimsMap: choice.dimsMap,
        partNo: choice.partNo,
        inStock: choice.onHand !== undefined && choice.onHand > 0,
      },
    }));

  return {
    id,
    kind: 'variant',
    prompt,
    options,
  };
}

/**
 * Creates an ActiveChoiceSet from a ChoiceSet for session storage.
 * @param choiceSet - The choice set to convert
 * @param parentProductId - Optional parent product ID (for variant choices)
 * @returns An ActiveChoiceSet for session storage
 */
export function createActiveChoiceSet(
  choiceSet: ChoiceSet,
  parentProductId?: string
): ActiveChoiceSet {
  return {
    id: choiceSet.id,
    kind: choiceSet.kind,
    options: choiceSet.options,
    createdAt: Date.now(),
    parentProductId,
  };
}
