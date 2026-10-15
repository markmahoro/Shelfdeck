'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp'),{createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {createJavCorrectionAssetsPreparation}=require('../../src/helix/domains/arca/capabilities/jav-correction-assets-preparation');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildSharedTypeSchemas}=require('../../scripts/helix-architecture/shared-type-schema-builder');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const contract=require('../../src/helix/domains/arca/model/jav-correction-execution-contract');
const {createJavCorrectionCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/jav-correction-capability-ports');
const {createJavCorrectionWorkspaceIo}=require('../../src/helix/integrations/jav-correction-workspace-io');
const {deriveJavCoverBytes}=require('../../src/helix/integrations/jav-cover-renderer');
const fixture=require('./fixtures/jav-correction');
test('interrupted asset writes replay frozen Source Result bytes and reject forged Result provenance',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-port-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-correction-port-'));fs.rmSync(root,{recursive:true,force:true});});
  const c=fixture.context(),controlProjections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),basis=buildJavCorrectionBasis({raw:c.raw,controlProjections}),
    bytes=await sharp({create:{width:240,height:120,channels:3,background:'#346789'}}).jpeg().toBuffer(),qualification=fixture.source();
  qualification.observation.cover={...qualification.observation.cover,byteDigest:createHash('sha256').update(bytes).digest('hex'),byteCount:bytes.length,width:240,height:120};
  qualification.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(qualification.observation).filter(([key])=>key!=='observationDigest')));
  const record={state:'active',stateRevision:2,correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),shelfEntryId:c.shelfEntryId,
    admissionDigest:fixture.digest('admission'),proof:{basis,proposal:buildJavCorrectionProposal({basis,...qualification})}},
    rootSnapshot={resolvedRoot:root,rootHandleRef:fixture.digest('root'),mountScopeId:'mount',endpointId:'endpoint'},scope=contract.buildJavCorrectionScope(record,rootSnapshot.rootHandleRef),
    frozen=structuredClone(qualification.observation);
  frozen.descriptiveEntries.push({key:'release_date',value:'2024-01-02'});
  frozen.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(frozen).filter(([key])=>key!=='observationDigest')));
  const prepared=await createJavCorrectionAssetsPreparation({deriveJavCoverBytes,acquireQualifiedCover:async()=>({coverBytes:bytes,observation:frozen})}).prepare(record),
    workspaceIo=createJavCorrectionWorkspaceIo({rootSnapshot}),expectations=workspaceIo.describe([{kind:'metadata',bytes:Buffer.from(canonicalJson(prepared.metadata),'utf8')},
      {kind:'nfo',bytes:prepared.nfo.bytes},...prepared.pictures.map(item=>({kind:item.artifactKind,bytes:item.bytes}))]),
    verified=contract.buildJavCorrectionSourceVerified(record,scope,frozen,100,expectations),registered=new Map();let interrupt=true;
  const workspaceStore={ensure(){},register(_id,_admission,handle,artifact){if(interrupt&&artifact?.artifactKind==='nfo'){interrupt=false;throw new Error('Injected interruption after file write.');}
    registered.set(handle.handleId,{handle,artifact});},resolve(_id,_admission,handle){assert.deepEqual(registered.get(handle.handleId)?.handle,handle);
      return {location:path.join(root,handle.workspaceId,...handle.relativePath.split('/'))};},inspect(){return {registryExists:true,members:[...registered.values()].map(item=>item.handle)};}},
    validator=createCapabilityContractValidator({schemas:[...Object.values(buildSharedTypeSchemas()),contract.javCorrectionScopeSchema(),contract.javCorrectionSourceVerifiedSchema(),contract.javCorrectionAssetsPreparedSchema()]}),
    ports=createJavCorrectionCapabilityPorts({rootSnapshot,workspaceIo,workspaceStore,contractValidator:validator,correctionStore:{get:()=>record},assertCurrentCorrectionScope(){},
      workResultReader:{read:()=>[{eventId:'source-event',outcomeKind:'succeeded',result:verified,capabilityRef:contract.SOURCE_CAPABILITY,
        resultSchemaRef:'helix://contracts/capabilities/arca.jav_correction.source.verify/v1/result'}]},
      resolveJavSourceHandle:({operationId})=>({...fixture.handle(),allowedOperation:operationId}),
      deriveJavCoverBytes,acquireJavCover:async()=>({coverBytes:bytes,observation:{...frozen,descriptiveEntries:[{key:'title',value:'Correct film'},{key:'release_date',value:'2026-09-10'}]}})}),
    execution={eventId:'asset-event',idempotencyKey:'asset-idempotency',ownerScope:{domain:'arca',processType:'arca_jav_identity_correction',processId:record.correctionId},
      namedInputs:{javCorrectionScope:scope,javCorrectionSourceVerified:verified}},port=ports[contract.CAPABILITY];
  await assert.rejects(port.execute(execution),/Injected interruption/);
  const nfoLocation=workspaceIo.location(record.correctionId,'nfo').location,nfoBefore=fs.readFileSync(nfoLocation),inodeBefore=fs.statSync(nfoLocation,{bigint:true}).ino;
  assert.match(nfoBefore.toString(),/2024-01-02/);assert.doesNotMatch(nfoBefore.toString(),/2026-09-10/);
  const recovery={work:{owner_domain:'arca',process_type:'arca_jav_identity_correction',process_id:record.correctionId,work_id:'work'},
    event:{event_id:'asset-event',work_id:'work',capability_ref:contract.CAPABILITY},effect:{effect_class:'workspace_write'},
    node:{capability_ref:contract.CAPABILITY,input_bindings_json:JSON.stringify({bindings:[{portName:'javCorrectionSourceVerified',bindingKind:'projected_event_result',eventId:'source-event',
      resultSchemaRef:'helix://contracts/capabilities/arca.jav_correction.source.verify/v1/result',parameters:{expectedScopeDigest:scope.digest}}]})}};
  assert.equal((await port.observeEffectReality(recovery)).status,'matching');
  assert.equal((await port.observeEffectReality({...recovery,work:{...recovery.work,owner_domain:'libra'}})).status,'conflict');
  const conflicting=Buffer.from(nfoBefore);conflicting[0]^=1;fs.writeFileSync(nfoLocation,conflicting);
  assert.equal((await port.observeEffectReality(recovery)).status,'conflict');fs.writeFileSync(nfoLocation,nfoBefore);
  const outcome=await port.execute(execution);port.validateResult(execution,outcome);
  assert.equal(registered.size,4);assert.deepEqual(fs.readFileSync(nfoLocation),nfoBefore);assert.equal(fs.statSync(nfoLocation,{bigint:true}).ino,inodeBefore);
  assert.equal(outcome.result.actualProposalDigest,verified.actualProposalDigest);
  assert.throws(()=>port.validateResult(execution,{...outcome,result:{...outcome.result,actualProposalDigest:fixture.digest('forged')}}),{code:'ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID'});
  const forged=structuredClone(outcome);forged.result.artifacts[0].artifactHandle.storageRef='outside/movie.nfo';
  const payload=Object.fromEntries(['correctionId','admissionDigest','confirmedProposalDigest','actualProposalDigest','sourceObservationDigest','metadataFactDigest','metadataHandle','artifacts'].map(key=>[key,forged.result[key]]));
  forged.result.payloadDigest=canonicalDigest(payload);forged.result.evidenceId='arca-correction-prepared-'+canonicalDigest(payload).slice(0,40);
  assert.throws(()=>port.validateResult(execution,forged),{code:'ARCA_JAV_CORRECTION_ASSETS_RESULT_INVALID'});
});
