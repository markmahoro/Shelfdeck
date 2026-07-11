'use strict';

const test = require('node:test');
const assert = require('node:assert');
const builtIns = require('../src/builtInCapabilities');
const registry = require('../src/capabilityRegistry');

test('JAV content identity is resolved by a dedicated Capability before provider fetch', async () => {
  builtIns.registerBuiltIns();
  const capability = registry.get('media.identity.resolve');
  const result = await capability.execute({
    task: { itemInfo: {}, helixAdmission: { sourceAccessDescriptor: { subLibraryId: 'jav', locator: { path: 'Y:\\JAV\\ABP-123.mp4' } } } },
    config: { subLibraries: [{ uuid: 'jav', mediaType: 'adult', adultRegion: 'japanese_jav' }] },
  });
  assert.strictEqual(result.result.adultId, 'ABP-123');
});
