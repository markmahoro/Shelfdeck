'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const replacement = require('../src/mediaReplacementService');
const { findNfoTmdbId } = require('../src/capabilities/mediaAssetCapabilities');

test('generic media identity inspection reads strong TMDB evidence from staged NFO', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-identity-'));
  try {
    fs.mkdirSync(path.join(root, 'nested'));
    fs.writeFileSync(path.join(root, 'nested', 'movie.nfo'), '<movie><tmdbid>12345</tmdbid></movie>');
    assert.strictEqual(findNfoTmdbId(root), '12345');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generic media.replace supports folder scope with rollback-safe commit and idempotent recovery', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-folder-replace-'));
  const target = path.join(root, 'target'); const staged = path.join(root, 'staged');
  try {
    fs.mkdirSync(target); fs.mkdirSync(staged);
    fs.writeFileSync(path.join(target, 'old.mkv'), 'old'); fs.writeFileSync(path.join(staged, 'new.mkv'), 'new'); fs.writeFileSync(path.join(staged, 'movie.nfo'), '<tmdbid>1</tmdbid>');
    const result = await replacement.replaceFolder({ stagedFolder: staged, targetFolder: target, operationId: 'event-1' });
    assert.strictEqual(result.committed, true);
    assert.strictEqual(fs.readFileSync(path.join(target, 'new.mkv'), 'utf8'), 'new');
    assert.strictEqual(fs.existsSync(path.join(target, 'old.mkv')), false);
    const recovered = await replacement.replaceFolder({ stagedFolder: staged, targetFolder: target, operationId: 'event-1' });
    assert.strictEqual(recovered.recoveredCommitted, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
