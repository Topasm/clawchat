import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'app');
const catalogPath = path.join(sourceRoot, 'i18n', 'literalResources.ts');
const userFacingAttributes = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'ariaLabel',
  'cancelLabel',
  'confirmLabel',
  'description',
  'emptyMessage',
  'label',
  'message',
  'placeholder',
  'sublabel',
  'title',
]);
const userFacingCalls = new Set(['addToast', 'alert', 'confirm', 'setError', 'setMessage']);

function canonical(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&rarr;/g, '→')
    .replace(/&times;/g, '×')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasEnglish(value) {
  const text = canonical(value);
  return /[A-Za-z]{2}/.test(text) && !text.startsWith('cc-') && text !== 'sk-...';
}

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : collectFiles(target);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [target] : [];
  });
}

function parse(file) {
  return ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function callName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text;
  return '';
}

function isTranslationCall(node) {
  return (
    ts.isCallExpression(node) &&
    ((ts.isIdentifier(node.expression) && ['t', 'translateUi'].includes(node.expression.text)) ||
      (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'tr'))
  );
}

function renderedExpressionHasEnglish(node) {
  if (isTranslationCall(node)) return false;
  if (ts.isStringLiteralLike(node)) return hasEnglish(node.text);
  if (ts.isTemplateExpression(node)) {
    return (
      hasEnglish(node.head.text) || node.templateSpans.some((span) => hasEnglish(span.literal.text))
    );
  }
  if (ts.isConditionalExpression(node)) {
    return (
      renderedExpressionHasEnglish(node.whenTrue) || renderedExpressionHasEnglish(node.whenFalse)
    );
  }
  if (ts.isBinaryExpression(node)) {
    return node.operatorToken.kind === ts.SyntaxKind.PlusToken
      ? renderedExpressionHasEnglish(node.left) || renderedExpressionHasEnglish(node.right)
      : false;
  }
  if (ts.isParenthesizedExpression(node)) return renderedExpressionHasEnglish(node.expression);
  return false;
}

function callMessageHasEnglish(node) {
  if (isTranslationCall(node) || ts.isCallExpression(node)) return false;
  if (ts.isConditionalExpression(node)) {
    return callMessageHasEnglish(node.whenTrue) || callMessageHasEnglish(node.whenFalse);
  }
  return renderedExpressionHasEnglish(node);
}

const catalog = new Set();
const catalogSource = parse(catalogPath);
function visitCatalog(node) {
  if (ts.isPropertyAssignment(node)) {
    const name = node.name;
    if (ts.isStringLiteralLike(name) || ts.isIdentifier(name)) catalog.add(canonical(name.text));
  }
  ts.forEachChild(node, visitCatalog);
}
visitCatalog(catalogSource);

const failures = [];
for (const file of collectFiles(sourceRoot)) {
  if (file === catalogPath) continue;
  const source = parse(file);
  function report(node, message) {
    const position = source.getLineAndCharacterOfPosition(node.getStart(source));
    failures.push(
      `${path.relative(root, file)}:${position.line + 1}:${position.character + 1} ${message}`,
    );
  }
  function visit(node) {
    if (ts.isJsxText(node) && hasEnglish(node.text)) {
      report(node, `untranslated JSX text: ${JSON.stringify(canonical(node.text))}`);
    }
    if (ts.isJsxAttribute(node) && userFacingAttributes.has(node.name.text)) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer) && hasEnglish(initializer.text)) {
        report(node, `untranslated ${node.name.text}: ${JSON.stringify(initializer.text)}`);
      }
    }
    if (
      ts.isJsxExpression(node) &&
      node.expression &&
      !isTranslationCall(node.expression) &&
      renderedExpressionHasEnglish(node.expression) &&
      (!node.parent ||
        !ts.isJsxAttribute(node.parent) ||
        userFacingAttributes.has(node.parent.name.text))
    ) {
      report(node, 'untranslated rendered expression');
    }
    if (ts.isCallExpression(node) && userFacingCalls.has(callName(node))) {
      const argument = node.arguments[callName(node) === 'addToast' ? 1 : 0];
      if (argument && callMessageHasEnglish(argument)) {
        report(argument, `untranslated ${callName(node)} message`);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'translateUi' &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      const key = canonical(node.arguments[0].text);
      if (!catalog.has(key)) report(node, `missing Korean catalog entry: ${JSON.stringify(key)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (failures.length > 0) {
  console.error(
    `UI localization check failed (${failures.length} issue(s)):\n${failures.join('\n')}`,
  );
  process.exitCode = 1;
} else {
  console.log(`UI localization check passed (${catalog.size} Korean catalog entries).`);
}
