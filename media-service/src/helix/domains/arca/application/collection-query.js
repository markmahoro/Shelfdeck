'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createArcaCollectionQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork) throw new TypeError('Arca Collection Query requires persistence.');
  const repository = createRepositoryDefinition({ repositoryId:'arca_collection_query', owner:'arca', readOnly:true,
    schemaManifest:options.schemaManifest, statements:{
      list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
      find_entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      find_identity:{kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
      find_shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','name'],keyColumns:['shelf_id']},
    }});
  const execute=(participant,body)=>options.unitOfWork.execute([{participantId:participant,owner:'arca',repositories:[repository],execute:body}])[participant];
  function map(repo,row){if(!row)return null;const identity=repo.invoke('find_identity',{shelf_entry_id:row.shelf_entry_id,revision:Number(row.canonical_identity_revision)});
    if(!identity)throw new Error('Shelf Entry current Canonical Identity is absent.');
    const shelf=repo.invoke('find_shelf',{shelf_id:row.shelf_id});
    return Object.freeze({shelfEntryId:row.shelf_entry_id,shelfId:row.shelf_id,shelfName:shelf?.name||row.shelf_id,structureKind:row.structure_kind,status:row.status,
      canonicalIdentityRevision:Number(row.canonical_identity_revision),canonicalIdentityKey:row.canonical_identity_key,
      provider:identity.provider,providerKey:identity.provider_key,identityKind:identity.identity_kind,identityDigest:identity.identity_digest,
      displayIdentity:identity.provider_key,currentInventoryRevision:Number(row.current_inventory_revision),currentDeckFactRevision:Number(row.current_deck_fact_revision),
      createdAtMs:Number(row.created_at_ms),terminalAtMs:Number(row.terminal_at_ms)});}
  function get(shelfEntryId){return execute('arca_collection_entry_read',(context)=>map(context.repository(repository.repositoryId),context.repository(repository.repositoryId).invoke('find_entry',{shelf_entry_id:shelfEntryId})));}
  return Object.freeze({list(){const items=execute('arca_collection_list',(context)=>{const repo=context.repository(repository.repositoryId);return repo.invoke('list_entries',{}).map((row)=>map(repo,row));})
      .sort((a,b)=>a.displayIdentity.localeCompare(b.displayIdentity,'zh-CN')||a.shelfEntryId.localeCompare(b.shelfEntryId));return Object.freeze({items:Object.freeze(items)});},
    get,
    targetProjection(shelfEntryId){const item=get(shelfEntryId);if(!item)return null;const body={targetType:'shelf_entry',targetId:item.shelfEntryId,targetRevision:item.canonicalIdentityRevision,
        title:item.displayIdentity,year:null,providerIdentity:item.provider+':'+item.providerKey,canonicalIdentityDigest:item.identityDigest};return Object.freeze({...body,targetDigest:canonicalDigest(body)});},
  });
}

module.exports=Object.freeze({createArcaCollectionQuery});
