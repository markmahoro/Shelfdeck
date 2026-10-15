'use strict';
const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');
function createJavCorrectionDirectoryInspection(options){
  const now=options.now||Date.now;
  return Object.freeze({async inspect(row){
    let scope,checks=[],errorCode=null,retryMs=24*60*60*1000;
    try{
      scope=options.prepareScope(row.correction_id);
      if(scope.shelfEntryId!==row.shelf_entry_id||scope.committedContextDigest!==row.committed_context_digest||scope.cleanupReceiptDigest!==row.cleanup_receipt_digest)
        throw Object.assign(new Error('Directory responsibility provenance changed.'),{code:'ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED'});
      const recycled=options.readRecycled();
      for(const directory of scope.directories){const source=directory.sourceLocation;
        const result=(state,recycleEntryId=null,code=null)=>({sourceLocation:source,state,recycleEntryId,errorCode:code});
        if(directory.eligibility!=='eligible'){checks.push(result(directory.eligibility));continue;}
        const prior=recycled.filter(item=>item.shelf_entry_id===row.shelf_entry_id&&item.source_location===source&&Number(item.created_at_ms)>=row.created_at_ms)
          .sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)||a.recycle_entry_id.localeCompare(b.recycle_entry_id))[0];
        if(prior&&['restoring','restored'].includes(prior.state)){checks.push(result('retained_after_restore',prior.recycle_entry_id));continue;}
        if(prior){const state=prior.state==='archived'?'archived':prior.state==='purged'?'purged':'recycle_pending';
          checks.push(result(state,prior.recycle_entry_id,prior.last_error||null));if(state==='recycle_pending')retryMs=Math.min(retryMs,5*60*1000);continue;}
        try{
          await options.scopeFor(row.shelf_entry_id,path.resolve(source));
          if(!await options.files.present(source)){checks.push(result('absent'));continue;}
          if(!await options.files.emptyDirectory(source)){checks.push(result('awaiting_confirmation'));continue;}
          const value=await options.preview(row.shelf_entry_id,source);
          if(value.requiresConfirmation){checks.push(result('awaiting_confirmation'));continue;}
          const recycled=await options.archive(row.shelf_entry_id,{...value,confirmManifestDigest:value.manifestDigest,
            idempotencyKey:'jav-correction-directory:'+row.correction_id+':'+canonicalDigest(source)});
          checks.push(result('recycle_pending',recycled.id));retryMs=Math.min(retryMs,5*60*1000);
        }catch(error){const code=error.code||'ARCA_RECYCLE_IO_FAILED';checks.push(result(code==='ARCA_RECYCLE_SOURCE_IN_USE'?'retained_in_use':'blocked',null,code));
          if(code!=='ARCA_RECYCLE_SOURCE_IN_USE')retryMs=Math.min(retryMs,5*60*1000);}
      }
    }catch(error){scope=null;checks=[];errorCode=error.code||'ARCA_RECYCLE_IO_FAILED';retryMs=5*60*1000;}
    const state=errorCode||checks.some(item=>['awaiting_confirmation','blocked'].includes(item.state)||item.errorCode&&item.state!=='retained_in_use')?'attention':checks.some(item=>item.state==='recycle_pending')?'pending':'completed';
    options.directoryStore.record(row,{scope,checks,state,errorCode,nextAt:state==='completed'?Number.MAX_SAFE_INTEGER:now()+retryMs});
    return {kind:'correction_directory_checked',correctionId:row.correction_id,shelfEntryId:row.shelf_entry_id,state};
  }});
}
module.exports=Object.freeze({createJavCorrectionDirectoryInspection});
