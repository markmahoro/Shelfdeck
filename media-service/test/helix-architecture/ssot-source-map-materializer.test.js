'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { materializeSsotSourceMap } = require('../../scripts/helix-architecture/ssot-source-map-materializer');
const { validateSsotSourceMap } = require('../../scripts/helix-architecture/ssot-source-map-validator');

const repositoryRoot = path.resolve(__dirname, '../../..');
const sourcePath = process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');

test('SSOT source map materializer emits deterministic complete shards accepted by validator', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-source-map-'));
  const docsRoot = path.join(root, 'docs', 'helix');
  const manifestRoot = path.join(root, 'media-service', 'src', 'helix', 'contracts', 'manifests');
  fs.mkdirSync(docsRoot, { recursive: true });
  fs.copyFileSync(sourcePath, path.join(docsRoot, 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'));
  try {
    const first = materializeSsotSourceMap({ sourcePath: path.join(docsRoot, 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
      sourceRelativePath: 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md', outputRoot: path.join(manifestRoot, 'ssot-source-map') });
    const snapshot = fs.readdirSync(path.join(manifestRoot, 'ssot-source-map')).sort().map((name) =>
      fs.readFileSync(path.join(manifestRoot, 'ssot-source-map', name), 'utf8'));
    const second = materializeSsotSourceMap({ sourcePath: path.join(docsRoot, 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
      sourceRelativePath: 'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md', outputRoot: path.join(manifestRoot, 'ssot-source-map') });
    assert.deepEqual(first.manifest.counts, { capabilities: 111, resultFamilies: 97, tables: 180, transactions: 43 });
    assert.equal(first.manifest.aggregateDigest, second.manifest.aggregateDigest);
    assert.deepEqual(snapshot, fs.readdirSync(path.join(manifestRoot, 'ssot-source-map')).sort().map((name) =>
      fs.readFileSync(path.join(manifestRoot, 'ssot-source-map', name), 'utf8')));
    assert.equal(validateSsotSourceMap({ repositoryRoot: root, mapPath: path.join(manifestRoot, 'ssot-source-map.json') }).ok, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
