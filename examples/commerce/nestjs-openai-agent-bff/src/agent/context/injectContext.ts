import type { ToolContext } from '../../session/sessionTypes.js';

/**
 * Result of building MCP args with context injection.
 * Includes the final args and metadata about context handling.
 */
export interface BuildMcpArgsResult<T> {
  /** The final MCP arguments with context injected (or omitted) */
  mcpArgs: T & { context?: ToolContext };
  /** The effective context that was used (from toolContext, not from model args) */
  effectiveContext?: ToolContext;
  /** True if the model args contained a context field that was ignored */
  modelContextIgnored: boolean;
  /** Preview of the model-provided context (safe subset only) for debugging */
  modelProvidedContextPreview?: { cultureCode?: string; currencyCode?: string };
}

/**
 * Strips the context field from model-provided args (defense in depth).
 * Returns a new object without the context property.
 */
function stripContextFromArgs<T extends Record<string, unknown>>(args: T): Omit<T, 'context'> {
  const { context, ...rest } = args;
  return rest as Omit<T, 'context'>;
}

/**
 * Extracts a safe preview of context for debugging purposes.
 * Only includes cultureCode and currencyCode to avoid logging sensitive data.
 */
function extractSafeContextPreview(
  context: unknown
): { cultureCode?: string; currencyCode?: string } | undefined {
  if (!context || typeof context !== 'object') {
    return undefined;
  }

  const ctx = context as Record<string, unknown>;
  const preview: { cultureCode?: string; currencyCode?: string } = {};

  if (typeof ctx.cultureCode === 'string') {
    preview.cultureCode = ctx.cultureCode;
  }
  if (typeof ctx.currencyCode === 'string') {
    preview.currencyCode = ctx.currencyCode;
  }

  return Object.keys(preview).length > 0 ? preview : undefined;
}

/**
 * Builds MCP arguments by:
 * 1. Stripping any context from model-provided args (defense in depth)
 * 2. Injecting context from toolContext if present
 * 3. Omitting context entirely if toolContext is not provided (no guessing)
 *
 * This ensures that context is ALWAYS caller-owned and never model-chosen.
 *
 * @param args - The model-provided tool arguments (may contain context that will be ignored)
 * @param toolContext - The caller-provided context from the HTTP request
 * @returns Object containing the final MCP args and metadata about context handling
 *
 * @example
 * // Model tries to inject en-US/USD, but caller provided sv-SE/SEK
 * const result = buildMcpArgs(
 *   { query: 'table', context: { cultureCode: 'en-US', currencyCode: 'USD' } },
 *   { cultureCode: 'sv-SE', currencyCode: 'SEK' }
 * );
 * // result.mcpArgs = { query: 'table', context: { cultureCode: 'sv-SE', currencyCode: 'SEK' } }
 * // result.effectiveContext = { cultureCode: 'sv-SE', currencyCode: 'SEK' }
 * // result.modelContextIgnored = true
 * // result.modelProvidedContextPreview = { cultureCode: 'en-US', currencyCode: 'USD' }
 */
export function buildMcpArgs<T extends Record<string, unknown>>(
  args: T,
  toolContext?: ToolContext
): BuildMcpArgsResult<Omit<T, 'context'>> {
  // Check if model args contained a context field
  const modelProvidedContext = 'context' in args ? args.context : undefined;
  const modelContextIgnored = modelProvidedContext !== undefined;
  const modelProvidedContextPreview = modelContextIgnored
    ? extractSafeContextPreview(modelProvidedContext)
    : undefined;

  // Strip context from model args (defense in depth)
  const strippedArgs = stripContextFromArgs(args);

  // Build the final MCP args
  const mcpArgs: Omit<T, 'context'> & { context?: ToolContext } = { ...strippedArgs };

  // Inject context from toolContext if present, otherwise omit entirely
  if (toolContext !== undefined && toolContext !== null) {
    mcpArgs.context = toolContext;
  }

  return {
    mcpArgs,
    effectiveContext: toolContext,
    modelContextIgnored,
    modelProvidedContextPreview,
  };
}

/**
 * Convenience function that returns just the MCP args without metadata.
 * Use buildMcpArgs if you need the metadata for debugging/logging.
 */
export function injectContext<T extends Record<string, unknown>>(
  args: T,
  toolContext?: ToolContext
): Omit<T, 'context'> & { context?: ToolContext } {
  return buildMcpArgs(args, toolContext).mcpArgs;
}
