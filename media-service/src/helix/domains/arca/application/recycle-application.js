'use strict';

const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');

function fail(code){throw Object.assign(new Error(code),{code});}
function createRecycleApplication(options){
  const {store,port,files}=options,now=options.now||Date.now;
  const root=path.resolve(options.root);let busy=false,lastExpirySweep=0;
  const retryAfter=new Map();
  async function assertRoot(scope){
    await files.noLinks(root);
    for(const scan of scope.scanRoots)if(files.inside(scan,root)||files.inside(root,scan))fail('ARCA_RECYCLE_ROOT_OVERLAP');
  }
  async function scopeFor(shelfEntryId,source){
    const scope=options.readScope(shelfEntryId);if(!scope)fail('ARCA_RECYCLE_ENTRY_NOT_FOUND');
    await assertRoot(scope);
    if(!scope.knownSourceDirectories.some(dir=>path.resolve(dir)===source))fail('ARCA_RECYCLE_SOURCE_NOT_BOUND');
    if(scope.scanRoots.some(dir=>path.resolve(dir)===source)||scope.protectedLocations.some(location=>files.inside(source,location)))fail('ARCA_RECYCLE_SOURCE_IN_USE');
    if(files.inside(source,root)||files.inside(root,source))fail('ARCA_RECYCLE_ROOT_OVERLAP');
    await files.noLinks(source);return scope;
  }
  async function preview(shelfEntryId,sourceLocation){
    if(sourceLocation===undefined){
      const scope=options.readScope(shelfEntryId);if(!scope)fail('ARCA_RECYCLE_ENTRY_NOT_FOUND');
      const items=[];
      for(const source of scope.knownSourceDirectories.slice(0,32)){
        if(!await files.present(source))continue;
        try{items.push(await preview(shelfEntryId,source));}
        catch(error){if(error.code!=='ARCA_RECYCLE_SOURCE_IN_USE')items.push({shelfEntryId,sourceLocation:source,errorCode:error.code||'ARCA_RECYCLE_IO_FAILED'});}
      }
      return {items};
    }
    if(typeof sourceLocation!=='string'||!path.isAbsolute(sourceLocation))fail('ARCA_RECYCLE_SOURCE_INVALID');
    const source=path.resolve(sourceLocation);await scopeFor(shelfEntryId,source);
    const manifest=await files.snapshot(source),manifestDigest=canonicalDigest(manifest);
    if(manifest.entries.some(row=>row.kind==='file'&&/\.(mkv|mp4|avi|mov|wmv|m2ts|mts|ts|iso|vob|mpg|mpeg|m4v)$/i.test(row.relativePath)))fail('ARCA_RECYCLE_PRIMARY_PRESENT');
    return Object.freeze({shelfEntryId,sourceLocation:source,manifest,manifestDigest,requiresConfirmation:manifest.entries.length>0});
  }
  function publicRow(row){return Object.freeze({id:row.recycle_entry_id,shelfEntryId:row.shelf_entry_id,sourceLocation:row.source_location,
    state:row.state,reasonCode:row.reason_code,createdAtMs:row.created_at_ms,archivedAtMs:row.archived_at_ms,expiresAtMs:row.expires_at_ms,
    fileCount:row.manifest.entries.filter(item=>item.kind==='file').length,totalBytes:row.manifest.totalBytes,errorCode:row.last_error});}
  function cleanupProjection(check,recycled){
    const checks=check.checks.map(item=>{
      const latest=recycled.filter(row=>row.shelf_entry_id===check.shelf_entry_id&&row.source_location===item.sourceLocation&&
        Number(row.created_at_ms)>=Number(check.created_at_ms)).sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms))[0];
      if(!latest)return item;
      const state=['restoring','restored'].includes(latest.state)?'retained_after_restore':latest.state==='archived'?'archived':latest.state==='purged'?'purged':'recycle_pending';
      return {sourceLocation:item.sourceLocation,state,recycleEntryId:latest.recycle_entry_id,errorCode:latest.last_error||null};
    });
    const state=checks.some(item=>item.errorCode&&item.state!=='retained_in_use'||['awaiting_confirmation','blocked'].includes(item.state))?'attention':
      checks.some(item=>item.state==='recycle_pending')?'pending':checks.length?'completed':check.state;
    return {onDeckRunId:check.on_deck_run_id,shelfEntryId:check.shelf_entry_id,state,checks,checkedAtMs:check.check_revision>1?check.updated_at_ms:null};
  }
  async function archive(shelfEntryId,body){
    if(typeof body?.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>200)fail('ARCA_RECYCLE_KEY_INVALID');
    const id=canonicalDigest({shelfEntryId,key:body.idempotencyKey}),prior=store.get(id);
    if(prior){if(prior.manifest_digest!==body.manifestDigest||prior.source_location!==path.resolve(body.sourceLocation||''))fail('ARCA_RECYCLE_KEY_CONFLICT');return publicRow(prior);}
    const value=await preview(shelfEntryId,body?.sourceLocation);
    if(body?.manifestDigest!==value.manifestDigest||body?.confirmManifestDigest!==value.manifestDigest)fail('ARCA_RECYCLE_CONFIRMATION_STALE');
    const live=store.list().find(row=>row.source_location===value.sourceLocation&&!['restored','purged'].includes(row.state));
    if(live)fail('ARCA_RECYCLE_SOURCE_ALREADY_QUEUED');
    const row=store.create({recycle_entry_id:id,shelf_entry_id:shelfEntryId,source_location:value.sourceLocation,archive_location:path.join(root,id,'payload'),
      manifest:value.manifest,manifest_digest:value.manifestDigest,reason_code:value.manifest.entries.length?'user_confirmed_source_residue':'empty_source_directory'});
    options.wake?.();return publicRow(row);
  }
  async function restore(id){const row=store.get(id);if(!row)fail('ARCA_RECYCLE_NOT_FOUND');
    if(row.state==='archived'&&await files.present(row.source_location))fail('ARCA_RECYCLE_TARGET_EXISTS');
    const scope=options.readScope(row.shelf_entry_id);if(!scope)fail('ARCA_RECYCLE_ENTRY_NOT_FOUND');await assertRoot(scope);
    const result=store.requestRestore(id);options.wake?.();return publicRow(result);
  }
  async function inspectCleanup(check){
    const checks=[];let retryMs=24*60*60*1000;
    try{
      const scope=options.readScope(check.shelf_entry_id);
      if(!scope||scope.onDeckRunId!==check.on_deck_run_id)fail('ARCA_RECYCLE_CHECK_SCOPE_CHANGED');
      if(scope.knownSourceDirectories.length>32)fail('ARCA_RECYCLE_SCOPE_TOO_LARGE');
      const recycled=store.list();
      for(const source of scope.knownSourceDirectories){
        const prior=recycled.filter(row=>row.source_location===source).sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms))[0];
        // A user restore ends this cleanup attempt; never move it back automatically.
        if(prior&&['restored','restoring'].includes(prior.state)){checks.push({sourceLocation:source,state:'retained_after_restore',recycleEntryId:prior.recycle_entry_id});continue;}
        if(prior&&!['purged'].includes(prior.state)){
          checks.push({sourceLocation:source,state:prior.state==='archived'?'archived':'recycle_pending',recycleEntryId:prior.recycle_entry_id,errorCode:prior.last_error||null});
          if(prior.state!=='archived')retryMs=Math.min(retryMs,5*60*1000);continue;
        }
        try{
          await scopeFor(check.shelf_entry_id,path.resolve(source));
          if(!await files.present(source)){checks.push({sourceLocation:source,state:'absent'});continue;}
          if(!await files.emptyDirectory(source)){checks.push({sourceLocation:source,state:'awaiting_confirmation'});continue;}
          const value=await preview(check.shelf_entry_id,source);
          // The directory may have changed after emptyDirectory. Never turn that race into consent.
          if(value.requiresConfirmation){checks.push({sourceLocation:source,state:'awaiting_confirmation'});continue;}
          const row=await archive(check.shelf_entry_id,{...value,confirmManifestDigest:value.manifestDigest,idempotencyKey:'on-deck-cleanup:'+check.on_deck_run_id+':'+canonicalDigest(source)});
          checks.push({sourceLocation:source,state:'recycle_pending',recycleEntryId:row.id});retryMs=Math.min(retryMs,5*60*1000);
        }catch(error){
          const code=error.code||'ARCA_RECYCLE_IO_FAILED';
          checks.push({sourceLocation:source,state:code==='ARCA_RECYCLE_SOURCE_IN_USE'?'retained_in_use':'blocked',errorCode:code});
          if(code!=='ARCA_RECYCLE_SOURCE_IN_USE')retryMs=Math.min(retryMs,5*60*1000);
        }
      }
    }catch(error){checks.length=0;checks.push({state:'blocked',errorCode:error.code||'ARCA_RECYCLE_IO_FAILED'});retryMs=5*60*1000;}
    const attention=checks.some(item=>['awaiting_confirmation','blocked'].includes(item.state)),pending=checks.some(item=>item.state==='recycle_pending');
    const state=attention?'attention':pending?'pending':'completed';
    options.cleanupStore.record(check,checks,state,state==='completed'?Number.MAX_SAFE_INTEGER:now()+retryMs);
    return {kind:'cleanup_checked',shelfEntryId:check.shelf_entry_id,state};
  }
  async function tick(){
    if(busy)return {kind:'busy'};busy=true;
    try{
      let rows=store.list();
      if(now()-lastExpirySweep>=24*60*60*1000){
        for(const row of rows.filter(row=>row.state==='archived'&&row.expires_at_ms!==null&&Number(row.expires_at_ms)<=now()))store.requestPurge(row,now());
        lastExpirySweep=now();rows=store.list();
      }
      const row=rows.filter(row=>['pending','moving','restoring','purging'].includes(row.state)&&now()>=(retryAfter.get(row.recycle_entry_id)||0))
        .sort((a,b)=>Number(a.created_at_ms)-Number(b.created_at_ms))[0];
      if(!row){
        const check=options.cleanupStore?.next(now());
        if(check)return await inspectCleanup(check);
        return {kind:'idle'};
      }
      let current=row;
      try{
        const scope=options.readScope(row.shelf_entry_id);if(!scope)fail('ARCA_RECYCLE_ENTRY_NOT_FOUND');await assertRoot(scope);
        if(!files.inside(root,row.archive_location)||row.archive_location!==path.join(root,row.recycle_entry_id,'payload'))fail('ARCA_RECYCLE_PATH_ESCAPE');
        if(row.state==='moving'&&await files.present(row.source_location))await scopeFor(row.shelf_entry_id,row.source_location);
        if(row.state==='pending'){await scopeFor(row.shelf_entry_id,row.source_location);await files.verify(row.source_location,row.manifest);current=store.start(row);}
        await port.apply(current);store.finish(current);retryAfter.delete(row.recycle_entry_id);
        return {kind:'completed',recycleEntryId:row.recycle_entry_id};
      }catch(error){store.recordError(current,error.code||'ARCA_RECYCLE_IO_FAILED');retryAfter.set(row.recycle_entry_id,now()+5*60*1000);return {kind:'blocked',recycleEntryId:row.recycle_entry_id,errorCode:error.code||'ARCA_RECYCLE_IO_FAILED'};}
    }finally{busy=false;}
  }
  return Object.freeze({list:(query={})=>{
    const cursor=query.cleanupCursor||null;
    if(cursor!==null&&(typeof cursor!=='string'||cursor.length>200))fail('ARCA_RECYCLE_CURSOR_INVALID');
    const rows=options.cleanupStore?.page(cursor,51)||[],page=rows.slice(0,50),recycled=store.list().sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms));
    return {items:recycled.map(publicRow),
      cleanupChecks:page.map(row=>cleanupProjection(row,recycled)),
      cleanupNextCursor:rows.length>50?page.at(-1).on_deck_run_id:null};
  },preview,archive,restore,tick});
}
module.exports=Object.freeze({createRecycleApplication});
