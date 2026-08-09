'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCleanLayoutObserver } = require('../../src/clean-layout-observer');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('bounded Layout observation reads sibling evidence without changing the movie directory', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-layout-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const movie = path.join(root, '银翼杀手：2022黑暗浩劫 (2017)');
  fs.mkdirSync(movie);
  const files = new Map([
    ['feature - 1080p x264.mkv', Buffer.from('primary')],
    ['feature - 1080p x264.nfo', Buffer.from('<movie/>')],
    ['poster.jpg', Buffer.from('poster')],
    ['fanart.jpg', Buffer.from('fanart')],
  ]);
  for (const [name, bytes] of files) fs.writeFileSync(path.join(movie, name), bytes);
  const primary = path.join(movie, 'feature - 1080p x264.mkv');
  const primaryStat = fs.statSync(primary, { bigint: true });
  const primaryIdentity = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion: 2,
    materialKey: '', mountScopeId: 'mount-1', inode: String(primaryStat.ino), sizeBytes:Number(primaryStat.size),
    fingerprintAlgorithm: 'middle-256k-sha256', fingerprintVersion:1, contentFingerprint: sha256(files.get('feature - 1080p x264.mkv')),
  };
  primaryIdentity.materialKey = canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:primaryIdentity.mountScopeId,
    inode:primaryIdentity.inode, sizeBytes:primaryIdentity.sizeBytes, fingerprintAlgorithm:primaryIdentity.fingerprintAlgorithm,
    fingerprintVersion:primaryIdentity.fingerprintVersion, contentFingerprint:primaryIdentity.contentFingerprint });
  const handle = Object.freeze({
    identity: Object.freeze(primaryIdentity),
    bindingRevision: 1, endpointId: 'endpoint-1', location: primary,
  });
  const parameter = { parameter: 'scopeKind', valueType: 'string', value: 'parent_directory', valueDigest: '' };
  parameter.valueDigest = canonicalDigest({ parameter: parameter.parameter, valueType: parameter.valueType, value: parameter.value });
  const scope = {
    schemaRef: 'helix://contracts/domain-types/BoundedLayoutScope/v1', schemaVersion: 1,
    scopeId: 'scope-1', revision: 1, digest: '', rootHandleDigest: canonicalDigest(handle),
    maxDepth: 1, maxMembers: 256, typedParameters: [parameter],
  };
  scope.digest = canonicalDigest(Object.fromEntries(Object.entries(scope).filter(([key]) => key !== 'digest')));
  const before = [...files].map(([name]) => [name, fs.readFileSync(path.join(movie, name)), fs.statSync(path.join(movie, name)).mtimeMs]);

  const evidence = await createCleanLayoutObserver().observe(handle, scope);

  assert.equal(evidence.producerRef, 'shared.material.layout.observe@1');
  assert.equal(evidence.entries[0].entryKind, 'directory');
  assert.equal(evidence.entries[0].baseName, '银翼杀手：2022黑暗浩劫 (2017)');
  assert.deepEqual(evidence.entries.filter((item) => item.entryKind === 'file').map((item) => item.baseName), [...files.keys()].sort());
  for (const [name, bytes, mtimeMs] of before) {
    assert.deepEqual(fs.readFileSync(path.join(movie, name)), bytes);
    assert.equal(fs.statSync(path.join(movie, name)).mtimeMs, mtimeMs);
  }
});
