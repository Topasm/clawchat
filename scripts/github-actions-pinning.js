const fs = require('node:fs');
const path = require('node:path');
const { isAlias, isScalar, LineCounter, parseDocument, visit } = require('yaml');

const FULL_COMMIT_SHA = /^[a-f\d]{40}$/;
const APPROVED_CORE_ACTION_REVISIONS = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'], // v7.0.1, Node 24
  ['actions/setup-node', '820762786026740c76f36085b0efc47a31fe5020'], // v7.0.0, Node 24
  ['actions/setup-python', '5fda3b95a4ea91299a34e894583c3862153e4b97'], // v7.0.0, Node 24
]);

function inspectWorkflow(contents, filename = 'workflow.yml') {
  const violations = [];
  const lineCounter = new LineCounter();
  const document = parseDocument(contents, { lineCounter });

  if (document.errors.length > 0) {
    return document.errors.map((error) => ({
      filename,
      line: error.linePos?.[0]?.line ?? 1,
      reference: '<invalid YAML>',
      reason: error.message,
    }));
  }

  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || pair.key.value !== 'uses') return;

      const valueNode = isAlias(pair.value) ? pair.value.resolve(document) : pair.value;
      const reference = isScalar(valueNode) ? String(valueNode.value) : '';
      const line = lineCounter.linePos(pair.value?.range?.[0] ?? pair.key.range[0]).line;

      if (reference.startsWith('./') || reference.startsWith('docker://')) return;
      const separator = reference.lastIndexOf('@');
      const action = separator > 0 ? reference.slice(0, separator) : '';
      const revision = separator > 0 ? reference.slice(separator + 1) : '';
      if (action.split('/').length < 2 || !FULL_COMMIT_SHA.test(revision)) {
        violations.push({ filename, line, reference, reason: 'not pinned to a full SHA' });
        return;
      }
      const approvedRevision = APPROVED_CORE_ACTION_REVISIONS.get(action.toLowerCase());
      if (approvedRevision && revision !== approvedRevision) {
        violations.push({
          filename,
          line,
          reference,
          reason: 'core action is not pinned to the approved Node 24 revision',
        });
      }
    },
  });

  return violations;
}

function inspectWorkflowDirectory(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const filePath = path.join(directory, entry.name);
      return inspectWorkflow(fs.readFileSync(filePath, 'utf8'), filePath);
    });
}

module.exports = {
  APPROVED_CORE_ACTION_REVISIONS,
  FULL_COMMIT_SHA,
  inspectWorkflow,
  inspectWorkflowDirectory,
};
