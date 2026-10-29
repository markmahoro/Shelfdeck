'use strict';
const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {createSeriesRootRelocationStore}=require('../persistence/series-root-relocation-store');
const {createSeriesRootRelocationExecution}=require('../persistence/series-root-relocation-execution');
const {buildAftercarePlacementBasis}=require('../model/aftercare-placement');
const {seriesScopeId}=require('../model/series-presentation');
const {PROCESS,OBJECTIVE,RESULT}=require('../model/series-root-relocation-contract');
function createSeriesRootRelocationServices(options) {
  const relocationStore=createSeriesRootRelocationStore(options),relocationIo=options.createSeriesRootRelocationIo();
  const relocationExecution=createSeriesRootRelocationExecution({...options,relocationStore,relocationIo});
  const admission=createWorkAdmission({...options,limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},eligibilityProvider:{check:request=>({
    eligible:request.ownerDomain==='arca'&&request.processType===PROCESS&&relocationStore.read(request.processId)?.plan_digest===request.executionBasisDigest,
    basisDigest:request.executionBasisDigest,reasonCode:'ARCA_SERIES_RELOCATION_STALE'})}});
  const works=id=>options.workResultReader.listWorks({ownerDomain:'arca',processType:PROCESS,processId:id,workKind:'series_root_relocation'})
    .slice().sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms)||a.work_id.localeCompare(b.work_id));
  const currentWork=history=>history.find(work=>!['succeeded','failed','cancelled'].includes(work.state))||history.at(-1);
  function reconcile(id,{retryKey=null}={}) {
    const row=relocationStore.read(id);if(!row)return {kind:'not_found'};
    const history=works(id),prior=currentWork(history);
    if(row.state==='committed')return {kind:'terminal',relocationId:id};
    const key=canonicalDigest({relocationId:id,planDigest:row.plan_digest,retryKey}),workId='arca-series-root-work-'+key.slice(0,40);
    const requested=history.find(work=>work.work_id===workId),current=requested||prior;
    if(current&&(requested||!retryKey||!['failed','cancelled'].includes(prior.state)))
      return {kind:['failed','cancelled'].includes(current.state)?'attention_required':'in_progress',relocationId:id,workId:current.work_id};
    if(prior)relocationExecution.assertRetrySafe(row,history);
    const definition={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId,ownerDomain:'arca',processType:PROCESS,
      processId:id,workKind:'series_root_relocation',workObjectiveTypeRef:OBJECTIVE,workObjectiveVersion:1,executionBasisId:id,executionBasisDigest:row.plan_digest,
      dependencyRefs:[],priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],idempotencyKey:'arca-series-root-key-'+key,
      concurrencyScope:PROCESS+'/'+row.scope_id,outputContractRef:RESULT};
    const result=admission.replay(definition)||admission.submit(definition);
    if(result.kind==='invalid_contract')throw Object.assign(new Error('Series root relocation Work admission failed.'),{code:result.reasonCode});
    return {kind:'in_progress',relocationId:id,workId};
  }
  function scopeFor(context) {
    const raw=context?.raw;
    if(!raw&&context?.structureKind==='season'&&context.seriesIdentityHint)
      return seriesScopeId(context.seriesIdentityHint.shelfId,String(context.seriesIdentityHint.providerKey));
    const structure=raw?.entry.structure_kind||context?.structureKind,identity=raw?.identity||context?.canonicalIdentity;
    if(structure!=='season'||identity?.provider!=='tmdb')return null;
    return seriesScopeId(raw?.entry.shelf_id||context.shelfId,String(identity.provider_key));
  }
  function pending(context,request) {const scopeId=scopeFor(context),row=scopeId&&relocationStore.active(scopeId);return row?reconcile(row.relocation_id,request):null;}
  function ensure(context,command) {
    const scopeId=scopeFor(context);if(!scopeId)return null;
    const active=relocationStore.active(scopeId);if(active)return reconcile(active.relocation_id,command);
    const current=options.series.seriesStore.readScope(scopeId);if(!current||!Number(current.current_version))return null;
    const request=buildAftercarePlacementBasis(context,1,'series-root-placement');
    const target=options.inventoryPort.resolvePolicyTargetLocation(request),root=path.dirname(target.targetDirectory);
    if(root===current.root_location)return null;
    const row=relocationStore.admit({scopeId,targetRoot:root,placementRevision:context.raw.shelf.current_placement_revision});
    return reconcile(row.relocation_id,command);
  }
  function issue(context,details=false) {const scopeId=scopeFor(context),row=scopeId&&relocationStore.active(scopeId);if(!row)return null;
    const prior=currentWork(works(row.relocation_id)),state=prior&&['failed','cancelled'].includes(prior.state)?'attention_required':'in_progress';
    return {state,...(details?{seasonCount:row.plan.seasons.length,reasonCode:state==='attention_required'?options.workResultReader.readFailures(prior.work_id)[0]?.code||null:null}:{})};}
  return Object.freeze({relocationStore,relocationIo,relocationExecution,pending,ensure,issue,reconcile,
    page:(cursor,limit)=>relocationStore.page(cursor,limit).map(row=>({cursor:row.relocation_id,scope:{relocationId:row.relocation_id}}))});
}
module.exports=Object.freeze({createSeriesRootRelocationServices});
