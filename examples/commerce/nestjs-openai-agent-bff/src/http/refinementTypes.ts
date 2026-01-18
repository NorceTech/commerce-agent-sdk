/**
 * Refinement types for structured search fallback actions.
 * 
 * These types define the structured refinement actions that can be returned
 * when a search returns 0 results or when the user might benefit from
 * narrowing/broadening their search.
 * 
 * Refinements are widget-renderable actions that the frontend can display
 * as buttons or chips for the user to click.
 */

import { z } from 'zod';

/**
 * Payload types for refinement actions.
 * These define what data is sent back to the server when the user clicks a refinement.
 */

/**
 * Broaden search payload - retry with a simpler/broader query.
 */
export interface SearchBroadenPayload {
  type: 'search_broaden';
  query: string;
}

/**
 * Retry search payload - retry with a specific query.
 */
export interface SearchRetryPayload {
  type: 'search_retry';
  query: string;
}

/**
 * Remove constraints payload - retry without specific constraints.
 */
export interface RemoveConstraintsPayload {
  type: 'remove_constraints';
  constraintsToRemove?: string[];
}

/**
 * Ask clarification payload - prompt user for more information.
 */
export interface AskClarifyPayload {
  type: 'ask_clarify';
  questionId?: string;
  question?: string;
}

/**
 * Filter by dimension payload - add a filter to narrow results.
 */
export interface FilterByDimensionPayload {
  type: 'filter_by_dimension';
  dimension: string;
  value?: string;
}

/**
 * Union type for all refinement payloads.
 */
export type RefinementPayload =
  | SearchBroadenPayload
  | SearchRetryPayload
  | RemoveConstraintsPayload
  | AskClarifyPayload
  | FilterByDimensionPayload;

/**
 * A structured refinement action that the widget can render as a button.
 * 
 * The `id` is a unique identifier for this refinement within the response.
 * The `label` is the user-facing text to display on the button.
 * The `payload` contains the data needed to execute the refinement action.
 */
export interface RefinementAction {
  id: string;
  label: string;
  payload: RefinementPayload;
}

/**
 * Zod schema for search_broaden payload.
 */
export const searchBroadenPayloadSchema = z.object({
  type: z.literal('search_broaden'),
  query: z.string(),
});

/**
 * Zod schema for search_retry payload.
 */
export const searchRetryPayloadSchema = z.object({
  type: z.literal('search_retry'),
  query: z.string(),
});

/**
 * Zod schema for remove_constraints payload.
 */
export const removeConstraintsPayloadSchema = z.object({
  type: z.literal('remove_constraints'),
  constraintsToRemove: z.array(z.string()).optional(),
});

/**
 * Zod schema for ask_clarify payload.
 */
export const askClarifyPayloadSchema = z.object({
  type: z.literal('ask_clarify'),
  questionId: z.string().optional(),
  question: z.string().optional(),
});

/**
 * Zod schema for filter_by_dimension payload.
 */
export const filterByDimensionPayloadSchema = z.object({
  type: z.literal('filter_by_dimension'),
  dimension: z.string(),
  value: z.string().optional(),
});

/**
 * Zod schema for refinement payload (union of all payload types).
 */
export const refinementPayloadSchema = z.discriminatedUnion('type', [
  searchBroadenPayloadSchema,
  searchRetryPayloadSchema,
  removeConstraintsPayloadSchema,
  askClarifyPayloadSchema,
  filterByDimensionPayloadSchema,
]);

/**
 * Zod schema for a refinement action.
 */
export const refinementActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  payload: refinementPayloadSchema,
});

/**
 * Zod schema for an array of refinement actions.
 */
export const refinementsArraySchema = z.array(refinementActionSchema);

/**
 * Type inferred from the Zod schema.
 */
export type RefinementActionSchema = z.infer<typeof refinementActionSchema>;

/**
 * Validates a refinement action against the schema.
 * 
 * @param action - The action to validate
 * @returns The validated action
 * @throws ZodError if validation fails
 */
export function validateRefinementAction(action: unknown): RefinementActionSchema {
  return refinementActionSchema.parse(action);
}

/**
 * Safely validates a refinement action against the schema.
 * 
 * @param action - The action to validate
 * @returns SafeParseResult with success flag and data or error
 */
export function safeParseRefinementAction(action: unknown) {
  return refinementActionSchema.safeParse(action);
}
