/**
 * Internationalization (i18n) module for BFF confirmation messages.
 * 
 * This module provides localized strings for cart confirmation prompts and options.
 * Currently supports English (en) and Swedish (sv) with English as the fallback.
 * 
 * NOTE: This module is intentionally minimal and only handles confirmation strings.
 * It does NOT localize the entire assistant - only confirmation UI elements.
 */

import enStrings from './en.json' with { type: 'json' };
import svStrings from './sv.json' with { type: 'json' };
import type { CartMutationKind } from '../session/sessionTypes.js';
import type { ConfirmationBlock, ConfirmationOption } from '../http/responseTypes.js';

/**
 * Supported languages for confirmation messages.
 */
export type SupportedLanguage = 'en' | 'sv';

/**
 * Type for the i18n strings structure.
 */
type I18nStrings = typeof enStrings;

/**
 * Map of supported languages to their string resources.
 */
const LANGUAGE_STRINGS: Record<SupportedLanguage, I18nStrings> = {
  en: enStrings,
  sv: svStrings,
};

/**
 * Default/fallback language when the requested language is not supported.
 */
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/**
 * Resolves a language code from a culture code.
 * 
 * Examples:
 * - "sv-SE" => "sv"
 * - "en-US" => "en"
 * - "en-GB" => "en"
 * - "de-DE" => "en" (fallback - German not supported)
 * - undefined => "en" (fallback)
 * - "" => "en" (fallback)
 * 
 * @param cultureCode - The culture code (e.g., "sv-SE", "en-US")
 * @returns The resolved language code ("en" or "sv")
 */
export function resolveLanguage(cultureCode?: string): SupportedLanguage {
  if (!cultureCode) {
    return DEFAULT_LANGUAGE;
  }

  // Extract the language part from the culture code (e.g., "sv-SE" => "sv")
  const languagePart = cultureCode.split('-')[0].toLowerCase();

  // Check if the language is supported
  if (languagePart in LANGUAGE_STRINGS) {
    return languagePart as SupportedLanguage;
  }

  return DEFAULT_LANGUAGE;
}

/**
 * Gets the i18n strings for a given language.
 * 
 * @param language - The language code
 * @returns The i18n strings for the language
 */
export function getStrings(language: SupportedLanguage): I18nStrings {
  return LANGUAGE_STRINGS[language] ?? LANGUAGE_STRINGS[DEFAULT_LANGUAGE];
}

/**
 * Interpolates placeholders in a string with values.
 * Placeholders are in the format {key}.
 * 
 * @param template - The template string with placeholders
 * @param values - The values to interpolate
 * @returns The interpolated string
 */
