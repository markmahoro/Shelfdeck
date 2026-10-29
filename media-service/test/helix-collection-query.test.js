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

test('Series Collection projects only claimed Episodes, shared files and parts from current Inventory',()=>{
  const {collectionSeriesProjection}=require('../src/helix/domains/arca/model/collection-series-projection');
  const {canonicalContentIdentity}=require('../src/helix/domains/arca/model/canonical-content-identity');
  const identity={structureKind:'season',contentProfile:'series',identityKind:'tmdb_series_season',identityDigest:'a'.repeat(64),providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'42',seasonNumber:2}]};
  const entry={structure_kind:'season',shelf_id:'shelf',canonical_identity_key:canonicalContentIdentity('shelf',identity).canonicalIdentityKey};
  const material=(key,episodes)=>({material_key:key,role:'primary_payload',location:'/media/'+key+'.mkv',size_bytes:100,episode_claims_json:JSON.stringify({items:episodes.map(episodeKey=>({episodeKey}))})});
  const materials=[material('shared',['E001','E003']),material('part',['E001'])];
  const facts=[{factKind:'resolved_identity',factValue:identity},{factKind:'product_metadata',factValue:{episodeMetadata:[{episodeScope:{seasonNumber:2,episodeNumber:3,episodeKey:'E003'},descriptiveFacts:{entries:[{key:'episode_title',value:'Third'}]}}]}}];
  const value=collectionSeriesProjection(entry,materials,facts);
  assert.equal(value.seasonNumber,2);assert.equal(value.episodeCount,2);assert.equal(value.physicalFileCount,2);
  assert.deepEqual(value.episodes.map(item=>item.episodeNumber),[1,3]);
  assert.equal(value.episodes[0].files.length,2);assert.equal(value.episodes[1].title,'Third');
  assert.equal(value.episodes[1].files[0].coveredEpisodeCount,2);
  assert.throws(()=>collectionSeriesProjection({...entry,canonical_identity_key:'other'},materials,facts),/identity/);
  assert.throws(()=>collectionSeriesProjection(entry,[...materials,materials[0]],facts),/duplicated/);
  assert.throws(()=>collectionSeriesProjection(entry,[material('bad',['E001','E001'])],facts),/claims/);
  assert.throws(()=>collectionSeriesProjection(entry,[material('bad',['E1'])],facts),/key/);
  assert.equal(collectionSeriesProjection({structure_kind:'single'},[],[]),null);
});


test('real SQLite title/year/search paging preserves results and reads heavy collection details only for the selected page',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
  const {openSqliteKernel}=require('../src/helix/foundation/persistence/sqlite-kernel');
  const {createSqliteUnitOfWork}=require('../src/helix/foundation/persistence/sqlite-unit-of-work');
  const schemaManifest=require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'collection-page-')),databasePath=path.join(temporary,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl:fs.readFileSync(path.join(__dirname,'../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8')});
  const db=new Database(databasePath),actual=createSqliteUnitOfWork({kernel}),detailReads=[];
  try {
    db.pragma('foreign_keys=ON');db.prepare("INSERT INTO arca_shelves(shelf_id,name,status) VALUES ('shelf','Shelf','active')").run();
    for(let i=0;i<12;i++){
      const id='entry-'+String(i).padStart(2,'0'),title=['Alpha','Beta','阿尔法','阿尔法'][i%4],year=2020+i%3;
      db.prepare("INSERT INTO arca_shelf_entries(shelf_entry_id,shelf_id,status,structure_kind,created_at_ms) VALUES (?,'shelf','active','single',?)").run(id,i);
      db.prepare("INSERT INTO arca_canonical_identity_revisions(shelf_entry_id,revision,structure_kind,identity_kind,provider,provider_key) VALUES (?,1,'single','tmdb_movie','tmdb',?)").run(id,String(i));
      db.prepare('INSERT INTO arca_inventory_representations(shelf_entry_id,revision) VALUES (?,1)').run(id);
      db.prepare('INSERT INTO arca_deck_fact_revisions(shelf_entry_id,revision) VALUES (?,1)').run(id);
      db.prepare('UPDATE arca_shelf_entries SET canonical_identity_revision=1,current_inventory_revision=1,current_deck_fact_revision=1 WHERE shelf_entry_id=?').run(id);
      db.prepare("INSERT INTO arca_inventory_product_facts(shelf_entry_id,inventory_revision,fact_kind,fact_revision,fact_json) VALUES (?,1,'product_metadata',1,?)").run(id,JSON.stringify({descriptiveFacts:{entries:[{key:'title',value:title},{key:'year',value:year}]}}));
    }
    const unitOfWork={execute(participants){return actual.execute(participants.map(participant=>({...participant,execute(context){
      return participant.execute({...context,repository(id){const repo=context.repository(id);return {invoke(name,args){
        if(['find_materials','find_people','find_facts'].includes(name))detailReads.push({name,ids:args.values});
        return repo.invoke(name,args);
      }};}});
    }})));}};
    const query=createArcaCollectionQuery({schemaManifest,unitOfWork,posterReader:async()=>null});
    for(const options of [{sort:'title'},{sort:'year_desc'},{sort:'title',q:'阿尔法'},{sort:'year_desc',q:'2021'}]){
      const expected=query.list(options);let cursor=null,actualItems=[];
      do {
        detailReads.length=0;
        const page=query.list({...options,limit:2,cursor});
        assert.equal(page.resultCount,expected.resultCount);
        for(const read of detailReads)assert.ok(read.ids.every(id=>page.items.some(item=>item.shelfEntryId===id)),read.name+' must stay within this page');
        actualItems.push(...page.items);cursor=page.nextCursor;
      }while(cursor);
      assert.deepEqual(actualItems,expected.items);
    }
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  }finally{db.close();kernel.close();fs.rmSync(temporary,{recursive:true,force:true});}
});
