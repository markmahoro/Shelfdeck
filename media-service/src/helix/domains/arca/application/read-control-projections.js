'use strict';

// These are preparation snapshots; the committing Authority still checks every
// expected revision atomically. Multiple reads do not constitute a commit.
function readControlProjections(port, materialKeys) {
  const keys = [...new Set(materialKeys)].sort();
  const projections = [];
  for (let offset = 0; offset < keys.length; offset += 500) {
    projections.push(...port.getMaterialControlProjections(keys.slice(offset, offset + 500)));
  }
  return Object.freeze(projections);
}

module.exports = { readControlProjections };
