const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { inspectIconSources } = require('./icon-design');
const { decodePng } = require('./png-raster');

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
  const chunkOrder = [];
  let offset = 8;
  while (offset + 8 <= contents.length) {
    const type = contents.toString('ascii', offset, offset + 4);
    const length = contents.readUInt32BE(offset + 4);
    assert.ok(length >= 8, `invalid ${type} ICNS chunk length`);
    chunks.add(type);
    chunkOrder.push(type);
    offset += length;
  }
  assert.equal(offset, contents.length);
  return { chunks, chunkOrder, size: contents.length };
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
  assert.deepEqual(icns.chunkOrder, [
    'is32',
    's8mk',
    'ic11',
    'il32',
    'l8mk',
    'ic12',
    'ic07',
    'ic13',
    'ic08',
    'ic14',
    'ic09',
    'ic10',
  ]);
  assert.ok(icns.size > 500_000, 'icon.icns must contain the detailed multi-resolution icon');

  const tauriConfig = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  assert.ok(tauriConfig.bundle.icon.includes('icons/icon.icns'));
  assert.ok(tauriConfig.bundle.icon.includes('icons/icon.ico'));
});

test('keeps web, mobile, and tray branding synchronized with platform-safe assets', () => {
  const expectedPngs = [
    ['public/icons/favicon-32.png', 32, 32, 6],
    ['public/icons/apple-touch-icon-180.png', 180, 180, 2],
    ['public/icons/pwa-192.png', 192, 192, 2],
    ['public/icons/pwa-512.png', 512, 512, 2],
    ['src/assets/favicon.png', 48, 48, 6],
    ['src/assets/icon.png', 192, 192, 6],
    ['src/assets/adaptive-icon.png', 192, 192, 2],
    ['src-tauri/icons/tray-template-macos.png', 36, 36, 6],
    ['src-tauri/icons/tray-color.png', 32, 32, 6],
  ];
  for (const [relativePath, width, height, colorType] of expectedPngs) {
    const header = readPngHeader(path.join(repositoryRoot, relativePath));
    assert.deepEqual(
      { width: header.width, height: header.height, colorType: header.colorType },
      { width, height, colorType },
      relativePath,
    );
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'public', 'manifest.webmanifest'), 'utf8'),
  );
  assert.equal(manifest.name, 'ClawChat');
  assert.equal(manifest.display, 'standalone');
  assert.deepEqual(
    manifest.icons.map(({ src, sizes, purpose }) => ({ src, sizes, purpose })),
    [
      { src: '/icons/pwa-192.png', sizes: '192x192', purpose: 'any' },
      { src: '/icons/pwa-512.png', sizes: '512x512', purpose: 'any maskable' },
    ],
  );
  const indexHtml = fs.readFileSync(path.join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(indexHtml, /href="\/icons\/favicon-32\.png"/);
  assert.match(indexHtml, /href="\/icons\/apple-touch-icon-180\.png"/);
  assert.match(indexHtml, /href="\/manifest\.webmanifest"/);
  assert.match(indexHtml, /class="cc-startup-shell__mark" src="\/icons\/favicon-32\.png"/);

  for (const relativePath of [
    'src-tauri/icons/tray-template-macos.png',
    'src-tauri/icons/tray-color.png',
  ]) {
    const image = decodePng(path.join(repositoryRoot, relativePath));
    const alphaAt = (x, y) => image.pixels[(y * image.width + x) * image.channels + 3];
    assert.equal(alphaAt(0, 0), 0, `${relativePath} top-left corner must be transparent`);
    assert.equal(
      alphaAt(image.width - 1, image.height - 1),
      0,
      `${relativePath} bottom-right corner must be transparent`,
    );
    let visiblePixels = 0;
    for (let offset = 3; offset < image.pixels.length; offset += image.channels) {
      if (image.pixels[offset] > 0) visiblePixels += 1;
    }
    const coverage = visiblePixels / (image.width * image.height);
    assert.ok(coverage >= 0.1 && coverage <= 0.65, `${relativePath} alpha coverage is ${coverage}`);
  }

  const nativeSource = fs.readFileSync(
    path.join(repositoryRoot, 'src-tauri', 'src', 'native.rs'),
    'utf8',
  );
  assert.match(nativeSource, /include_image!\("\.\/icons\/tray-template-macos\.png"\)/);
  assert.match(nativeSource, /include_image!\("\.\/icons\/tray-color\.png"\)/);
  assert.match(nativeSource, /\.icon_as_template\(cfg!\(target_os = "macos"\)\)/);
  assert.doesNotMatch(nativeSource, /default_window_icon/);

  const androidBackground = fs.readFileSync(
    path.join(repositoryRoot, 'android/app/src/main/res/drawable/ic_launcher_background.xml'),
    'utf8',
  );
  const androidForeground = fs.readFileSync(
    path.join(repositoryRoot, 'android/app/src/main/res/drawable/ic_launcher_foreground.xml'),
    'utf8',
  );
  const androidThemedIcon = fs.readFileSync(
    path.join(repositoryRoot, 'android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml'),
    'utf8',
  );
  assert.match(androidBackground, /#1976D2/);
  assert.doesNotMatch(`${androidBackground}${androidForeground}`, /#6C5CE7/i);
  assert.match(androidForeground, /#2196F3/);
  assert.match(androidForeground, /#0D47A1/);
  assert.match(
    androidThemedIcon,
    /<monochrome android:drawable="@drawable\/ic_launcher_monochrome"/,
  );

  const notificationHelper = fs.readFileSync(
    path.join(
      repositoryRoot,
      'android/core/src/main/java/com/clawchat/android/core/notification/ReminderNotificationHelper.kt',
    ),
    'utf8',
  );
  const notificationIcon = fs.readFileSync(
    path.join(repositoryRoot, 'android/core/src/main/res/drawable/ic_stat_clawchat.xml'),
    'utf8',
  );
  assert.match(notificationHelper, /R\.drawable\.ic_stat_clawchat/);
  assert.doesNotMatch(notificationHelper, /android\.R\.drawable\.ic_dialog_info/);
  assert.match(notificationIcon, /android:fillType="evenOdd"/);

  const generationScript = fs.readFileSync(
    path.join(repositoryRoot, 'scripts', 'generate-brand-icons.js'),
    'utf8',
  );
  assert.match(generationScript, /flattenPngToRgb/);
  assert.match(generationScript, /canonicalizeIcns/);
  assert.match(generationScript, /clawchat-full-bleed-icon\.svg/);
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
