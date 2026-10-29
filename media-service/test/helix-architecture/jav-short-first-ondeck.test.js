'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test');
const {createCleanArcaInventoryPort}=require('../../src/clean-arca-inventory-port');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const {javFeasibilityFailureOutcome,stagePreconditionFailureOutcome,shortenedStageObservationFailureOutcome}=require('../../src/helix/domains/arca/capabilities/on-deck-capability-ports');

function member(location,role){
  const observed=computeBoundedMaterialFingerprintSync(location),base={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
    physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,...base,
      materialKey:canonicalDigest({schema:'physical-material-identity@2',...base})};
  return {materialKey:physicalIdentity.materialKey,role,physicalIdentity,sizeBytes:base.sizeBytes,
    location:{locationKind:'domain_binding',endpointId:'source',location},workspaceMaterialHandle:null,
    episodeClaims:[],episodeClaimSetDigest:canonicalDigest({schema:'libra.production-material-episode-claims@1',items:[]})};
}
function fixture(title,code='HALT-094'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-short-first-')),source=path.join(root,'source'),target=path.join(root,'target');
  fs.mkdirSync(source);fs.mkdirSync(target);
  const files={primary:path.join(source,'input.mkv'),nfo:path.join(source,'input.nfo'),poster:path.join(source,'input.jpg')};
  fs.writeFileSync(files.primary,'synthetic media');fs.writeFileSync(files.nfo,'<movie><title>synthetic</title></movie>');fs.writeFileSync(files.poster,'synthetic poster');
  const shelf={shelfId:'shelf',status:'active',currentStandardRevision:1,currentPlacementRevision:1,target:{endpointId:'target',rootLocation:target,mountScopeId:'mount',mountScopeRevision:1},
    placement:{value:{folderTemplate:'{title}'}}};
  const packageValue={onDeckPackageId:'package',packageDigest:'package-digest',shelfId:'shelf',resolvedIdentitySnapshot:{factValue:{contentProfile:'jav',structureKind:'single',
    identityKind:'jav_code',title,year:2026,providerIdentities:[{provider:'jav',namespace:'jav_code',providerKey:code}]}},
    productStructureSnapshot:{structureKind:'single'},productMaterialManifest:{manifestDigest:'manifest',members:[member(files.primary,'primary_payload'),
      member(files.nfo,'metadata_sidecar'),member(files.poster,'poster')]},offloadContextManifest:{manifestDigest:'offload',members:[]}};
  const port=createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:path.join(root,'workspace')});
  const request={onDeckRunId:'run',custodyId:'custody',shelf,onDeckProductPackage:packageValue,observedAtMs:10};
  return {root,target,files,port,shelf,packageValue,request};
}
async function stagedFixture(f){
  const decision=f.port.prepare(f.request),request={...f.request,finalInventoryDecision:decision},slot=f.port.prepareSlot(request),
    staged=await f.port.stage({...request,targetCommitSlotHandle:slot}),
    verification=await f.port.verifyStaged({...request,stagedInventoryManifest:staged});
  const placement={...request,stagedInventoryManifest:staged,stagedInventoryVerification:verification,
    targetBindings:{bindingSetDigest:'binding'},replacedInputSetDigest:'inputs'};
  return {decision,slot,staged,verification,placement};
}

for(const [code,title] of [['HALT-094','HALT-094 '+'題'.repeat(74)+'A'],['EMLB-094','EMLB-094 '+'題'.repeat(85)]]){
  test('new '+code+' Decision uses one bounded title and preserves the source facts through formal placement',async()=>{
    const f=fixture(title,code);
    try{
      const before=JSON.stringify(f.packageValue),feasibility=f.port.assess(f.request),x=await stagedFixture(f),
        primary=x.decision.members.find(item=>item.role==='primary_payload'),nfo=x.decision.members.find(item=>item.role==='metadata_sidecar');
      assert.ok(feasibility.finalInventoryDecisionDraftDigest);assert.deepEqual(f.port.prepare(f.request),x.decision);
      assert.equal(x.slot.targetDirectory,f.port.resolveTargetLocation(f.request).targetDirectory);
      assert.ok(path.basename(x.slot.targetDirectory).startsWith(code+' '));
      assert.ok(Buffer.byteLength(path.basename(x.slot.targetDirectory)+'.shelfdeck-stage-'+'0'.repeat(16))<=255);
      for(const item of x.decision.members)assert.ok(Buffer.byteLength(item.finalName+'.restore-'+'0'.repeat(16))<=255);
      assert.equal(path.basename(primary.finalName,'.mkv'),path.basename(nfo.finalName,'.nfo'));
      assert.ok(primary.finalName.endsWith(' (2026).mkv'));assert.ok(nfo.finalName.endsWith(' (2026).nfo'));
      const receipt=await f.port.switchPlacement(x.placement);assert.equal(receipt.receiptKind,'placement_switched');
      assert.equal(fs.readFileSync(primary.targetLocation,'utf8'),'synthetic media');
      assert.equal(fs.readFileSync(nfo.targetLocation,'utf8'),'<movie><title>synthetic</title></movie>');
      assert.equal(fs.readFileSync(f.files.primary,'utf8'),'synthetic media');assert.equal(JSON.stringify(f.packageValue),before);
    }finally{fs.rmSync(f.root,{recursive:true,force:true});}
  });
}

