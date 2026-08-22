'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  containerFromLocation,
  filterCollectionIndex,
  occupancyFromMaterials,
  videoSpecFromFacts,
} = require('../src/helix/domains/arca/application/collection-query');

test('Collection occupancy sums Inventory members and names primary container from location', () => {
  const occupancy = occupancyFromMaterials([
    { role: 'primary_payload', location: 'G:/shelf/movie.mkv', size_bytes: 12_000_000_000 },
    { role: 'poster', location: 'G:/shelf/poster.jpg', size_bytes: 400_000 },
    { role: 'metadata_sidecar', location: 'G:/shelf/movie.nfo', size_bytes: 4_000 },
  ]);
  assert.equal(occupancy.occupancyBytes, 12_000_404_000);
  assert.equal(occupancy.primaryVideoBytes, 12_000_000_000);
  assert.equal(occupancy.primaryContainer, 'MKV');
  assert.equal(occupancy.hasPoster, true);
  assert.equal(occupancy.hasNfo, true);
  assert.equal(containerFromLocation('folder/title.mp4'), 'MP4');
  assert.equal(containerFromLocation('no-extension'), null);
});

test('Collection video spec uses Inventory probe facts and does not invent codec', () => {
  assert.deepEqual(videoSpecFromFacts([{ factValue: { videoStreams: [{ codecName: 'hevc', height: 2160 }] } }]), {
    codec: 'HEVC', raster: '2160p',
  });
  assert.deepEqual(videoSpecFromFacts([{ factValue: { title: 'Only metadata' } }]), { codec: null, raster: null });
});

test('Collection index filter stays on the query, including unset-shelf-free current/history splits', () => {
  const index = [
    { shelf_entry_id: 'a', shelf_id: 'shelf-1', status: 'active' },
    { shelf_entry_id: 'b', shelf_id: 'shelf-1', status: 'off_deck' },
    { shelf_entry_id: 'c', shelf_id: 'shelf-2', status: 'active' },
  ];
  assert.deepEqual(filterCollectionIndex(index, { shelfId: 'shelf-1', status: 'current' }).map((row) => row.shelf_entry_id), ['a']);
  assert.deepEqual(filterCollectionIndex(index, { shelfId: 'shelf-1', status: 'history' }).map((row) => row.shelf_entry_id), ['b']);
  assert.equal(filterCollectionIndex(index, { status: 'current' }).length, 2);
});
