const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { flattenPngToRgb } = require('./png-raster');

const repositoryRoot = path.resolve(__dirname, '..');
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const tauriIcons = path.join(repositoryRoot, 'src-tauri', 'icons');
const appSource = path.join(tauriIcons, 'clawchat-app-icon-source.png');
const fullBleedSource = path.join(tauriIcons, 'clawchat-full-bleed-icon.svg');
const trayTemplateSource = path.join(tauriIcons, 'tray-template-macos.svg');
const trayColorSource = path.join(tauriIcons, 'tray-color.svg');

function generate(source, output, sizes) {
  const args = [tauriCli, 'icon'];
  if (sizes) args.push('--png', sizes);
  args.push(source, '--output', output);
  execFileSync(process.execPath, args, { cwd: repositoryRoot, stdio: 'inherit' });
}

function copy(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function canonicalizeIcns(filename) {
  const contents = fs.readFileSync(filename);
  if (contents.toString('ascii', 0, 4) !== 'icns' || contents.readUInt32BE(4) !== contents.length) {
    throw new Error(`Invalid ICNS container: ${filename}`);
  }
  const chunks = [];
  let offset = 8;
  while (offset < contents.length) {
    const length = contents.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > contents.length) {
      throw new Error(`Invalid ICNS chunk at byte ${offset}: ${filename}`);
    }
    chunks.push({
      type: contents.toString('ascii', offset, offset + 4),
      contents: contents.subarray(offset, offset + length),
    });
    offset += length;
  }
  const preferredOrder = [
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
  ];
  const order = new Map(preferredOrder.map((type, index) => [type, index]));
  chunks.sort(
    (left, right) =>
      (order.get(left.type) ?? preferredOrder.length) -
        (order.get(right.type) ?? preferredOrder.length) || left.type.localeCompare(right.type),
  );
  fs.writeFileSync(
    filename,
    Buffer.concat([contents.subarray(0, 8), ...chunks.map((x) => x.contents)]),
  );
}

generate(appSource, tauriIcons);
canonicalizeIcns(path.join(tauriIcons, 'icon.icns'));

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clawchat-brand-icons-'));
try {
  const regularOutput = path.join(temporaryRoot, 'regular');
  const fullBleedOutput = path.join(temporaryRoot, 'full-bleed');
  const trayTemplateOutput = path.join(temporaryRoot, 'tray-template');
  const trayColorOutput = path.join(temporaryRoot, 'tray-color');
  generate(appSource, regularOutput, '32,48,192');
  generate(fullBleedSource, fullBleedOutput, '180,192,512,1024');
  generate(trayTemplateSource, trayTemplateOutput, '36');
  generate(trayColorSource, trayColorOutput, '32');

  const publicIcons = path.join(repositoryRoot, 'public', 'icons');
  copy(path.join(regularOutput, '32x32.png'), path.join(publicIcons, 'favicon-32.png'));
  flattenPngToRgb(path.join(fullBleedOutput, '192x192.png'), path.join(publicIcons, 'pwa-192.png'));
  flattenPngToRgb(path.join(fullBleedOutput, '512x512.png'), path.join(publicIcons, 'pwa-512.png'));
  flattenPngToRgb(
    path.join(fullBleedOutput, '180x180.png'),
    path.join(publicIcons, 'apple-touch-icon-180.png'),
  );
  const legacyAssets = path.join(repositoryRoot, 'src', 'assets');
  copy(path.join(regularOutput, '48x48.png'), path.join(legacyAssets, 'favicon.png'));
  copy(path.join(regularOutput, '192x192.png'), path.join(legacyAssets, 'icon.png'));
  flattenPngToRgb(
    path.join(fullBleedOutput, '192x192.png'),
    path.join(legacyAssets, 'adaptive-icon.png'),
  );

  flattenPngToRgb(
    path.join(fullBleedOutput, '1024x1024.png'),
    path.join(
      repositoryRoot,
      'ios',
      'App',
      'App',
      'Assets.xcassets',
      'AppIcon.appiconset',
      'AppIcon-512@2x.png',
    ),
  );

  copy(
    path.join(trayTemplateOutput, '36x36.png'),
    path.join(tauriIcons, 'tray-template-macos.png'),
  );
  copy(path.join(trayColorOutput, '32x32.png'), path.join(tauriIcons, 'tray-color.png'));
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
