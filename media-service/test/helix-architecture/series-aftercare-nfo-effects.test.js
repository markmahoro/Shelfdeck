'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fixture:acceptedFixture}=require('./fixtures/series-aftercare-context');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync:fingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {createAftercareCapabilityPorts,nfoInventoryFindings}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {seriesNfoProfileParameters}=require('../../src/helix/domains/arca/model/aftercare-series-nfo-targets');
const {CAPABILITY_REFS:C,deriveInventoryMaterialChanges}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
function outcomeValidator() {
  const root=path.join(__dirname,'../../src/helix/contracts'),schemas=new Map();
  function load(file) {
    const schema=JSON.parse(fs.readFileSync(file,'utf8'));if(schemas.has(schema.$id))return;
    schemas.set(schema.$id,schema);
    function visit(value) {
      if(!value||typeof value!=='object')return;
      if(value.$ref?.startsWith('helix://contracts/'))load(path.join(root,value.$ref.split('#')[0].slice('helix://contracts/'.length),'schema.json'));
      Object.values(value).forEach(visit);
    }
    visit(schema);
  }
  for(const capability of [C.textRender,C.artifactMaterialize])for(const kind of ['result','evidence'])
    load(path.join(root,'capabilities',...capability.replace('@1','').split('.'),'v1',kind+'.schema.json'));
  load(path.join(root,'types/EffectReceipt/v1/schema.json'));
  const validator=createCapabilityContractValidator({schemas:[...schemas.values()]});
  return outcome=>{
    validator.validate(outcome.resultSchemaRef,outcome.result);validator.validate(outcome.evidenceSchemaRef,outcome.evidence);
    validator.validate(outcome.effectReceipt.schemaRef,outcome.effectReceipt);
  };
}
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-nfo-effects-')),shelf=path.join(root,'shelf'),workspace=path.join(root,'workspace');
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(shelf);
  const context=acceptedFixture();context.shelfEntryId='entry';context.basis={digest:canonicalDigest('basis')};
  context.raw.entry.current_inventory_revision=1;
  context.raw.shelf={status:'active',current_standard_revision:1,target_root_location:shelf,target_endpoint_id:'endpoint',target_mount_scope_id:'mount'};
  context.raw.standard={standard_digest:canonicalDigest('standard')};context.raw.reservations=[];
  context.raw.facts.forEach(row=>{row.fact_digest=canonicalDigest(row.value);});
  for(const row of context.raw.materials) {
    row.name=row.material_key;row.location=path.join(shelf,row.name+(row.role==='metadata_sidecar'?'.nfo':'.mkv'));
    fs.writeFileSync(row.location,'External '+row.name);
    const observed=fingerprint(row.location),tuple={mountScopeId:'mount',inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
      fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
    Object.assign(row,{material_key:canonicalDigest({schema:'physical-material-identity@2',...tuple}),endpoint_id:'endpoint',binding_revision:1,
      mount_scope_id:'mount',inode:tuple.inode,size_bytes:tuple.sizeBytes,fingerprint_algorithm:tuple.fingerprintAlgorithm,
      fingerprint_version:tuple.fingerprintVersion,content_fingerprint:tuple.contentFingerprint});
  }
  const missing=context.raw.materials.find(row=>row.name==='two'),damaged=context.raw.materials.find(row=>row.name==='three');
  fs.unlinkSync(missing.location);fs.writeFileSync(damaged.location,'');
  const findings=nfoInventoryFindings(context).map((draft,index)=>({findingId:'finding-'+index,assessmentId:'presentation',
    findingKind:'presentation:'+draft.schemaRef.split('/')[5],findingDigest:draft.snapshotDigest,severity:'warning',repairability:'attention_required'}));
  findings.push({findingId:'custody-missing',assessmentId:'custody',findingKind:'custody:artifact_missing',severity:'critical',repairability:'attention_required',
    findingDigest:canonicalDigest({kind:'custody',code:'artifact_missing',severity:'critical',repairability:'attention_required',basis:missing.material_key})});
  const requirement={careBasisDigest:context.basis.digest,requiredEffects:findings.map(row=>({objectId:row.findingId,digest:row.findingDigest})),
    typedParameters:findings.map((row,index)=>({parameter:'finding.'+index,value:row.findingKind}))};
  const care={state:'active',aftercareCaseId:'case',careBasisDigest:context.basis.digest,careRequirementDigest:canonicalDigest(requirement),
    careRequirement:{...requirement,digest:canonicalDigest(requirement)}};
  const history={cases:[care],findings,commits:[],assessments:['presentation','custody'].map(kind=>({assessmentId:kind,
    assessmentKind:kind,careBasisDigest:context.basis.digest}))},registered=new Map();
  const store={history:()=>history,ensureAftercareWorkspace(){},aftercareWorkspaceRootSnapshot:{rootHandleRef:'workspace-root',endpointId:'workspace-endpoint',mountScopeId:'workspace-mount'},
    aftercareWorkspaceRelativePath:(caseId,location)=>path.relative(path.join(workspace,caseId),location).replaceAll('\\','/'),
    registerAftercareWorkspaceMaterial(handle,artifact){
      assert.equal(handle.workspaceId,care.aftercareCaseId);assert.equal(handle.digestHex,artifact.digestHex);
      if(registered.has(artifact.artifactHandleId))assert.deepEqual(registered.get(artifact.artifactHandleId),artifact);
      registered.set(artifact.artifactHandleId,artifact);
    },resolveAftercareArtifact(artifact){assert.deepEqual(registered.get(artifact.artifactHandleId),artifact);return artifact;}};
  const ports=createAftercareCapabilityPorts({schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('Capability fixture does not perform Inventory transactions.');}},
    aftercareWorkspaceRoot:workspace,computeBoundedMaterialFingerprintSync:fingerprint,contextReader:{read:()=>context,store}});
  function renderExecution(material) {
    const profile={schemaRef:'helix://contracts/domain-types/ArtifactProfile/v1',schemaVersion:1,profileId:'entry:nfo:'+material.material_key,
      revision:1,artifactKinds:['nfo'],qualityPolicyDigest:context.raw.standard.standard_digest,
      typedParameters:seriesNfoProfileParameters(context,care,history,{materialKey:material.material_key,
        artifactScopeDigest:JSON.parse(material.artifact_scope_json).scopeDigest})};
    return {ownerScope:{processId:'entry'},workId:'prepare',eventId:'render-'+material.material_key,idempotencyKey:'render-'+material.material_key,
      namedInputs:{artifactProfile:{...profile,digest:canonicalDigest(profile)},acceptedProductFacts:{shelfEntryId:'entry',inventoryRevision:1,
        productFactSetDigest:canonicalDigest(context.raw.facts.map(row=>row.fact_digest).sort())}}};
  }
  function materializeExecution(artifact,recoveryDecision) {
    return {ownerScope:{processId:'entry'},workId:'commit',eventId:'materialize-'+artifact.artifactHandleId,idempotencyKey:'materialize-'+artifact.artifactHandleId,
      recoveryDecision,namedInputs:{verifiedArtifactOrWorkspaceMediaHandle:artifact,
        inventoryTargetHandle:{targetDirectory:shelf,slotDirectory:shelf}}};
  }
  return {root,shelf,workspace,context,care,history,ports,registered,missing,damaged,renderExecution,materializeExecution};
}

