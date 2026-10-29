'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createCatalogue}=require('../../scripts/qualification/buffalo/catalogue');
test('catalogue links provide a stable technical identity without merging equal names or changing per-face match output',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buffalo-links-'));
  t.after(()=>{assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const members={'manifest.json':{version:'2026.10.09',models:{embedding_dim:512}},'faces.json':['source:a','source:b'],
    'face_yaw.json':[0,0],'aliases.json':{},'performer_links.json':[['source:a','source:c'],['source:c','source:b']]};
  for(const [name,value]of Object.entries(members))fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  class Index{view(){}dimensions(){return 512;}size(){return 2;}search(){return {keys:[0,1],distances:[0.1,0.2]};}}
  class Database{pragma(){}prepare(){return {get:key=>({id:key,canonical_name:'Same Name',gender:'FEMALE'})};}close(){}}
  const catalogue=createCatalogue({root,usearch:{Index},Database});catalogue.load();
  assert.equal(catalogue.identityKey('source:a'),'source:a');assert.equal(catalogue.identityKey('source:b'),'source:a');
  assert.equal(catalogue.identityKey('unlinked:same-name'),'unlinked:same-name');
  const vector=Array(512).fill(0);vector[0]=1;
  const before=catalogue.search(vector);catalogue.identityKey('source:b');
  assert.deepEqual(catalogue.search(vector),before);assert.deepEqual(before.matches.map(x=>x.uid),['source:a','source:b']);
  catalogue.close();assert.throws(()=>catalogue.identityKey('source:a'),{code:'BUFFALO_CATALOGUE_INVALID'});
});
