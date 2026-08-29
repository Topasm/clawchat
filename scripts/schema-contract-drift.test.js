'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  analyzeSchemaDrift,
  enumLiteralValues,
  objectLiteralProperties,
  openApiProperties,
  readDeclarationBody,
  resolveProperties,
} = require('./check-schema-contract-drift.js');

function withFixture(spec, schemaSource, assertion) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-drift-'));
  const specPath = path.join(directory, 'openapi.json');
  const schemaModulePath = path.join(directory, 'schemas.ts');

  fs.writeFileSync(specPath, JSON.stringify(spec));
  fs.writeFileSync(schemaModulePath, schemaSource);

  try {
    assertion(analyzeSchemaDrift({ specPath, schemaModulePath }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('reads a declaration body up to the statement terminator', () => {
  const source = 'export const AlphaSchema = z.object({ id: z.string() });\nconst other = 1;\n';
  assert.match(
    readDeclarationBody(source, 'AlphaSchema'),
    /^z\.object\(\{ id: z\.string\(\) \}\)$/,
  );
  assert.equal(readDeclarationBody(source, 'MissingSchema'), null);
});

test('collects object properties across line breaks and nested schemas', () => {
  const body = `z
  .object({
    id: z.string(),
    nested: z.object({ ignored_depth: z.string() }),
    tags: z.array(z.string()).nullable().optional(),
  })
  .strict()`;
  const properties = objectLiteralProperties(body);
  assert.ok(properties.has('id'));
  assert.ok(properties.has('nested'));
  assert.ok(properties.has('tags'));
});

test('collects properties declared with the zod v4 recursive getter form', () => {
  const properties = objectLiteralProperties(
    'z.object({ id: z.string(), get children() { return z.array(SelfSchema); } })',
  );
  assert.ok(properties.has('children'));
});

test('resolves properties inherited through extend, partial and aliases', () => {
  const source = [
    'export const BaseSchema = z.object({ id: z.string(), title: z.string() });',
    'export const ExtendedSchema = BaseSchema.extend({ extra: z.string() });',
    'export const PartialSchema = BaseSchema.partial();',
    'export const AliasSchema = ExtendedSchema;',
  ].join('\n');

  assert.deepEqual([...resolveProperties(source, 'ExtendedSchema')].sort(), [
    'extra',
    'id',
    'title',
  ]);
  assert.deepEqual([...resolveProperties(source, 'PartialSchema')].sort(), ['id', 'title']);
  assert.deepEqual([...resolveProperties(source, 'AliasSchema')].sort(), ['extra', 'id', 'title']);
});

test('reads enum literals and flattens allOf composition', () => {
  assert.deepEqual(enumLiteralValues("z.enum(['a', 'b'])"), ['a', 'b']);
  assert.equal(enumLiteralValues('z.object({})'), null);

  const document = {
    components: { schemas: { Base: { properties: { id: {} } } } },
  };
  assert.deepEqual(
    openApiProperties(
      { allOf: [{ $ref: '#/components/schemas/Base' }, { properties: { b: {} } }] },
      document,
    ),
    ['id', 'b'],
  );
});

test('reports a server field the hand-written zod mirror does not declare', () => {
  withFixture(
    { components: { schemas: { Widget: { properties: { id: {}, created_at: {} } } } } },
    'export const WidgetSchema = z.object({ id: z.string() });\n',
    (result) => {
      assert.equal(result.comparedObjects, 1);
      assert.deepEqual(result.errors, ['Widget is missing server fields: created_at']);
    },
  );
});

test('warns, without failing, about a field the server no longer documents', () => {
  withFixture(
    { components: { schemas: { Widget: { properties: { id: {} } } } } },
    'export const WidgetSchema = z.object({ id: z.string(), legacy: z.string() });\n',
    (result) => {
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.warnings, [
        'Widget declares fields the server no longer documents: legacy',
      ]);
    },
  );
});

test('reports enum drift in both directions', () => {
  withFixture(
    { components: { schemas: { Mode: { enum: ['fast', 'slow'] } } } },
    "export const ModeSchema = z.enum(['fast', 'turbo']);\n",
    (result) => {
      assert.equal(result.comparedEnums, 1);
      assert.deepEqual(result.errors, [
        'Mode enum is missing server values: slow',
        'Mode enum declares unknown values: turbo',
      ]);
    },
  );
});

test('ignores client-only schemas that have no OpenAPI counterpart', () => {
  withFixture(
    { components: { schemas: { Widget: { properties: { id: {} } } } } },
    [
      'export const WidgetSchema = z.object({ id: z.string() });',
      'export const IsoDateSchema = z.string();',
    ].join('\n'),
    (result) => {
      assert.deepEqual(result.errors, []);
      assert.equal(result.comparedObjects, 1);
    },
  );
});

test('src/app/types/schemas.ts matches the checked-in OpenAPI snapshot', () => {
  const result = analyzeSchemaDrift();

  assert.ok(
    result.comparedObjects > 50,
    `expected the checker to compare the bulk of the hand-written mirrors, saw ${result.comparedObjects}`,
  );
  assert.ok(result.comparedEnums > 0, 'expected at least one enum to be compared');
  assert.deepEqual(
    result.errors,
    [],
    `src/app/types/schemas.ts has drifted from server/openapi.json:\n${result.errors.join('\n')}`,
  );
});
