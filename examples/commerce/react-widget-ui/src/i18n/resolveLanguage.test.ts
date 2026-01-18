import { describe, it, expect } from 'vitest';
import { resolveWidgetLanguage } from './resolveLanguage';

describe('resolveWidgetLanguage', () => {
  describe('with cultureCode only', () => {
    it('returns "sv" for cultureCode="sv-SE"', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'sv-SE' })).toBe('sv');
    });

    it('returns "en" for cultureCode="en-US"', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'en-US' })).toBe('en');
    });

    it('returns "en" for cultureCode="en-GB"', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'en-GB' })).toBe('en');
    });

    it('returns fallback "en" for unsupported cultureCode="da-DK"', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'da-DK' })).toBe('en');
    });

    it('returns fallback "en" for unsupported cultureCode="de-DE"', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'de-DE' })).toBe('en');
    });

    it('handles uppercase cultureCode', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'SV-SE' })).toBe('sv');
    });
  });

  describe('with uiLanguage override', () => {
    it('returns "sv" when uiLanguage="sv"', () => {
      expect(resolveWidgetLanguage({ uiLanguage: 'sv' })).toBe('sv');
    });

    it('returns "en" when uiLanguage="en"', () => {
      expect(resolveWidgetLanguage({ uiLanguage: 'en' })).toBe('en');
    });

    it('returns fallback "en" for unsupported uiLanguage="xx"', () => {
      expect(resolveWidgetLanguage({ uiLanguage: 'xx' })).toBe('en');
    });

    it('returns fallback "en" for unsupported uiLanguage="de"', () => {
      expect(resolveWidgetLanguage({ uiLanguage: 'de' })).toBe('en');
    });

    it('uiLanguage overrides cultureCode', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'en-US', uiLanguage: 'sv' })).toBe('sv');
    });

    it('uiLanguage overrides cultureCode even when both are same language', () => {
      expect(resolveWidgetLanguage({ cultureCode: 'sv-SE', uiLanguage: 'en' })).toBe('en');
    });

    it('handles uppercase uiLanguage', () => {
      expect(resolveWidgetLanguage({ uiLanguage: 'SV' })).toBe('sv');
    });
  });

  describe('with no options', () => {
    it('returns fallback "en" when no options provided', () => {
      expect(resolveWidgetLanguage({})).toBe('en');
    });

    it('returns fallback "en" when both cultureCode and uiLanguage are undefined', () => {
      expect(resolveWidgetLanguage({ cultureCode: undefined, uiLanguage: undefined })).toBe('en');
    });
  });
});
