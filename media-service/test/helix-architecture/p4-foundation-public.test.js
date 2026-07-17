'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const foundationPublic = require('../../src/helix/foundation/public');

const expectedPorts = [
  'ArtifactQueryPort', 'CanonicalQueryRegistryPort', 'CommandReceiptPort', 'DomainCommitRegistryPort', 'FoundationHealthPort',
  'MaterialControlPort', 'WorkQueryPort', 'WorkSubmissionPort'
];

test('Foundation public package preserves the seven P4 ports and adds the P5 Artifact query port', () => {
  assert.deepEqual(Object.keys(foundationPublic).sort(), expectedPorts);
  const submission = foundationPublic.WorkSubmissionPort({ submit: (definition) => definition.workId });
  assert.equal(submission.submit({ workId: 'work-1' }), 'work-1');
  assert.deepEqual(Object.keys(submission), ['submit']);
  assert.equal(Object.isFrozen(submission), true);
});

test('Foundation public ports reject missing, extra, Repository, SQLite, Executor, and generic dispatch methods', () => {
  assert.throws(() => foundationPublic.WorkSubmissionPort({}), (error) => error.code === 'P4_PUBLIC_PORT_SHAPE_MISMATCH');
  for (const extra of ['repository', 'sqlite', 'executor', 'dispatch']) {
    assert.throws(() => foundationPublic.WorkSubmissionPort({ submit() {}, [extra]() {} }),
      (error) => error.code === 'P4_PUBLIC_PORT_SHAPE_MISMATCH', extra);
  }
});

test('Foundation public source has no persistence, executor instance, generic dispatch, or legacy dependency', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/public/index.js'), 'utf8');
  for (const fragments of [['foundation', '/persistence'], ['better-', 'sqlite3'], ['kair', 'ox'], ['dispatch', '(capability']]) {
    assert.equal(source.toLowerCase().includes(fragments.join('').toLowerCase()), false, fragments.join(''));
  }
});
