'use strict';
const {buildJavCorrectionFilePlan,buildJavCorrectionFilePlanForRecovery,SCHEMA}=require('../model/jav-correction-file-plan');
const {SOURCE_CAPABILITY,CAPABILITY}=require('../model/jav-correction-execution-contract');
const {RECOVERY_SOURCE_PROJECTION,readJavCorrectionSourceResult}=require('../model/jav-correction-source-result');
function createJavCorrectionFilePlanPreparation(options) {
  function prepareUsing(correctionId,workId,recovery){
    const c=(recovery?options.correctionContextReader.readForRecovery:options.correctionContextReader.read)(correctionId),status=options.workResultReader.status(workId);
    if(!c||status?.owner_domain!=='arca'||status.process_type!=='arca_jav_identity_correction'||status.process_id!==correctionId||status.state!=='succeeded')
      throw Object.assign(new Error('File Plan requires this correction\'s completed preparation Work.'),{code:'ARCA_JAV_CORRECTION_ASSETS_NOT_READY'});
    const rows=options.workResultReader.read(workId),exact=ref=>rows.filter(item=>item.capabilityRef===ref&&item.outcomeKind==='succeeded');
    const source=readJavCorrectionSourceResult({...options,...c}),assets=exact(CAPABILITY);
    if(assets.length!==1||!assets[0].inputBindings.bindings.some(binding=>binding.portName==='javCorrectionSourceVerified'&&
        (binding.bindingKind==='projected_event_result'&&binding.eventId===source.eventId||
          binding.bindingKind==='projected_owner_facts'&&binding.projectionRef===RECOVERY_SOURCE_PROJECTION&&c.record.recoveryIntent?.sourceResultReference?.eventId===source.eventId)))
      throw Object.assign(new Error('File Plan must use the exact successful Source predecessor and asset Result.'),{code:'ARCA_JAV_CORRECTION_ASSETS_NOT_READY'});
    for(const item of [assets[0].result.metadataHandle,...assets[0].result.artifacts.map(item=>item.workspaceMaterialHandle)])
      (recovery?options.workspaceStore.resolveRecovery:options.workspaceStore.resolve)(correctionId,c.record.admissionDigest,item);
    const shelf=c.context.raw.shelf,target={endpointId:shelf.target_endpoint_id,rootLocation:shelf.target_root_location,
      mountScopeId:shelf.target_mount_scope_id,mountScopeRevision:Number(shelf.target_mount_scope_revision)},
      value=(recovery?buildJavCorrectionFilePlanForRecovery:buildJavCorrectionFilePlan)({record:c.record,scope:c.scope,verified:source.result,prepared:assets[0].result,target});
    options.contractValidator.validate(SCHEMA,value);return value;
  }
  return Object.freeze({prepare:(correctionId,workId)=>prepareUsing(correctionId,workId,false),prepareForRecovery:(correctionId,workId)=>prepareUsing(correctionId,workId,true)});
}
module.exports=Object.freeze({createJavCorrectionFilePlanPreparation});
