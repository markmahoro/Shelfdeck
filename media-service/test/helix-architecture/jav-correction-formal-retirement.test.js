'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createJavCorrectionFormalFiles}=require('../../src/helix/integrations/jav-correction-formal-files');
const {createJavCorrectionFormalRetirement}=require('../../src/helix/integrations/jav-correction-formal-retirement');
const {buildJavCorrectionFormalRetirementPlan,SCHEMA}=require('../../src/helix/domains/arca/model/jav-correction-formal-retirement');
const {javCorrectionRetainedLocation}=require('../../src/helix/contracts/jav-correction-retained-location');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../scripts/helix-architecture/shared-type-schema-builder');
const validator=createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas()),
  require('../../src/helix/domains/arca/model/jav-correction-commit-contract').javCorrectionCommitReceiptSchema()]});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function physical(location){const observed=computeBoundedMaterialFingerprintSync(location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
  fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
  return {schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple};}
async function fixture(t,{overlap=false,crossVolume=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-retirement-')),shelf=path.join(root,'shelf'),old=path.join(shelf,'old'),workspace=path.join(root,'workspace'),
    correctionId='arca-jav-correction-'+canonicalDigest('case').slice(0,40),sources=new Map(),video=Buffer.alloc(2048,44);
  fs.mkdirSync(old,{recursive:true});fs.mkdirSync(workspace);
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('jav-retirement-'));fs.rmSync(root,{recursive:true,force:true});});
  const members=['primary_payload','metadata_sidecar','poster','fanart'].map((role,ordinal)=>{
    const name=['film.mkv','film.nfo','poster.jpg','fanart.jpg'][ordinal],location=path.join(old,name);fs.writeFileSync(location,ordinal===0?video:Buffer.alloc(1024,20+ordinal));
    const original={ordinal,role,location,endpointId:'target',bindingRevision:1,controlRevision:1,controlProjectionDigest:canonicalDigest('old-control-'+ordinal),physicalIdentity:physical(location)};
    let source={kind:'retained_inventory',workspaceMaterialHandle:null,artifactHandle:null};
    if(ordinal){const location=path.join(workspace,name),bytes=Buffer.alloc(2048,60+ordinal);fs.writeFileSync(location,bytes);
      const handle={handleId:String(ordinal),sizeBytes:bytes.length,digestHex:hash(bytes),physicalIdentity:physical(location)};sources.set(handle.handleId,{location});source={kind:'correction_artifact',workspaceMaterialHandle:handle,artifactHandle:null};}
    return {ordinal,role,original,source,retainedLocation:javCorrectionRetainedLocation(correctionId,ordinal,location),targetEndpointId:'target',targetLocation:overlap?location:path.join(shelf,'new',name)};
  }),body={schemaRef:'helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1',schemaVersion:1,correctionId,shelfEntryId:'entry',admissionDigest:canonicalDigest('admission'),
    scopeDigest:canonicalDigest('scope'),basisDigest:canonicalDigest('basis'),target:{rootLocation:shelf,mountScopeId:'mount',mountScopeRevision:1,endpointId:'target'},members},plan={...body,planDigest:canonicalDigest(body)},
    formal=createJavCorrectionFormalFiles({resolveWorkspaceMaterial:(_id,_admission,handle)=>sources.get(handle.handleId)}),staged=await formal.stage(plan,{shouldContinue:()=>true});
  if(crossVolume){const original=staged.members[0],location=original.location;fs.unlinkSync(location);fs.copyFileSync(members[0].original.location,location);original.physicalIdentity=physical(location);}
  const manifestBody={sourceProductManifestDigest:plan.planDigest,stagedMembers:staged.members.map(row=>({role:row.role,location:row.location,physicalIdentity:row.physicalIdentity,fullByteDigest:row.byteDigest}))},
    manifest={...manifestBody,manifestDigest:canonicalDigest(manifestBody)};
  await formal.publish(plan,manifest,{shouldContinue:()=>true});
  const result={schemaRef:'helix://contracts/types/JavCorrectionCommitReceipt/v1',schemaVersion:1,receiptId:'receipt',receiptKind:'jav_identity_correction_committed',ownerDomain:'arca',
    scopeType:'jav_identity_correction',scopeId:correctionId,scopeDigest:plan.scopeDigest,effectReceiptRef:'effect-receipt',committedAtMs:100,
    correctionId,shelfEntryId:'entry',previousCanonicalIdentityRevision:1,newCanonicalIdentityRevision:2,previousInventoryRevision:1,newInventoryRevision:2,
    canonicalIdentityDigest:canonicalDigest('new-identity'),canonicalIdentityKey:canonicalDigest('new-key'),inventoryDigest:canonicalDigest('new-inventory'),verificationDigest:canonicalDigest('verification'),
    controlChangeDigest:canonicalDigest('control-change'),changeDigest:canonicalDigest('change'),originalCommitDigest:canonicalDigest('original-commit')},
    terminalEvidenceDigest=canonicalDigest({schema:'arca.jav-correction-inventory-commit@1',changeDigest:result.changeDigest,controlChangeDigest:result.controlChangeDigest,receiptDigest:canonicalDigest(result)}),
    record={correctionId,shelfEntryId:'entry',admissionDigest:plan.admissionDigest,state:'committed',terminalAtMs:100,terminalEvidenceDigest,
      proof:{basis:{shelfId:'shelf',basisDigest:plan.basisDigest,originalCommitDigest:result.originalCommitDigest,materials:members.map(row=>row.original)}}},
    commit={kind:'succeeded',resultSchemaRef:result.schemaRef,result,effectReceipt:{effectReceiptId:'effect-receipt',effectClass:'responsibility_control_commit',verificationEvidenceDigest:terminalEvidenceDigest}},
    raw={entry:{shelf_entry_id:'entry',shelf_id:'shelf',status:'active',canonical_identity_revision:2,current_inventory_revision:2,canonical_identity_key:result.canonicalIdentityKey},
      shelf:{status:'active'},identity:{identity_digest:result.canonicalIdentityDigest},inventory:{representation_digest:result.inventoryDigest},reservations:[],correctionGate:null,
      materials:members.map((member,index)=>{const identity=manifest.stagedMembers[index].physicalIdentity;return {ordinal:index,role:member.role,location:member.targetLocation,endpoint_id:'target',binding_revision:2,
        material_key:identity.materialKey,mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,fingerprint_algorithm:identity.fingerprintAlgorithm,
        fingerprint_version:identity.fingerprintVersion,content_fingerprint:identity.contentFingerprint};})},
    finalKeys=new Set(raw.materials.map(row=>row.material_key)),keys=[...new Set([...finalKeys,...members.map(row=>row.original.physicalIdentity.materialKey)])],
    controls=keys.map(materialKey=>({materialKey,resultKind:'available',controlRevision:2,projectionDigest:canonicalDigest('current-control-'+materialKey),
      controlState:finalKeys.has(materialKey)?'controlled':'uncontrolled',...(finalKeys.has(materialKey)?{ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry'}:{})})),
    input={record,commit,plan,manifest,raw,controlProjections:controls,activeCases:[]},retirement=buildJavCorrectionFormalRetirementPlan(input);
  validator.validate(result.schemaRef,result);validator.validate(SCHEMA,retirement);
  const port=createJavCorrectionFormalRetirement({validatePlan:value=>validator.validate(SCHEMA,value)}),options={shouldContinue:()=>true,readCurrentGuardDigest:()=>buildJavCorrectionFormalRetirementPlan(input).guardDigest};
  return {root,shelf,old,video,input,retirement,port,options};
}
test('post-commit formal retirement removes only the declared old and stage aliases and conserves final video identity and bytes',async t=>{
  const f=await fixture(t),before=canonicalDigest(f.input),primary=f.retirement.finals[0],result=await f.port.retire(f.retirement,f.options);
  assert.equal(result.retiredAliasCount,12);assert.equal(fs.existsSync(f.retirement.stageDirectory),false);
  for(const row of f.retirement.retirements)assert.equal(fs.existsSync(row.location),false);
  assert.deepEqual(fs.readFileSync(primary.location),f.video);assert.equal(String(fs.statSync(primary.location,{bigint:true}).ino),primary.physicalIdentity.inode);
  assert.equal(canonicalDigest(f.input),before);assert.equal(result.commitReceiptDigest,canonicalDigest(f.input.commit.result));
});
test('overlapping old and new paths protect every final binding including the original video',async t=>{
  const f=await fixture(t,{overlap:true});assert.equal(f.retirement.retirements.length,8);
  assert.ok(f.retirement.retirements.every(row=>row.kind!=='superseded_binding'));await f.port.retire(f.retirement,f.options);
  assert.deepEqual(fs.readFileSync(f.retirement.finals[0].location),f.video);for(const row of f.retirement.finals)assert.equal(hash(fs.readFileSync(row.location)),row.fullByteDigest);
});
test('a verified copy with a different physical identity retires only the released old video and keeps the new copy',async t=>{
  const f=await fixture(t,{crossVolume:true});assert.notEqual(f.retirement.finals[0].physicalIdentity.inode,f.input.plan.members[0].original.physicalIdentity.inode);
  await f.port.retire(f.retirement,f.options);assert.deepEqual(fs.readFileSync(f.retirement.finals[0].location),f.video);
});
test('unknown stage members and a replaced late alias stop the whole preflight without any deletion',async t=>{
  for(const kind of ['stage','alias']){
    const f=await fixture(t);let conflict;
    if(kind==='stage'){conflict=path.join(f.retirement.stageDirectory,'unknown.txt');fs.writeFileSync(conflict,'foreign');}
    else{conflict=f.retirement.retirements.at(-1).location;fs.unlinkSync(conflict);fs.writeFileSync(conflict,'foreign');}
    await assert.rejects(f.port.retire(f.retirement,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT'});
    assert.equal(fs.readFileSync(conflict,'utf8'),'foreign');assert.ok(fs.existsSync(f.input.plan.members[0].original.location));assert.deepEqual(fs.readFileSync(f.retirement.finals[0].location),f.video);
  }
});
test('current final byte drift and another owner acquiring a released material never authorize cleanup',async t=>{
  const f=await fixture(t),original=f.input.plan.members[0].original.location;
  const changed=Buffer.from(f.video);changed[5]^=1;fs.writeFileSync(f.retirement.finals[0].location,changed);
  await assert.rejects(f.port.retire(f.retirement,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_CONFLICT'});assert.ok(fs.existsSync(original));
  const other=await fixture(t);Object.assign(other.input.controlProjections.find(row=>row.controlState==='uncontrolled'),{controlState:'controlled',ownerDomain:'procurement',ownerScopeType:'material_field',ownerScopeId:'foreign'});
  await assert.rejects(other.port.retire(other.retirement,other.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});assert.ok(fs.existsSync(other.input.plan.members[0].original.location));
});
test('interrupted alias removal needs explicit original-Effect continuation and leaves final video intact throughout',async t=>{
  const f=await fixture(t),unlink=fs.unlinkSync;let removed=0;
  fs.unlinkSync=function(location,...args){const result=unlink.call(fs,location,...args);if(++removed===2)throw new Error('Injected retirement interruption.');return result;};
  try{await assert.rejects(f.port.retire(f.retirement,f.options),/Injected retirement interruption/);}finally{fs.unlinkSync=unlink;}
  assert.deepEqual(fs.readFileSync(f.retirement.finals[0].location),f.video);
  await assert.rejects(f.port.retire(f.retirement,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_INCOMPLETE'});
  const result=await f.port.retire(f.retirement,{...f.options,recoveryDecision:'continue_forward'});
  assert.equal(result.retiredAliasCount,12);assert.deepEqual(await f.port.retire(f.retirement,{...f.options,recoveryDecision:'continue_forward'}),result);
});
test('loss of the committed head guard between two removals prevents all later mutations',async t=>{
  const f=await fixture(t),unlink=fs.unlinkSync;let removed=0;
  fs.unlinkSync=function(location,...args){const result=unlink.call(fs,location,...args);if(++removed===2)f.input.raw.entry.current_inventory_revision++;return result;};
  try{await assert.rejects(f.port.retire(f.retirement,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});}finally{fs.unlinkSync=unlink;}
  assert.equal(removed,2);assert.deepEqual(fs.readFileSync(f.retirement.finals[0].location),f.video);assert.ok(fs.existsSync(f.retirement.retirements[2].location));
});
test('uncommitted or mismatched receipts refuse a plan and unrelated old-directory content is preserved',async t=>{
  const f=await fixture(t),before=canonicalDigest(f.input);
  for(const changed of [{...f.input.record,state:'active'},{...f.input.record,terminalEvidenceDigest:canonicalDigest('foreign')}])
    assert.throws(()=>buildJavCorrectionFormalRetirementPlan({...f.input,record:changed}),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});
  const notes=path.join(f.old,'notes.txt');fs.writeFileSync(notes,'keep');await f.port.retire(f.retirement,f.options);
  assert.equal(fs.readFileSync(notes,'utf8'),'keep');assert.equal(canonicalDigest(f.input),before);
});
test('a resealed path expansion cannot borrow the original Entry and Control guard',async t=>{
  const f=await fixture(t),foreign=path.join(f.old,'foreign.mkv');fs.writeFileSync(foreign,f.video);
  const changed=structuredClone(f.retirement);changed.retirements[0].location=foreign;changed.retirements[0].physicalIdentity=physical(foreign);
  const {planDigest:ignored,...body}=changed;changed.planDigest=canonicalDigest(body);
  await assert.rejects(f.port.retire(changed,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_PLAN_INVALID'});
  changed.guard.retirementSetDigest=canonicalDigest({targetRoot:changed.targetRoot,stageDirectory:changed.stageDirectory,finals:changed.finals,retirements:changed.retirements,
    filePlanDigest:changed.filePlanDigest,stagedManifestDigest:changed.stagedManifestDigest});changed.guardDigest=canonicalDigest(changed.guard);
  const {planDigest:ignoredAgain,...sealed}=changed;changed.planDigest=canonicalDigest(sealed);
  await assert.rejects(f.port.retire(changed,f.options),{code:'ARCA_JAV_CORRECTION_RETIREMENT_FENCED'});
  assert.deepEqual(fs.readFileSync(foreign),f.video);assert.ok(fs.existsSync(f.input.plan.members[0].original.location));
});
test('missing owner concurrency observations and expanded nominal payloads fail closed',async t=>{
  const f=await fixture(t);
  assert.throws(()=>buildJavCorrectionFormalRetirementPlan({...f.input,activeCases:undefined}),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});
  assert.throws(()=>buildJavCorrectionFormalRetirementPlan({...f.input,raw:{...f.input.raw,reservations:undefined}}),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});
  const {correctionGate:ignored,...unknownGate}=f.input.raw;
  assert.throws(()=>buildJavCorrectionFormalRetirementPlan({...f.input,raw:unknownGate}),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});
  assert.throws(()=>validator.validate(SCHEMA,{...f.retirement,deleteAnyPrimary:true}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});