test('Series NFO Capabilities generate and replace only two frozen targets, preserving other files',async t=>{
  const f=fixture(t),validate=outcomeValidator(),untouched=f.context.raw.materials.filter(row=>![f.missing,f.damaged].includes(row))
    .map(row=>({row,bytes:fs.readFileSync(row.location)})),receipts=[];
  for(const material of [f.missing,f.damaged]) {
    const execution=f.renderExecution(material),prepared=f.ports[C.textRender].execute(execution);
    f.ports[C.textRender].validateResult(execution,prepared);
    validate(prepared);
    assert.equal(prepared.kind,'succeeded');assert.equal(prepared.result.provenanceRef.objectId,material.material_key);
    assert.match(fs.readFileSync(prepared.result.storageRef,'utf8'),new RegExp('<episode>'+JSON.parse(material.artifact_scope_json).episodeScope.episodeNumber+'</episode>'));
    assert.deepEqual(f.ports[C.textRender].execute(execution).result,prepared.result);
    const commit=f.materializeExecution(prepared.result),result=await f.ports[C.artifactMaterialize].execute(commit);
    f.ports[C.artifactMaterialize].validateResult(commit,result);receipts.push(result.result);
    validate(result);
    assert.equal(result.result.targetLocation,material.location.replaceAll('\\','/'));
    assert.deepEqual(result.result.retiredMaterials.map(item=>item.identity.materialKey),[material.material_key]);
    assert.deepEqual(fs.readFileSync(material.location),fs.readFileSync(prepared.result.storageRef));
    const replay=await f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result,'continue_forward'));
    assert.equal(replay.result.finalRealityDigest,result.result.finalRealityDigest);
  }
  for(const {row,bytes} of untouched)assert.deepEqual(fs.readFileSync(row.location),bytes);
  const changes=deriveInventoryMaterialChanges(f.context.raw.materials,receipts);
  assert.deepEqual(changes.filter(change=>change.action==='release').map(change=>change.identity.materialKey).sort(),
    [f.missing.material_key,f.damaged.material_key].sort());
  assert.equal(changes.filter(change=>change.action==='acquire').length,2);
});

