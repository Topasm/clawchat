import { useSyncExternalStore } from 'react';

export type AppLanguage = 'en' | 'ko';

const LANGUAGE_STORAGE_KEY = 'clawchat-language';
const languageListeners = new Set<() => void>();

type TranslationOptions = Record<string, string | number> & { count?: number };

function detectLanguage(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === 'en' || stored === 'ko') return stored;
  } catch {
    // Restricted WebViews may disable local storage.
  }
  return navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

let currentLanguage = detectLanguage();
let englishStructuredTranslations: Record<string, unknown> = {};
let koreanStructuredTranslations: Record<string, unknown> = {};
let koreanUiTranslations: Record<string, string> = {};
let englishCatalogPromise: Promise<void> | null = null;
let koreanCatalogPromise: Promise<void> | null = null;

async function loadEnglishCatalog(): Promise<void> {
  if (englishCatalogPromise) return englishCatalogPromise;

  englishCatalogPromise = import('./localeCatalog').then(async (catalogModule) => {
    englishStructuredTranslations = await catalogModule.loadEnglishCatalog();
  });
  return englishCatalogPromise;
}

async function loadKoreanCatalog(): Promise<void> {
  if (koreanCatalogPromise) return koreanCatalogPromise;

  koreanCatalogPromise = import('./localeCatalog').then(async (catalogModule) => {
    const catalog = await catalogModule.loadKoreanCatalog();
    koreanStructuredTranslations = catalog.structured;
    koreanUiTranslations = catalog.literal;
  });
  return koreanCatalogPromise;
}

async function prepareLanguage(language: AppLanguage): Promise<void> {
  await loadEnglishCatalog();
  if (language === 'ko') await loadKoreanCatalog();
}

function applyDocumentLanguage(language: AppLanguage) {
  document.documentElement.lang = language;
}

function resourceValue(language: AppLanguage, key: string): string | null {
  let value: unknown =
    language === 'ko' ? koreanStructuredTranslations : englishStructuredTranslations;
  for (const segment of key.split('.')) {
    if (!value || typeof value !== 'object' || !(segment in value)) return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return typeof value === 'string' ? value : null;
}

function translate(key: string, options: TranslationOptions = {}): string {
  const pluralKey =
    typeof options.count === 'number' ? `${key}_${options.count === 1 ? 'one' : 'other'}` : key;
  const template =
    resourceValue(currentLanguage, pluralKey) ??
    resourceValue(currentLanguage, key) ??
    resourceValue('en', pluralKey) ??
    resourceValue('en', key) ??
    key;

  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (placeholder, name: string) => {
    const value = options[name];
    return value === undefined ? placeholder : String(value);
  });
}

const UI_ENTITIES: Record<string, string> = {
  '&apos;': "'",
  '&mdash;': '—',
  '&middot;': '·',
  '&rarr;': '→',
  '&times;': '×',
};

function canonicalUiMessage(source: string): string {
  return source
    .replace(/&(apos|mdash|middot|rarr|times);/g, (entity) => UI_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Translate a canonical English UI message while preserving interpolation. */
export function translateUi(source: string, options: TranslationOptions = {}): string {
  const canonical = canonicalUiMessage(source);
  const template =
    currentLanguage === 'ko' ? (koreanUiTranslations[canonical] ?? canonical) : canonical;
  const translated = template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (placeholder, name: string) => {
    const value = options[name];
    return value === undefined ? placeholder : String(value);
  });

  const leadingSpace = /^\s/.test(source) ? ' ' : '';
  const trailingSpace = /\s$/.test(source) ? ' ' : '';
  return `${leadingSpace}${translated}${trailingSpace}`;
}

function setLanguage(language: AppLanguage) {
  if (currentLanguage === language) return;
  currentLanguage = language;
  applyDocumentLanguage(language);
  languageListeners.forEach((listener) => listener());
}

applyDocumentLanguage(currentLanguage);

/** Load locale resources required before the first application render. */
export async function prepareAppLanguage(): Promise<void> {
  await prepareLanguage(currentLanguage);
}

/** Small application-owned i18n surface; avoids shipping a framework for two locales. */
export const i18n = {
  t: translate,
  tr: translateUi,
  get language() {
    return currentLanguage;
  },
  get resolvedLanguage() {
    return currentLanguage;
  },
  async changeLanguage(language: AppLanguage) {
    await prepareLanguage(language);
    setLanguage(language);
  },
};

export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  await prepareLanguage(language);
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Keep the in-memory selection when persistence is unavailable.
  }
  setLanguage(language);
}

export function getAppLanguage(): AppLanguage {
  return currentLanguage;
}

export function useTranslation() {
  useSyncExternalStore(
    (listener) => {
      languageListeners.add(listener);
      return () => languageListeners.delete(listener);
    },
    () => currentLanguage,
    () => currentLanguage,
  );
  return { t: translate, tr: translateUi, i18n };
}
