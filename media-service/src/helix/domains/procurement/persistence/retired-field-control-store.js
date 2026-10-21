'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {createMaterialControlProjectionPort,createMaterialControlParticipant,controlScopeDigest}=
  require('../../../foundation/persistence/material-control');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const RESULT_SCHEMA='helix://contracts/application-types/ProcurementFieldControlReleaseReceipt/v1';

function createRetiredFieldControlStore(options) {
  const repository=createRepositoryDefinition({repositoryId:'procurement_retired_field_control',owner:'procurement',
    schemaManifest:options.schemaManifest,statements:{
      fields:{kind:'select-page-after',tableId:'proc_material_fields',columns:['field_id'],keyColumn:'field_id',fixedKeyColumns:['status'],maxItems:100},
      field:{kind:'select-one',tableId:'proc_material_fields',columns:['field_id','status','current_access_revision','extraction_policy_revision'],keyColumns:['field_id']},
      runs:{kind:'select-all',tableId:'proc_procurement_runs',columns:['procurement_run_id','state','state_revision'],keyColumns:['field_id']},
      members:{kind:'select-all',tableId:'proc_run_materials',columns:['material_key','selection_state','terminal_disposition','candidate_package_id'],keyColumns:['procurement_run_id']},
      delivery:{kind:'select-one',tableId:'proc_candidate_deliveries',columns:['state'],keyColumns:['candidate_package_id']},
      material:{kind:'select-one',tableId:'proc_field_materials',columns:['material_key','mount_scope_id','inode','size_bytes',
        'fingerprint_algorithm','fingerprint_version','content_fingerprint'],keyColumns:['field_id','material_key'],safeIntegers:true},
    }});
  const execute=body=>options.unitOfWork.execute([{participantId:'retired_field_control_read',owner:'procurement',repositories:[repository],
    execute:context=>body(context.repository(repository.repositoryId))}]).retired_field_control_read;
  const controls=createMaterialControlProjectionPort(options),commands=createCommandCommitCoordinator(options);
  function blockedMaterials(repo,fieldId){
    const field=repo.invoke('field',{field_id:fieldId});
    if(field?.status!=='deregistered')return null;
    const blocked=new Set();
    for(const run of repo.invoke('runs',{field_id:fieldId})){
      for(const member of repo.invoke('members',{procurement_run_id:run.procurement_run_id})){
        if(run.state!=='sealed'||member.selection_state!=='released' ||
            (member.candidate_package_id && !['rejected','stale'].includes(repo.invoke('delivery',{candidate_package_id:member.candidate_package_id})?.state)))
          blocked.add(member.material_key);
      }
    }
    return blocked;
  }
  function reconcile(fieldId) {
    const scope={ownerDomain:'procurement',scopeType:'material_field',scopeId:fieldId};
    const candidates=controls.readScope(scope).items.filter(item=>item.controlState==='controlled');
    const members=execute(repo=>{
      const blocked=blockedMaterials(repo,fieldId);
      return blocked===null?[]:candidates.filter(item=>!blocked.has(item.materialKey)).slice(0,128).map(control=>{
      const row=repo.invoke('material',{field_id:fieldId,material_key:control.materialKey});
      if(!row)fail('PROCUREMENT_RETIRED_CONTROL_IDENTITY_MISSING','Retired Field Control lacks its Physical Material identity.');
      return {control,identity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:row.material_key,
        mountScopeId:row.mount_scope_id,inode:String(row.inode),sizeBytes:Number(row.size_bytes),fingerprintAlgorithm:row.fingerprint_algorithm,
        fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint}};
      });
    });
    if(!members.length)return {kind:'idle',fieldId};
    const changes=members.map(({control,identity})=>({action:'release',identity,fromScope:scope,toScope:null,
      expectedRevision:control.controlRevision,expectedProjectionDigest:control.projectionDigest}));
    const scopeDigest=controlScopeDigest(changes),requestDigest=canonicalDigest({fieldId,scopeDigest}),marker='procurement-retired-control-'+requestDigest;
    const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:marker,
      ownerDomain:'procurement',processType:'material_field',processId:fieldId,operationKind:'release',
      basisRef:{objectType:'retired_field_control_scope',objectId:fieldId,revision:1,digest:requestDigest},basisDigest:requestDigest,
      canonicalFactSetDigest:requestDigest,bindingSetDigest:canonicalDigest(members.map(item=>item.identity)),controlScopeDigest:scopeDigest,
      expectedControlRevisions:changes.map(item=>({materialKey:item.identity.materialKey,revision:item.expectedRevision})),eventFenceDigest:requestDigest,
      receiptContract:{receiptSchemaRef:RESULT_SCHEMA,controlRevisionSetSchemaRef:'procurement.retired-field-control-set@1'}};
    const result=commands.execute({command:{commandReceiptId:marker,ownerDomain:'procurement',commandContract:'procurement.retired-field-control-release@1',
      callerScope:'field_retirement',idempotencyKey:requestDigest,requestDigest,targetType:'material_field',targetId:fieldId},
      domainParticipant:{participantId:'procurement_retired_field_guard',owner:'procurement',repositories:[repository],execute(context){
        const repo=context.repository(repository.repositoryId);
        const blocked=blockedMaterials(repo,fieldId);
        for(const {identity} of members)if(blocked===null||blocked.has(identity.materialKey))
          fail('PROCUREMENT_RETIRED_CONTROL_SCOPE_ACTIVE','Retired Field still has an active selection or delivery.');
        return {fieldId,releasedCount:members.length,scopeDigest};
      }},
      controlParticipant:createMaterialControlParticipant({schemaManifest:options.schemaManifest,handle,changes,commitMarker:marker}),
      commitMarker:{commitMarker:marker,scopeType:'material_field',scopeId:fieldId,commitDigest:requestDigest},
      auditRecords:[{auditId:marker+'-audit',actorType:'system',actorId:'procurement',action:'release_retired_field_control',
        scopeType:'material_field',scopeId:fieldId,evidenceDigest:requestDigest}],
      resultEnvelope:resultRef=>({resultSchemaRef:RESULT_SCHEMA,resultRef}),
    }).receipt.resultRef;
    return {kind:'released',...result};
  }
  return Object.freeze({reconcile,listPage({cursor=null,limit=32}){return execute(repo=>repo.invoke('fields',{
    status:'deregistered',cursor,limit:Math.min(limit,100)}).map(row=>({cursor:row.field_id,scope:{fieldId:row.field_id}})));}});
}
module.exports=Object.freeze({createRetiredFieldControlStore});
