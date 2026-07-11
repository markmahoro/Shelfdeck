'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-user-perception-facts-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const kairoxStore = require('../src/kairoxStore');

test.after(() => {
  kairoxStore.resetForTests();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('identical user perception facts do not increase fact revision', () => {
  const first = kairoxStore.updateUserPerception({
    subjectId: 'perception-item',
    facts: { doubanRating: 5, watched: true },
    evidence: { source: 'douban', snapshot: 'one' },
  });
  const unchanged = kairoxStore.updateUserPerception({
    subjectId: 'perception-item',
    facts: { doubanRating: 5, watched: true },
    evidence: { source: 'douban', snapshot: 'two' },
  });
  const changed = kairoxStore.updateUserPerception({
    subjectId: 'perception-item',
    facts: { doubanRating: 4, watched: true },
    evidence: { source: 'douban', snapshot: 'three' },
  });
  assert.strictEqual(first.factRevision, 1);
  assert.strictEqual(unchanged.factRevision, 1);
  assert.strictEqual(changed.factRevision, 2);
});
