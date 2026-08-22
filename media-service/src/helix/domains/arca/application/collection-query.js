'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { buildRatingTargetIdentity } = require('../../libra/model/decision-identity-evidence-contracts');

function containerFromLocation(location) {
  const basename = String(location || '').split(/[\\/]/).pop().split(/[?#]/)[0];
  const match = basename.toLowerCase().match(/\.([a-z0-9]+)$/);
  if (!match) return null;
  if (match[1] === 'mkv') return 'MKV';
  if (match[1] === 'mp4') return 'MP4';
  if (match[1] === 'm2ts' || match[1] === 'mts') return 'M2TS';
  return match[1].toUpperCase();
}
function rasterFromHeight(height) {
  const value = Number(height);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value >= 2160) return '2160p';
  if (value >= 1440) return '1440p';
  if (value >= 1080) return '1080p';
  if (value >= 720) return '720p';
  return String(Math.round(value)) + 'p';
}
function videoSpecFromFacts(facts) {
  for (const fact of facts || []) {
    const value = fact.factValue;
    if (!value || typeof value !== 'object') continue;
    const stream = (value.videoStreams || value.probe?.videoStreams || [])[0];
    if (!stream) continue;
    const codec = stream.codecName || stream.codec;
    return Object.freeze({
      codec: codec && codec !== 'any' ? String(codec).toUpperCase() : null,
      raster: rasterFromHeight(stream.height),
    });
  }
  return Object.freeze({ codec: null, raster: null });
}
function occupancyFromMaterials(materials) {
  const members = materials || [];
  const occupancyBytes = members.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
  const primary = members.find((item) => item.role === 'primary_payload') || null;
  return Object.freeze({
    occupancyBytes,
    primaryVideoBytes: primary ? Number(primary.size_bytes || 0) : null,
    primaryContainer: primary ? containerFromLocation(primary.location) : null,
    hasPoster: members.some((item) => item.role === 'poster'),
    hasNfo: members.some((item) => item.role === 'metadata_sidecar' && String(item.location || '').toLowerCase().endsWith('.nfo')),
  });
}
function filterCollectionIndex(index, query = {}) {
  const shelfId = query.shelfId || null;
  const status = query.status === 'history' ? 'history' : query.status === 'current' ? 'current' : null;
  return (index || []).filter((row) => {
    if (shelfId && row.shelf_id !== shelfId) return false;
    if (status === 'current' && row.status !== 'active') return false;
    if (status === 'history' && row.status === 'active') return false;
    return true;
  });
}

function createArcaCollectionQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.posterReader !== 'function') {
    throw new TypeError('Arca Collection Query requires persistence and a bounded poster reader.');
  }
  const repository = createRepositoryDefinition({ repositoryId:'arca_collection_query', owner:'arca', readOnly:true,
    schemaManifest:options.schemaManifest, statements:{
      list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
      list_entry_index:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','status'],keyColumns:[],safeIntegers:true},
      list_entries_by_shelf:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_id'],safeIntegers:true},
      list_shelves:{kind:'select-all',tableId:'arca_shelves',columns:['shelf_id','name','status'],keyColumns:[]},
      find_entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      find_identity:{kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
      find_shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','name','status','target_root_location'],keyColumns:['shelf_id']},
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
    const materials=repo.invoke('list_materials',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision});
    const occupancy=occupancyFromMaterials(materials);
    const spec=videoSpecFromFacts(facts);
    return Object.freeze({shelfEntryId:row.shelf_entry_id,shelfId:row.shelf_id,shelfName:shelf?.name||row.shelf_id,structureKind:row.structure_kind,status:row.status,
      canonicalIdentityRevision:Number(row.canonical_identity_revision),canonicalIdentityKey:row.canonical_identity_key,
      provider:identity.provider,providerKey:identity.provider_key,identityKind:identity.identity_kind,identityDigest:identity.identity_digest,
      displayIdentity:descriptive.get('title')||descriptive.get('display_title')||identity.provider_key,year:descriptive.get('year')||descriptive.get('release_year')||null,
      overview:descriptive.get('overview')||descriptive.get('plot')||null,genres:Object.freeze(genres),people:Object.freeze(people),
      hasPoster:occupancy.hasPoster,hasNfo:occupancy.hasNfo,occupancyBytes:occupancy.occupancyBytes,
      primaryVideoBytes:occupancy.primaryVideoBytes,primaryContainer:occupancy.primaryContainer,
      videoCodec:spec.codec,videoRaster:spec.raster,
      currentInventoryRevision:revision,currentDeckFactRevision:Number(row.current_deck_fact_revision),
      createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)});}
  const emptyHealth=Object.freeze({state:'never_assessed'});
  function withHealth(item,health){return item?Object.freeze({...item,health:health||options.healthReader?.(item.shelfEntryId)||emptyHealth}):null;}
  function getBase(shelfEntryId){return execute('arca_collection_entry_read',(context)=>map(context.repository(repository.repositoryId),context.repository(repository.repositoryId).invoke('find_entry',{shelf_entry_id:shelfEntryId})));}
  function get(shelfEntryId){return withHealth(getBase(shelfEntryId));}
  return Object.freeze({list(query={}){const packed=execute('arca_collection_list',(context)=>{
      const repo=context.repository(repository.repositoryId);
      const index=repo.invoke('list_entry_index',{});
      const shelfRows=repo.invoke('list_shelves',{});
      const selected=filterCollectionIndex(index,query);
      const wanted=new Set(selected.map((row)=>row.shelf_entry_id));
      const source=query.shelfId?repo.invoke('list_entries_by_shelf',{shelf_id:query.shelfId}):repo.invoke('list_entries',{});
      return Object.freeze({
        rows:source.filter((row)=>wanted.has(row.shelf_entry_id)).map((row)=>map(repo,row)),
        index, shelfRows,
      });
    });
    const health=options.healthReaderMany?.(packed.rows.map((row)=>row.shelfEntryId))||new Map();
    const healthState=query.health && query.health !== 'all' ? query.health : null;
    const items=packed.rows.map((row)=>withHealth(row,health.get(row.shelfEntryId)))
      .filter((item)=>query.status==='history'||!healthState||item.health.state===healthState)
      .sort((a,b)=>a.displayIdentity.localeCompare(b.displayIdentity,'zh-CN')||a.shelfEntryId.localeCompare(b.shelfEntryId));
    const shelves=packed.shelfRows.filter((row)=>row.status==='active').map((shelf)=>{
      const members=packed.index.filter((row)=>row.shelf_id===shelf.shelf_id);
      return Object.freeze({
        shelfId:shelf.shelf_id, name:shelf.name,
        currentCount:members.filter((row)=>row.status==='active').length,
        historyCount:members.filter((row)=>row.status!=='active').length,
      });
    });
    const summary=Object.freeze({
      currentCount:packed.index.filter((row)=>row.status==='active').length,
      historyCount:packed.index.filter((row)=>row.status!=='active').length,
    });
    return Object.freeze({items:Object.freeze(items),shelves:Object.freeze(shelves),summary});},
    overviewStats(nowMs){
      const monthStartMs=Date.UTC(new Date(nowMs).getUTCFullYear(), new Date(nowMs).getUTCMonth(), 1);
      const packed=execute('arca_collection_overview',(context)=>{
        const repo=context.repository(repository.repositoryId);
        const index=repo.invoke('list_entry_index',{});
        const rows=repo.invoke('list_entries',{});
        const active=rows.filter((row)=>row.status==='active')
          .sort((left,right)=>Number(right.created_at_ms)-Number(left.created_at_ms));
        const recent=active.slice(0,5).map((row)=>map(repo,row));
        return Object.freeze({
          index, activeIds:active.map((row)=>row.shelf_entry_id),
          currentCount:active.length,
          monthNewCount:active.filter((row)=>Number(row.created_at_ms)>=monthStartMs).length,
          recent,
        });
      });
      const health=options.healthReaderMany?.(packed.activeIds)||new Map();
      let healthyCount=0, healthAttentionCount=0;
      for (const id of packed.activeIds) {
        const state=(health.get(id)||emptyHealth).state;
        if (state==='healthy') healthyCount += 1;
        if (state==='attention_required') healthAttentionCount += 1;
      }
      return Object.freeze({
        currentCount:packed.currentCount,
        monthNewCount:packed.monthNewCount,
        healthyCount, healthAttentionCount,
        recentOnDeck:Object.freeze(packed.recent.map((item)=>Object.freeze({
          shelfEntryId:item.shelfEntryId, displayIdentity:item.displayIdentity, createdAtMs:item.createdAtMs,
        }))),
      });
    },
    get,
    getPoster(shelfEntryId){const reference=execute('arca_collection_poster_reference_read',(context)=>{const repo=context.repository(repository.repositoryId),row=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});
      if(!row||row.status!=='active')return null;const shelf=repo.invoke('find_shelf',{shelf_id:row.shelf_id}),poster=repo.invoke('list_materials',{
        shelf_entry_id:shelfEntryId,inventory_revision:Number(row.current_inventory_revision)}).find((item)=>item.role==='poster');
      if(!poster)return null;return Object.freeze({shelfEntryId,inventoryRevision:Number(row.current_inventory_revision),
        shelfTargetRoot:shelf.target_root_location,location:poster.location,materialKey:poster.material_key,sizeBytes:Number(poster.size_bytes)});});
      return reference?options.posterReader(reference):null;},
    targetProjection(shelfEntryId){const item=getBase(shelfEntryId);if(!item)return null;
      const identity=buildRatingTargetIdentity({
        title:item.displayIdentity,year:item.year,
        providerIdentity:item.provider&&item.providerKey?item.provider+':'+item.providerKey:null,
      });
      const body={targetType:'shelf_entry',targetId:item.shelfEntryId,targetRevision:item.canonicalIdentityRevision,
        title:identity.title,year:identity.year,providerIdentity:identity.providerIdentity,canonicalIdentityDigest:item.identityDigest};
      return Object.freeze({...body,targetDigest:canonicalDigest(body)});},
  });
}

module.exports=Object.freeze({
  containerFromLocation,
  createArcaCollectionQuery,
  filterCollectionIndex,
  occupancyFromMaterials,
  videoSpecFromFacts,
});
