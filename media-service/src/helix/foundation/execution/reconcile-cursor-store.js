'use strict';

const { createRepositoryDefinition } = require('../persistence/owner-repository');

class ReconcileCursorStoreError extends Error {
  constructor(code,message,details={}){super(message);this.name='ReconcileCursorStoreError';this.code=code;this.details=details;}
}
function fail(code,message,details){throw new ReconcileCursorStoreError(code,message,details);}

function createReconcileCursorStore(options){
  if(!options?.schemaManifest||!options.unitOfWork||typeof options.now!=='function'){
    fail('P4_RECONCILE_CURSOR_DEPENDENCIES_REQUIRED','Reconcile cursor persistence requires Foundation UoW and clock.');
  }
  const repository=createRepositoryDefinition({repositoryId:'foundation_reconcile_cursors',owner:'execution-foundation',
    schemaManifest:options.schemaManifest,statements:{
      find:{kind:'select-one',tableId:'fx_reconcile_cursors',columns:['owner_domain','reconciler_key','revision','opaque_cursor','updated_at_ms'],
        keyColumns:['owner_domain','reconciler_key']},
      insert:{kind:'insert',tableId:'fx_reconcile_cursors',columns:['owner_domain','reconciler_key','revision','opaque_cursor','updated_at_ms']},
      update:{kind:'update',tableId:'fx_reconcile_cursors',setColumns:['revision','opaque_cursor','updated_at_ms'],
        keyColumns:['owner_domain','reconciler_key'],compareColumns:[{column:'revision',parameter:'expected_revision'}]},
    }});
  function exactKey(request){
    if(!request||typeof request.ownerDomain!=='string'||!request.ownerDomain||typeof request.reconcilerKey!=='string'||!request.reconcilerKey){
      fail('P4_RECONCILE_CURSOR_KEY_INVALID','Reconcile cursor requires owner and reconciler identities.');
    }
  }
  return Object.freeze({
    read(request){exactKey(request);return options.unitOfWork.execute([{participantId:'reconcile_cursor_read',owner:'execution-foundation',
      repositories:[repository],execute(context){const row=context.repository(repository.repositoryId).invoke('find',{
        owner_domain:request.ownerDomain,reconciler_key:request.reconcilerKey});return row?Object.freeze({revision:Number(row.revision),
          cursor:row.opaque_cursor,updatedAtMs:Number(row.updated_at_ms)}):Object.freeze({revision:0,cursor:null,updatedAtMs:null});}}]).reconcile_cursor_read;},
    advance(request){exactKey(request);if(!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<0||
        (request.cursor!==null&&(typeof request.cursor!=='string'||Buffer.byteLength(request.cursor,'utf8')>4096))){
      fail('P4_RECONCILE_CURSOR_ADVANCE_INVALID','Reconcile cursor advance is invalid or unbounded.');
    }
    return options.unitOfWork.execute([{participantId:'reconcile_cursor_advance',owner:'execution-foundation',repositories:[repository],
      execute(context){const repo=context.repository(repository.repositoryId);const current=repo.invoke('find',{
        owner_domain:request.ownerDomain,reconciler_key:request.reconcilerKey});const revision=current?Number(current.revision):0;
        if(revision!==request.expectedRevision)fail('P4_RECONCILE_CURSOR_STALE','Reconcile cursor revision is stale.');
        const next={owner_domain:request.ownerDomain,reconciler_key:request.reconcilerKey,revision:revision+1,
          opaque_cursor:request.cursor,updated_at_ms:options.now()};
        if(current)repo.invoke('update',{...next,expected_revision:revision});else repo.invoke('insert',next);
        return Object.freeze({revision:next.revision,cursor:next.opaque_cursor,updatedAtMs:next.updated_at_ms});}}]).reconcile_cursor_advance;}
  });
}

module.exports=Object.freeze({ReconcileCursorStoreError,createReconcileCursorStore});
