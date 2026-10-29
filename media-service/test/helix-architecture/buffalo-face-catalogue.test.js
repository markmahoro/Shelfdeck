'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createGeneration,MEMBER_NAMES}=require('../../src/helix/contracts/face-catalogue-generation');
const {catalogueSearchPolicy}=require('../../src/helix/contracts/face-catalogue-search-policy');
const {createBuffaloFaceCatalogue}=require('../../src/helix/integrations/buffalo-face-catalogue');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),linux={skip:process.platform!=='linux'?'Linux catalogue filesystem guards are required.':false};
function fixture(t,{differentId=false,brokenFaces=false,sparse=false,catalogueUid=false}={}){
  const Database=require('better-sqlite3'),parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'buffalo-catalogue-')),
    database=new Database(path.join(root,'performers.db')),uid=catalogueUid?'iafd:1':'stashdb.org:actor-a';
  database.exec('CREATE TABLE performers(id INTEGER PRIMARY KEY,canonical_name TEXT); CREATE TABLE faces(embedding_index INTEGER PRIMARY KEY,performer_id INTEGER,source_endpoint TEXT); CREATE TABLE stashbox_ids(performer_id INTEGER,endpoint TEXT,stashbox_performer_id TEXT,PRIMARY KEY(endpoint,stashbox_performer_id)); CREATE TABLE performer_urls(performer_id INTEGER,source_endpoint TEXT,url_type TEXT);');
  database.prepare('INSERT INTO performers VALUES(?,?)').run(1,'Actor A');database.prepare('INSERT INTO performers VALUES(?,?)').run(2,'Actor B');
  database.prepare('INSERT INTO faces VALUES(0,?,?)').run(differentId?2:1,catalogueUid?'iafd':'stashdb');
  database.prepare('INSERT INTO stashbox_ids VALUES(1,?,?)').run('stashdb','actor-a');database.close();
  const values={'aliases.json':{[uid]:['Alias A']},'faces.json':brokenFaces?[uid]:sparse?[uid,null,null,null]:[uid,null],'face_yaw.json':sparse?[60,null,null,null]:[60,null],
    'performer_links.json':[[uid,'linked:a']],'performers.json':{[uid]:{name:'Actor A'}}};
  for(const [name,value]of Object.entries(values))fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  fs.writeFileSync(path.join(root,'face_embeddings.usearch'),'controlled-index-test');
  const members=MEMBER_NAMES.map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {name,bytes:bytes.length,sha256:sha(bytes)};}),
    manifest=JSON.stringify({version:'fixture-v1',models:{embedding_dim:512},checksums:Object.fromEntries(members.map(x=>[x.name,'sha256:'+x.sha256]))});
  fs.writeFileSync(path.join(root,'manifest.json'),manifest);
  class Index{view(file){assert.equal(file,path.join(root,'face_embeddings.usearch'));}size(){return 2;}dimensions(){return 512;}
    search(vector,count,threads){assert.equal(vector.length,512);assert.equal(count,100);assert.equal(threads,1);return {keys:BigUint64Array.from([0n,sparse?3n:1n]),distances:Float32Array.from([0.1,0.2])};}}
  const generation=createGeneration({datasetVersion:'fixture-v1',manifestDigest:sha(manifest),members}),catalogue=createBuffaloFaceCatalogue({root,generation,searchPolicy:catalogueSearchPolicy(),Database,usearch:{Index}});
  t.after(()=>{catalogue.close();assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  const vector=Array(512).fill(0);vector[0]=1;
  return {root,generation,catalogue,vector};
}
test('Linux catalogue queries preserve generation, explicit links, yaw adjustment and null-slot evidence',linux,async t=>{
  const f=fixture(t);await f.catalogue.load({deadlineAtMs:Date.now()+5000});const out=f.catalogue.search(f.vector);
  assert.equal(out.generationDigest,f.generation.generationDigest);assert.equal(out.searchPolicyDigest,catalogueSearchPolicy().policyDigest);
  assert.equal(out.matches.length,1);assert.equal(out.matches[0].identityKey,'linked:a');assert.equal(out.matches[0].name,'Actor A');
  assert.deepEqual(out.matches[0].aliases,['Alias A']);assert.ok(Math.abs(out.matches[0].combinedDistance-0.25)<1e-6);
  assert.equal(Object.hasOwn(out.matches[0],'gender'),false);assert.deepEqual(out.retiredSlots,[{key:1,reason:'explicit_null_catalogue_slot'}]);
});
test('Linux catalogue never accepts a face UID joined to another performer or inconsistent cardinalities',linux,async t=>{
  const f=fixture(t,{differentId:true});await f.catalogue.load({deadlineAtMs:Date.now()+5000});
  assert.throws(()=>f.catalogue.search(f.vector),{code:'BUFFALO_CATALOGUE_IDENTITY_INVALID'});
  const broken=fixture(t,{brokenFaces:true});await assert.rejects(broken.catalogue.load({deadlineAtMs:Date.now()+5000}),{code:'BUFFALO_CATALOGUE_CARDINALITY_INVALID'});
});
test('Linux sparse index labels can exceed live vector count while staying inside their pinned mapping key space',linux,async t=>{
  const f=fixture(t,{sparse:true});await f.catalogue.load({deadlineAtMs:Date.now()+5000});const out=f.catalogue.search(f.vector);
  assert.deepEqual(out.retiredSlots,[{key:3,reason:'explicit_null_catalogue_slot'}]);assert.equal(out.matches[0].uid,'stashdb.org:actor-a');
});
test('Linux catalogue source identities bind their numeric performer key and source independently of stashbox IDs',linux,async t=>{
  const f=fixture(t,{catalogueUid:true});await f.catalogue.load({deadlineAtMs:Date.now()+5000});assert.equal(f.catalogue.search(f.vector).matches[0].uid,'iafd:1');
  const other=fixture(t,{catalogueUid:true,differentId:true});await other.catalogue.load({deadlineAtMs:Date.now()+5000});
  assert.throws(()=>other.catalogue.search(other.vector),{code:'BUFFALO_CATALOGUE_IDENTITY_INVALID'});
});
test('Linux catalogue load, query and warm reuse reject replaced generations instead of returning empty matches',linux,async t=>{
  const f=fixture(t);await f.catalogue.load({deadlineAtMs:Date.now()+5000});fs.appendFileSync(path.join(f.root,'aliases.json'),' ');
  assert.throws(()=>f.catalogue.search(f.vector),{code:'FACE_CATALOGUE_FILES_CHANGED'});
  await assert.rejects(f.catalogue.load({deadlineAtMs:Date.now()+5000}),{code:'FACE_CATALOGUE_FILES_CHANGED'});
});
test('Linux catalogue cannot search before load, accept an old feature, or reopen after close',linux,async t=>{
  const f=fixture(t);assert.throws(()=>f.catalogue.search(f.vector),{code:'BUFFALO_CATALOGUE_INVALID'});
  await f.catalogue.load({deadlineAtMs:Date.now()+5000});
  for(const vector of [Array(128).fill(0),Array(512).fill(0),[...f.vector.slice(0,511),NaN],f.vector.map(x=>x*2)])
    assert.throws(()=>f.catalogue.search(vector),{code:'BUFFALO_CATALOGUE_INVALID'});
  f.catalogue.close();await assert.rejects(f.catalogue.load({deadlineAtMs:Date.now()+5000}),{code:'BUFFALO_CATALOGUE_INVALID'});
});
