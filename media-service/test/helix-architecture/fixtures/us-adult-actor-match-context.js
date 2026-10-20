'use strict';
const fs=require('node:fs'),path=require('node:path');
const {fixture:storeFixture}=require('./us-adult-actor-refresh-store-context');
const {canonicalDigest:D}=require('../../../src/helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync}=require('../../../src/helix/integrations/bounded-material-fingerprint');
const {createUsAdultInventorySource}=require('../../../src/helix/integrations/us-adult-inventory-source');
const {createUsAdultInventoryWorkspace}=require('../../../src/helix/integrations/us-adult-inventory-workspace');
const {sourcePrepared,sourcePreparedSchema}=require('../../../src/helix/contracts/us-adult-inventory-analysis');
const matching=require('../../../src/helix/contracts/us-adult-inventory-matching');
const workModel=require('../../../src/helix/domains/arca/model/us-adult-actor-match-work');
const {sourceWork,SOURCE}=require('../../../src/helix/domains/arca/model/us-adult-actor-refresh-execution');
const {faceModelReference}=require('../../../src/helix/contracts/us-adult-face-model');
function fixture(t){
  const f=storeFixture(t),location=path.join(f.root,'source.mkv');fs.writeFileSync(location,Buffer.alloc(1000,3));
  const observed=computeBoundedMaterialFingerprintSync(location),row=f.context.raw.materials[0],tuple={mountScopeId:row.mount_scope_id,inode:String(observed.stat.ino),
    sizeBytes:Number(observed.stat.size),fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint};
  Object.assign(row,{location,material_key:D({schema:'physical-material-identity@2',...tuple}),inode:tuple.inode,size_bytes:tuple.sizeBytes,content_fingerprint:tuple.contentFingerprint});
  const s=f.services(),{personId,expectedPersonRevision,expectedReferenceRevision,...body}=f.request,
    started=s.command.request('entry',{...body,mode:'automatic'},'admin'),aftercareCaseId=started.aftercareCaseId,intent=s.store.get(started.intentId).intent;
  s.care.admitCase(aftercareCaseId);
  const context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){}},
    identity=require('../../../src/helix/domains/arca/model/aftercare-contract').physicalIdentityFromInventoryRow(row),
    handle=createUsAdultInventorySource({assertAuthority:()=>true,now:()=>10000}).issueReadHandle({intent,aftercareCaseId,identity,
      binding:{endpointId:row.endpoint_id,bindingRevision:row.binding_revision,location},target:{endpointId:row.endpoint_id,rootLocation:f.root,mountScopeId:tuple.mountScopeId,mountScopeRevision:1},context}),
    workspace=createUsAdultInventoryWorkspace({rootSnapshot:{...s.care.aftercareWorkspaceRootSnapshot,resolvedRoot:s.dependencies.aftercareWorkspaceRoot},
      ensureWorkspace:s.care.ensureAftercareWorkspace,registerMaterial:s.care.registerAftercareWorkspaceMaterial,assertRegistered:()=>true}),
    write=kind=>workspace.write({intent,aftercareCaseId,context,kind,bytes:Buffer.from('{}')}),
    // This fixture assumes already-qualified producer outputs. Actual geometry,
    // CPU matching and media bytes are qualified by the separate native suite.
    sourceResult=sourcePrepared({intent,aftercareCaseId,sourceHandle:handle,sourceProbeDigest:D('unit probe'),durationMs:1000,container:'matroska',
      analysis:{analysisDigest:D('unit analysis'),detectedFaceCount:1,modelRef:faceModelReference('western_frame_set'),referenceModelRefDigest:intent.referenceModelRefDigest},
      frameManifestHandle:write('frames'),featuresHandle:write('features'),atMs:10000}),
    domain=require('../../../scripts/helix-architecture/domain-input-schema-builder').buildDomainInputSchemas(),
    validator=require('../../../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas:[
      ...['UsAdultActorRefreshIntent','UsAdultPersonSnapshot','PersonReferenceProjection','PeopleReferenceLibraryPage','FaceModelRef'].map(name=>domain[name]),
      ...['PhysicalMaterialReadHandle','PhysicalMaterialIdentity','WorkspaceMaterialHandle'].map(name=>require('../../../src/helix/contracts/types/'+name+'/'+(name==='PhysicalMaterialIdentity'?'v2':'v1')+'/schema.json')),
      sourcePreparedSchema(),matching.pageMatchSchema()]}),pages=Array.from({length:intent.pageCount},(_,ordinal)=>s.store.page(intent.intentId,ordinal));
  function record(work,capability,result,bindings){const inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings};
    return {workId:work.workId,attemptId:work.workId+'-attempt',planId:work.workId+'-plan',eventId:work.workId+'-event',resultId:work.workId+'-result',
      capabilityRef:capability,state:'succeeded',outcomeKind:'succeeded',resultSchemaRef:workModel.resultRef(capability),result,resultDigest:D(result),inputBindings,inputBindingDigest:D(inputBindings)};}
  const sourceRecord=record(sourceWork(intent,aftercareCaseId),SOURCE,sourceResult,[]);
  function records(scores){return pages.map((page,pageOrdinal)=>{
    const person=page.items[0],asset=person.referenceProjection.contributions[0].activeAssets[0],score=scores[pageOrdinal],
      matches=score===null?[]:[{personId:person.personId,faceGroupId:'arca-face-'+D('unit face'),score,referenceAssetId:asset.referenceAssetId,artifactDigest:asset.artifactDigest,
        threshold:0.363,faceModelRefDigest:intent.faceModelRef.digest,referenceModelRefDigest:intent.referenceModelRefDigest,confidenceClass:'strong'}],
      result=matching.pageMatch({intent,aftercareCaseId,pageOrdinal,page,sourceResult,matches,atMs:10000}),
      work=workModel.matchWork(intent,aftercareCaseId,pageOrdinal,page.pageDigest,sourceRecord.resultDigest),parameters={aftercareCaseId,intentId:intent.intentId,pageOrdinal,sourceResultDigest:sourceRecord.resultDigest},
      bindings=Object.entries({usAdultActorRefreshScope:workModel.PROJECTIONS.scope,usAdultActorRefreshIntent:workModel.PROJECTIONS.intent,
        arcaUsAdultSourcePrepared:workModel.PROJECTIONS.source,peopleReferenceLibraryPage:workModel.PROJECTIONS.page}).map(([portName,projectionRef])=>({
        portName,bindingKind:'projected_owner_facts',ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry',projectionRef,parameters}));
    return record(work,matching.MATCH,result,bindings);
  });}
  const request={intent,aftercareCaseId,pages,sourceRecord,contractValidator:validator};
  return {f,s,request,records,complete:scores=>workModel.completeMatching({...request,records:records(scores)}),workModel};
}
module.exports=Object.freeze({fixture});
