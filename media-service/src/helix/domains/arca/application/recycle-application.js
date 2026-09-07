'use strict';

const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');

function fail(code){throw Object.assign(new Error(code),{code});}
function createRecycleApplication(options){
  const {store,port,files}=options,now=options.now||Date.now;
  const root=path.resolve(options.root);let busy=false,lastExpirySweep=0,discoveryCursor=null,discoveryAfter=0;
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
        if(options.listEntryPage&&now()>=discoveryAfter){
          const page=options.listEntryPage(discoveryCursor,1);
          if(!page.length){discoveryCursor=null;discoveryAfter=now()+24*60*60*1000;}
          else{
            const entry=page[0];discoveryCursor=entry.cursor;
            const scope=options.readScope(entry.scope.shelfEntryId),candidates={items:[]};
            for(const source of (scope?.knownSourceDirectories||[]).slice(0,32)){
              // Automatic discovery does not hash occupied source directories.
              try{if(await files.present(source)&&await files.emptyDirectory(source))candidates.items.push(await preview(entry.scope.shelfEntryId,source));}
              catch(error){return {kind:'discovery_blocked',shelfEntryId:entry.scope.shelfEntryId,errorCode:error.code||'ARCA_RECYCLE_IO_FAILED'};}
            }
            for(const value of candidates.items.filter(value=>value.manifest?.entries.length===0)){
              if(!store.list().some(item=>item.source_location===value.sourceLocation&&!['restored','purged'].includes(item.state)))await archive(entry.scope.shelfEntryId,{...value,confirmManifestDigest:value.manifestDigest,idempotencyKey:'empty:'+value.manifestDigest+':'+now()});
            }
          }
        }
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
  return Object.freeze({list:()=>({items:store.list().sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)).map(publicRow)}),preview,archive,restore,tick});
}
module.exports=Object.freeze({createRecycleApplication});
