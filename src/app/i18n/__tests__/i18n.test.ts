import { afterEach, describe, expect, it } from 'vitest';
import { changeAppLanguage, i18n, translateUi } from '..';
import { translationResources } from '../resources';

function leafKeys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'object' && child !== null ? leafKeys(child, path) : [path];
  });
}

describe('i18n', () => {
  afterEach(async () => {
    await changeAppLanguage('en');
  });

  it('keeps English and Korean resource keys in parity', () => {
    expect(leafKeys(translationResources.ko.translation).sort()).toEqual(
      leafKeys(translationResources.en.translation).sort(),
    );
  });

  it('switches language, document metadata, and pluralized text', async () => {
    await changeAppLanguage('ko');

    expect(i18n.t('nav.inbox')).toBe('Inbox');
    expect(i18n.t('nav.tasks')).toBe('작업');
    expect(i18n.t('nav.schedule')).toBe('일정');
    expect(i18n.t('connection.pending', { count: 3 })).toBe('대기 중인 작업 3개');
    expect(i18n.t('workspaceSettings.ai.errors.codexAuthenticationFailed')).toBe(
      '설정된 OpenAI API 키가 거부되었습니다.',
    );
    expect(document.documentElement.lang).toBe('ko');
  });

  it('translates catalog UI messages and preserves interpolation', async () => {
    await changeAppLanguage('ko');

    expect(translateUi('Task created')).toBe('작업을 만들었습니다.');
    expect(translateUi('Connected to {{name}}.', { name: '연구실' })).toBe(
      '연구실에 연결했습니다.',
    );
    expect(translateUi('No results for "{{query}}"', { query: '실험' })).toBe(
      '“실험”에 대한 결과 없음',
    );
  });
});
