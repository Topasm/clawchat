const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const TOKEN_REFERENCE = /var\((--cc-[a-z0-9-]+)/g;
const RUNTIME_TOKEN_DEFINITION = /['"](--cc-[a-z0-9-]+)['"]\s*:/g;

function collectMatches(source, expression) {
  const matches = new Set();
  for (const match of source.matchAll(expression)) matches.add(match[1]);
  return matches;
}

function inspectDesignTokens(styleSources, runtimeSource = '') {
  const definedTokens = collectMatches(runtimeSource, RUNTIME_TOKEN_DEFINITION);
  const parsedStyles = [];
  const violations = [];

  for (const { filename, source } of styleSources) {
    try {
      const root = postcss.parse(source, { from: filename });
      parsedStyles.push({ filename, root });
      root.walkDecls((declaration) => {
        if (/^--cc-[a-z0-9-]+$/.test(declaration.prop)) {
          definedTokens.add(declaration.prop);
        }
      });
    } catch (error) {
      violations.push({
        filename,
        line: error.line || 1,
        reason: `invalid CSS: ${error.reason || error.message}`,
      });
    }
  }

  for (const { filename, root } of parsedStyles) {
    root.walkDecls((declaration) => {
      for (const token of collectMatches(declaration.value, TOKEN_REFERENCE)) {
        if (!definedTokens.has(token)) {
          violations.push({
            filename,
            line: declaration.source?.start?.line || 1,
            reason: `undefined design token ${token}`,
          });
        }
      }
    });

    root.walkAtRules((atRule) => {
      for (const token of collectMatches(atRule.params, TOKEN_REFERENCE)) {
        if (!definedTokens.has(token)) {
          violations.push({
            filename,
            line: atRule.source?.start?.line || 1,
            reason: `undefined design token ${token}`,
          });
        }
      }
    });

    root.walkDecls(/^border(?:-[a-z]+)*-radius$/i, (declaration) => {
      if (/\d+(?:\.\d+)?px\b/i.test(declaration.value)) {
        violations.push({
          filename,
          line: declaration.source?.start?.line || 1,
          reason: `raw border radius ${declaration.value.trim()}`,
        });
      }
    });
  }
  return violations;
}

function inspectRepository(rootDirectory) {
  const stylesDirectory = path.join(rootDirectory, 'src', 'styles');
  const styleSources = fs.readdirSync(stylesDirectory)
    .filter((filename) => filename.endsWith('.css'))
    .sort()
    .map((filename) => ({
      filename: path.join(stylesDirectory, filename),
      source: fs.readFileSync(path.join(stylesDirectory, filename), 'utf8'),
    }));
  const runtimeSource = fs.readFileSync(
    path.join(rootDirectory, 'src', 'app', 'components', 'Layout.tsx'),
    'utf8',
  );
  return inspectDesignTokens(styleSources, runtimeSource);
}

module.exports = { inspectDesignTokens, inspectRepository };
