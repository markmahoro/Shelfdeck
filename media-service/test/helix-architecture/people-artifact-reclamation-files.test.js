'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createCleanPeopleArtifactReclamationPort}=require('../../src/clean-people-artifact-reclamation-port');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'people-reference-gc-files-')),id=D('artifact'),bytes=Buffer.from('exact registered reference bytes'),
  handle={artifactHandleId:id,digestHex:crypto.createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length,storageRef:'people-artifact:'+id,referenceRevision:1},file=path.join(root,id);
  fs.writeFileSync(file,bytes);t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('people-reference-gc-files-'));fs.rmSync(root,{recursive:true,force:true});});
  let crash=false,authority=true,record={state:'active',handle:{...handle}},saved=null,claims=0;
  const context={workId:'work',eventId:'event',eventAttemptId:'attempt',idempotencyKey:'effect-key',assertExecutionActive(){}},rootValue={rootId:'people',state:'active',configRevision:1,resolvedRoot:root},
    options={rootPath:root,controlledRoot:()=>rootValue,safeDirectory:dir=>fs.mkdirSync(dir,{recursive:true}),
      requireEffect:()=>({effect_id:D(['workspace_write',context.idempotencyKey])}),publish:(target,data)=>fs.writeFileSync(target,data,{flag:'wx'}),
      readExact(target,digest,size){const read=fs.readFileSync(target);assert.equal(read.length,size);assert.equal(crypto.createHash('sha256').update(read).digest('hex'),digest);return read;},
      afterPhysicalEffect(){if(crash)throw new Error('interrupted after real unlink');},locationRegistryRepository:{createWorkspaceRootReadParticipant:()=>({})}},
    io=createCleanPeopleArtifactReclamationPort(options),evidence={artifactHandle:handle,...io.snapshot()},callbacks={context,evidence,authority:()=>authority,
      replay:()=>saved,readRegistry:()=>record,
      claim({verifyIntent}){assert.equal(verifyIntent(),true);record={state:'gc_eligible',handle:{...handle,referenceRevision:2}};claims++;},
      settle({disposition,verifyReality}){assert.equal(verifyReality(),true);record={state:disposition==='deleted'?'deleted':'active',handle:{...handle,referenceRevision:record.state==='gc_eligible'?3:1}};
        saved={disposition};return saved;}};
  return {root,file,bytes,options,io,context,evidence,callbacks,get record(){return record;},get claims(){return claims;},crash:value=>crash=value,authority:value=>authority=value};
}
test('actual unlink interruption recovers the same immutable deletion Intent across a new process boot',t=>{
  const h=fixture(t);h.crash(true);assert.throws(()=>h.io.reclaim(h.callbacks),/interrupted after real unlink/);assert.equal(fs.existsSync(h.file),false);assert.equal(h.record.state,'gc_eligible');
  const reopened=createCleanPeopleArtifactReclamationPort(h.options);assert.notEqual(reopened.snapshot().bootId,h.evidence.bootId);h.crash(false);h.authority(false);
  assert.deepEqual(reopened.reclaim(h.callbacks),{disposition:'deleted'});assert.equal(h.record.state,'deleted');assert.equal(h.record.handle.referenceRevision,3);
  fs.writeFileSync(h.file,h.bytes);assert.deepEqual(reopened.reclaim(h.callbacks),{disposition:'deleted'});assert.equal(fs.readFileSync(h.file).equals(h.bytes),true,'Historical receipt replay never removes later legitimate republication.');
});
test('new boot or lost current authority retains a present Artifact without issuing a new delete',t=>{
  for(const reboot of [false,true]){const h=fixture(t);h.authority(reboot);const io=reboot?createCleanPeopleArtifactReclamationPort(h.options):h.io;
    assert.deepEqual(io.reclaim(h.callbacks),{disposition:'retained'});assert.equal(h.claims,0);assert.equal(h.record.state,'active');assert.equal(fs.readFileSync(h.file).equals(h.bytes),true);}
});
test('changed physical bytes after claim are retained and never mistaken for completed deletion',t=>{
  const h=fixture(t),original=h.callbacks.claim;h.callbacks.claim=request=>{original(request);fs.writeFileSync(h.file,'foreign replacement bytes');};
  assert.throws(()=>h.io.reclaim(h.callbacks));assert.equal(fs.readFileSync(h.file,'utf8'),'foreign replacement bytes');assert.equal(h.record.state,'gc_eligible');
});
test('hard linked Artifact and foreign deletion Intent are refused before unlink',t=>{
  const h=fixture(t),link=path.join(h.root,'retained-link');fs.linkSync(h.file,link);assert.throws(()=>h.io.reclaim(h.callbacks),{code:'PEOPLE_ARTIFACT_PHYSICAL_FENCE_CHANGED'});
  assert.equal(h.claims,0);assert.equal(fs.readFileSync(link).equals(h.bytes),true);fs.unlinkSync(link);
  h.crash(true);assert.throws(()=>h.io.reclaim(h.callbacks));fs.writeFileSync(h.file,h.bytes);
  assert.throws(()=>h.io.reclaim({...h.callbacks,context:{...h.context,workId:'foreign-work'}}),{code:'PEOPLE_ARTIFACT_PHYSICAL_FENCE_CHANGED'});assert.equal(fs.existsSync(h.file),true);
});

test('a committed claim with a present file is released after reboot or lost window permission without unlink',t=>{
  for(const reboot of [true,false]){const h=fixture(t),claim=h.callbacks.claim;h.callbacks.claim=request=>{claim(request);if(reboot)throw new Error('stopped after Registry claim');h.authority(false);};
    if(reboot){assert.throws(()=>h.io.reclaim(h.callbacks),/stopped after Registry claim/);assert.deepEqual(createCleanPeopleArtifactReclamationPort(h.options).reclaim(h.callbacks),{disposition:'retained'});}
    else assert.deepEqual(h.io.reclaim(h.callbacks),{disposition:'retained'});
    assert.equal(h.claims,1);assert.equal(h.record.state,'active');assert.equal(h.record.handle.referenceRevision,3);assert.equal(fs.readFileSync(h.file).equals(h.bytes),true);}
});
