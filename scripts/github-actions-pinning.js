const fs = require('node:fs');
const path = require('node:path');

const FULL_COMMIT_SHA = /^[a-f\d]{40}$/;

function inspectWorkflow(contents, filename = 'workflow.yml') {
  const violations = [];
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/);
    if (!match) continue;
    const reference = match[1].replace(/^['"]|['"]$/g, '');
    if (reference.startsWith('./') || reference.startsWith('docker://')) continue;
    const separator = reference.lastIndexOf('@');
    const action = separator > 0 ? reference.slice(0, separator) : '';
    const revision = separator > 0 ? reference.slice(separator + 1) : '';
    if (action.split('/').length < 2 || !FULL_COMMIT_SHA.test(revision)) {
      violations.push({ filename, line: index + 1, reference });
    }
  }
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
  FULL_COMMIT_SHA,
  inspectWorkflow,
  inspectWorkflowDirectory,
};
