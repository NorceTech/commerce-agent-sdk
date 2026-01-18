import { describe, it, expect } from 'vitest';
import {
  resolveStatusLanguage,
  tStatus,
  getLocalizedStageMessage,
  getLocalizedToolDisplayName,
  getLocalizedToolStartMessage,
  getLocalizedToolEndMessage,
  getLocalizedRoundMessage,
  DEFAULT_STATUS_LANGUAGE,
} from '../i18n/statusI18n.js';

describe('statusI18n', () => {
  describe('resolveStatusLanguage', () => {
    it('should return "en" as default when no options provided', () => {
      expect(resolveStatusLanguage()).toBe('en');
      expect(resolveStatusLanguage({})).toBe('en');
    });

    it('should resolve "sv" from cultureCode "sv-SE"', () => {
      expect(resolveStatusLanguage({ cultureCode: 'sv-SE' })).toBe('sv');
    });

    it('should resolve "en" from cultureCode "en-US"', () => {
      expect(resolveStatusLanguage({ cultureCode: 'en-US' })).toBe('en');
    });

    it('should resolve "en" from cultureCode "en-GB"', () => {
      expect(resolveStatusLanguage({ cultureCode: 'en-GB' })).toBe('en');
    });

    it('should return "en" for unknown cultureCode', () => {
      expect(resolveStatusLanguage({ cultureCode: 'de-DE' })).toBe('en');
      expect(resolveStatusLanguage({ cultureCode: 'fr-FR' })).toBe('en');
      expect(resolveStatusLanguage({ cultureCode: 'unknown' })).toBe('en');
    });

    it('should prioritize uiLanguage over cultureCode', () => {
      expect(resolveStatusLanguage({ uiLanguage: 'sv', cultureCode: 'en-US' })).toBe('sv');
      expect(resolveStatusLanguage({ uiLanguage: 'en', cultureCode: 'sv-SE' })).toBe('en');
    });

    it('should handle uiLanguage with region suffix', () => {
      expect(resolveStatusLanguage({ uiLanguage: 'sv-SE' })).toBe('sv');
      expect(resolveStatusLanguage({ uiLanguage: 'en-US' })).toBe('en');
    });

    it('should fall back to cultureCode when uiLanguage is unknown', () => {
      expect(resolveStatusLanguage({ uiLanguage: 'de', cultureCode: 'sv-SE' })).toBe('sv');
    });

    it('should return "en" when both uiLanguage and cultureCode are unknown', () => {
      expect(resolveStatusLanguage({ uiLanguage: 'de', cultureCode: 'fr-FR' })).toBe('en');
    });
  });

  describe('tStatus', () => {
    it('should return English string for "en" language', () => {
      expect(tStatus('en', 'stage.thinking')).toBe('Thinking...');
      expect(tStatus('en', 'stage.start')).toBe('Starting...');
    });

    it('should return Swedish string for "sv" language', () => {
      expect(tStatus('sv', 'stage.thinking')).toBe('Tänker...');
      expect(tStatus('sv', 'stage.start')).toBe('Startar...');
    });

    it('should handle nested keys', () => {
      expect(tStatus('en', 'tool.displayName.product_search')).toBe('Search products');
      expect(tStatus('sv', 'tool.displayName.product_search')).toBe('Söker produkter');
    });

    it('should return the key itself for unknown keys', () => {
      expect(tStatus('en', 'unknown.key')).toBe('unknown.key');
      expect(tStatus('sv', 'unknown.key')).toBe('unknown.key');
    });

    it('should perform interpolation with {var} syntax', () => {
      expect(tStatus('en', 'stream.round', { round: 2 })).toBe('Working on step 2...');
      expect(tStatus('sv', 'stream.round', { round: 3 })).toBe('Arbetar vidare (steg 3)...');
    });

    it('should handle missing interpolation variables gracefully', () => {
      const result = tStatus('en', 'stream.round', {});
      expect(result).toContain('{round}');
    });
  });

  describe('getLocalizedStageMessage', () => {
    it('should return English stage messages', () => {
      expect(getLocalizedStageMessage('en', 'thinking')).toBe('Thinking...');
      expect(getLocalizedStageMessage('en', 'searching')).toBe('Searching the catalog...');
      expect(getLocalizedStageMessage('en', 'refining')).toBe('Refining the results...');
      expect(getLocalizedStageMessage('en', 'cart')).toBe('Updating your cart...');
    });

    it('should return Swedish stage messages', () => {
      expect(getLocalizedStageMessage('sv', 'thinking')).toBe('Tänker...');
      expect(getLocalizedStageMessage('sv', 'searching')).toBe('Söker i katalogen...');
      expect(getLocalizedStageMessage('sv', 'refining')).toBe('Förbättrar resultaten...');
      expect(getLocalizedStageMessage('sv', 'cart')).toBe('Uppdaterar din varukorg...');
    });

    it('should return fallback for unknown stage', () => {
      expect(getLocalizedStageMessage('en', 'unknown' as 'thinking')).toBe('stage.unknown');
    });
  });

  describe('getLocalizedToolDisplayName', () => {
    it('should return English tool display names', () => {
      expect(getLocalizedToolDisplayName('en', 'product_search')).toBe('Search products');
      expect(getLocalizedToolDisplayName('en', 'product_get')).toBe('Get product details');
      expect(getLocalizedToolDisplayName('en', 'cart_add_item')).toBe('Add to cart');
    });

    it('should return Swedish tool display names', () => {
      expect(getLocalizedToolDisplayName('sv', 'product_search')).toBe('Söker produkter');
      expect(getLocalizedToolDisplayName('sv', 'product_get')).toBe('Hämta produktdetaljer');
      expect(getLocalizedToolDisplayName('sv', 'cart_add_item')).toBe('Lägg till i varukorgen');
    });

    it('should return tool name for unknown tools', () => {
      expect(getLocalizedToolDisplayName('en', 'unknown_tool')).toBe('unknown_tool');
    });
  });

  describe('getLocalizedToolStartMessage', () => {
    it('should return English tool start messages', () => {
      expect(getLocalizedToolStartMessage('en', 'product_search')).toBe('Searching the catalog...');
      expect(getLocalizedToolStartMessage('en', 'product_get')).toBe('Checking details and availability...');
      expect(getLocalizedToolStartMessage('en', 'cart_add_item')).toBe('Adding to your cart...');
    });

    it('should return Swedish tool start messages', () => {
      expect(getLocalizedToolStartMessage('sv', 'product_search')).toBe('Söker i katalogen...');
      expect(getLocalizedToolStartMessage('sv', 'product_get')).toBe('Kontrollerar detaljer och tillgänglighet...');
      expect(getLocalizedToolStartMessage('sv', 'cart_add_item')).toBe('Lägger till i din varukorg...');
    });

    it('should return default message for unknown tools', () => {
      expect(getLocalizedToolStartMessage('en', 'unknown_tool')).toBe('Working...');
      expect(getLocalizedToolStartMessage('sv', 'unknown_tool')).toBe('Arbetar...');
    });
  });

  describe('getLocalizedToolEndMessage', () => {
    it('should return English tool end messages for success', () => {
      expect(getLocalizedToolEndMessage('en', 'product_search', true)).toBe('Found some options.');
      expect(getLocalizedToolEndMessage('en', 'product_get', true)).toBe('Details checked.');
      expect(getLocalizedToolEndMessage('en', 'cart_add_item', true)).toBe('Cart updated.');
    });

    it('should return Swedish tool end messages for success', () => {
      expect(getLocalizedToolEndMessage('sv', 'product_search', true)).toBe('Hittade några alternativ.');
      expect(getLocalizedToolEndMessage('sv', 'product_get', true)).toBe('Detaljer kontrollerade.');
      expect(getLocalizedToolEndMessage('sv', 'cart_add_item', true)).toBe('Varukorg uppdaterad.');
    });

    it('should return English tool end messages for failure', () => {
      expect(getLocalizedToolEndMessage('en', 'product_search', false)).toBe('Search didn\'t work. Retrying...');
      expect(getLocalizedToolEndMessage('en', 'cart_add_item', false)).toBe('Couldn\'t update cart. Retrying...');
    });

    it('should return Swedish tool end messages for failure', () => {
      expect(getLocalizedToolEndMessage('sv', 'product_search', false)).toBe('Sökningen fungerade inte. Försöker igen...');
      expect(getLocalizedToolEndMessage('sv', 'cart_add_item', false)).toBe('Kunde inte uppdatera varukorgen. Försöker igen...');
    });

    it('should return default message for unknown tools', () => {
      expect(getLocalizedToolEndMessage('en', 'unknown_tool', true)).toBe('Done.');
      expect(getLocalizedToolEndMessage('en', 'unknown_tool', false)).toBe('Something went wrong. Retrying...');
      expect(getLocalizedToolEndMessage('sv', 'unknown_tool', true)).toBe('Klart.');
      expect(getLocalizedToolEndMessage('sv', 'unknown_tool', false)).toBe('Något gick fel. Försöker igen...');
    });
  });

  describe('getLocalizedRoundMessage', () => {
    it('should return first round message for first round', () => {
      expect(getLocalizedRoundMessage('en', 1, true)).toBe('Thinking...');
      expect(getLocalizedRoundMessage('sv', 1, true)).toBe('Tänker...');
    });

    it('should return round message with interpolation for subsequent rounds', () => {
      expect(getLocalizedRoundMessage('en', 2, false)).toBe('Working on step 2...');
      expect(getLocalizedRoundMessage('sv', 2, false)).toBe('Arbetar vidare (steg 2)...');
      expect(getLocalizedRoundMessage('en', 3, false)).toBe('Working on step 3...');
      expect(getLocalizedRoundMessage('sv', 3, false)).toBe('Arbetar vidare (steg 3)...');
    });
  });

  describe('DEFAULT_STATUS_LANGUAGE', () => {
    it('should be "en"', () => {
      expect(DEFAULT_STATUS_LANGUAGE).toBe('en');
    });
  });
});
