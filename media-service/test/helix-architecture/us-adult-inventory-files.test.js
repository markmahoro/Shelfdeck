'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {PLAN,createUsAdultInventoryFiles}=require('../../src/helix/integrations/us-adult-inventory-files');
const {retainedName}=require('../../src/helix/contracts/us-adult-retained-name');
function fixture(t,{sameActor=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-actor-files-')),shelf=path.join(root,'shelf'),workspace=path.join(root,'workspace'),
    old=path.join(shelf,'Old Actor Original.Scene'),target=sameActor?old:path.join(shelf,'New Actor Original.Scene');
  fs.mkdirSync(old,{recursive:true});fs.mkdirSync(workspace);
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const roles=['primary_payload','metadata_sidecar','poster','fanart'],names=['Old Actor Original.Scene.mkv','Old Actor Original.Scene.nfo','poster.jpg','fanart.jpg'],
    aftercareCaseId='actor-case',members=roles.map((role,ordinal)=>{
      const location=path.join(old,names[ordinal]);fs.writeFileSync(location,Buffer.alloc(400000+ordinal,ordinal+23));
      const fp=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'shelf-mount',inode:String(fp.stat.ino),sizeBytes:Number(fp.stat.size),
        fingerprintAlgorithm:fp.fingerprintAlgorithm,fingerprintVersion:fp.fingerprintVersion,contentFingerprint:fp.contentFingerprint},
        identity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:D({schema:'physical-material-identity@2',...tuple}),...tuple};
      let source={kind:'retained_inventory'};
      if(['metadata_sidecar','poster'].includes(role)){
        const artifact=path.join(workspace,role);fs.writeFileSync(artifact,Buffer.alloc(50000,ordinal+44));
        source={kind:'actor_artifact',workspaceMaterialHandle:{location:artifact,sizeBytes:50000,digestHex:crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex')}};
      }
      return {ordinal,role,original:{location,rootLocation:shelf,physicalIdentity:identity,bindingRevision:2},source,
        retainedLocation:path.join(path.dirname(location),retainedName(aftercareCaseId,ordinal)),targetEndpointId:'shelf',
        targetLocation:path.join(target,ordinal<2?(sameActor?'Old Actor':'New Actor')+' Original.Scene.'+(ordinal===0?'mkv':'nfo'):names[ordinal])};
    }),body={schemaRef:PLAN,schemaVersion:1,aftercareCaseId,intentDigest:D('intent'),target:{rootLocation:shelf,endpointId:'shelf',mountScopeId:'shelf-mount'},members},
    plan={...body,planDigest:D(body)},io=createUsAdultInventoryFiles({resolveWorkspaceMaterial:(_case,_intent,handle)=>({location:handle.location})}),
    settings={shouldContinue:()=>true};
  return {root,shelf,old,target,plan,io,settings};
}
test('actor file publication preserves originals until commit and retires only exact old aliases',async t=>{
  const x=fixture(t),stage=await x.io.stage(x.plan,x.settings),published=await x.io.publish(x.plan,stage,x.settings);
  assert.equal(published.members.length,4);
  for(const member of x.plan.members){assert.ok(fs.existsSync(member.original.location));assert.ok(fs.existsSync(member.retainedLocation));assert.ok(fs.existsSync(member.targetLocation));}
  await assert.rejects(x.io.retire(x.plan,stage,x.settings),{code:'ARCA_US_ADULT_RETIREMENT_NOT_COMMITTED'});
  const retired=await x.io.retire(x.plan,stage,{...x.settings,inventoryCommitted:true});assert.ok(retired.deletedCount>0);assert.equal(fs.existsSync(x.old),false);
  assert.equal((await x.io.retire(x.plan,stage,{...x.settings,inventoryCommitted:true})).deletedCount,0);
  assert.ok(fs.existsSync(x.shelf));for(const member of x.plan.members)assert.ok(fs.existsSync(member.targetLocation));
});
test('refreshing the same actor replaces poster and NFO while keeping video identity and bytes',async t=>{
  const x=fixture(t,{sameActor:true}),video=x.plan.members[0],before=fs.readFileSync(video.original.location),stage=await x.io.stage(x.plan,x.settings);
  await x.io.publish(x.plan,stage,x.settings);await x.io.verify(x.plan,stage,x.settings);
  await x.io.retire(x.plan,stage,{...x.settings,inventoryCommitted:true});assert.deepEqual(fs.readFileSync(video.targetLocation),before);
  assert.equal(String(fs.statSync(video.targetLocation,{bigint:true}).ino),video.original.physicalIdentity.inode);
  assert.deepEqual(fs.readFileSync(x.plan.members[1].targetLocation),fs.readFileSync(x.plan.members[1].source.workspaceMaterialHandle.location));
});
test('partial publication resumes the same plan without duplicate prefixes or overwriting a foreign target',async t=>{
  const x=fixture(t),stage=await x.io.stage(x.plan,x.settings);let checks=0;
  await assert.rejects(x.io.publish(x.plan,stage,{shouldContinue:()=>{
    if(fs.existsSync(x.plan.members[0].targetLocation)&&++checks>0)throw Object.assign(new Error('Isolated interruption'),{code:'INTERRUPTED'});return true;}}),{code:'INTERRUPTED'});
  await x.io.publish(x.plan,stage,{...x.settings,recoveryDecision:'continue_forward'});assert.equal((await x.io.verify(x.plan,stage,x.settings)).members.length,4);
  const foreign=path.join(x.target,'foreign.txt');fs.writeFileSync(foreign,'keep');
  await assert.rejects(x.io.publish(x.plan,stage,{...x.settings,recoveryDecision:'continue_forward'}),{code:'ARCA_US_ADULT_TARGET_CONFLICT'});assert.equal(fs.readFileSync(foreign,'utf8'),'keep');
});
test('source drift, a pre-existing target and cancellation fail before changing original files',async t=>{
  const x=fixture(t),stage=await x.io.stage(x.plan,x.settings);fs.mkdirSync(x.target);
  await assert.rejects(x.io.publish(x.plan,stage,x.settings),{code:'ARCA_US_ADULT_TARGET_CONFLICT'});
  fs.rmdirSync(x.target);fs.appendFileSync(x.plan.members[0].original.location,'changed');
  await assert.rejects(x.io.publish(x.plan,stage,x.settings),{code:'ARCA_US_ADULT_FILE_CHANGED'});
  await assert.rejects(x.io.stage(x.plan,{shouldContinue:()=>false}),{code:'ARCA_US_ADULT_FILE_FENCED'});
  for(const member of x.plan.members)assert.ok(fs.existsSync(member.original.location));assert.equal(fs.existsSync(x.target),false);
});

test('only a fresh publication preflight proves that its Effect has not started writing',async t=>{
  const x=fixture(t),manifest=await x.io.stage(x.plan,x.settings);fs.mkdirSync(x.target);
  const foreign=path.join(x.target,'foreign.txt');fs.writeFileSync(foreign,'keep');
  await assert.rejects(x.io.publish(x.plan,manifest,x.settings),error=>{
    assert.equal(error.code,'ARCA_US_ADULT_TARGET_CONFLICT');
    assert.deepEqual(error.details,{effectWriteStarted:false,boundary:'before_publication'});return true;
  });
  assert.equal(x.plan.members.some(member=>fs.existsSync(member.retainedLocation)),false);
  await assert.rejects(x.io.publish(x.plan,manifest,{...x.settings,recoveryDecision:'continue_forward'}),error=>{
    assert.equal(error.code,'ARCA_US_ADULT_TARGET_CONFLICT');assert.equal(error.details,undefined);return true;
  });
  assert.equal(fs.readFileSync(foreign,'utf8'),'keep');
});

test('a classified partial stage resumes only an exact source prefix and reports foreign bytes as conflict',async t=>{
  const x=fixture(t),directory=path.join(x.shelf,'.shelfdeck-us-'+D(x.plan.aftercareCaseId).slice(0,32)+'-stage'),
    partial=path.join(directory,'0001.stage.part'),source=x.plan.members[1].source.workspaceMaterialHandle.location;
  fs.mkdirSync(directory);fs.writeFileSync(partial,fs.readFileSync(source).subarray(0,100));
  const observed=await x.io.observe(x.plan,null,'stage',x.settings);assert.equal(observed.members[1].partial,true);
  await assert.rejects(x.io.stage(x.plan,x.settings),{code:'ARCA_US_ADULT_STAGE_PARTIAL_WRITE'});
  const manifest=await x.io.stage(x.plan,{...x.settings,recoveryDecision:'continue_forward'});assert.equal(manifest.members.length,4);
  assert.equal(fs.existsSync(partial),false);
  fs.writeFileSync(partial,Buffer.from('foreign stage bytes'));
  await assert.rejects(x.io.observe(x.plan,null,'stage',x.settings),{code:'ARCA_US_ADULT_STAGE_CONFLICT'});
  assert.equal(fs.readFileSync(partial,'utf8'),'foreign stage bytes');
});

test('read-only Effect recovery validates partial publication and post-commit retirement without performing either',async t=>{
  const x=fixture(t),manifest=await x.io.stage(x.plan,x.settings);
  await assert.rejects(x.io.publish(x.plan,manifest,{shouldContinue:()=>{
    if(fs.existsSync(x.plan.members[0].targetLocation))throw Object.assign(new Error('Interrupted publisher'),{code:'INTERRUPTED'});return true;
  }}),{code:'INTERRUPTED'});
  const before=fs.readdirSync(x.target),publication=await x.io.observe(x.plan,manifest,'publish',x.settings);
  assert.equal(publication.members[0].finalExact,true);assert.deepEqual(fs.readdirSync(x.target),before);
  await x.io.publish(x.plan,manifest,{...x.settings,recoveryDecision:'continue_forward'});
  assert.equal((await x.io.observe(x.plan,manifest,'retire',x.settings)).members.length,4);
  assert.ok(fs.existsSync(x.old));
  await x.io.retire(x.plan,manifest,{...x.settings,inventoryCommitted:true});
  assert.equal((await x.io.observe(x.plan,manifest,'retire',x.settings)).members.every(member=>member.finalExact&&!member.retainedPresent),true);
});

test('an actual process exit after publication or retirement resumes the exact file plan',async t=>{
  const x=fixture(t),manifest=await x.io.stage(x.plan,x.settings),input=path.join(x.root,'crash-input.json'),
    worker=path.join(__dirname,'fixtures/us-adult-file-crash-worker.js');
  fs.writeFileSync(input,JSON.stringify({plan:x.plan,manifest}));
  // This qualifies actual file-effect crash boundaries. The formal Host and
  // SQLite transaction proofs are separate and are not replaced by this test.
  for(const phase of ['publish','retire']){
    const child=require('node:child_process').spawnSync(process.execPath,[worker,input,phase],{encoding:'utf8',windowsHide:true,timeout:15000});
    assert.equal(child.status,73,child.stderr);
    assert.equal((await x.io.observe(x.plan,manifest,phase,x.settings)).members[0].finalExact,true);
    await x.io[phase](x.plan,manifest,{...x.settings,recoveryDecision:'continue_forward',inventoryCommitted:phase==='retire'});
  }
  assert.equal(fs.existsSync(x.old),false);assert.ok(fs.existsSync(x.plan.members[0].targetLocation));
  assert.equal((await x.io.retire(x.plan,manifest,{...x.settings,inventoryCommitted:true})).deletedCount,0);
});
