'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createArcaCollectionQuery}=require('../../src/helix/domains/arca/application/collection-query');
function seedEntry(db,id,kind){
  db.prepare('INSERT INTO arca_shelf_entries VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,'shelf','single','active',1,D(id),2,1,10000,null);
  db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run(id,2,D(id+' inventory'),'package',10000);
  db.prepare('INSERT INTO arca_canonical_identity_revisions VALUES(?,?,?,?,?,?,?,?)').run(id,1,'single',kind,'fixture',id,D(id+' identity'),10000);
}
function relation(db,entry,revision,person,id){
  db.prepare('INSERT INTO arca_inventory_person_relations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,entry,revision,person,'Actor','actor','actor',
    'user_actor_choice',null,null,null,D(id+' source'),'user_confirmed',D(id));
}
test('related works use only current Inventory relations, the exact library and a bounded stable cursor',t=>{
  const f=fixture(t),s=f.services();seedEntry(f.db,'entry-us-b','internal_identity');seedEntry(f.db,'entry-movie','tmdb_movie');seedEntry(f.db,'entry-jav','jav_code');
  relation(f.db,'entry',2,'actor-a','current');relation(f.db,'entry',1,'actor-b','historical');
  relation(f.db,'entry-us-b',2,'actor-a','other-current');relation(f.db,'entry-movie',2,'actor-a','cross-normal');relation(f.db,'entry-jav',2,'actor-a','cross-jav');
  const query=createArcaCollectionQuery({...s.dependencies,posterReader(){throw new Error('Related works cannot read physical images.');}}),
    first=query.relatedWorks({personId:'actor-a',libraryKind:'us_adult',limit:1});
  assert.deepEqual(first.items.map(item=>item.shelfEntryId),['entry']);assert.equal(first.nextCursor,'entry');
  const second=query.relatedWorks({personId:'actor-a',libraryKind:'us_adult',limit:1,cursor:first.nextCursor});
  assert.deepEqual(second.items.map(item=>item.shelfEntryId),['entry-us-b']);assert.equal(second.nextCursor,null);
  assert.deepEqual(query.relatedWorks({personId:'actor-b',libraryKind:'us_adult'}).items,[]);
  assert.deepEqual(query.relatedWorks({personId:'actor-a',libraryKind:'normal'}).items.map(item=>item.shelfEntryId),['entry-movie']);
  assert.deepEqual(query.relatedWorks({personId:'actor-a',libraryKind:'jav'}).items.map(item=>item.shelfEntryId),['entry-jav']);
  f.db.prepare('UPDATE arca_shelf_entries SET status=? WHERE shelf_entry_id=?').run('offdecked','entry-us-b');
  assert.deepEqual(query.relatedWorks({personId:'actor-a',libraryKind:'us_adult'}).items.map(item=>item.shelfEntryId),['entry']);
  assert.throws(()=>query.relatedWorks({personId:'actor-a',libraryKind:'us_adult',limit:101}),{code:'PEOPLE_RELATED_WORKS_QUERY_INVALID'});
});
test('the HTTP Facade takes library identity from People and does not accept a caller library override',async()=>{
  let actual;
  const {createCleanFacades}=require('../../src/helix/composition/create-clean-facades'),facades=createCleanFacades({
    sessionTokens:{},readiness:{},
    peopleAdminQuery:{relatedWorksScope:id=>id==='actor'?{personId:id,libraryKind:'us_adult',personIds:[id]}:null},
    arcaCollectionQuery:{relatedWorks:query=>{actual=query;return {items:[],nextCursor:null};}}}),
    read=facades.ArcaCollectionFacade.get_people_personid_collection;
  assert.deepEqual((await read({params:{personId:'actor'},query:{libraryKind:'normal',cursor:'cursor',limit:'2'}})).body,{items:[],nextCursor:null});
  assert.deepEqual(actual,{personId:'actor',libraryKind:'us_adult',personIds:['actor'],cursor:'cursor',limit:'2'});
  await assert.rejects(read({params:{personId:'missing'},query:{}}),{code:'PEOPLE_PERSON_NOT_FOUND'});
});

test('current works include exact People Merge sources without rewriting any Arca relation',t=>{
  const f=fixture(t),s=f.services();seedEntry(f.db,'entry-movie-a','tmdb_movie');seedEntry(f.db,'entry-movie-b','tmdb_movie');
  relation(f.db,'entry-movie-a',2,'former-person','former');relation(f.db,'entry-movie-b',2,'current-person','current');
  relation(f.db,'entry-movie-a',2,'current-person','same-entry-duplicate');
  const query=createArcaCollectionQuery({...s.dependencies,posterReader(){throw new Error('Related works do not read images.');}}),scope={personId:'current-person',libraryKind:'normal',personIds:['current-person','former-person']},first=query.relatedWorks({...scope,limit:1});
  assert.deepEqual(first.items.map(item=>item.shelfEntryId),['entry-movie-a']);assert.equal(first.nextCursor,'entry-movie-a');
  assert.deepEqual(query.relatedWorks({...scope,cursor:first.nextCursor,limit:1}).items.map(item=>item.shelfEntryId),['entry-movie-b']);
  assert.equal(f.db.prepare("SELECT person_id FROM arca_inventory_person_relations WHERE relation_id='former'").get().person_id,'former-person');
  assert.throws(()=>query.relatedWorks({...scope,libraryKind:'us_adult'}),{code:'PEOPLE_RELATED_WORKS_QUERY_INVALID'});
});
