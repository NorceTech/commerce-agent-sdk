import { type SupportedLanguage, isSupportedLanguage } from './index';

export interface ResolveLanguageOptions {
  cultureCode?: string;
  uiLanguage?: string;
}

export function resolveWidgetLanguage(
  options: ResolveLanguageOptions
): SupportedLanguage {
  const { cultureCode, uiLanguage } = options;

  if (uiLanguage) {
    const normalized = uiLanguage.toLowerCase().slice(0, 2);
    if (isSupportedLanguage(normalized)) {
      return normalized;
    }
    return 'en';
  }

  if (cultureCode) {
    const normalized = cultureCode.toLowerCase().slice(0, 2);
    if (isSupportedLanguage(normalized)) {
      return normalized;
    }
    return 'en';
  }

  return 'en';
}
