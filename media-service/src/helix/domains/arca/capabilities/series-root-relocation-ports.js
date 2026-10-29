'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {CAPS,FILES,RESULT,outcome}=require('../model/series-root-relocation-contract');
function createSeriesRootRelocationPorts(options) {
  const executionStore=options.relocationExecution,io=options.relocationIo,now=options.now||Date.now;
  function validate(execution,value,schema){options.contractValidator.validate(schema,value.result);
    const ref=execution.namedInputs.seriesRootRelocationReference;
    if(value.result.relocationId!==ref.relocationId||value.result.planDigest!==ref.planDigest||value.result.scopeId!==ref.scopeId)
      throw new Error('Relocation result lost its exact immutable plan.');}
  const ports={
    [CAPS.files]:{validateInputs(){},execute(execution){
      const row=executionStore.assertExecuting(execution),physical=io.move(row.plan,()=>executionStore.assertExecuting(execution));
      const payload={relocationId:row.relocation_id,scopeId:row.scope_id,...physical};
      const result={schemaRef:FILES,schemaVersion:1,evidenceId:'arca-series-root-files-'+canonicalDigest(payload).slice(0,40),
        evidenceKind:'series_root_files_verified',producerRef:CAPS.files,basisDigest:row.plan_digest,payloadDigest:canonicalDigest(payload),observedAtMs:now(),...payload};
      return outcome(CAPS.files,result,execution,'material_commit');
    },validateResult:(execution,value)=>validate(execution,value,FILES),observeEffectReality(context){
      try {
        const row=options.relocationStore.read(context.work?.process_id);
        if(!row||context.work.owner_domain!=='arca'||context.work.process_type!=='arca_series_root_relocation'||
          context.event?.capability_ref!==CAPS.files||context.node?.capability_ref!==CAPS.files||context.effect?.effect_class!=='material_commit')throw new Error('Relocation recovery context changed.');
        // Startup projects only Work identity; re-read its frozen basis through
        // the declared Foundation participant instead of assuming extra fields.
        executionStore.assertRecoveryContext(context,row);
        if(row.state==='active')options.relocationStore.inspect({relocationId:row.relocation_id,scopeId:row.scope_id,planDigest:row.plan_digest});
        const observed=io.observe(row.plan);
        return {status:'forward_required',rollbackDeclared:false,evidenceDigest:canonicalDigest({planDigest:row.plan_digest,...observed})};
      } catch(error) {return {status:'conflict',rollbackDeclared:false,evidenceDigest:canonicalDigest({reasonCode:error.code||'ARCA_SERIES_RELOCATION_RECOVERY_CONFLICT'})};}
    }},
    [CAPS.commit]:{validateInputs(execution){options.contractValidator.validate(FILES,execution.namedInputs.seriesRootRelocationFilesVerified);},
      execute:executionStore.commit,validateResult:(execution,value)=>validate(execution,value,RESULT)},
  };
  for(const port of Object.values(ports)) {
    const execute=port.execute;
    port.execute=execution=>{try{return execute(execution);}catch(error){
      if(!/^(ARCA_SERIES_RELOCATION_(UNSAFE_PATH|UNKNOWN_MEMBER|PHYSICAL_DRIFT|TARGET_CONFLICT|CROSS_VOLUME)|EACCES|EPERM|ENOENT|ENOSPC|EIO)$/.test(error.code||''))throw error;
      return {kind:'failed',failureClass:'series_root_relocation_precondition',code:error.code,
        message:'The complete Series folder could not be moved.',retryDirective:'never',
        evidence:{reasonCode:error.code,relocationId:execution.ownerScope.processId}};
    }};
  }
  return Object.freeze(ports);
}
module.exports=Object.freeze({createSeriesRootRelocationPorts});
