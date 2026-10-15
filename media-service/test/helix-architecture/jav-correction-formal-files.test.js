'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createJavCorrectionFormalFiles}=require('../../src/helix/integrations/jav-correction-formal-files');
const {javCorrectionRetainedLocation}=require('../../src/helix/contracts/jav-correction-retained-location');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-formal-stage-')),shelf=path.join(root,'shelf'),old=path.join(shelf,'old'),workspace=path.join(root,'workspace');
  for(const location of [old,workspace])fs.mkdirSync(location,{recursive:true});
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-formal-stage-'));fs.rmSync(root,{recursive:true,force:true});});
  const roles=['primary_payload','metadata_sidecar','poster','fanart'],names=['film.mkv','film.nfo','poster.jpg','fanart.jpg'],sources=new Map();
  const members=roles.map((role,ordinal)=>{
    const location=path.join(old,names[ordinal]);fs.writeFileSync(location,Buffer.alloc(1024,ordinal+20));
    const observed=computeBoundedMaterialFingerprintSync(location),identity={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},original={location,physicalIdentity:{...identity,materialKey:canonicalDigest({schema:'physical-material-identity@2',...identity})}};
    let source={kind:'retained_inventory',workspaceMaterialHandle:null};
    if(ordinal>0) {
      const actual=path.join(workspace,names[ordinal]),bytes=Buffer.alloc(2048,ordinal+60);fs.writeFileSync(actual,bytes);
      const snapshot=computeBoundedMaterialFingerprintSync(actual),handle={handleId:String(ordinal),sizeBytes:bytes.length,digestHex:createHash('sha256').update(bytes).digest('hex'),
        physicalIdentity:{inode:String(snapshot.stat.ino),contentFingerprint:snapshot.contentFingerprint}};
      sources.set(handle.handleId,{location:actual});source={kind:'correction_artifact',workspaceMaterialHandle:handle};
    }
    original.bindingRevision=1;
    return {ordinal,role,original,source,retainedLocation:javCorrectionRetainedLocation('arca-jav-correction-'+canonicalDigest('case').slice(0,40),ordinal,location),
      targetEndpointId:'target',targetLocation:path.join(shelf,'new',names[ordinal])};
  }),body={schemaRef:'helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1',schemaVersion:1,
    correctionId:'arca-jav-correction-'+canonicalDigest('case').slice(0,40),admissionDigest:canonicalDigest('admission'),target:{rootLocation:shelf,mountScopeId:'mount',endpointId:'target'},members},
    plan={...body,planDigest:canonicalDigest(body)},port=createJavCorrectionFormalFiles({resolveWorkspaceMaterial:(_id,_admission,handle)=>sources.get(handle.handleId)});
  return {shelf,plan,port,sources};
}
test('correction stage preflights every source before writing and preserves original video and artwork on late source drift',async t=>{
  const {shelf,plan,port,sources}=fixture(t),old=plan.members.map(item=>({location:item.original.location,bytes:fs.readFileSync(item.original.location)}));
  fs.writeFileSync(sources.get('3').location,Buffer.alloc(2048,91));
  await assert.rejects(port.stage(plan,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_FILE_DRIFT'});
  assert.deepEqual(fs.readdirSync(shelf),['old']);for(const item of old)assert.deepEqual(fs.readFileSync(item.location),item.bytes);
});
function publishedManifest(plan,staged) {
  const body={sourceProductManifestDigest:plan.planDigest,stagedMembers:staged.members.map(item=>({role:item.role,location:item.location,
    physicalIdentity:item.physicalIdentity,fullByteDigest:item.byteDigest}))};
  return {...body,manifestDigest:canonicalDigest(body)};
}
test('recovery stage and publication preflights observe partial declared files without creating, retiring or replacing any member',async t=>{
  const {plan,port,shelf}=fixture(t),check={shouldContinue:()=>true,recoveryDecision:'continue_forward'};
  await port.preflightStage(plan,check);assert.deepEqual(fs.readdirSync(shelf),['old']);
  const staged=await port.stage(plan,check),missing=staged.members[3].location;
  fs.unlinkSync(missing);const before=fs.readdirSync(staged.directory);await port.preflightStage(plan,check);
  assert.deepEqual(fs.readdirSync(staged.directory),before);assert.equal(fs.existsSync(missing),false);
  const manifest=publishedManifest(plan,await port.stage(plan,check));await port.preflightPublish(plan,manifest,check);
  for(const member of plan.members){assert.equal(fs.existsSync(member.retainedLocation),false);assert.equal(fs.existsSync(member.targetLocation),false);}
  const conflict=plan.members[3].targetLocation;fs.mkdirSync(path.dirname(conflict));fs.writeFileSync(conflict,'foreign');
  await assert.rejects(port.preflightPublish(plan,manifest,check),{code:'ARCA_JAV_CORRECTION_TARGET_CONFLICT'});
  assert.equal(fs.readFileSync(conflict,'utf8'),'foreign');for(const member of plan.members)assert.equal(fs.existsSync(member.retainedLocation),false);
});
test('publication preserves all original bytes, verifies final full digests and replays the same physical targets',async t=>{
  const {plan,port}=fixture(t),staged=await port.stage(plan,{shouldContinue:()=>true}),manifest=publishedManifest(plan,staged),
    old=plan.members.map(item=>({location:item.original.location,bytes:fs.readFileSync(item.original.location)})),
    final=await port.publish(plan,manifest,{shouldContinue:()=>true});
  assert.deepEqual(await port.publish(plan,manifest,{shouldContinue:()=>true,recoveryDecision:'continue_forward'}),final);
  for(const item of old)assert.deepEqual(fs.readFileSync(item.location),item.bytes);
  for(const member of plan.members)assert.deepEqual(fs.readFileSync(member.retainedLocation),fs.readFileSync(member.original.location));
  assert.equal(final.members[0].physicalIdentity.inode,plan.members[0].original.physicalIdentity.inode);
});
test('overlapping artwork is replaced only after retaining its exact old material; primary is never removed',async t=>{
  const f=fixture(t);for(const member of f.plan.members)member.targetLocation=member.original.location;
  const {planDigest,...body}=f.plan;f.plan={...body,planDigest:canonicalDigest(body)};
  const originals=f.plan.members.map(item=>fs.readFileSync(item.original.location)),staged=await f.port.stage(f.plan,{shouldContinue:()=>true}),manifest=publishedManifest(f.plan,staged);
  const final=await f.port.publish(f.plan,manifest,{shouldContinue:()=>true});assert.equal(final.members.length,4);
  assert.deepEqual(fs.readFileSync(f.plan.members[0].original.location),originals[0]);
  for(let index=1;index<4;index++){assert.deepEqual(fs.readFileSync(f.plan.members[index].retainedLocation),originals[index]);assert.notDeepEqual(fs.readFileSync(f.plan.members[index].targetLocation),originals[index]);}
});
test('publication interrupted between old artwork retirement and replacement continues from retained exact originals',async t=>{
  const f=fixture(t);for(const member of f.plan.members)member.targetLocation=member.original.location;
  const {planDigest,...body}=f.plan;f.plan={...body,planDigest:canonicalDigest(body)};
  const staged=await f.port.stage(f.plan,{shouldContinue:()=>true}),manifest=publishedManifest(f.plan,staged),target=f.plan.members[2].targetLocation,unlink=fs.unlinkSync;
  fs.unlinkSync=function(location,...args){const result=unlink.call(fs,location,...args);if(location===target)throw new Error('Injected publication interruption.');return result;};
  try{await assert.rejects(f.port.publish(f.plan,manifest,{shouldContinue:()=>true}),/Injected publication interruption/);}finally{fs.unlinkSync=unlink;}
  assert.equal(fs.existsSync(target),false);assert.deepEqual(fs.readFileSync(f.plan.members[2].retainedLocation),Buffer.alloc(1024,22));
  const final=await f.port.publish(f.plan,manifest,{shouldContinue:()=>true,recoveryDecision:'continue_forward'});
  assert.equal(final.members.length,4);assert.deepEqual(fs.readFileSync(f.plan.members[0].original.location),Buffer.alloc(1024,20));
});
test('foreign final collision fails whole preflight before retaining or changing any original',async t=>{
  const f=fixture(t),staged=await f.port.stage(f.plan,{shouldContinue:()=>true}),manifest=publishedManifest(f.plan,staged),foreign=f.plan.members[3].targetLocation;
  fs.mkdirSync(path.dirname(foreign));fs.writeFileSync(foreign,'foreign');
  await assert.rejects(f.port.publish(f.plan,manifest,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_TARGET_CONFLICT'});
  assert.equal(fs.readFileSync(foreign,'utf8'),'foreign');
  for(const member of f.plan.members){assert.equal(fs.existsSync(member.retainedLocation),false);assert.deepEqual(fs.readFileSync(member.original.location),Buffer.alloc(1024,member.ordinal+20));}
});
test('correction stage reuses complete matching members and refuses foreign stage bytes without changing either original or conflict',async t=>{
  const {plan,port}=fixture(t),first=await port.stage(plan,{shouldContinue:()=>true});
  assert.deepEqual(await port.stage(plan,{shouldContinue:()=>true}),first);
  const conflict=Buffer.alloc(2048,92),location=first.members.find(item=>item.role==='fanart').location;fs.writeFileSync(location,conflict);
  await assert.rejects(port.stage(plan,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_STAGE_CONFLICT'});
  assert.deepEqual(fs.readFileSync(location),conflict);assert.deepEqual(fs.readFileSync(plan.members[0].original.location),Buffer.alloc(1024,20));
});

test('independent final verification rejects changed targets and missing retained originals without repairing either',async t=>{
  const {plan,port}=fixture(t),staged=await port.stage(plan,{shouldContinue:()=>true}),manifest=publishedManifest(plan,staged);
  await port.publish(plan,manifest,{shouldContinue:()=>true});
  const target=plan.members[1].targetLocation,original=fs.readFileSync(target),changed=Buffer.from(original);changed[500]^=1;fs.writeFileSync(target,changed);
  await assert.rejects(port.verify(plan,manifest,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_FILE_DRIFT'});
  await assert.rejects(port.readVerifiedNfo(plan,manifest,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_FILE_DRIFT'});
  assert.deepEqual(fs.readFileSync(target),changed);fs.writeFileSync(target,original);
  const retained=plan.members[2].retainedLocation;fs.unlinkSync(retained);
  await assert.rejects(port.verify(plan,manifest,{shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_FILE_DRIFT'});
  assert.equal(fs.existsSync(retained),false);assert.deepEqual(fs.readFileSync(plan.members[0].original.location),Buffer.alloc(1024,20));
});