function interpolate(template: string, values: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = values[key];
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Builds a localized confirmation prompt for a cart mutation.
 * 
 * @param kind - The type of cart mutation
 * @param args - The arguments for the mutation
 * @param language - The language code
 * @returns The localized confirmation prompt
 */
export function buildLocalizedConfirmationPrompt(
  kind: CartMutationKind,
  args: Record<string, unknown>,
  language: SupportedLanguage
): string {
  const strings = getStrings(language);
  const partNo = args.partNo as string | undefined;
  const productId = args.productId as string | undefined;
  const quantity = args.quantity as number | undefined;

  switch (kind) {
    case 'cart_add_item': {
      const qty = quantity ?? 1;
      const identifier = partNo || productId;
      if (identifier) {
        return interpolate(strings.confirm.add_to_cart.prompt, { quantity: qty, identifier });
      }
      return strings.confirm.add_to_cart.prompt_generic;
    }
    case 'cart_set_item_quantity': {
      if (productId && quantity !== undefined) {
        return interpolate(strings.confirm.set_item_quantity.prompt, { productId, quantity });
      }
      return strings.confirm.set_item_quantity.prompt_generic;
    }
    case 'cart_remove_item': {
      if (productId) {
        return interpolate(strings.confirm.remove_item.prompt, { productId });
      }
      return strings.confirm.remove_item.prompt_generic;
    }
    default:
      return strings.confirm.generic.prompt;
  }
}

/**
 * Builds the localized confirmation options (Yes/No buttons).
 * 
 * @param language - The language code
 * @returns Array of confirmation options
 */
export function buildLocalizedConfirmationOptions(language: SupportedLanguage): ConfirmationOption[] {
  const strings = getStrings(language);
  
  return [
    {
      id: 'confirm',
      label: strings.confirm.options.yes,
      value: strings.confirm.options.yes_value,
      style: 'primary',
    },
    {
      id: 'cancel',
      label: strings.confirm.options.no,
      value: strings.confirm.options.no_value,
      style: 'secondary',
    },
  ];
}

/**
 * Builds a complete localized confirmation block for a pending cart action.
 * 
 * @param pendingActionId - The unique ID of the pending action
 * @param kind - The type of cart mutation
 * @param args - The arguments for the mutation
 * @param cultureCode - The culture code from the request context
 * @returns The complete confirmation block
 */
export function buildConfirmationBlock(
  pendingActionId: string,
  kind: CartMutationKind,
  args: Record<string, unknown>,
  cultureCode?: string
): ConfirmationBlock {
  const language = resolveLanguage(cultureCode);
  
  return {
    id: pendingActionId,
    kind: 'cart_confirm',
    prompt: buildLocalizedConfirmationPrompt(kind, args, language),
    options: buildLocalizedConfirmationOptions(language),
  };
}

/**
 * Gets the localized "cancelled" message.
 * 
 * @param cultureCode - The culture code from the request context
 * @returns The localized cancelled message
 */
export function getLocalizedCancelledMessage(cultureCode?: string): string {
  const language = resolveLanguage(cultureCode);
  const strings = getStrings(language);
  return strings.confirm.cancelled;
}

/**
 * Gets the localized "already completed" message.
 * 
 * @param cultureCode - The culture code from the request context
 * @returns The localized already completed message
 */
export function getLocalizedAlreadyCompletedMessage(cultureCode?: string): string {
  const language = resolveLanguage(cultureCode);
  const strings = getStrings(language);
  return strings.confirm.already_completed;
}

/**
 * Gets the localized "already cancelled" message.
 * 
 * @param cultureCode - The culture code from the request context
 * @returns The localized already cancelled message
 */
export function getLocalizedAlreadyCancelledMessage(cultureCode?: string): string {
  const language = resolveLanguage(cultureCode);
  const strings = getStrings(language);
  return strings.confirm.already_cancelled;
}

/**
 * Builds a localized text message for a pending cart action.
 * This is used for the `text` field in the response (for backwards compatibility).
 * 
 * @param kind - The type of cart mutation
 * @param args - The arguments for the mutation
 * @param cultureCode - The culture code from the request context
 * @returns The localized text message
 */
export function buildLocalizedConfirmationText(
  kind: CartMutationKind,
  args: Record<string, unknown>,
  cultureCode?: string
): string {
  const language = resolveLanguage(cultureCode);
  return buildLocalizedConfirmationPrompt(kind, args, language);
}

/**
 * Gets the localized "action completed" message.
 * 
 * @param cultureCode - The culture code from the request context
 * @returns The localized completed message
 */
export function getLocalizedCompletedMessage(cultureCode?: string): string {
  const language = resolveLanguage(cultureCode);
  const strings = getStrings(language);
  return strings.confirm.completed;
}

/**
 * Builds a localized "pending action reminder" message.
 * Used when user sends an unrelated message while there's a pending action.
 * 
 * @param kind - The type of cart mutation
 * @param args - The arguments for the mutation
 * @param cultureCode - The culture code from the request context
 * @returns The localized reminder message
 */
export function buildLocalizedPendingActionReminder(
  kind: CartMutationKind,
  args: Record<string, unknown>,
  cultureCode?: string
): string {
  const language = resolveLanguage(cultureCode);
  const strings = getStrings(language);
  const prompt = buildLocalizedConfirmationPrompt(kind, args, language);
  
  // Build a reminder message that includes the pending action prompt
  // and asks the user to confirm or cancel
  if (language === 'sv') {
    return `Jag har en väntande åtgärd: ${prompt} Vänligen bekräfta med "${strings.confirm.options.yes_value}" eller avbryt med "${strings.confirm.options.no_value}" innan jag kan hjälpa dig med något annat.`;
  }
  return `I have a pending action: ${prompt} Please confirm with "${strings.confirm.options.yes_value}" or cancel with "${strings.confirm.options.no_value}" before I can help with something else.`;
}
