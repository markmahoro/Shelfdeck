'use strict';
const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const columns=['target_binding_id','shelf_id','endpoint_id','root_location','mount_scope_id','mount_scope_revision','binding_digest','captured_at_ms'];
const statements=Object.freeze({
  find_target_binding:{kind:'select-one',tableId:'arca_shelf_target_bindings',columns,keyColumns:['target_binding_id'],safeIntegers:true},
  insert_target_binding:{kind:'insert',tableId:'arca_shelf_target_bindings',columns},
  list_source_target_bindings:{kind:'select-filtered-page',tableId:'arca_shelf_target_bindings',columns,
    fixedKeyColumns:['shelf_id','endpoint_id','mount_scope_id'],orderBy:[{column:'target_binding_id',direction:'asc'}],maxItems:101,safeIntegers:true},
});
function targetValue(shelfId,target){return {schema:'arca.shelf-target-binding@1',shelfId,
  endpointId:target.endpointId,rootLocation:target.rootLocation,mountScopeId:target.mountScopeId,
  mountScopeRevision:Number(target.mountScopeRevision)};}
function fromShelf(row){return {endpointId:row.target_endpoint_id,rootLocation:row.target_root_location,
  mountScopeId:row.target_mount_scope_id,mountScopeRevision:Number(row.target_mount_scope_revision)};}
function captureTargetBinding(repo,shelfId,target,at){
  const body=targetValue(shelfId,target),digest=canonicalDigest(body),id=digest;
  const prior=repo.invoke('find_target_binding',{target_binding_id:id});
  if(prior){if(prior.binding_digest!==digest)throw new Error('Shelf Target Binding digest is corrupt.');return;}
  repo.invoke('insert_target_binding',{target_binding_id:id,shelf_id:shelfId,endpoint_id:body.endpointId,
    root_location:body.rootLocation,mount_scope_id:body.mountScopeId,mount_scope_revision:body.mountScopeRevision,
    binding_digest:digest,captured_at_ms:at});
}
function contains(root,location){let a=path.resolve(root),b=path.resolve(location);
  if(process.platform==='win32'){a=a.toLowerCase();b=b.toLowerCase();}
  return b.startsWith(a.endsWith(path.sep)?a:a+path.sep);
}
function exactSourceTargetBinding(repo,shelf,material){
  const fail=code=>{throw Object.assign(new Error('The original Inventory source requires one exact Shelf Target Binding.'),{code});};
  const rows=repo.invoke('list_source_target_bindings',{shelf_id:shelf.shelf_id,endpoint_id:material.endpoint_id,
    mount_scope_id:material.mount_scope_id,offset:0,limit:101});
  if(rows.length>100)fail('ARCA_SOURCE_TARGET_BINDING_BOUND');
  const candidates=new Map();
  for(const row of rows){const target={endpointId:row.endpoint_id,rootLocation:row.root_location,
    mountScopeId:row.mount_scope_id,mountScopeRevision:Number(row.mount_scope_revision)};
    if(canonicalDigest(targetValue(shelf.shelf_id,target))!==row.binding_digest||row.target_binding_id!==row.binding_digest)
      fail('ARCA_SOURCE_TARGET_BINDING_CORRUPT');
    candidates.set(row.binding_digest,target);
  }
  const current=fromShelf(shelf);candidates.set(canonicalDigest(targetValue(shelf.shelf_id,current)),current);
  const matches=[...candidates.values()].filter(target=>target.endpointId===material.endpoint_id&&
    target.mountScopeId===material.mount_scope_id&&contains(target.rootLocation,material.location));
  if(matches.length!==1)fail(matches.length?'ARCA_SOURCE_TARGET_BINDING_AMBIGUOUS':'ARCA_SOURCE_TARGET_BINDING_MISSING');
  return Object.freeze(matches[0]);
}
module.exports=Object.freeze({statements,captureTargetBinding,exactSourceTargetBinding,fromShelf});
