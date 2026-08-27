const fs = require('node:fs');
const path = require('node:path');

// The one raw SVG is IconBase itself; product icons must compose that base.
const INLINE_SVG_LIMIT = 1;
const EMOJI_ICON = /\p{Extended_Pictographic}/gu;
const SVG_OPENING = /<svg\b[^>]*>/g;
const HARDCODED_PAINT = /(?:fill|stroke)\s*=\s*["']#[0-9a-f]{3,8}["']/i;
const ACCESSIBLE_NAME = /\baria-(?:label|labelledby)\s*=/;
const ARIA_HIDDEN = /\baria-hidden\s*=/;
const NOT_FOCUSABLE = /\bfocusable\s*=\s*(?:["']false["']|\{(?:false|["']false["'])\})/;

function lineNumber(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function inspectIconSources(sources, options = {}) {
  const inlineSvgLimit = options.inlineSvgLimit ?? INLINE_SVG_LIMIT;
  const violations = [];
  let inlineSvgCount = 0;

  for (const { filename, source } of sources) {
    for (const match of source.matchAll(SVG_OPENING)) {
      inlineSvgCount += 1;
      if (!/\bviewBox\s*=/.test(match[0])) {
        violations.push({
          filename,
          line: lineNumber(source, match.index),
          reason: 'inline SVG is missing a viewBox',
        });
      }
      if (HARDCODED_PAINT.test(match[0])) {
        violations.push({
          filename,
          line: lineNumber(source, match.index),
          reason: 'icon paint must inherit currentColor or use a design token',
        });
      }
      const hasAccessibleName = ACCESSIBLE_NAME.test(match[0]);
      const isDecorative = ARIA_HIDDEN.test(match[0]) && NOT_FOCUSABLE.test(match[0]);
      if (!hasAccessibleName && !isDecorative) {
        violations.push({
          filename,
          line: lineNumber(source, match.index),
          reason: 'SVG must have an accessible label or be aria-hidden and non-focusable',
        });
      }
    }

    for (const match of source.matchAll(EMOJI_ICON)) {
      violations.push({
        filename,
        line: lineNumber(source, match.index),
        reason: `emoji UI icon ${match[0]} must use the shared vector icon set`,
      });
    }
  }

  if (inlineSvgCount > inlineSvgLimit) {
    violations.push({
      filename: 'src/app',
      line: 1,
      reason: `inline SVG count ${inlineSvgCount} exceeds migration ceiling ${inlineSvgLimit}`,
    });
  }

  return violations;
}

function collectTsxSources(directory) {
  const sources = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...collectTsxSources(filename));
    if (entry.isFile() && filename.endsWith('.tsx')) {
      sources.push({ filename, source: fs.readFileSync(filename, 'utf8') });
    }
  }
  return sources;
}

function inspectIconContract(rootDirectory) {
  const appDirectory = path.join(rootDirectory, 'src', 'app');
  const sources = collectTsxSources(appDirectory);
  const violations = inspectIconSources(sources);
  const iconsFilename = path.join(appDirectory, 'components', 'shared', 'Icons.tsx');
  const iconsSource = fs.readFileSync(iconsFilename, 'utf8');
  const navIconsFilename = path.join(appDirectory, 'components', 'shared', 'NavIcons.tsx');
  const navIconsSource = fs.readFileSync(navIconsFilename, 'utf8');

  const contractAttributes = [
    'export const ICON_SIZE = {',
    'micro: 12',
    'compact: 14',
    'control: 16',
    'feature: 18',
    'empty: 28',
    'export const ICON_STROKE_WIDTH = 1.75',
    'size = ICON_SIZE.feature',
    'strokeWidth = ICON_STROKE_WIDTH',
    'viewBox="0 0 18 18"',
    'stroke="currentColor"',
    'aria-hidden={label ? undefined : true}',
    'focusable="false"',
  ];
  for (const attribute of contractAttributes) {
    if (!iconsSource.includes(attribute)) {
      violations.push({
        filename: iconsFilename,
        line: 1,
        reason: `IconBase is missing contract attribute ${attribute}`,
      });
    }
  }

  const numericDefaultPatterns = [
    {
      pattern: /size\s*=\s*\d+(?:\.\d+)?/,
      reason: 'shared icons must use a semantic ICON_SIZE value instead of a numeric default',
    },
    {
      pattern: /strokeWidth\s*=\s*\d+(?:\.\d+)?/,
      reason: 'shared icons must use ICON_STROKE_WIDTH instead of a numeric default',
    },
  ];
  for (const { pattern, reason } of numericDefaultPatterns) {
    for (const [filename, source] of [
      [iconsFilename, iconsSource],
      [navIconsFilename, navIconsSource],
    ]) {
      const match = pattern.exec(source);
      if (match) violations.push({ filename, line: lineNumber(source, match.index), reason });
    }
  }

  if (navIconsSource.includes('<svg')) {
    violations.push({
      filename: navIconsFilename,
      line: 1,
      reason: 'navigation icons must use IconBase instead of raw SVG',
    });
  }
  return violations;
}

module.exports = { INLINE_SVG_LIMIT, inspectIconSources, inspectIconContract };
