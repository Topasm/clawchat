#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const resourcesPath = path.join(root, 'src', 'app', 'i18n', 'resources.ts');
const literalResourcesPath = path.join(root, 'src', 'app', 'i18n', 'literalResources.ts');
const englishOutputPath = path.join(root, 'src', 'app', 'i18n', 'generated', 'en.catalog.json.gz');
const koreanOutputPath = path.join(root, 'src', 'app', 'i18n', 'generated', 'ko.catalog.json.gz');
const checkOnly = process.argv.includes('--check');

function loadTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  }).outputText;
  const exports = {};
  vm.runInNewContext(
    `(function (exports) { ${compiled}\n})(exports);`,
    { exports },
    {
      filename: filePath,
    },
  );
  return exports;
}

function assertCurrent(filePath, expected) {
  if (!fs.existsSync(filePath) || !fs.readFileSync(filePath).equals(expected)) {
    console.error(`${path.relative(root, filePath)} is stale. Run: npm run generate:i18n-catalog`);
    process.exitCode = 1;
  }
}

async function main() {
  const resources = loadTypeScriptModule(resourcesPath).translationResources;
  const literal = loadTypeScriptModule(literalResourcesPath).koreanUiTranslations;
  const englishJson = Buffer.from(JSON.stringify(resources.en.translation), 'utf8');
  const englishGzip = zlib.gzipSync(englishJson, { level: 9, mtime: 0 });
  const koreanJson = Buffer.from(
    JSON.stringify({ structured: resources.ko.translation, literal }),
    'utf8',
  );
  const koreanGzip = zlib.gzipSync(koreanJson, { level: 9, mtime: 0 });

  if (checkOnly) {
    assertCurrent(englishOutputPath, englishGzip);
    assertCurrent(koreanOutputPath, koreanGzip);
    if (!process.exitCode) console.log('Generated i18n catalog is current.');
    return;
  }

  fs.mkdirSync(path.dirname(englishOutputPath), { recursive: true });
  fs.writeFileSync(englishOutputPath, englishGzip);
  fs.writeFileSync(koreanOutputPath, koreanGzip);
  console.log(
    `Generated ${(englishGzip.length / 1024).toFixed(2)} KiB English and ` +
      `${(koreanGzip.length / 1024).toFixed(2)} KiB Korean catalogs.`,
  );
}

void main();