for(const failure of ['stale_profile','wrong_facts','already_readable'])test('Series NFO preparation rejects '+failure+' before Workspace creation',t=>{
  const f=fixture(t),execution=f.renderExecution(f.missing);
  if(failure==='stale_profile') {
    execution.namedInputs.artifactProfile=structuredClone(execution.namedInputs.artifactProfile);
    execution.namedInputs.artifactProfile.typedParameters[0].value='foreign';
  }
  if(failure==='wrong_facts')execution.namedInputs.acceptedProductFacts.productFactSetDigest=canonicalDigest('foreign');
  if(failure==='already_readable')fs.writeFileSync(f.missing.location,'Externally restored');
  assert.throws(()=>f.ports[C.textRender].execute(execution));assert.equal(fs.existsSync(f.workspace),false);assert.equal(f.registered.size,0);
});
for(const scenario of ['appeared','changed','recovery_conflict'])test('Series NFO Materialize refuses external source changes: '+scenario,async t=>{
  const f=fixture(t),material=scenario==='appeared'?f.missing:f.damaged,
    prepared=f.ports[C.textRender].execute(f.renderExecution(material));
  fs.writeFileSync(material.location,'External writer owns these bytes');
  const result=await f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result,scenario==='recovery_conflict'?'continue_forward':undefined));
  assert.equal(result.kind,'failed');assert.equal(result.code,'ARCA_AFTERCARE_NFO_SOURCE_STALE');
  assert.equal(fs.readFileSync(material.location,'utf8'),'External writer owns these bytes');
  assert.equal(fs.existsSync(material.location+'.superseded-case'),false);
});
test('Series NFO forward recovery completes an interrupted rename using its exact frozen damaged source',async t=>{
  const f=fixture(t),prepared=f.ports[C.textRender].execute(f.renderExecution(f.damaged));
  fs.renameSync(f.damaged.location,f.damaged.location+'.superseded-case');
  const result=await f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result,'continue_forward'));
  assert.equal(result.kind,'succeeded');assert.deepEqual(fs.readFileSync(f.damaged.location),fs.readFileSync(prepared.result.storageRef));
  assert.equal(fs.readFileSync(f.damaged.location+'.superseded-case').length,0);
});

test('Series NFO refuses a corrupted superseded source during forward recovery',async t=>{
  const f=fixture(t),prepared=f.ports[C.textRender].execute(f.renderExecution(f.damaged)),retired=f.damaged.location+'.superseded-case';
  fs.renameSync(f.damaged.location,retired);fs.writeFileSync(retired,'Foreign retired bytes');
  const result=await f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result,'continue_forward'));
  assert.equal(result.kind,'failed');assert.equal(result.code,'ARCA_AFTERCARE_NFO_SOURCE_STALE');
  assert.equal(fs.existsSync(f.damaged.location),false);assert.equal(fs.readFileSync(retired,'utf8'),'Foreign retired bytes');
});
test('Series NFO verifies Workspace bytes before touching the exact Inventory target',async t=>{
  const f=fixture(t),prepared=f.ports[C.textRender].execute(f.renderExecution(f.damaged));
  fs.writeFileSync(prepared.result.storageRef,'Wrong Episode XML');
  await assert.rejects(()=>f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result)),{code:'ARCA_AFTERCARE_ARTIFACT_VERIFICATION_FAILED'});
  assert.equal(fs.readFileSync(f.damaged.location).length,0);assert.equal(fs.existsSync(f.damaged.location+'.superseded-case'),false);
});

test('Series NFO missing-file commit still requires the matching Custody and Presentation findings',async t=>{
  const f=fixture(t),requirement=f.care.careRequirement;
  requirement.requiredEffects=requirement.requiredEffects.filter(item=>item.objectId!=='custody-missing');
  requirement.typedParameters=requirement.typedParameters.filter(item=>item.value!=='custody:artifact_missing');
  const {digest,...body}=requirement;requirement.digest=canonicalDigest(body);f.care.careRequirementDigest=requirement.digest;
  const prepared=f.ports[C.textRender].execute(f.renderExecution(f.missing));
  await assert.rejects(()=>f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result)),{code:'ARCA_AFTERCARE_TARGET_CONFLICT'});
  assert.equal(fs.existsSync(f.missing.location),false);
});
test('an already written Series NFO cannot be adopted without the explicit recovery decision',async t=>{
  const f=fixture(t),prepared=f.ports[C.textRender].execute(f.renderExecution(f.missing));
  fs.copyFileSync(prepared.result.storageRef,f.missing.location);
  const result=await f.ports[C.artifactMaterialize].execute(f.materializeExecution(prepared.result));
  assert.equal(result.kind,'failed');assert.equal(result.code,'ARCA_AFTERCARE_NFO_SOURCE_STALE');
});
