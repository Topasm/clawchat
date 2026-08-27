#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import prettier from 'prettier';
import prettierBaseline from './prettier-baseline.js';

const { compareFormattingDebt, normalizeFormattingPath } = prettierBaseline;

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(repositoryRoot, 'src');
const baselinePath = resolve(repositoryRoot, '.prettier-baseline.json');
const supportedExtension = /\.(?:css|ts|tsx)$/u;

function collectSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filename = resolve(directory, entry.name);
      if (entry.isDirectory()) return collectSourceFiles(filename);
      return entry.isFile() && supportedExtension.test(filename) ? [filename] : [];
    })
    .sort();
}

function digest(source) {
  return createHash('sha256').update(source).digest('hex');
}

async function findFormattingDebt() {
  const debt = {};
  for (const filename of collectSourceFiles(sourceRoot)) {
    const source = readFileSync(filename, 'utf8');
    const options = (await prettier.resolveConfig(filename)) ?? {};
    if (!(await prettier.check(source, { ...options, filepath: filename }))) {
      debt[normalizeFormattingPath(relative(repositoryRoot, filename))] = digest(source);
    }
  }
  return debt;
}

const currentDebt = await findFormattingDebt();

const serializedBaseline = `${JSON.stringify({ schemaVersion: 1, files: currentDebt }, null, 2)}\n`;

if (process.argv.includes('--write-baseline')) {
  writeFileSync(baselinePath, serializedBaseline);
  console.log(`Wrote Prettier baseline with ${Object.keys(currentDebt).length} legacy files`);
  process.exit(0);
}

if (process.argv.includes('--print-baseline')) {
  process.stdout.write(serializedBaseline);
  process.exit(0);
}

if (!existsSync(baselinePath)) {
  console.error(
    'Missing .prettier-baseline.json; generate and review a formatting baseline first.',
  );
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
if (baseline.schemaVersion !== 1 || !baseline.files || typeof baseline.files !== 'object') {
  console.error('Unsupported Prettier baseline schema.');
  process.exit(1);
}

const violations = compareFormattingDebt(currentDebt, baseline.files);

if (violations.length > 0) {
  console.error('Prettier ratchet failed:');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('Format changed files and remove their baseline entries.');
  process.exit(1);
}

console.log(
  `Verified Prettier formatting; ${Object.keys(currentDebt).length} legacy files remain baselined`,
);
