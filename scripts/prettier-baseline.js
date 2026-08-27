'use strict';

function compareFormattingDebt(currentDebt, baselineFiles) {
  const violations = [];

  for (const [filename, hash] of Object.entries(currentDebt)) {
    if (baselineFiles[filename] !== hash) {
      violations.push(`${filename}: formatting differs from baseline`);
    }
  }

  for (const filename of Object.keys(baselineFiles)) {
    if (!(filename in currentDebt)) {
      violations.push(`${filename}: remove stale formatting baseline entry`);
    }
  }

  return violations;
}

module.exports = { compareFormattingDebt };
