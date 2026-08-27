'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const startupThemeSource = fs.readFileSync(
  path.resolve(__dirname, '..', 'public', 'startup-theme.js'),
  'utf8',
);

function runStartupTheme({
  storedMode = null,
  storedLanguage = null,
  systemDark = false,
  storageError = false,
  navigatorLanguage = 'en-US',
} = {}) {
  const themeColor = {
    content: '#F7F8FA',
    setAttribute(name, value) {
      if (name === 'content') this.content = value;
    },
  };
  const documentElement = { dataset: {}, style: {} };
  const localStorage = {
    getItem(key) {
      if (storageError) throw new Error('storage unavailable');
      return key === 'clawchat-language' ? storedLanguage : storedMode;
    },
  };

  vm.runInNewContext(startupThemeSource, {
    window: {
      localStorage,
      matchMedia: () => ({ matches: systemDark }),
    },
    navigator: { language: navigatorLanguage },
    document: {
      documentElement,
      querySelector: () => themeColor,
    },
  });

  return { documentElement, themeColor };
}

test('applies a stored dark theme before the app starts', () => {
  const { documentElement, themeColor } = runStartupTheme({ storedMode: 'dark' });

  assert.equal(documentElement.dataset.ccTheme, 'dark');
  assert.equal(documentElement.style.colorScheme, 'dark');
  assert.equal(themeColor.content, '#111316');
});

test('resolves system mode from the OS color scheme', () => {
  const { documentElement } = runStartupTheme({ storedMode: 'system', systemDark: true });

  assert.equal(documentElement.dataset.ccTheme, 'dark');
});

test('falls back safely when storage is unavailable', () => {
  const { documentElement, themeColor } = runStartupTheme({ storageError: true });

  assert.equal(documentElement.dataset.ccTheme, 'light');
  assert.equal(themeColor.content, '#F7F8FA');
});

test('applies a stored application language before the shell paints', () => {
  const { documentElement } = runStartupTheme({
    storedLanguage: 'ko',
    navigatorLanguage: 'en-US',
  });

  assert.equal(documentElement.lang, 'ko');
});
