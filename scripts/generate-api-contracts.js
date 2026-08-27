#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const defaultSpecPath = path.join(repositoryRoot, 'server', 'openapi.json');
const generatedFiles = {
  taskStatusTypescript: path.join(
    repositoryRoot,
    'src',
    'app',
    'generated',
    'contracts',
    'taskStatus.ts',
  ),
  taskStatusKotlin: path.join(
    repositoryRoot,
    'android',
    'core',
    'src',
    'main',
    'java',
    'com',
    'clawchat',
    'android',
    'core',
    'data',
    'model',
    'TaskStatus.kt',
  ),
  taskRelationshipTypeTypescript: path.join(
    repositoryRoot,
    'src',
    'app',
    'generated',
    'contracts',
    'taskRelationshipType.ts',
  ),
  taskRelationshipTypeKotlin: path.join(
    repositoryRoot,
    'android',
    'core',
    'src',
    'main',
    'java',
    'com',
    'clawchat',
    'android',
    'core',
    'data',
    'model',
    'TaskRelationshipType.kt',
  ),
};

function enumValuesFromOpenApi(document, schemaName) {
  const values = document?.components?.schemas?.[schemaName]?.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`OpenAPI components.schemas.${schemaName}.enum is missing or empty`);
  }
  if (values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${schemaName} enum values must be non-empty strings`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${schemaName} enum contains duplicate values`);
  }
  return values;
}

function taskStatusesFromOpenApi(document) {
  return enumValuesFromOpenApi(document, 'TaskStatus');
}

function taskRelationshipTypesFromOpenApi(document) {
  return enumValuesFromOpenApi(document, 'TaskRelationshipType');
}

function kotlinConstant(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`API enum value cannot be represented safely in Kotlin: ${value}`);
  }
  return value.toUpperCase();
}

function renderTypeScript(statuses) {
  const values = statuses.map((status) => `'${status}'`).join(', ');
  return `// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.\n\nexport const TASK_STATUSES = [${values}] as const;\n\nexport type TaskStatus = (typeof TASK_STATUSES)[number];\n`;
}

function renderTaskRelationshipTypeScript(relationshipTypes) {
  const values = relationshipTypes.map((type) => `'${type}'`).join(', ');
  return `// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.\n\nexport const TASK_RELATIONSHIP_TYPES = [${values}] as const;\n\nexport type TaskRelationshipType = (typeof TASK_RELATIONSHIP_TYPES)[number];\n`;
}

function renderKotlin(statuses) {
  const constants = statuses
    .map(
      (status) =>
        `    @SerialName(${JSON.stringify(status)})\n    ${kotlinConstant(status)}(${JSON.stringify(status)}),`,
    )
    .join('\n\n');
  return `// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.\npackage com.clawchat.android.core.data.model\n\nimport kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\n\n/** Canonical task lifecycle shared with the ClawChat API. */\n@Serializable\nenum class TaskStatus(val wireValue: String) {\n${constants}\n    ;\n\n    companion object {\n        fun fromWireValue(value: String): TaskStatus =\n            entries.firstOrNull { it.wireValue == value }\n                ?: throw IllegalArgumentException(${JSON.stringify('Unsupported task status: $value')})\n    }\n}\n`;
}

function renderTaskRelationshipKotlin(relationshipTypes) {
  const constants = relationshipTypes
    .map(
      (type) =>
        `    @SerialName(${JSON.stringify(type)})\n    ${kotlinConstant(type)}(${JSON.stringify(type)}),`,
    )
    .join('\n\n');
  return `// Generated from server/openapi.json by scripts/generate-api-contracts.js. Do not edit.\npackage com.clawchat.android.core.data.model\n\nimport kotlinx.serialization.SerialName\nimport kotlinx.serialization.Serializable\n\n/** Canonical task relationship type shared with the ClawChat API. */\n@Serializable\nenum class TaskRelationshipType(val wireValue: String) {\n${constants}\n    ;\n\n    companion object {\n        fun fromWireValue(value: String): TaskRelationshipType =\n            entries.firstOrNull { it.wireValue == value }\n                ?: throw IllegalArgumentException(${JSON.stringify('Unsupported task relationship type: $value')})\n    }\n}\n`;
}

function expectedContracts(specPath = defaultSpecPath) {
  const document = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const statuses = taskStatusesFromOpenApi(document);
  const relationshipTypes = taskRelationshipTypesFromOpenApi(document);
  return {
    statuses,
    relationshipTypes,
    outputs: {
      [generatedFiles.taskStatusTypescript]: renderTypeScript(statuses),
      [generatedFiles.taskStatusKotlin]: renderKotlin(statuses),
      [generatedFiles.taskRelationshipTypeTypescript]:
        renderTaskRelationshipTypeScript(relationshipTypes),
      [generatedFiles.taskRelationshipTypeKotlin]: renderTaskRelationshipKotlin(relationshipTypes),
    },
  };
}

function generateContracts({ check = false, specPath = defaultSpecPath } = {}) {
  const { statuses, relationshipTypes, outputs } = expectedContracts(specPath);
  const stale = [];

  for (const [filename, contents] of Object.entries(outputs)) {
    const current = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
    if (current === contents) continue;
    if (check) {
      stale.push(path.relative(repositoryRoot, filename));
      continue;
    }
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, contents);
  }

  if (check && stale.length > 0) {
    throw new Error(
      `Generated API contracts are stale:\n${stale.map((file) => `  - ${file}`).join('\n')}\nRun \`npm run generate:api\`.`,
    );
  }
  return {
    statuses,
    relationshipTypes,
    files: Object.keys(outputs).map((file) => path.relative(repositoryRoot, file)),
  };
}

function parseArguments(argv) {
  const unknown = argv.filter((argument) => argument !== '--check');
  if (unknown.length > 0) {
    throw new Error(`Unknown argument(s): ${unknown.join(', ')}`);
  }
  return { check: argv.includes('--check') };
}

if (require.main === module) {
  try {
    const result = generateContracts(parseArguments(process.argv.slice(2)));
    console.log(
      `API enums (TaskStatus: ${result.statuses.join(', ')}; TaskRelationshipType: ${result.relationshipTypes.join(', ')}) ${process.argv.includes('--check') ? 'are current' : 'generated'} for TypeScript and Kotlin.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  expectedContracts,
  generateContracts,
  kotlinConstant,
  renderKotlin,
  renderTaskRelationshipKotlin,
  renderTaskRelationshipTypeScript,
  renderTypeScript,
  taskRelationshipTypesFromOpenApi,
  taskStatusesFromOpenApi,
};
