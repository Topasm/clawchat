'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ELECTRON_RUNTIME =
  /(?:\b(?:window|globalThis)\s*(?:\.\s*electronAPI|\[\s*['"]electronAPI['"]\s*\])|(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]electron(?:-updater)?(?:\/[^'"]*)?['"])/u;
const TAURI_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@tauri-apps\//u;

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function inspectRuntimeBoundary(sources) {
  const violations = [];

  for (const { filename, source } of sources) {
    const normalized = filename.split(path.sep).join('/');
    const tauriAllowed = normalized.includes('/platform/');

    const electronMatch = ELECTRON_RUNTIME.exec(source);
    if (electronMatch) {
      violations.push({
        filename,
        line: lineNumber(source, electronMatch.index),
        reason: 'Electron runtime references are forbidden after the Tauri cutover',
      });
    }

    const tauriMatch = TAURI_IMPORT.exec(source);
    if (tauriMatch && !tauriAllowed) {
      violations.push({
        filename,
        line: lineNumber(source, tauriMatch.index),
        reason: 'Tauri imports must stay inside the platform adapter',
      });
    }
  }

  return violations;
}

function collectSources(directory) {
  const sources = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...collectSources(filename));
    if (entry.isFile() && /\.(?:ts|tsx)$/u.test(entry.name)) {
      sources.push({ filename, source: fs.readFileSync(filename, 'utf8') });
    }
  }
  return sources;
}

module.exports = { collectSources, inspectRuntimeBoundary };
