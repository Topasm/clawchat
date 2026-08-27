const assert = require('node:assert/strict');
const test = require('node:test');

const {
  kotlinConstant,
  renderKotlin,
  renderTaskRelationshipKotlin,
  renderTaskRelationshipTypeScript,
  renderTypeScript,
  taskRelationshipTypesFromOpenApi,
  taskStatusesFromOpenApi,
} = require('./generate-api-contracts');

const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'];
const RELATIONSHIP_TYPES = ['depends_on', 'related', 'duplicate'];

test('reads the canonical TaskStatus enum from OpenAPI', () => {
  const document = { components: { schemas: { TaskStatus: { enum: STATUSES } } } };
  assert.deepEqual(taskStatusesFromOpenApi(document), STATUSES);
});

test('reads the canonical TaskRelationshipType enum from OpenAPI', () => {
  const document = {
    components: { schemas: { TaskRelationshipType: { enum: RELATIONSHIP_TYPES } } },
  };
  assert.deepEqual(taskRelationshipTypesFromOpenApi(document), RELATIONSHIP_TYPES);
});

test('renders TypeScript and Kotlin contracts with identical wire values', () => {
  const typescript = renderTypeScript(STATUSES);
  const kotlin = renderKotlin(STATUSES);

  assert.match(
    typescript,
    /TASK_STATUSES = \['pending', 'in_progress', 'completed', 'cancelled'\] as const/,
  );

  for (const status of STATUSES) {
    assert.match(typescript, new RegExp(`['"]${status}['"]`));
    assert.match(kotlin, new RegExp(`@SerialName\\(['"]${status}['"]\\)`));
    assert.match(kotlin, new RegExp(`${kotlinConstant(status)}\\(['"]${status}['"]\\)`));
  }
});

test('renders TypeScript and Kotlin task relationship contracts with identical wire values', () => {
  const typescript = renderTaskRelationshipTypeScript(RELATIONSHIP_TYPES);
  const kotlin = renderTaskRelationshipKotlin(RELATIONSHIP_TYPES);

  assert.match(
    typescript,
    /TASK_RELATIONSHIP_TYPES = \['depends_on', 'related', 'duplicate'\] as const/,
  );

  for (const relationshipType of RELATIONSHIP_TYPES) {
    assert.match(typescript, new RegExp(`['"]${relationshipType}['"]`));
    assert.match(kotlin, new RegExp(`@SerialName\\(['"]${relationshipType}['"]\\)`));
    assert.match(
      kotlin,
      new RegExp(`${kotlinConstant(relationshipType)}\\(['"]${relationshipType}['"]\\)`),
    );
  }
});

test('fails closed for missing, duplicate, or unsafe enum values', () => {
  assert.throws(() => taskStatusesFromOpenApi({}), /missing or empty/);
  assert.throws(
    () =>
      taskStatusesFromOpenApi({
        components: { schemas: { TaskStatus: { enum: ['pending', 'pending'] } } },
      }),
    /duplicate/,
  );
  assert.throws(() => kotlinConstant('In Progress'), /cannot be represented safely/);
  assert.throws(() => taskRelationshipTypesFromOpenApi({}), /missing or empty/);
});
