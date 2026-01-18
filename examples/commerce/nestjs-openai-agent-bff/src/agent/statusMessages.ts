/**
 * User-facing status message vocabulary.
 * 
 * These messages are designed to be end-user friendly and are emitted
 * during streaming to provide progress feedback without exposing
 * developer-oriented details like "Processing round N".
 * 
 * Developer-oriented status messages are emitted separately via
 * dev_status events when debug mode is enabled.
 */

/**
 * Status stages for user-facing messages.
 */
export type StatusStage =
  | 'start'
  | 'thinking'
  | 'searching'
  | 'refining'
  | 'fetchingDetails'
  | 'updatingCart'
  | 'finalizing';

/**
 * User-facing status messages for each stage.
 */
const STATUS_MESSAGES: Record<StatusStage, string> = {
  start: 'Starting…',
  thinking: 'Thinking…',
  searching: 'Searching the catalog…',
  refining: 'Refining the results…',
  fetchingDetails: 'Fetching product details…',
  updatingCart: 'Updating your cart…',
  finalizing: 'Preparing the reply…',
};

/**
 * Get the user-facing status message for a given stage.
 * 
 * @param stage - The status stage
 * @returns The user-facing status message
 */
export function userFacingStatus(stage: StatusStage): string {
  return STATUS_MESSAGES[stage];
}

/**
 * Determine the appropriate user-facing status based on the tool being executed.
 * 
 * @param toolName - The internal tool name
 * @returns The appropriate StatusStage for the tool
 */
export function getStatusStageForTool(toolName: string): StatusStage {
  switch (toolName) {
    case 'product_search':
      return 'searching';
    case 'product_get':
      return 'fetchingDetails';
    case 'cart_get':
    case 'cart_add_item':
    case 'cart_set_item_quantity':
    case 'cart_remove_item':
      return 'updatingCart';
    default:
      return 'thinking';
  }
}

/**
 * Determine the user-facing status based on the current round and context.
 * 
 * @param round - The current round number (1-indexed)
 * @param isFirstRound - Whether this is the first round
 * @param lastToolName - The name of the last tool executed (if any)
 * @returns The appropriate StatusStage
 */
export function getStatusStageForRound(
  round: number,
  isFirstRound: boolean,
  lastToolName?: string
): StatusStage {
  if (isFirstRound) {
    return 'thinking';
  }
  
  if (lastToolName === 'product_search') {
    return 'refining';
  }
  
  if (lastToolName === 'product_get') {
    return 'fetchingDetails';
  }
  
  if (lastToolName?.startsWith('cart_')) {
    return 'updatingCart';
  }
  
  return 'refining';
}

/**
 * Build a developer status message with round information.
 * This is only emitted when debug mode is enabled.
 * 
 * @param round - The current round number
 * @param additionalInfo - Optional additional information to include
 * @returns Developer status message object
 */
export function buildDevStatus(
  round: number,
  additionalInfo?: Record<string, unknown>
): { message: string; round: number } & Record<string, unknown> {
  return {
    message: `Processing round ${round}...`,
    round,
    ...additionalInfo,
  };
}
