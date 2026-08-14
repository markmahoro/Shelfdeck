'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createArcaCollectionQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.posterReader !== 'function') {
    throw new TypeError('Arca Collection Query requires persistence and a bounded poster reader.');
  }
  const repository = createRepositoryDefinition({ repositoryId:'arca_collection_query', owner:'arca', readOnly:true,
    schemaManifest:options.schemaManifest, statements:{
      list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
      find_entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      find_identity:{kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
      find_shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','name','target_root_location'],keyColumns:['shelf_id']},
      list_materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','size_bytes','active_guard'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_facts:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_json','fact_digest'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_people:{kind:'select-all',tableId:'arca_inventory_person_relations',columns:['shelf_entry_id','inventory_revision','person_id','display_name','role','relation_digest'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
    }});
  const execute=(participant,body)=>options.unitOfWork.execute([{participantId:participant,owner:'arca',repositories:[repository],execute:body}])[participant];
  function map(repo,row){if(!row)return null;const identity=repo.invoke('find_identity',{shelf_entry_id:row.shelf_entry_id,revision:Number(row.canonical_identity_revision)});
    if(!identity)throw new Error('Shelf Entry current Canonical Identity is absent.');
    const shelf=repo.invoke('find_shelf',{shelf_id:row.shelf_id});
    const revision=Number(row.current_inventory_revision),facts=repo.invoke('list_facts',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision}).map((item)=>{
      try{return Object.freeze({factKind:item.fact_kind,factValue:JSON.parse(item.fact_json),factDigest:item.fact_digest});}catch{throw new Error('Shelf Entry Product Fact is corrupt.');}}),
      metadata=facts.find((item)=>item.factKind==='product_metadata')?.factValue||{},descriptive=new Map((metadata.descriptiveFacts?.entries||[]).map((item)=>[item.key,item.value])),
      genresValue=descriptive.get('genres')??descriptive.get('genre')??[],genres=Array.isArray(genresValue)?genresValue:(typeof genresValue==='string'?genresValue.split(/[,/|]/).map((item)=>item.trim()).filter(Boolean):[]),
      people=repo.invoke('list_people',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision})
        .map((item)=>Object.freeze({personId:item.person_id,displayName:item.display_name,role:item.role}));
    return Object.freeze({shelfEntryId:row.shelf_entry_id,shelfId:row.shelf_id,shelfName:shelf?.name||row.shelf_id,structureKind:row.structure_kind,status:row.status,
      canonicalIdentityRevision:Number(row.canonical_identity_revision),canonicalIdentityKey:row.canonical_identity_key,
      provider:identity.provider,providerKey:identity.provider_key,identityKind:identity.identity_kind,identityDigest:identity.identity_digest,
      displayIdentity:descriptive.get('title')||descriptive.get('display_title')||identity.provider_key,year:descriptive.get('year')||descriptive.get('release_year')||null,
      overview:descriptive.get('overview')||descriptive.get('plot')||null,genres:Object.freeze(genres),people:Object.freeze(people),
      hasPoster:repo.invoke('list_materials',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision}).some((item)=>item.role==='poster'),
      currentInventoryRevision:revision,currentDeckFactRevision:Number(row.current_deck_fact_revision),
      createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)});}
  function get(shelfEntryId){return execute('arca_collection_entry_read',(context)=>map(context.repository(repository.repositoryId),context.repository(repository.repositoryId).invoke('find_entry',{shelf_entry_id:shelfEntryId})));}
  return Object.freeze({list(){const items=execute('arca_collection_list',(context)=>{const repo=context.repository(repository.repositoryId);return repo.invoke('list_entries',{}).map((row)=>map(repo,row));})
      .sort((a,b)=>a.displayIdentity.localeCompare(b.displayIdentity,'zh-CN')||a.shelfEntryId.localeCompare(b.shelfEntryId));return Object.freeze({items:Object.freeze(items)});},
    get,
    getPoster(shelfEntryId){const reference=execute('arca_collection_poster_reference_read',(context)=>{const repo=context.repository(repository.repositoryId),row=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});
      if(!row||row.status!=='active')return null;const shelf=repo.invoke('find_shelf',{shelf_id:row.shelf_id}),poster=repo.invoke('list_materials',{
        shelf_entry_id:shelfEntryId,inventory_revision:Number(row.current_inventory_revision)}).find((item)=>item.role==='poster');
      if(!poster)return null;return Object.freeze({shelfEntryId,inventoryRevision:Number(row.current_inventory_revision),
        shelfTargetRoot:shelf.target_root_location,location:poster.location,materialKey:poster.material_key,sizeBytes:Number(poster.size_bytes)});});
      return reference?options.posterReader(reference):null;},
    targetProjection(shelfEntryId){const item=get(shelfEntryId);if(!item)return null;const body={targetType:'shelf_entry',targetId:item.shelfEntryId,targetRevision:item.canonicalIdentityRevision,
        title:item.displayIdentity,year:item.year,providerIdentity:item.provider+':'+item.providerKey,canonicalIdentityDigest:item.identityDigest};return Object.freeze({...body,targetDigest:canonicalDigest(body)});},
  });
}

module.exports=Object.freeze({createArcaCollectionQuery});
