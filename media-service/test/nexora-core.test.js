'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-nexora-'));
const previousDataDir = process.env.CONTROL_PLANE_DATA_DIR;
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const embyService = require('../src/services/embyService');
const libraryStore = require('../src/libraryStore');
const nexoraStore = require('../src/nexoraStore');
const mediaLibraryService = require('../src/mediaLibraryService');
const adultLibraryService = require('../src/adultLibraryService');
const nexoraService = require('../src/nexoraService');
const { getHelixServices } = require('../src/libraCompositionRoot');

test.after(() => {
  if (previousDataDir === undefined) delete process.env.CONTROL_PLANE_DATA_DIR;
  else process.env.CONTROL_PLANE_DATA_DIR = previousDataDir;
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // better-sqlite3 may keep a Windows handle until process exit.
  }
});

function writeConfig(config) {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
}

function embyConfig() {
  return {
    embyServers: { srv: { baseUrl: 'http://emby.test', apiKey: 'key', userId: 'user' } },
    subLibraries: [{ uuid: 'nexora-emby-lib', name: 'Nexora Emby', source: 'emby', embyServerId: 'srv', sectionId: 'sec', enabled: true }],
  };
}

function fakeEmbyItem(sourceId, patch = {}) {
  return {
    sourceId,
    itemId: sourceId,
    name: `Nexora ${sourceId}`,
    type: 'movie',
    path: `/media/${sourceId}.mkv`,
    size: 123456,
    isDiscLike: false,
    ...patch,
  };
}

test('sourceId is a stable adapter-scoped identity built from stable payload', () => {
  const a = nexoraService.embyIdentity({
    subLib: { embyServerId: 'srv', sectionId: 'sec' },
    sourceRefId: 'emby-item-1',
  });
  const b = nexoraService.embyIdentity({
    subLib: { sectionId: 'sec', embyServerId: 'srv' },
    sourceRefId: 'emby-item-1',
  });
  const c = nexoraService.embyIdentity({
    subLib: { embyServerId: 'srv', sectionId: 'sec' },
    sourceRefId: 'emby-item-2',
  });

  assert.strictEqual(a.sourceId, b.sourceId);
  assert.notStrictEqual(a.sourceId, c.sourceId);
  assert.match(a.sourceId, /^srv:emby_item:[a-f0-9]{40}$/);
});

test('source binding has bindingId primary key and mediaItemId/sourceId unique identity', () => {
  const first = nexoraStore.upsertSourceBinding({
    mediaItemId: 'binding-item-1',
    sourceId: 'test-source-1',
    validity: 'valid',
    reason: 'accepted_source',
    observedAt: '2026-07-09T00:00:00.000Z',
  });
  const second = nexoraStore.upsertSourceBinding({
    mediaItemId: 'binding-item-1',
    sourceId: 'test-source-1',
    validity: 'invalid',
    reason: 'source_missing',
    observedAt: '2026-07-09T00:01:00.000Z',
  });

  assert.ok(first.bindingId);
  assert.strictEqual(second.bindingId, first.bindingId);
  assert.strictEqual(second.validity, 'invalid');
  assert.strictEqual(second.reason, 'source_missing');
});

test('Emby onboarding writes Libra Membership and revisioned valid/invalid/recovered SourceBinding', async () => {
  writeConfig(embyConfig());
  const originalGetItemById = embyService.getItemById;
  const originalGetSeasonEpisodes = embyService.getSeasonEpisodes;
  embyService.getSeasonEpisodes = async () => [];

  try {
    embyService.getItemById = async () => fakeEmbyItem('emby-nexora-1');
    const created = await mediaLibraryService.commitEmbySourceCandidate({
      itemId: 'ingest:nexora-emby-lib:emby-nexora-1',
      subLibraryId: 'nexora-emby-lib',
      source: 'emby',
      sourceId: 'emby-nexora-1',
      embyItemId: 'emby-nexora-1',
      sourceObservationKind: 'new_source_observed',
    }, { now: '2026-07-09T01:00:00.000Z' });

    let facts = nexoraService.factsForItemId(created.item.itemId);
    assert.strictEqual(facts.sourceBindings.length, 1);
    assert.strictEqual(facts.sourceBindings[0].validity, 'valid');
    assert.strictEqual(facts.sourceBindings[0].reason, 'accepted_source');
    assert.strictEqual(facts.sourceProjection.readiness, 'ready');
    assert.strictEqual(facts.sourceProjection.sourceRevision, 1);
    assert.strictEqual(getHelixServices().libraService.getLibraryProjection(created.item.itemId).membership.status, 'active');

    const bindingId = facts.sourceBindings[0].bindingId;
    embyService.getItemById = async () => {
      throw new Error('Emby request failed (404): Not Found');
    };
    await mediaLibraryService.commitEmbySourceCandidate({
      itemId: created.item.itemId,
      subLibraryId: 'nexora-emby-lib',
      source: 'emby',
      sourceId: 'emby-nexora-1',
      sourceObservationKind: 'source_missing',
    }, { now: '2026-07-09T01:01:00.000Z' });

    facts = nexoraService.factsForItemId(created.item.itemId);
    assert.strictEqual(facts.sourceBindings[0].bindingId, bindingId);
    assert.strictEqual(facts.sourceBindings[0].validity, 'invalid');
    assert.strictEqual(facts.sourceBindings[0].reason, 'source_missing');
    assert.strictEqual(facts.sourceProjection.readiness, 'missing');
    assert.strictEqual(facts.sourceProjection.sourceRevision, 2);

    embyService.getItemById = async () => fakeEmbyItem('emby-nexora-1');
    await mediaLibraryService.commitEmbySourceCandidate({
      itemId: created.item.itemId,
      subLibraryId: 'nexora-emby-lib',
      source: 'emby',
      sourceId: 'emby-nexora-1',
    }, { now: '2026-07-09T01:02:00.000Z' });

    facts = nexoraService.factsForItemId(created.item.itemId);
    assert.strictEqual(facts.sourceBindings[0].bindingId, bindingId);
    assert.strictEqual(facts.sourceBindings[0].validity, 'valid');
    assert.strictEqual(facts.sourceBindings[0].reason, 'recovered');
    assert.strictEqual(facts.sourceProjection.readiness, 'ready');
    assert.strictEqual(facts.sourceProjection.sourceRevision, 3);

    const detail = mediaLibraryService.getLibraryItem(created.item.itemId);
    assert.strictEqual(detail.nexora.readiness, 'ready');
    assert.strictEqual(detail.nexora.sourceRevision, 3);
  } finally {
    embyService.getItemById = originalGetItemById;
    embyService.getSeasonEpisodes = originalGetSeasonEpisodes;
  }
});

