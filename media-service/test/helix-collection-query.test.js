'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  containerFromLocation,
  collectionPage,
  collectionSort,
  createArcaCollectionQuery,
  filterCollectionIndex,
  occupancyFromMaterials,
  yearFromDescriptiveFacts,
  videoSpecFromFacts,
} = require('../src/helix/domains/arca/application/collection-query');

test('Collection computes health only for the visible page and never invokes the per-entry fallback during sorting',()=>{
  const entries=Array.from({length:12},(_,i)=>({shelf_entry_id:'entry-'+i,shelf_id:'shelf',status:'active',
    canonical_identity_revision:1,current_inventory_revision:1,current_deck_fact_revision:1,created_at_ms:i,terminal_at_ms:null}));
  const healthCalls=[];
  const repo={invoke(name){
    if(['list_entry_index','list_entries'].includes(name))return entries;
    if(name==='list_shelves')return [{shelf_id:'shelf',name:'Films',status:'active'}];
    if(name==='find_identities')return entries.map(row=>({shelf_entry_id:row.shelf_entry_id,revision:1,provider_key:row.shelf_entry_id}));
    return [];
  }};
  const query=createArcaCollectionQuery({schemaManifest:require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(participants){return Object.fromEntries(participants.map(p=>[p.participantId,p.execute({repository:()=>repo})]));}},
    posterReader:async()=>null,healthReader(){throw Error('Unpaged health fallback');},
    healthReaderMany(ids){healthCalls.push(ids);return new Map(ids.map(id=>[id,{state:'healthy'}]));}});
  const page=query.list({limit:3});
  assert.equal(page.items.length,3);assert.equal(page.resultCount,12);
  assert.deepEqual(healthCalls,[page.items.map(item=>item.shelfEntryId)]);
  assert.ok(page.items.every(item=>item.health.state==='healthy'));
});

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
  assert.equal(containerFromLocation('F:\\canary\\Movie TrueHD5.1\\movie.mkv'), 'MKV');
  assert.equal(containerFromLocation('/canary/Movie.TrueHD5.1/movie.release.final.m2ts?revision=1'), 'M2TS');
  assert.equal(containerFromLocation('F:\\canary\\Movie.TrueHD5.1\\no-extension'), null);
  assert.equal(containerFromLocation('no-extension'), null);
});

test('Collection large-shelf browse sorts and paginates with a bounded cursor', () => {
  const items = [
    { shelfEntryId:'b', displayIdentity:'Bravo', createdAtMs:2, year:1990 },
    { shelfEntryId:'a', displayIdentity:'Alpha', createdAtMs:3, year:2020 },
    { shelfEntryId:'c', displayIdentity:'Charlie', createdAtMs:1, year:null },
  ];
  const sorted = collectionSort([...items], 'recent');
  assert.deepEqual(sorted.map((item) => item.shelfEntryId), ['a', 'b', 'c']);
  assert.deepEqual(collectionPage(sorted, { limit:'2' }), { items:sorted.slice(0, 2), nextCursor:'2' });
  assert.deepEqual(collectionPage(sorted, { limit:'2', cursor:'2' }), { items:sorted.slice(2), nextCursor:null });
});

test('Collection video spec uses Inventory probe facts and does not invent codec', () => {
  assert.deepEqual(videoSpecFromFacts([{ factValue: { videoStreams: [{ codecName: 'hevc', height: 2160 }] } }]), {
    codec: 'HEVC', raster: '2160p',
  });
  assert.deepEqual(videoSpecFromFacts([{ factValue: { title: 'Only metadata' } }]), { codec: null, raster: null });
});

test('Collection year follows the descriptive fields emitted by provider metadata', () => {
  assert.equal(yearFromDescriptiveFacts(new Map([['year_or_release_date', '2023']])), 2023);
  assert.equal(yearFromDescriptiveFacts(new Map([['release_date', '2025-06-23']])), 2025);
  assert.equal(yearFromDescriptiveFacts(new Map([['release_year', 1999]])), 1999);
  assert.equal(yearFromDescriptiveFacts(new Map([['year_or_release_date', 'unknown']])), null);
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
