/**
 * Internationalization (i18n) module for BFF stream status messages.
 *
 * This module provides localized strings for SSE status events emitted during
 * agent execution. Currently supports English (en) and Swedish (sv) with
 * English as the fallback.
 *
 * NOTE: This module is intentionally minimal and only handles stream status messages.
 * It does NOT localize the entire assistant - only status/progress messages.
 */

import enStatusStrings from './en/status.json' with { type: 'json' };
import svStatusStrings from './sv/status.json' with { type: 'json' };

/**
 * Supported languages for status messages.
 */
export type StatusLanguage = 'en' | 'sv';

/**
 * Type for the status i18n strings structure.
 */
type StatusStrings = typeof enStatusStrings;

/**
 * Map of supported languages to their status string resources.
 */
const STATUS_LANGUAGE_STRINGS: Record<StatusLanguage, StatusStrings> = {
  en: enStatusStrings,
  sv: svStatusStrings,
};

/**
 * Default/fallback language when the requested language is not supported.
 */
export const DEFAULT_STATUS_LANGUAGE: StatusLanguage = 'en';

/**
 * Resolves a language code from uiLanguage or cultureCode.
 *
 * Priority:
 * 1. uiLanguage (if provided and supported)
 * 2. cultureCode (if provided and supported)
 * 3. English fallback
 *
 * Examples:
 * - { uiLanguage: "sv" } => "sv"
 * - { cultureCode: "sv-SE" } => "sv"
 * - { uiLanguage: "sv", cultureCode: "en-US" } => "sv" (uiLanguage takes priority)
 * - { cultureCode: "en-US" } => "en"
 * - { cultureCode: "de-DE" } => "en" (fallback - German not supported)
 * - {} => "en" (fallback)
 *
 * @param options - Object containing uiLanguage and/or cultureCode
 * @returns The resolved language code ("en" or "sv")
 */
export function resolveStatusLanguage(options?: {
  uiLanguage?: string;
  cultureCode?: string;
}): StatusLanguage {
  if (!options) {
    return DEFAULT_STATUS_LANGUAGE;
  }

  const { uiLanguage, cultureCode } = options;

  // Try uiLanguage first (takes priority)
  if (uiLanguage) {
    const langPart = uiLanguage.split('-')[0].toLowerCase();
    if (langPart in STATUS_LANGUAGE_STRINGS) {
      return langPart as StatusLanguage;
    }
  }

  // Fall back to cultureCode
  if (cultureCode) {
    const langPart = cultureCode.split('-')[0].toLowerCase();
    if (langPart in STATUS_LANGUAGE_STRINGS) {
      return langPart as StatusLanguage;
    }
  }

  return DEFAULT_STATUS_LANGUAGE;
}

/**
 * Gets the status strings for a given language.
 *
 * @param language - The language code
 * @returns The status strings for the language
 */
export function getStatusStrings(language: StatusLanguage): StatusStrings {
  return STATUS_LANGUAGE_STRINGS[language] ?? STATUS_LANGUAGE_STRINGS[DEFAULT_STATUS_LANGUAGE];
}

/**
 * Interpolates placeholders in a string with values.
 * Placeholders are in the format {key}.
 *
 * @param template - The template string with placeholders
 * @param values - The values to interpolate
 * @returns The interpolated string
 */
function interpolateStatus(
  template: string,
  values?: Record<string, string | number | undefined>
): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Gets a localized status string by key with optional interpolation.
 *
 * Key format uses dot notation to navigate the JSON structure:
 * - "stage.thinking" => strings.stage.thinking
 * - "tool.start.product_search" => strings.tool.start.product_search
 * - "tool.end.ok.product_search" => strings.tool.end.ok.product_search
 * - "stream.round" => strings.stream.round (with {round} interpolation)
 *
 * @param lang - The language code
 * @param key - The dot-notation key for the string
 * @param vars - Optional variables for interpolation
 * @returns The localized string, or the key if not found
 */
export function tStatus(
  lang: StatusLanguage,
  key: string,
  vars?: Record<string, string | number | undefined>
): string {
  const strings = getStatusStrings(lang);
  const parts = key.split('.');

  // Navigate the nested structure
  let current: unknown = strings;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      // Key not found, return the key itself
      return key;
    }
  }

  if (typeof current !== 'string') {
    // Value is not a string (might be an object), return the key
    return key;
  }

  return interpolateStatus(current, vars);
}

/**
 * Gets a localized stage message.
 *
 * @param lang - The language code
 * @param stageId - The stage identifier (e.g., "thinking", "searching")
 * @returns The localized stage message
 */
export function getLocalizedStageMessage(lang: StatusLanguage, stageId: string): string {
  return tStatus(lang, `stage.${stageId}`);
}

/**
 * Gets a localized tool display name.
 *
 * @param lang - The language code
 * @param toolName - The internal tool name (e.g., "product_search")
 * @returns The localized display name, or the tool name if not found
 */
export function getLocalizedToolDisplayName(lang: StatusLanguage, toolName: string): string {
  const result = tStatus(lang, `tool.displayName.${toolName}`);
  // If the key wasn't found, tStatus returns the key itself
  // In that case, return the original tool name
  if (result === `tool.displayName.${toolName}`) {
    return toolName;
  }
  return result;
}

/**
 * Gets a localized tool start message.
 *
 * @param lang - The language code
 * @param toolName - The internal tool name (e.g., "product_search")
 * @returns The localized start message
 */
export function getLocalizedToolStartMessage(lang: StatusLanguage, toolName: string): string {
  const result = tStatus(lang, `tool.start.${toolName}`);
  // If the key wasn't found, return the default
  if (result === `tool.start.${toolName}`) {
    return tStatus(lang, 'tool.start.default');
  }
  return result;
}

/**
 * Gets a localized tool end message.
 *
 * @param lang - The language code
 * @param toolName - The internal tool name (e.g., "product_search")
 * @param ok - Whether the tool execution succeeded
 * @returns The localized end message
 */
export function getLocalizedToolEndMessage(
  lang: StatusLanguage,
  toolName: string,
  ok: boolean
): string {
  const outcome = ok ? 'ok' : 'fail';
  const result = tStatus(lang, `tool.end.${outcome}.${toolName}`);
  // If the key wasn't found, return the default
  if (result === `tool.end.${outcome}.${toolName}`) {
    return tStatus(lang, `tool.end.${outcome}.default`);
  }
  return result;
}

/**
 * Gets a localized dev status message for a round.
 *
 * @param lang - The language code
 * @param round - The current round number
 * @param isFirstRound - Whether this is the first round
 * @returns The localized dev status message
 */
export function getLocalizedRoundMessage(
  lang: StatusLanguage,
  round: number,
  isFirstRound: boolean
): string {
  if (isFirstRound) {
    return tStatus(lang, 'stream.round_first');
  }
  return tStatus(lang, 'stream.round', { round });
}
