import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TAURI_COMMANDS } from '../tauriCommands';

const repositoryRoot = process.cwd();
const buildSource = readFileSync(resolve(repositoryRoot, 'src-tauri/build.rs'), 'utf8');
const handlerSource = readFileSync(resolve(repositoryRoot, 'src-tauri/src/lib.rs'), 'utf8');
const adapterSource = readFileSync(resolve(repositoryRoot, 'src/app/platform/tauriPlatformApi.ts'), 'utf8');
const capability = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'src-tauri/capabilities/main-window.json'), 'utf8'),
) as { permissions: string[] };

function captureBody(source: string, pattern: RegExp, description: string): string {
  const body = source.match(pattern)?.groups?.body;
  if (!body) throw new Error(`Could not parse ${description}`);
  return body;
}

function collect(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function expectExactRegistry(actual: string[], expected: string[]) {
  expect([...actual].sort()).toEqual([...expected].sort());
}

const commandValues = Object.values(TAURI_COMMANDS);
const commandKeys = Object.keys(TAURI_COMMANDS);
const buildCommands = collect(
  captureBody(
    buildSource,
    /const COMMANDS: &\[&str\] = &\[(?<body>[\s\S]*?)\];/u,
    'build-time command manifest',
  ),
  /"([a-z0-9_]+)"/gu,
);
const handlerCommands = collect(
  captureBody(
    handlerSource,
    /\.invoke_handler\(tauri::generate_handler!\[(?<body>[\s\S]*?)\]\)/u,
    'Rust invoke handler',
  ),
  /commands::[a-z0-9_]+::([a-z0-9_]+),/gu,
);
const capabilityPermissions = capability.permissions.filter((permission) =>
  permission.startsWith('allow-'),
);
const expectedPermissions = commandValues.map(
  (command) => `allow-${command.replaceAll('_', '-')}`,
);
const adapterCommandKeys = collect(adapterSource, /TAURI_COMMANDS\.([A-Za-z0-9_]+)/gu);

describe('Tauri command registry parity', () => {
  it('keeps command values unique', () => {
    expect(new Set(commandValues).size).toBe(commandValues.length);
  });

  it('matches the build-time command manifest in both directions', () => {
    expectExactRegistry(buildCommands, commandValues);
  });

  it('matches the Rust invoke handler in both directions', () => {
    expectExactRegistry(handlerCommands, commandValues);
  });

  it('matches the main-window capability permissions in both directions', () => {
    expectExactRegistry(capabilityPermissions, expectedPermissions);
  });

  it('references every command key from the Tauri adapter', () => {
    expectExactRegistry([...new Set(adapterCommandKeys)], commandKeys);
  });
});
