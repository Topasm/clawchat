#!/usr/bin/env node
'use strict';

/**
 * Guards `src/app/types/schemas.ts` against drifting away from the FastAPI
 * OpenAPI snapshot in `server/openapi.json`.
 *
 * The zod schemas in `types/schemas.ts` are hand-written mirrors of the server
 * Pydantic models. Nothing forces them to stay in sync: when the server grows a
 * response field, the hand-written mirror silently keeps its old shape and the
 * inferred TypeScript type drops the new field without a compile error.
 *
 * This check pairs every `<Name>Schema` export with `components.schemas.<Name>`
 * and reports:
 *   - MISSING: a property the server documents that the zod object does not
 *     declare. Treated as an error — the client silently discards it.
 *   - EXTRA: a property the zod object declares that the server no longer
 *     documents. Reported as a warning: these are usually optional leftovers
 *     that still typecheck, and removing one is a consumer-visible change.
 *   - ENUM drift in both directions, treated as an error.
 *
 * Deliberately a lightweight source scan rather than a runtime import: the file
 * is TypeScript and `node --test` runs plain CommonJS.
 */

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const defaultSpecPath = path.join(repositoryRoot, 'server', 'openapi.json');
const defaultSchemaModulePath = path.join(repositoryRoot, 'src', 'app', 'types', 'schemas.ts');

/**
 * Zod properties that intentionally have no OpenAPI counterpart, with the
 * reason each one is retained. Keep this list short and justified.
 */
const ALLOWED_EXTRA_PROPERTIES = new Map([
  [
    'AgentTaskSummary.skill_chain',
    'Rendered by ActivityTab as an optional detail; the summary payload omits it.',
  ],
]);

const SCHEMA_SUFFIX = 'Schema';
const OPENERS = '([{';
const CLOSERS = ')]}';

/** Extracts the initializer source of `const <name> = ...;` at statement level. */
function readDeclarationBody(source, name) {
  const declaration = new RegExp(`^(?:export )?const ${name}\\s*=\\s*`, 'm');
  const match = declaration.exec(source);
  if (!match) return null;

  let index = match.index + match[0].length;
  const start = index;
  let depth = 0;

  while (index < source.length) {
    const character = source[index];
    if (OPENERS.includes(character)) depth += 1;
    else if (CLOSERS.includes(character)) depth -= 1;
    else if (character === ';' && depth === 0) break;
    index += 1;
  }

  return source.slice(start, index);
}