test('an in-budget JAV title is not truncated to the legacy UTF-16 limit',()=>{
  const f=fixture('A'.repeat(190));try{
    const decision=f.port.prepare(f.request),primary=decision.members.find(item=>item.role==='primary_payload');
    assert.equal(path.basename(path.dirname(primary.targetLocation)),'A'.repeat(190));
    assert.equal(primary.finalName,'A'.repeat(190)+' (2026).mkv');
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a shortened target cannot adopt an existing directory even when its media bytes match',async()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const decision=f.port.prepare(f.request),request={...f.request,finalInventoryDecision:decision},slot=f.port.prepareSlot(request),
      primary=decision.members.find(item=>item.role==='primary_payload');
    fs.mkdirSync(slot.targetDirectory);fs.copyFileSync(f.files.primary,primary.targetLocation);
    const before=fs.statSync(primary.targetLocation,{bigint:true}).ino;
    await assert.rejects(()=>f.port.stage({...request,targetCommitSlotHandle:slot}),{code:'CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED'});
    assert.equal(fs.statSync(primary.targetLocation,{bigint:true}).ino,before);assert.equal(fs.readFileSync(primary.targetLocation,'utf8'),'synthetic media');
    assert.deepEqual(fs.readdirSync(slot.slotDirectory),[]);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a pre-existing stage is preserved instead of being attributed to a fresh shortened Effect',async()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const decision=f.port.prepare(f.request),request={...f.request,finalInventoryDecision:decision},slot=f.port.prepareSlot(request),
      primary=decision.members.find(item=>item.role==='primary_payload'),foreign=path.join(slot.slotDirectory,primary.finalName);
    fs.copyFileSync(f.files.primary,foreign);const before=fs.statSync(foreign,{bigint:true}).ino;
    await assert.rejects(()=>f.port.stage({...request,targetCommitSlotHandle:slot}),{code:'CLEAN_ARCA_SHORT_STAGE_UNCERTAIN'});
    assert.equal(fs.statSync(foreign,{bigint:true}).ino,before);assert.equal(fs.existsSync(slot.targetDirectory),false);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a shortened staging slot cannot redirect writes through a symlink',t=>{
  if(process.platform==='win32')return t.skip('Directory symlink creation requires separate Windows privileges.');
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const decision=f.port.prepare(f.request),request={...f.request,finalInventoryDecision:decision},slot=f.port.slotHandle(request),
      foreign=path.join(f.root,'foreign');fs.mkdirSync(foreign);fs.symlinkSync(foreign,slot.slotDirectory,'dir');
    assert.throws(()=>f.port.prepareSlot(request),{code:'CLEAN_ARCA_SHORT_STAGE_UNCERTAIN'});
    assert.deepEqual(fs.readdirSync(foreign),[]);assert.equal(fs.lstatSync(slot.slotDirectory).isSymbolicLink(),true);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a target appearing after staging is preserved and cannot become a placement receipt',async()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const x=await stagedFixture(f),primary=x.decision.members.find(item=>item.role==='primary_payload');
    fs.mkdirSync(x.slot.targetDirectory);fs.copyFileSync(f.files.primary,primary.targetLocation);
    const before=fs.statSync(primary.targetLocation,{bigint:true}).ino;
    await assert.rejects(()=>f.port.switchPlacement(x.placement),{code:'CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN'});
    assert.equal(fs.statSync(primary.targetLocation,{bigint:true}).ino,before);
    assert.equal(fs.readdirSync(x.slot.slotDirectory).length,x.decision.members.length);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('an interrupted shortened publication is not classified as completed on re-entry',async()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const x=await stagedFixture(f);
    await assert.rejects(()=>f.port.switchPlacement({...x.placement,shouldContinue:()=>
      !fs.existsSync(x.slot.targetDirectory)||fs.readdirSync(x.slot.targetDirectory).length===0}),{code:'CLEAN_ARCA_EFFECT_FENCED'});
    assert.equal(fs.readdirSync(x.slot.targetDirectory).length,1);
    assert.equal(fs.readdirSync(x.slot.slotDirectory).length,x.decision.members.length);
    await assert.rejects(()=>f.port.switchPlacement(x.placement),{code:'CLEAN_ARCA_SHORT_STAGE_UNCERTAIN'});
    assert.equal(fs.readdirSync(x.slot.targetDirectory).length,1);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('a fresh service instance cannot infer Stage continuity from saved names and bytes',async()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    const x=await stagedFixture(f),fresh=createCleanArcaInventoryPort({schemaManifest,unitOfWork:{},workspaceRoot:path.join(f.root,'workspace')});
    await assert.rejects(()=>fresh.verifyStaged({...f.request,finalInventoryDecision:x.decision,stagedInventoryManifest:x.staged}),
      {code:'CLEAN_ARCA_SHORT_STAGE_UNCERTAIN'});
    assert.equal(fs.readdirSync(x.slot.slotDirectory).length,x.decision.members.length);assert.equal(fs.existsSync(x.slot.targetDirectory),false);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('shortening requires matching primary and NFO stems and retains an over-budget original-name member',()=>{
  const f=fixture('HALT-094 '+'題'.repeat(80));try{
    f.shelf.placement.value.nfoTemplate='other-{stem}.nfo';
    assert.throws(()=>f.port.prepare(f.request),{code:'CLEAN_ARCA_JAV_SHORT_STEM_MISMATCH'});
    f.shelf.placement.value.nfoTemplate='{stem}.nfo';
    const related=path.join(path.dirname(f.files.primary),'a'.repeat(231));fs.writeFileSync(related,'related');
    f.packageValue.productMaterialManifest.members.push(member(related,'sidecar'));
    assert.throws(()=>f.port.prepare(f.request),{code:'CLEAN_ARCA_JAV_TITLE_UNFITTING'});
    assert.equal(fs.readFileSync(related,'utf8'),'related');assert.deepEqual(fs.readdirSync(f.target),[]);
  }finally{fs.rmSync(f.root,{recursive:true,force:true});}
});

test('only deterministic JAV naming failures become non-retryable feasibility outcomes',()=>{
  const jav={resolvedIdentitySnapshot:{factValue:{contentProfile:'jav'}}},movie={resolvedIdentitySnapshot:{factValue:{contentProfile:'movie'}}};
  for(const [input,expected] of [['CLEAN_ARCA_TARGET_SEGMENT_INVALID','CLEAN_ARCA_JAV_NAME_INVALID'],
    ['CLEAN_ARCA_TARGET_COLLISION','CLEAN_ARCA_JAV_TARGET_COLLISION'],['CLEAN_ARCA_JAV_TITLE_UNFITTING','CLEAN_ARCA_JAV_TITLE_UNFITTING']]){
    const error=Object.assign(new Error('fixture'),{code:input}),outcome=javFeasibilityFailureOutcome(error,jav);
    assert.equal(outcome.code,expected);assert.equal(outcome.retryDirective,'never');assert.equal(outcome.failureClass,'contract');
    assert.equal(javFeasibilityFailureOutcome(error,movie),null);
  }
  assert.equal(javFeasibilityFailureOutcome(Object.assign(new Error('io'),{code:'EIO'}),jav),null);
  const conflict=stagePreconditionFailureOutcome(Object.assign(new Error('occupied'),{code:'CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED'}));
  assert.equal(conflict.retryDirective,'never');assert.equal(conflict.failureClass,'stage_precondition');
  const unknown=shortenedStageObservationFailureOutcome(Object.assign(new Error('unclassified'),{code:'CLEAN_ARCA_SHORT_STAGE_UNCERTAIN'}));
  assert.equal(unknown.retryDirective,'never');assert.equal(unknown.failureClass,'stage_precondition');
  assert.equal(shortenedStageObservationFailureOutcome(Object.assign(new Error('io'),{code:'EIO'})),null);
});
