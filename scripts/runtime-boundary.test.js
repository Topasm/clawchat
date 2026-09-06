'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { inspectRuntimeBoundary } = require('./runtime-boundary');
const fs = require('node:fs');
const path = require('node:path');

// Source guard only: the native panel still needs a real macOS/GTK smoke test.
test('folder picker yields while the native UI is open instead of blocking its event loop', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../src-tauri/src/commands/server.rs'),
    'utf8',
  );
  const command = source.match(
    /pub async fn server_select_folder[\s\S]*?(?=\n#\[tauri::command\])/,
  );
  assert.ok(command, 'folder selection must remain an asynchronous command');
  assert.match(command[0], /oneshot::channel\(/);
  assert.match(command[0], /\.pick_folder\(/);
  assert.match(command[0], /receiver\s*\.await/);
  assert.doesNotMatch(command[0], /blocking_pick_folder|\.recv\(|block_on\(/);
  assert.match(command[0], /sender\.send\(path\.map\(/, 'cancel must be forwarded as None');
});

test('accepts native calls inside platform adapters', () => {
  const violations = inspectRuntimeBoundary([
    {
      filename: '/repo/src/app/platform/tauriPlatformApi.ts',
      source: "import { invoke } from '@tauri-apps/api/core';",
    },
  ]);

  assert.deepEqual(violations, []);
});

test('rejects native runtime access from feature code', () => {
  const violations = inspectRuntimeBoundary([
    {
      filename: '/repo/src/app/pages/Feature.tsx',
      source: "import { invoke } from '@tauri-apps/api/core';\nwindow.electronAPI?.getAppMode();",
    },
  ]);

  assert.deepEqual(violations, [
    {
      filename: '/repo/src/app/pages/Feature.tsx',
      line: 2,
      reason: 'Electron runtime references are forbidden after the Tauri cutover',
    },
    {
      filename: '/repo/src/app/pages/Feature.tsx',
      line: 1,
      reason: 'Tauri imports must stay inside the platform adapter',
    },
  ]);
});

test('rejects dynamic and bracket-based native access from feature code', () => {
  const violations = inspectRuntimeBoundary([
    {
      filename: '/repo/src/app/features/nativeShortcut.ts',
      source:
        "const bridge = globalThis['electronAPI'];\nconst core = await import('@tauri-apps/api/core');",
    },
  ]);

  assert.deepEqual(
    violations.map(({ line, reason }) => ({ line, reason })),
    [
      {
        line: 1,
        reason: 'Electron runtime references are forbidden after the Tauri cutover',
      },
      {
        line: 2,
        reason: 'Tauri imports must stay inside the platform adapter',
      },
    ],
  );
});

test('rejects Electron references even inside former transition adapters', () => {
  const violations = inspectRuntimeBoundary([
    {
      filename: '/repo/src/app/platform/index.ts',
      source: 'const bridge = window.electronAPI;',
    },
  ]);

  assert.deepEqual(violations, [
    {
      filename: '/repo/src/app/platform/index.ts',
      line: 1,
      reason: 'Electron runtime references are forbidden after the Tauri cutover',
    },
  ]);
});
