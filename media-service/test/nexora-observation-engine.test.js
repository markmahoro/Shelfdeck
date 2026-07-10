'use strict';

const assert = require('assert');
const test = require('node:test');

const engine = require('../src/nexoraObservationEngine');

test.after(() => engine.stop());

test('Nexora observation engine commits source candidates without creating Kairox ingest tasks', async () => {
  const committed = [];
  const result = await engine.runOnce({
    configStore: { loadConfig: () => ({ subLibraries: [
      { uuid: 'adult-lib', source: 'folder', enabled: true },
      { uuid: 'emby-lib', source: 'emby', enabled: true },
    ] }) },
    adultLibraryService: {
      listIngestCandidates: () => [{ itemInfo: { itemId: 'adult-source', subLibraryId: 'adult-lib', path: '/source/a.mkv' } }],
      commitAdultFolderSourceReference: (subLib, item) => committed.push({ kind: 'adult', subLib: subLib.uuid, item: item.itemId }),
    },
    mediaLibraryService: {
      listSourceObservationCandidates: async () => [{ itemInfo: { itemId: 'emby-source', subLibraryId: 'emby-lib' } }],
      commitEmbySourceCandidate: async (item) => committed.push({ kind: 'emby', item: item.itemId }),
    },
  });
  assert.strictEqual(result.observed, 2);
  assert.deepStrictEqual(committed.map((entry) => entry.kind), ['adult', 'emby']);
});

test('Nexora observation engine can be woken after a source is added at runtime', async () => {
  const committed = [];
  let subLibraries = [];
  engine.start(
    { loadConfig: () => ({ sourceObservationInitialDelaySeconds: 3600, subLibraries }) },
    {
      listSourceObservationCandidates: async () => subLibraries.length > 0
        ? [{ itemInfo: { itemId: 'runtime-emby-source', subLibraryId: 'runtime-emby-lib' } }]
        : [],
      commitEmbySourceCandidate: async (item) => committed.push(item.itemId),
    },
    { listIngestCandidates: () => [], commitAdultFolderSourceReference: () => {} },
  );
  subLibraries = [{ uuid: 'runtime-emby-lib', source: 'emby', enabled: true }];
  assert.strictEqual(engine.wake(), true);
  const deadline = Date.now() + 1000;
  while (committed.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.deepStrictEqual(committed, ['runtime-emby-source']);
  engine.stop();
});