test('Emby rebind invalidates old binding and validates new binding', async () => {
  writeConfig(embyConfig());
  const originalGetItemById = embyService.getItemById;
  const originalGetSeasonEpisodes = embyService.getSeasonEpisodes;
  embyService.getSeasonEpisodes = async () => [];

  try {
    embyService.getItemById = async () => fakeEmbyItem('emby-rebind-old', { path: '/media/rebind-old.mkv' });
    const created = await mediaLibraryService.commitEmbySourceCandidate({
      itemId: 'ingest:nexora-emby-lib:emby-rebind-old',
      subLibraryId: 'nexora-emby-lib',
      source: 'emby',
      sourceId: 'emby-rebind-old',
    }, { now: '2026-07-09T02:00:00.000Z' });

    embyService.getItemById = async () => fakeEmbyItem('emby-rebind-new', { path: '/media/rebind-new.mkv' });
    await mediaLibraryService.commitEmbySourceCandidate({
      itemId: created.item.itemId,
      subLibraryId: 'nexora-emby-lib',
      source: 'emby',
      sourceId: 'emby-rebind-new',
    }, { now: '2026-07-09T02:01:00.000Z' });

    const facts = nexoraService.factsForItemId(created.item.itemId);
    assert.strictEqual(facts.sourceBindings.length, 2);
    assert.strictEqual(facts.sourceBindings.filter((binding) => binding.validity === 'valid').length, 1);
    assert.strictEqual(facts.sourceBindings.filter((binding) => binding.validity === 'invalid').length, 1);
    assert.ok(facts.sourceBindings.find((binding) => binding.reason === 'identity_mismatch'));
    assert.strictEqual(facts.sourceProjection.readiness, 'ready');
  } finally {
    embyService.getItemById = originalGetItemById;
    embyService.getSeasonEpisodes = originalGetSeasonEpisodes;
  }
});

test('adult folder source observation writes valid, missing, and recovered binding', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexora-adult-root-'));
  const filePath = path.join(root, 'ABCD-001.mp4');
  fs.writeFileSync(filePath, 'sample');
  const subLib = {
    uuid: 'nexora-adult-lib',
    name: 'Nexora Adult',
    source: 'folder',
    mediaType: 'adult',
    adultRegion: 'japanese_jav',
    watchRoot: root,
    enabled: true,
  };

  const created = adultLibraryService.commitAdultFolderSourceReference(subLib, { path: filePath }, {
    now: '2026-07-09T03:00:00.000Z',
  });
  let facts = nexoraService.factsForItemId(created.item.itemId);
  assert.strictEqual(facts.sourceBindings[0].validity, 'valid');
  assert.strictEqual(facts.sourceBindings[0].reason, 'accepted_source');
  assert.strictEqual(facts.sourceProjection.readiness, 'ready');

  const bindingId = facts.sourceBindings[0].bindingId;
  fs.rmSync(filePath, { force: true });
  adultLibraryService.commitAdultFolderSourceReference(subLib, { itemId: created.item.itemId, path: filePath }, {
    now: '2026-07-09T03:01:00.000Z',
  });
  facts = nexoraService.factsForItemId(created.item.itemId);
  assert.strictEqual(facts.sourceBindings[0].bindingId, bindingId);
  assert.strictEqual(facts.sourceBindings[0].validity, 'invalid');
  assert.strictEqual(facts.sourceBindings[0].reason, 'source_missing');
  assert.strictEqual(facts.sourceProjection.readiness, 'missing');

  fs.writeFileSync(filePath, 'sample-again');
  adultLibraryService.commitAdultFolderSourceReference(subLib, { itemId: created.item.itemId, path: filePath }, {
    now: '2026-07-09T03:02:00.000Z',
  });
  facts = nexoraService.factsForItemId(created.item.itemId);
  assert.strictEqual(facts.sourceBindings[0].bindingId, bindingId);
  assert.strictEqual(facts.sourceBindings[0].validity, 'valid');
  assert.strictEqual(facts.sourceBindings[0].reason, 'recovered');
  assert.strictEqual(facts.sourceProjection.readiness, 'ready');
});
