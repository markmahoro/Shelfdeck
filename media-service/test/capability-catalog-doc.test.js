'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');
const catalog = require('../src/capabilityCatalog');

test('historical Kairox Capability evidence still names every legacy Catalog entry', () => {
  const file = path.join(__dirname, '..', '..', 'docs', 'helix', 'KAIROX_CAPABILITY_CATALOG.md');
  const document = fs.readFileSync(file, 'utf8');
  const capabilities = catalog.list().map((entry) => entry.capability).filter((name) => name !== 'workflow.blocked');
  assert.strictEqual(capabilities.length, 62);
  for (const capability of capabilities) assert.ok(document.includes('`' + capability + '`'), capability);
});
