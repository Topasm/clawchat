#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const positionalArgs = args.filter((arg) => arg !== '--json');

if (positionalArgs.length > 1) {
  console.error('Usage: node scripts/measure-renderer-bundle.js [build-directory] [--json]');
  process.exit(1);
}

const buildDirectory = path.resolve(positionalArgs[0] || 'dist');
const indexPath = path.join(buildDirectory, 'index.html');

if (!fs.existsSync(indexPath)) {
  console.error(`Renderer entry not found: ${indexPath}`);
  console.error('Build it first with: npm run build:web');
  process.exit(1);
}

function listFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveLocalAsset(assetUrl) {
  if (/^[a-z][a-z\d+.-]*:/i.test(assetUrl) || assetUrl.startsWith('//')) {
    throw new Error(`Expected a local renderer asset, received: ${assetUrl}`);
  }

  const cleanUrl = decodeURIComponent(assetUrl.split(/[?#]/, 1)[0]);
  const relativePath = cleanUrl.startsWith('/') ? cleanUrl.slice(1) : cleanUrl;
  const assetPath = path.resolve(buildDirectory, relativePath);
  const relativeToBuild = path.relative(buildDirectory, assetPath);

  if (relativeToBuild.startsWith('..') || path.isAbsolute(relativeToBuild)) {
    throw new Error(`Renderer asset escapes the build directory: ${assetUrl}`);
  }
  if (!fs.existsSync(assetPath)) {
    throw new Error(`Renderer asset referenced by index.html was not found: ${assetPath}`);
  }
  return assetPath;
}

function isJavaScript(filePath) {
  return ['.js', '.mjs', '.cjs'].includes(path.extname(filePath));
}

function measureFile(filePath) {
  const contents = fs.readFileSync(filePath);
  return {
    path: path.relative(buildDirectory, filePath).split(path.sep).join('/'),
    rawBytes: contents.byteLength,
    gzipBytes: zlib.gzipSync(contents, { level: 9 }).byteLength,
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

try {
  const html = fs.readFileSync(indexPath, 'utf8');
  const initialAssetUrls = [];

  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const type = readAttribute(match[0], 'type');
    const src = readAttribute(match[0], 'src');
    if (type?.toLowerCase() === 'module' && src) initialAssetUrls.push(src);
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = readAttribute(match[0], 'rel');
    const href = readAttribute(match[0], 'href');
    if (rel?.toLowerCase().split(/\s+/).includes('modulepreload') && href) {
      initialAssetUrls.push(href);
    }
  }

  const initialFiles = [...new Set(initialAssetUrls.map(resolveLocalAsset))]
    .filter(isJavaScript)
    .sort()
    .map(measureFile);
  const allFiles = listFiles(buildDirectory).sort();
  const allJavaScript = allFiles.filter(isJavaScript).map(measureFile);
  const result = {
    schemaVersion: 1,
    buildDirectory,
    initialJavaScript: {
      fileCount: initialFiles.length,
      rawBytes: sum(initialFiles, 'rawBytes'),
      gzipBytes: sum(initialFiles, 'gzipBytes'),
      files: initialFiles,
    },
    allJavaScript: {
      fileCount: allJavaScript.length,
      rawBytes: sum(allJavaScript, 'rawBytes'),
      gzipBytes: sum(allJavaScript, 'gzipBytes'),
    },
    allRendererFiles: {
      fileCount: allFiles.length,
      rawBytes: allFiles.reduce((total, filePath) => total + fs.statSync(filePath).size, 0),
    },
  };

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Renderer bundle: ${buildDirectory}`);
    console.log(
      `Initial HTML JavaScript: ${formatBytes(result.initialJavaScript.rawBytes)} raw, ` +
        `${formatBytes(result.initialJavaScript.gzipBytes)} gzip ` +
        `(${result.initialJavaScript.fileCount} files)`,
    );
    console.log(
      `All JavaScript: ${formatBytes(result.allJavaScript.rawBytes)} raw, ` +
        `${formatBytes(result.allJavaScript.gzipBytes)} gzip ` +
        `(${result.allJavaScript.fileCount} files)`,
    );
    console.log(
      `All renderer files: ${formatBytes(result.allRendererFiles.rawBytes)} ` +
        `(${result.allRendererFiles.fileCount} files)`,
    );
    console.log('Initial files:');
    for (const file of initialFiles) {
      console.log(
        `  ${file.path}: ${formatBytes(file.rawBytes)} raw, ${formatBytes(file.gzipBytes)} gzip`,
      );
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
