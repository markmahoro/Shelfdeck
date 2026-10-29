'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {createGeneration,MEMBER_NAMES}=require('../../src/helix/contracts/face-catalogue-generation');
const {verifyCatalogueGenerationFiles:verify}=require('../../src/helix/integrations/face-catalogue-verification');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),linux={skip:process.platform!=='linux'?'Linux resource verification is required.':false};
function fixture(t,mutateManifest){
  const parent=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'face-catalogue-'));
  t.after(()=>{assert.equal(path.dirname(root),parent);fs.rmSync(root,{recursive:true,force:true});});
  const members=MEMBER_NAMES.map(name=>{
    const bytes=Buffer.from(name.repeat(3));fs.writeFileSync(path.join(root,name),bytes);return {name,bytes:bytes.length,sha256:sha(bytes)};
  }),manifest={version:'test-v1',models:{embedding_dim:512},checksums:Object.fromEntries(members.map(x=>[x.name,'sha256:'+x.sha256]))};
  mutateManifest?.(manifest);const bytes=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(path.join(root,'manifest.json'),bytes);
  return {root,generation:createGeneration({datasetVersion:'test-v1',manifestDigest:sha(bytes),members}),deadlineAtMs:Date.now()+5000};
}
test('Linux complete generation verification binds every file and excludes resource paths from its receipt',linux,async t=>{
  const args=fixture(t),before=fs.readdirSync(args.root),value=await verify(args);
  assert.equal(value.generationDigest,args.generation.generationDigest);assert.equal(value.verifiedMembers.length,8);
  assert.equal(value.totalBytes,value.verifiedMembers.reduce((n,x)=>n+x.bytes,0));assert.equal(JSON.stringify(value).includes(args.root),false);
  assert.equal(Object.isFrozen(value.verifiedMembers[0]),true);assert.deepEqual(fs.readdirSync(args.root),before);
});
test('Linux verification rejects same-size corruption and incomplete manifest declarations',linux,async t=>{
  const args=fixture(t),file=path.join(args.root,'faces.json'),bytes=fs.readFileSync(file);bytes[0]^=1;fs.writeFileSync(file,bytes);
  await assert.rejects(verify(args),{code:'FACE_CATALOGUE_FILES_INVALID'});
  for(const mutate of [m=>delete m.checksums['faces.json'],m=>m.checksums['extra.json']='sha256:'+sha('extra'),
    m=>m.version='other',m=>m.models.embedding_dim=128])await assert.rejects(verify(fixture(t,mutate)),{code:'FACE_CATALOGUE_FILES_INVALID'});
});
test('Linux resource roots and members cannot be symbolic links or directories',linux,async t=>{
  const args=fixture(t),file=path.join(args.root,'aliases.json'),real=path.join(args.root,'aliased-resource');
  fs.renameSync(file,real);fs.symlinkSync(real,file);
  await assert.rejects(verify(args),{code:'FACE_CATALOGUE_FILES_INVALID'});
  fs.unlinkSync(file);fs.mkdirSync(file);await assert.rejects(verify(args),{code:'FACE_CATALOGUE_FILES_INVALID'});
  const link=path.join(args.root,'linked-root');fs.symlinkSync(args.root,link);
  await assert.rejects(verify({...args,root:link}),{code:'FACE_CATALOGUE_FILES_INVALID'});
});
test('Linux verification fences previously hashed members against later replacement',linux,async t=>{
  const args=fixture(t);let changed=false;
  await assert.rejects(verify({...args,onRead({name}){
    if(name==='performers.json'&&!changed){changed=true;const file=path.join(args.root,'aliases.json'),bytes=fs.readFileSync(file);
      fs.unlinkSync(file);fs.writeFileSync(file,bytes);}
  }}),{code:'FACE_CATALOGUE_FILES_INVALID'});assert.equal(changed,true);
});
test('Linux verification detects mutation during hashing and aborts instead of returning partial qualification',linux,async t=>{
  const args=fixture(t);let changed=false;
  await assert.rejects(verify({...args,onRead({name}){
    if(name==='faces.json'&&!changed){changed=true;fs.appendFileSync(path.join(args.root,name),'changed');}
  }}),{code:'FACE_CATALOGUE_FILES_INVALID'});
  const controller=new AbortController(),other=fixture(t);
  await assert.rejects(verify({...other,signal:controller.signal,onRead(){controller.abort();}}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
});
test('Linux resource verification has bounded filesystem waits and cleans up a handle opened after timeout',linux,async t=>{
  const args=fixture(t),began=performance.now();let closed=false,opened;
  const fsPromises={...fs.promises,async open(...values){
    await new Promise(resolve=>setTimeout(resolve,120));opened=await fs.promises.open(...values);
    return {async close(){await opened.close();closed=true;}};
  }};
  await assert.rejects(verify({...args,deadlineAtMs:Date.now()+40,fsPromises}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
  assert.ok(performance.now()-began<500);
  await new Promise(resolve=>setTimeout(resolve,180));assert.equal(closed,true);
});
test('Linux verification bounds inputs and rejects expired deadlines before reading files',linux,async t=>{
  const args=fixture(t);
  for(const patch of [{root:'relative'},{deadlineAtMs:Date.now()+600000},{deadlineAtMs:NaN},{onRead:true}])
    await assert.rejects(verify({...args,...patch}),{code:'FACE_CATALOGUE_FILES_INVALID'});
  await assert.rejects(verify({...args,deadlineAtMs:Date.now()-1}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
  const controller=new AbortController();controller.abort();
  await assert.rejects(verify({...args,signal:controller.signal}),{code:'P4_COOPERATIVE_DEADLINE_EXCEEDED'});
});
