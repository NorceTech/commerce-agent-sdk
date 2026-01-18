import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';
import svCommon from './locales/sv/common.json';

const SUPPORTED_LANGUAGES = ['en', 'sv'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  en: { common: enCommon },
  sv: { common: svCommon },
};

let isInitialized = false;

export function initI18n(language: SupportedLanguage = 'en'): void {
  if (isInitialized) {
    return;
  }

  i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    defaultNS: 'common',
    ns: ['common'],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

  isInitialized = true;
}

export async function setLanguage(language: SupportedLanguage): Promise<void> {
  if (!isInitialized) {
    initI18n(language);
    return;
  }
  await i18n.changeLanguage(language);
}

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}

export { i18n, SUPPORTED_LANGUAGES };
