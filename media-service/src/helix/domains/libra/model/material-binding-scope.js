'use strict';
const path = require('node:path');

function bindingScopePredicate({ endpointId, directory }) {
  if (typeof endpointId !== 'string' || !endpointId || typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('Exact binding scope required.');
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const root = normalize(directory);
  return row => row.health_state !== 'released' && (normalize(row.location) === root || normalize(row.location).startsWith(root + path.sep));
}
module.exports = Object.freeze({ bindingScopePredicate });
