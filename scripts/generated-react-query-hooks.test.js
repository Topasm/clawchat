'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(repositoryRoot, 'src', 'app', 'generated');
const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

const criticalOperations = new Map([
  ['health_api_health_get', 'get'],
  ['login_api_auth_login_post', 'post'],
  ['apply_plan_api_todos__todo_id__plan_apply_post', 'post'],
  ['generate_graph_plan_api_todos__todo_id__plan_generate_post', 'post'],
  ['revert_change_set_api_change_sets__change_set_id__revert_post', 'post'],
]);

function readGeneratedSource(directory = generatedRoot) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return readGeneratedSource(filename);
      return entry.isFile() && entry.name.endsWith('.ts')
        ? [fs.readFileSync(filename, 'utf8')]
        : [];
    })
    .join('\n');
}

function readOpenApiOperations() {
  const document = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, 'server', 'openapi.json'), 'utf8'),
  );
  const operations = [];

  for (const [route, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!httpMethods.has(method)) continue;
      assert.equal(typeof operation?.operationId, 'string', `${method} ${route} lacks operationId`);
      operations.push({ method, operationId: operation.operationId, route });
    }
  }

  assert.ok(operations.length, 'OpenAPI document contains no HTTP operations');
  return operations;
}

function generatedOperationName(operationId) {
  assert.match(operationId, /^[a-z0-9_]+$/, `unsupported operationId format: ${operationId}`);
  const [first, ...rest] = operationId.split(/_+/);
  return first + rest.map((part) => part[0].toUpperCase() + part.slice(1)).join('');
}

function exportCount(source, identifier) {
  return source.match(new RegExp(`\\bexport\\s+const\\s+${identifier}\\s*=`, 'g'))?.length ?? 0;
}

function assertGeneratedHookKind(source, operation) {
  const operationName = generatedOperationName(operation.operationId);
  const typeName = operationName[0].toUpperCase() + operationName.slice(1);
  const expectedKind = operation.method === 'get' ? 'Query' : 'Mutation';
  const unexpectedKind = expectedKind === 'Query' ? 'Mutation' : 'Query';
  const location = `${operation.method.toUpperCase()} ${operation.route} (${operation.operationId})`;

  assert.equal(
    exportCount(source, operationName),
    1,
    `${location} must have exactly one generated request function`,
  );
  assert.equal(
    exportCount(source, `get${typeName}${expectedKind}Options`),
    1,
    `${location} must generate ${expectedKind}Options`,
  );
  assert.equal(
    exportCount(source, `get${typeName}${unexpectedKind}Options`),
    0,
    `${location} must not generate ${unexpectedKind}Options`,
  );
}

test('maps every OpenAPI GET to a query and every non-GET to a mutation', () => {
  const source = readGeneratedSource();
  for (const operation of readOpenApiOperations()) assertGeneratedHookKind(source, operation);
});

test('pins health and revision-sensitive mutation hook classifications', () => {
  const source = readGeneratedSource();
  const operations = new Map(
    readOpenApiOperations().map((operation) => [operation.operationId, operation]),
  );

  for (const [operationId, method] of criticalOperations) {
    const operation = operations.get(operationId);
    assert.ok(operation, `critical OpenAPI operation is missing: ${operationId}`);
    assert.equal(operation.method, method, `${operationId} changed HTTP method`);
    assertGeneratedHookKind(source, operation);
  }
});
