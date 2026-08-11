'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { validateSsotSourceMap } = require('../../scripts/helix-architecture/ssot-source-map-validator');

const repositoryRoot = path.resolve(__dirname, '../../..');
const actualMapPath = path.resolve(__dirname, '../../src/helix/contracts/manifests/ssot-source-map.json');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-ssot-map-'));
  const docsDirectory = path.join(root, 'docs', 'helix');
  const mapDirectory = path.join(root, 'manifests');
  fs.mkdirSync(docsDirectory, { recursive: true });
  fs.mkdirSync(mapDirectory, { recursive: true });
  fs.copyFileSync(
    process.env.HELIX_SSOT_PATH || path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md'),
    path.join(docsDirectory, 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md')
  );
  fs.copyFileSync(actualMapPath, path.join(mapDirectory, 'ssot-source-map.json'));
  fs.cpSync(path.join(path.dirname(actualMapPath), 'ssot-source-map'), path.join(mapDirectory, 'ssot-source-map'), { recursive: true });
  return { root, mapPath: path.join(mapDirectory, 'ssot-source-map.json') };
}

function mutateJson(filePath, mutate) {
  const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  mutate(value);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function codes(result) {
  return new Set(result.findings.map((item) => item.code));
}

test('committed source map exactly matches live SSOT extraction', () => {
  const result = validateSsotSourceMap({ repositoryRoot, mapPath: actualMapPath });
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { capabilities: 112, resultFamilies: 98, tables: 180, transactions: 43 });
  assert.equal(result.shardCount, 22);
});

test('fails closed when a mapped item drifts', () => {
  const fixture = createFixture();
  try {
    const shardPath = path.join(path.dirname(fixture.mapPath), 'ssot-source-map', 'capabilities-001-056.json');
    mutateJson(shardPath, (shard) => { shard.entries[0].effectClass = 'workspace_write'; });
    const result = validateSsotSourceMap({ repositoryRoot: fixture.root, mapPath: fixture.mapPath });
    assert.ok(codes(result).has('SOURCE_MAP_CATEGORY_DRIFT'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails closed for duplicate, escaping, or unresolved shard paths', () => {
  for (const replacement of [
    (map) => map.entryFiles.push(map.entryFiles[0]),
    (map) => { map.entryFiles[0] = '../escape.json'; },
    (map) => { map.entryFiles[0] = 'ssot-source-map/missing.json'; }
  ]) {
    const fixture = createFixture();
    try {
      mutateJson(fixture.mapPath, replacement);
      const result = validateSsotSourceMap({ repositoryRoot: fixture.root, mapPath: fixture.mapPath });
      assert.equal(result.ok, false);
      assert.ok([...codes(result)].some((code) =>
        code === 'INVALID_SOURCE_MAP_SHARD_PATH' || code === 'INVALID_SOURCE_MAP_JSON' || code === 'SOURCE_MAP_ORDINAL_GAP'
      ));
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test('fails closed when the SSOT document drifts from the frozen map', () => {
  const fixture = createFixture();
  try {
    const sourcePath = path.join(fixture.root, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
    fs.appendFileSync(sourcePath, '\n');
    const result = validateSsotSourceMap({ repositoryRoot: fixture.root, mapPath: fixture.mapPath });
    assert.ok(codes(result).has('SOURCE_MAP_DIGEST_DRIFT'));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
