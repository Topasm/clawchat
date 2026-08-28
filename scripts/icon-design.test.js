const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { inspectIconSources } = require('./icon-design');

const repositoryRoot = path.resolve(__dirname, '..');

function readPngHeader(filename) {
  const contents = fs.readFileSync(filename);
  assert.deepEqual(
    contents.subarray(0, 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `${filename} must be a PNG`,
  );
  assert.equal(contents.toString('ascii', 12, 16), 'IHDR');
  return {
    width: contents.readUInt32BE(16),
    height: contents.readUInt32BE(20),
    bitDepth: contents[24],
    colorType: contents[25],
    size: contents.length,
  };
}

function readIcnsChunks(filename) {
  const contents = fs.readFileSync(filename);
  assert.equal(contents.toString('ascii', 0, 4), 'icns');
  assert.equal(contents.readUInt32BE(4), contents.length);
  const chunks = new Set();
  let offset = 8;
  while (offset + 8 <= contents.length) {
    const type = contents.toString('ascii', offset, offset + 4);
    const length = contents.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `invalid ${type} ICNS chunk length`);
    chunks.add(type);
    offset += length;
  }
  assert.equal(offset, contents.length);
  return { chunks, size: contents.length };
}

test('ships a detailed canonical app icon and generated desktop assets', () => {
  const iconsDirectory = path.join(repositoryRoot, 'src-tauri', 'icons');
  const source = readPngHeader(path.join(iconsDirectory, 'clawchat-app-icon-source.png'));
  assert.deepEqual(
    {
      width: source.width,
      height: source.height,
      bitDepth: source.bitDepth,
      colorType: source.colorType,
    },
    { width: 1254, height: 1254, bitDepth: 8, colorType: 6 },
  );
  assert.ok(source.size > 500_000, 'canonical icon must not regress to a flat placeholder');

  const appPng = readPngHeader(path.join(iconsDirectory, 'icon.png'));
  assert.deepEqual({ width: appPng.width, height: appPng.height }, { width: 512, height: 512 });
  assert.ok(appPng.size > 50_000, 'desktop PNG must contain the rendered brand mark');

  const smallPng = readPngHeader(path.join(iconsDirectory, '32x32.png'));
  assert.deepEqual({ width: smallPng.width, height: smallPng.height }, { width: 32, height: 32 });
  assert.ok(smallPng.size > 1_000, 'small desktop PNG must not be a single-color tile');

  const icns = readIcnsChunks(path.join(iconsDirectory, 'icon.icns'));
  for (const chunk of ['ic11', 'ic12', 'ic07', 'ic08', 'ic09', 'ic10']) {
    assert.ok(icns.chunks.has(chunk), `icon.icns is missing ${chunk}`);
  }
  assert.ok(icns.size > 500_000, 'icon.icns must contain the detailed multi-resolution icon');

  const tauriConfig = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'));
  assert.ok(tauriConfig.bundle.icon.includes('icons/icon.ico'));
});

test('accepts responsive icons that inherit their paint', () => {
  const sources = [
    {
      filename: 'DecorativeIcon.tsx',
      source:
        '<svg viewBox="0 0 18 18" stroke="currentColor" aria-hidden="true" focusable="false" />',
    },
    {
      filename: 'MeaningfulIcon.tsx',
      source: '<svg viewBox="0 0 18 18" stroke="currentColor" aria-label="Connection status" />',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 2 }), []);
});

test('rejects missing viewBox, hardcoded paint, missing accessibility, emoji, and SVG growth', () => {
  const sources = [
    {
      filename: 'BadIcon.tsx',
      source: '<svg fill="#fff" />\n<span>📌</span>',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 0 }), [
    { filename: 'BadIcon.tsx', line: 1, reason: 'inline SVG is missing a viewBox' },
    {
      filename: 'BadIcon.tsx',
      line: 1,
      reason: 'icon paint must inherit currentColor or use a design token',
    },
    {
      filename: 'BadIcon.tsx',
      line: 1,
      reason: 'SVG must have an accessible label or be aria-hidden and non-focusable',
    },
    {
      filename: 'BadIcon.tsx',
      line: 2,
      reason: 'emoji UI icon 📌 must use the shared vector icon set',
    },
    { filename: 'src/app', line: 1, reason: 'inline SVG count 1 exceeds migration ceiling 0' },
  ]);
});

test('rejects decorative SVGs that can receive focus', () => {
  const sources = [
    {
      filename: 'FocusableDecoration.tsx',
      source: '<svg viewBox="0 0 18 18" aria-hidden="true" />',
    },
  ];

  assert.deepEqual(inspectIconSources(sources, { inlineSvgLimit: 1 }), [
    {
      filename: 'FocusableDecoration.tsx',
      line: 1,
      reason: 'SVG must have an accessible label or be aria-hidden and non-focusable',
    },
  ]);
});
