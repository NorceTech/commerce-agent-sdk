import { describe, it, expect } from 'vitest';
import {
  resolveLanguage,
  getStrings,
  buildLocalizedConfirmationPrompt,
  buildLocalizedConfirmationOptions,
  buildConfirmationBlock,
  getLocalizedCancelledMessage,
  getLocalizedAlreadyCompletedMessage,
  getLocalizedAlreadyCancelledMessage,
  type SupportedLanguage,
} from '../i18n/index.js';

describe('i18n', () => {
  describe('resolveLanguage', () => {
    it('should resolve "sv-SE" to "sv"', () => {
      expect(resolveLanguage('sv-SE')).toBe('sv');
    });

    it('should resolve "sv" to "sv"', () => {
      expect(resolveLanguage('sv')).toBe('sv');
    });

    it('should resolve "en-US" to "en"', () => {
      expect(resolveLanguage('en-US')).toBe('en');
    });

    it('should resolve "en-GB" to "en"', () => {
      expect(resolveLanguage('en-GB')).toBe('en');
    });

    it('should resolve "en" to "en"', () => {
      expect(resolveLanguage('en')).toBe('en');
    });

    it('should fallback to "en" for unsupported language "de-DE"', () => {
      expect(resolveLanguage('de-DE')).toBe('en');
    });

    it('should fallback to "en" for unsupported language "fr-FR"', () => {
      expect(resolveLanguage('fr-FR')).toBe('en');
    });

    it('should fallback to "en" for undefined cultureCode', () => {
      expect(resolveLanguage(undefined)).toBe('en');
    });

    it('should fallback to "en" for empty string cultureCode', () => {
      expect(resolveLanguage('')).toBe('en');
    });

    it('should be case-insensitive for language part', () => {
      expect(resolveLanguage('SV-SE')).toBe('sv');
      expect(resolveLanguage('EN-US')).toBe('en');
    });
  });

  describe('getStrings', () => {
    it('should return English strings for "en"', () => {
      const strings = getStrings('en');
      expect(strings.confirm.options.yes).toBe('Yes');
      expect(strings.confirm.options.no).toBe('No');
    });

    it('should return Swedish strings for "sv"', () => {
      const strings = getStrings('sv');
      expect(strings.confirm.options.yes).toBe('Ja');
      expect(strings.confirm.options.no).toBe('Nej');
    });
  });

  describe('buildLocalizedConfirmationPrompt', () => {
    describe('cart_add_item', () => {
      it('should build English prompt with identifier and quantity', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_add_item',
          { partNo: 'SKU-123', quantity: 2 },
          'en'
        );
        expect(prompt).toContain('2');
        expect(prompt).toContain('SKU-123');
        expect(prompt).toContain('cart');
      });

      it('should build Swedish prompt with identifier and quantity', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_add_item',
          { partNo: 'SKU-123', quantity: 2 },
          'sv'
        );
        expect(prompt).toContain('2');
        expect(prompt).toContain('SKU-123');
        expect(prompt).toContain('varukorg');
      });

      it('should use productId as fallback when partNo is not provided', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_add_item',
          { productId: 'PROD-456', quantity: 1 },
          'en'
        );
        expect(prompt).toContain('PROD-456');
      });

      it('should default quantity to 1 when not provided', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_add_item',
          { partNo: 'SKU-123' },
          'en'
        );
        expect(prompt).toContain('1');
      });

      it('should use generic prompt when no identifier is provided', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_add_item',
          {},
          'en'
        );
        expect(prompt).toContain('item');
        expect(prompt).toContain('cart');
      });
    });

    describe('cart_set_item_quantity', () => {
      it('should build English prompt with productId and quantity', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_set_item_quantity',
          { productId: 'PROD-123', quantity: 5 },
          'en'
        );
        expect(prompt).toContain('PROD-123');
        expect(prompt).toContain('5');
        expect(prompt).toContain('quantity');
      });

      it('should build Swedish prompt with productId and quantity', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_set_item_quantity',
          { productId: 'PROD-123', quantity: 5 },
          'sv'
        );
        expect(prompt).toContain('PROD-123');
        expect(prompt).toContain('5');
        expect(prompt).toContain('antalet');
      });

      it('should use generic prompt when productId or quantity is missing', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_set_item_quantity',
          { productId: 'PROD-123' },
          'en'
        );
        expect(prompt).toContain('update');
        expect(prompt).toContain('quantity');
      });
    });

    describe('cart_remove_item', () => {
      it('should build English prompt with productId', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_remove_item',
          { productId: 'PROD-123' },
          'en'
        );
        expect(prompt).toContain('PROD-123');
        expect(prompt).toContain('remove');
      });

      it('should build Swedish prompt with productId', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_remove_item',
          { productId: 'PROD-123' },
          'sv'
        );
        expect(prompt).toContain('PROD-123');
        expect(prompt).toContain('ta bort');
      });

      it('should use generic prompt when productId is missing', () => {
        const prompt = buildLocalizedConfirmationPrompt(
          'cart_remove_item',
          {},
          'en'
        );
        expect(prompt).toContain('remove');
        expect(prompt).toContain('item');
      });
    });
  });

  describe('buildLocalizedConfirmationOptions', () => {
    it('should return English options for "en"', () => {
      const options = buildLocalizedConfirmationOptions('en');
      
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        id: 'confirm',
        label: 'Yes',
        value: 'yes',
        style: 'primary',
      });
      expect(options[1]).toEqual({
        id: 'cancel',
        label: 'No',
        value: 'no',
        style: 'secondary',
      });
    });

    it('should return Swedish options for "sv"', () => {
      const options = buildLocalizedConfirmationOptions('sv');
      
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual({
        id: 'confirm',
        label: 'Ja',
        value: 'ja',
        style: 'primary',
      });
      expect(options[1]).toEqual({
        id: 'cancel',
        label: 'Nej',
        value: 'nej',
        style: 'secondary',
      });
    });

    it('should return localized values for each language', () => {
      const enOptions = buildLocalizedConfirmationOptions('en');
      const svOptions = buildLocalizedConfirmationOptions('sv');
      
      // English values
      expect(enOptions[0].value).toBe('yes');
      expect(enOptions[1].value).toBe('no');
      // Swedish values
      expect(svOptions[0].value).toBe('ja');
      expect(svOptions[1].value).toBe('nej');
    });
  });

  describe('buildConfirmationBlock', () => {
    const testUuid = '550e8400-e29b-41d4-a716-446655440000';

    it('should build a complete confirmation block with English localization', () => {
      const block = buildConfirmationBlock(
        testUuid,
        'cart_add_item',
        { partNo: 'SKU-123', quantity: 2 },
        'en-US'
      );

      expect(block.id).toBe(testUuid);
      expect(block.kind).toBe('cart_confirm');
      expect(block.prompt).toContain('SKU-123');
      expect(block.prompt).toContain('2');
      expect(block.options).toHaveLength(2);
      expect(block.options[0].label).toBe('Yes');
      expect(block.options[1].label).toBe('No');
    });

    it('should build a complete confirmation block with Swedish localization', () => {
      const block = buildConfirmationBlock(
        testUuid,
        'cart_add_item',
        { partNo: 'SKU-123', quantity: 2 },
        'sv-SE'
      );

      expect(block.id).toBe(testUuid);
      expect(block.kind).toBe('cart_confirm');
      expect(block.prompt).toContain('SKU-123');
      expect(block.prompt).toContain('2');
      expect(block.options).toHaveLength(2);
      expect(block.options[0].label).toBe('Ja');
      expect(block.options[1].label).toBe('Nej');
    });

    it('should fallback to English when cultureCode is undefined', () => {
      const block = buildConfirmationBlock(
        testUuid,
        'cart_add_item',
        { partNo: 'SKU-123' },
        undefined
      );

      expect(block.options[0].label).toBe('Yes');
      expect(block.options[1].label).toBe('No');
    });

    it('should fallback to English for unsupported language', () => {
      const block = buildConfirmationBlock(
        testUuid,
        'cart_add_item',
        { partNo: 'SKU-123' },
        'de-DE'
      );

      expect(block.options[0].label).toBe('Yes');
      expect(block.options[1].label).toBe('No');
    });

    it('should always set kind to "cart_confirm"', () => {
      const addBlock = buildConfirmationBlock(testUuid, 'cart_add_item', {});
      const setBlock = buildConfirmationBlock(testUuid, 'cart_set_item_quantity', {});
      const removeBlock = buildConfirmationBlock(testUuid, 'cart_remove_item', {});

      expect(addBlock.kind).toBe('cart_confirm');
      expect(setBlock.kind).toBe('cart_confirm');
      expect(removeBlock.kind).toBe('cart_confirm');
    });
  });

  describe('getLocalizedCancelledMessage', () => {
    it('should return English cancelled message', () => {
      const message = getLocalizedCancelledMessage('en-US');
      expect(message).toContain('cancelled');
      expect(message).toContain('anything else');
    });

    it('should return Swedish cancelled message', () => {
      const message = getLocalizedCancelledMessage('sv-SE');
      expect(message).toContain('avbrutit');
      expect(message).toContain('något annat');
    });

    it('should fallback to English for undefined cultureCode', () => {
      const message = getLocalizedCancelledMessage(undefined);
      expect(message).toContain('cancelled');
    });
  });

  describe('getLocalizedAlreadyCompletedMessage', () => {
    it('should return English already completed message', () => {
      const message = getLocalizedAlreadyCompletedMessage('en-US');
      expect(message).toContain('already been completed');
    });

    it('should return Swedish already completed message', () => {
      const message = getLocalizedAlreadyCompletedMessage('sv-SE');
      expect(message).toContain('redan slutförts');
    });
  });

  describe('getLocalizedAlreadyCancelledMessage', () => {
    it('should return English already cancelled message', () => {
      const message = getLocalizedAlreadyCancelledMessage('en-US');
      expect(message).toContain('already been cancelled');
    });

    it('should return Swedish already cancelled message', () => {
      const message = getLocalizedAlreadyCancelledMessage('sv-SE');
      expect(message).toContain('redan avbrutits');
    });
  });
});
