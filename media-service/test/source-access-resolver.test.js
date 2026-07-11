'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const resolver = require('../src/sourceAccessResolver');

test.afterEach(() => {
  delete process.env.SHELFDECK_SOURCE_ACCESS_MAP_FILE;
  resolver.resetForTests();
});

test('Source Access Resolver maps the longest directory prefix and keeps mapping internal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-source-map-'));
  const film = path.join(root, 'Film');
  fs.mkdirSync(path.join(film, 'Movie'), { recursive: true });
  const mapFile = path.join(root, 'map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ version: 1, mappings: [
    { sourcePrefix: '/volume1/Media', accessPrefix: root },
    { sourcePrefix: '/volume1/Media/Film', accessPrefix: film },
  ] }));
  process.env.SHELFDECK_SOURCE_ACCESS_MAP_FILE = mapFile;
  resolver.resetForTests();
  const result = resolver.resolve('/volume1/Media/Film/Movie', { mustExist: true });
  assert.strictEqual(result.accessPath, path.join(film, 'Movie'));
  assert.strictEqual(result.matched, true);
  assert.notStrictEqual(result.revision, 'identity');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Source Access Resolver fences Tasks when mapping revision changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-source-fence-'));
  const mapFile = path.join(root, 'map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ version: 1, mappings: [{ sourcePrefix: '/source', accessPrefix: root }] }));
  process.env.SHELFDECK_SOURCE_ACCESS_MAP_FILE = mapFile;
  resolver.resetForTests();
  const task = { id: 'mapped-task', sourceAccessMappingRevision: resolver.getRevision() };
  fs.writeFileSync(mapFile, JSON.stringify({ version: 1, mappings: [{ sourcePrefix: '/changed', accessPrefix: root }] }));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(mapFile, future, future);
  assert.throws(() => resolver.assertTaskRevision(task), (error) => error.code === 'SOURCE_ACCESS_MAPPING_STALE');
  fs.rmSync(root, { recursive: true, force: true });
});

test('Source Access Resolver rejects traversal and inaccessible resolved paths', () => {
  assert.throws(() => resolver.resolve('/source/../escape'), (error) => error.code === 'SOURCE_ACCESS_PATH_ESCAPE');
  assert.throws(() => resolver.resolve(path.join(os.tmpdir(), 'missing-shelfdeck-source'), { mustExist: true }), (error) => error.code === 'SOURCE_ACCESS_PATH_UNRESOLVED');
});
