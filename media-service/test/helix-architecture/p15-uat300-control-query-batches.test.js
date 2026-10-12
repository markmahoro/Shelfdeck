'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createMaterialControlProjectionPort } = require('../../src/helix/foundation/persistence/material-control');
const { readControlProjections } = require('../../src/helix/domains/arca/persistence/read-control-projections');
const { fixture } = require('./helpers/acceptance-evidence-fixture');

test('Arca assembles complete large Control snapshots through bounded public queries', () => {
  const native = fixture('arca.ondeck.commit@1');
  try {
    const port = createMaterialControlProjectionPort(native.options);
    const keys = Array.from({ length:1024 }, (_, index) => canonicalDigest({ index })).sort();
    assert.throws(() => port.getMaterialControlProjections(keys), { code:'P3_CONTROL_QUERY_KEYS_INVALID' });
    const batches = [];
    const projections = readControlProjections({ getMaterialControlProjections(batch) {
      batches.push(batch.length);
      return port.getMaterialControlProjections(batch);
    } }, [...keys].reverse().concat(keys[0]));
    assert.deepEqual(batches, [500, 500, 24]);
    assert.deepEqual(projections.map(item => item.materialKey), keys);
    assert.ok(projections.every(item => item.resultKind === 'available'));
    assert.deepEqual(readControlProjections(port, []), []);
    assert.throws(() => readControlProjections(port, ['invalid']), { code:'P3_CONTROL_QUERY_KEYS_INVALID' });
  } finally { native.close(); }
});
