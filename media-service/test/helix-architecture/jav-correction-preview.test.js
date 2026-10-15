'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {createJavIdentityCorrectionPreview}=require('../../src/helix/domains/arca/application/jav-identity-correction-preview');
const fixture=require('./fixtures/jav-correction');
const schemas=buildArcaApplicationSchemas(),names=['ArcaJavCorrectionBasis','ArcaJavCorrectionProposal'];
const validator=createCapabilityContractValidator({schemas:names.map(name=>schemas[name])});
const type=name=>'helix://contracts/application-types/'+name+'/v1';
function setup(overrides={}) {
  const state={context:fixture.context(),configRevision:1,cases:[],calls:[]};
  const options={now:()=>1000,contractValidator:validator,contextReader:{read:()=>state.context,store:{history:()=>({cases:state.cases})}},
    materialControlProjectionPort:{getMaterialControlProjections:keys=>keys.map(materialKey=>({materialKey,resultKind:'available',controlState:'controlled',
      ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:'entry',controlRevision:1,projectionDigest:fixture.digest('control')}))},
    resolveJavSourceHandle:({siteRef})=>fixture.handle(siteRef,state.configRevision),
    observeJavSourceForPreview:async request=>{state.calls.push(request);const observation=fixture.observation(request.siteRef);
      return {observation,sourceCoverDigest:observation.cover.byteDigest,posterUrl:'data:image/jpeg;base64,/9j/2Q=='};},
    inventoryPort:{inspectJavCorrectionPlacement:()=>({schema:'arca.jav-correction-target-reality@1',targetRealityDigest:fixture.digest('target-reality')}),prepare:request=>({members:request.onDeckProductPackage.productMaterialManifest.members.map(item=>({role:item.role,sourceMaterialKey:item.materialKey,
      targetEndpointId:'target',targetLocation:'shelf/IPX-178.mkv'}))})},...overrides};
  return {state,options,service:createJavIdentityCorrectionPreview(options)};
}

test('correction nominal schemas conserve complete owned provenance and reject cross-domain fields or missing source proof',()=>{
  for(const name of names)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname,'../../src/helix/contracts/application-types',name,'v1/schema.json'),'utf8')),schemas[name]);
  const {state,options}=setup(),basis=buildJavCorrectionBasis({raw:state.context.raw,
    controlProjections:options.materialControlProjectionPort.getMaterialControlProjections(state.context.raw.materials.map(row=>row.material_key))});
  validator.validate(type(names[0]),basis);
  const proposal=buildJavCorrectionProposal({basis,...fixture.source()});validator.validate(type(names[1]),proposal);
  assert.throws(()=>validator.validate(type(names[1]),{...proposal,newIdentity:{...proposal.newIdentity,libraRunId:'forged-run'}}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  assert.throws(()=>validator.validate(type(names[1]),{...proposal,sourceQualification:{...proposal.sourceQualification,observation:{...proposal.sourceQualification.observation,cover:null}}}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});

test('correction preview displays old/new films and exact rename without changing collection, source or Commit',async()=>{
  const {state,service}=setup(),before=canonicalDigest(state.context),preview=await service.preview('entry',{javCode:'IPX-178'});
  assert.deepEqual(preview.oldIdentity,{javCode:'IPX-177',title:'Original film'});
  assert.equal(preview.newIdentity.javCode,'IPX-178');assert.equal(preview.newIdentity.title,'Correct film');
  assert.equal(preview.paths[0].previousLocation,'shelf/IPX-177.mkv');assert.equal(preview.paths[0].targetLocation,'shelf/IPX-178.mkv');
  assert.equal(state.calls.length,1);assert.equal(state.calls[0].operationId,'shared.integration.search@1');
  const proof=service.readPreview('entry',preview.previewId);proof.proposal.newJavCode='changed-client-copy';
  assert.equal(service.readPreview('entry',preview.previewId).proposal.newJavCode,'IPX-178');assert.equal(canonicalDigest(state.context),before);
});

test('old correction preview is rejected after Inventory, Control configuration, owner scope or active Case changes',async()=>{
  for(const change of [state=>state.context.raw.entry.current_inventory_revision++,state=>state.configRevision++,state=>state.context.raw.shelf.target_root_location='different-root',
    state=>state.cases.push({state:'queued'}),state=>state.context.raw.entry.status='offdeck_in_progress']) {
    const {state,service}=setup(),preview=await service.preview('entry',{javCode:'IPX-178'});change(state);
    assert.throws(()=>service.readPreview('entry',preview.previewId));
  }
  const {service}=setup(),preview=await service.preview('entry',{javCode:'IPX-178'});
  assert.throws(()=>service.readPreview('another-entry',preview.previewId),{code:'ARCA_JAV_CORRECTION_PREVIEW_STALE'});
});

test('source fallback uses only the successful site and stops there',async()=>{
  const calls=[],{service}=setup({observeJavSourceForPreview:async request=>{calls.push(request.siteRef);
    const observation=fixture.observation(request.siteRef,request.siteRef==='javdb'?'not_found':'qualified');
    return {observation,...(observation.cover?{sourceCoverDigest:observation.cover.byteDigest,posterUrl:'data:image/jpeg;base64,/9j/2Q=='}:{})};}});
  const preview=await service.preview('entry',{javCode:'IPX-178'}),proof=service.readPreview('entry',preview.previewId);
  assert.deepEqual(calls,['javdb','javmenu']);assert.equal(preview.newIdentity.siteRef,'javmenu');
  assert.equal(proof.proposal.sourceQualification.observation.siteRef,'javmenu');
});

test('concurrent collection change while source query is pending prevents any new preview admission',async()=>{
  const {state,options}=setup();options.observeJavSourceForPreview=async()=>{state.context.raw.entry.current_inventory_revision++;
    const observation=fixture.observation();return {observation,sourceCoverDigest:observation.cover.byteDigest,posterUrl:'data:image/jpeg;base64,/9j/2Q=='};};
  await assert.rejects(createJavIdentityCorrectionPreview(options).preview('entry',{javCode:'IPX-178'}),{code:'ARCA_JAV_CORRECTION_PREVIEW_STALE'});
});