/** Splits an object-literal body on the commas that sit at nesting depth zero. */
function splitTopLevelEntries(body) {
  const entries = [];
  let depth = 0;
  let current = '';

  for (const character of body) {
    if (OPENERS.includes(character)) depth += 1;
    else if (CLOSERS.includes(character)) depth -= 1;

    if (character === ',' && depth === 0) {
      entries.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  entries.push(current);
  return entries;
}

/** Collects the property names of every `z.object({...})`/`.extend({...})` literal. */
function objectLiteralProperties(body) {
  // `z.object({` is often written across lines as `z\n  .object({`, and derived
  // schemas add their own fields through `<Base>Schema.extend({...})`.
  const literal = /(?:z\s*\.\s*object|\.\s*extend)\s*\(\s*\{/g;
  const properties = new Set();
  let found = false;
  let match;

  while ((match = literal.exec(body)) !== null) {
    found = true;
    let depth = 0;
    let index = match.index + match[0].length - 1; // position of the `{`
    let inner = '';

    for (; index < body.length; index += 1) {
      const character = body[index];
      if (OPENERS.includes(character)) {
        depth += 1;
        if (depth === 1) continue;
      } else if (CLOSERS.includes(character)) {
        depth -= 1;
        if (depth === 0) break;
      }
      inner += character;
    }

    for (const entry of splitTopLevelEntries(inner)) {
      // `name: z...` plus zod v4's recursive form, `get name() { return z...; }`.
      const property = /^\s*(?:\/\/[^\n]*\n\s*)*(?:get\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*[:(]/.exec(
        entry,
      );
      if (property) properties.add(property[1]);
    }

    literal.lastIndex = index;
  }

  return found ? properties : null;
}

/** Reads the values of a `z.enum([...])` literal. */
function enumLiteralValues(body) {
  const match = /z\s*\.\s*enum\s*\(\s*\[([^\]]*)\]\s*\)/.exec(body);
  if (!match) return null;
  return [...match[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map((value) => value[1] ?? value[2]);
}

/**
 * Resolves the full property set of a schema, following `.extend()`,
 * `.partial()`, `.omit()`-free derivations and plain aliases to a base schema.
 */
function resolveProperties(source, name, seen = new Set()) {
  if (seen.has(name)) return null;
  seen.add(name);

  const body = readDeclarationBody(source, name);
  if (body === null) return null;

  const own = objectLiteralProperties(body);

  // `const XSchema = YSchema.extend({...})` / `.partial()` / `= YSchema`
  const base = /^\s*([A-Za-z0-9_]+Schema)\b/.exec(body);
  if (base && base[1] !== name) {
    const inherited = resolveProperties(source, base[1], seen);
    if (inherited) {
      const merged = new Set(inherited);
      if (own) for (const property of own) merged.add(property);
      return merged;
    }
  }

  return own;
}

/** Property names an OpenAPI schema documents, flattening `allOf` composition. */
function openApiProperties(schema, document, seen = new Set()) {
  if (!schema || typeof schema !== 'object') return null;

  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    if (seen.has(name)) return null;
    seen.add(name);
    return openApiProperties(document.components?.schemas?.[name], document, seen);
  }

  if (schema.properties) return Object.keys(schema.properties);

  if (Array.isArray(schema.allOf)) {
    const names = schema.allOf.flatMap((member) => openApiProperties(member, document, seen) ?? []);
    return names.length ? names : null;
  }

  return null;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Compares the hand-written zod mirrors against the OpenAPI snapshot.
 * Returns `{ errors, warnings, comparedObjects, comparedEnums, skipped }`.
 */
function analyzeSchemaDrift({
  specPath = defaultSpecPath,
  schemaModulePath = defaultSchemaModulePath,
} = {}) {
  const document = loadJson(specPath);
  const source = fs.readFileSync(schemaModulePath, 'utf8');
  const components = document.components?.schemas ?? {};

  if (Object.keys(components).length === 0) {
    throw new Error(`${specPath} declares no components.schemas`);
  }

  const declared = [
    ...source.matchAll(new RegExp(`^(?:export )?const ([A-Za-z0-9_]+${SCHEMA_SUFFIX})\\s*=`, 'gm')),
  ].map((match) => match[1]);

  const errors = [];
  const warnings = [];
  const skipped = [];
  let comparedObjects = 0;
  let comparedEnums = 0;

  for (const schemaConst of declared) {
    const modelName = schemaConst.slice(0, -SCHEMA_SUFFIX.length);
    const component = components[modelName];
    if (!component) continue; // client-only helper schema, nothing to compare against

    const body = readDeclarationBody(source, schemaConst);
    if (body === null) {
      skipped.push(`${modelName}: could not read declaration body`);
      continue;
    }

    if (Array.isArray(component.enum)) {
      const values = enumLiteralValues(body);
      if (values === null) {
        // Enums sourced from the generated contracts (TASK_STATUSES etc.) are
        // already guarded by scripts/generate-api-contracts.js --check.
        if (/TASK_STATUSES|TASK_RELATIONSHIP_TYPES/.test(body)) {
          comparedEnums += 1;
        } else {
          skipped.push(`${modelName}: enum literal not recognised`);
        }
        continue;
      }

      comparedEnums += 1;
      const missing = component.enum.filter((value) => !values.includes(value));
      const extra = values.filter((value) => !component.enum.includes(value));
      if (missing.length) {
        errors.push(`${modelName} enum is missing server values: ${missing.join(', ')}`);
      }
      if (extra.length) {
        errors.push(`${modelName} enum declares unknown values: ${extra.join(', ')}`);
      }
      continue;
    }

    const documented = openApiProperties(component, document);
    if (!documented) {
      skipped.push(`${modelName}: OpenAPI schema declares no properties`);
      continue;
    }

    const properties = resolveProperties(source, schemaConst);
    if (!properties) {
      skipped.push(`${modelName}: not an object schema`);
      continue;
    }

    comparedObjects += 1;

    const missing = documented.filter((property) => !properties.has(property));
    if (missing.length) {
      errors.push(`${modelName} is missing server fields: ${missing.join(', ')}`);
    }

    const extra = [...properties]
      .filter((property) => !documented.includes(property))
      .filter((property) => !ALLOWED_EXTRA_PROPERTIES.has(`${modelName}.${property}`));
    if (extra.length) {
      warnings.push(
        `${modelName} declares fields the server no longer documents: ${extra.join(', ')}`,
      );
    }
  }

  return { errors, warnings, skipped, comparedObjects, comparedEnums };
}

function main() {
  let result;
  try {
    result = analyzeSchemaDrift();
  } catch (error) {
    console.error(`schema contract drift check failed: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);

  if (result.errors.length) {
    console.error('src/app/types/schemas.ts has drifted from server/openapi.json:');
    for (const error of result.errors) console.error(`  - ${error}`);
    console.error(
      '\nUpdate the hand-written zod mirrors in src/app/types/schemas.ts to match the snapshot.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `schema contract drift check passed (${result.comparedObjects} object schemas, ` +
      `${result.comparedEnums} enums compared).`,
  );
}

if (require.main === module) main();

module.exports = {
  ALLOWED_EXTRA_PROPERTIES,
  analyzeSchemaDrift,
  enumLiteralValues,
  objectLiteralProperties,
  openApiProperties,
  readDeclarationBody,
  resolveProperties,
};
