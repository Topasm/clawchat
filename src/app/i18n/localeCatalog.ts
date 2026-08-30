import englishCatalogUrl from './generated/en.catalog.json.gz?url&no-inline';
import koreanCatalogUrl from './generated/ko.catalog.json.gz?url';
import { gunzipSync } from 'fflate';

export interface TranslationTree {
  [key: string]: string | TranslationTree;
}

export interface KoreanCatalog {
  structured: TranslationTree;
  literal: Record<string, string>;
}

async function loadSourceEnglishCatalog(): Promise<TranslationTree> {
  const { translationResources } = await import('./resources');
  return translationResources.en.translation;
}

async function loadSourceKoreanCatalog(): Promise<KoreanCatalog> {
  const [{ translationResources }, { koreanUiTranslations }] = await Promise.all([
    import('./resources'),
    import('./literalResources'),
  ]);
  return {
    structured: translationResources.ko.translation,
    literal: koreanUiTranslations,
  };
}

async function loadCompressedJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load application translations (${response.status}).`);
  }

  const compressed = new Uint8Array(await response.arrayBuffer());
  const json = new TextDecoder().decode(gunzipSync(compressed));
  return JSON.parse(json) as T;
}

export function loadEnglishCatalog(): Promise<TranslationTree> {
  return import.meta.env.MODE === 'test'
    ? loadSourceEnglishCatalog()
    : loadCompressedJson<TranslationTree>(englishCatalogUrl);
}

export function loadKoreanCatalog(): Promise<KoreanCatalog> {
  return import.meta.env.MODE === 'test'
    ? loadSourceKoreanCatalog()
    : loadCompressedJson<KoreanCatalog>(koreanCatalogUrl);
}
