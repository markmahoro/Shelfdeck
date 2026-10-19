'use strict';
const path=require('node:path');
const {retainedName}=require('../../../contracts/us-adult-retained-name');
const {readRequirement:readActorRequirement}=require('../model/us-adult-actor-refresh-objective');
const {physicalIdentityFromInventoryRow}=require('../model/aftercare-contract');
const { readStoredMetadataValue } = require('../../../contracts/episode-metadata-records');

const {collectionSeriesProjection}=require('../model/collection-series-projection');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { LibraExecutionRegistration } = require('../../libra/public');
const buildRatingTargetIdentity = LibraExecutionRegistration.buildRatingTargetIdentity;
const {createJavPerceptionContinuityReader}=require('./jav-perception-continuity-reader');

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
function yearFromDescriptiveFacts(descriptive) {
  const raw = descriptive.get('year')
    ?? descriptive.get('release_year')
    ?? descriptive.get('year_or_release_date')
    ?? descriptive.get('release_date')
    ?? null;
  const match = String(raw ?? '').match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
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

function collectionSort(items, sort) {
  const titleOrder = (a, b) => a.displayIdentity.localeCompare(b.displayIdentity, 'zh-CN')
    || a.shelfEntryId.localeCompare(b.shelfEntryId);
  if (sort === 'recent') {
    return items.sort((a, b) => b.createdAtMs - a.createdAtMs || titleOrder(a, b));
  }
  if (sort === 'year_desc') {
    return items.sort((a, b) => Number(b.year || 0) - Number(a.year || 0) || titleOrder(a, b));
  }
  return items.sort(titleOrder);
}

function collectionPage(items, query) {
  const requestedLimit = Number(query.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
    return Object.freeze({ items, nextCursor: null });
  }
  const limit = Math.min(requestedLimit, 100);
  const requestedOffset = Number(query.cursor || 0);
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return Object.freeze({
    items: page,
    nextCursor: nextOffset < items.length ? String(nextOffset) : null,
  });
}

function createArcaCollectionQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.posterReader !== 'function') {
    throw new TypeError('Arca Collection Query requires persistence and a bounded poster reader.');
  }
  const repository = createRepositoryDefinition({ repositoryId:'arca_collection_query', owner:'arca', readOnly:true,
    schemaManifest:options.schemaManifest, statements:{
      pending_jav_correction:{kind:'select-all',tableId:'arca_jav_identity_corrections',columns:['correction_id','preview_proof_json','basis_digest','state','terminal_at_ms'],keyColumns:['shelf_entry_id']},
      pending_actor_case:{kind:'select-all',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','state','care_basis_json','care_basis_digest','care_requirement_json'],keyColumns:['shelf_entry_id']},
      related_entries:{kind:'select-joined-page',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key',
        'current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],joins:[
        {tableId:'arca_inventory_person_relations',alias:'person',on:[{column:'shelf_entry_id',otherAlias:'base',otherColumn:'shelf_entry_id'},
          {column:'inventory_revision',otherAlias:'base',otherColumn:'current_inventory_revision'}]},
        {tableId:'arca_canonical_identity_revisions',alias:'identity',on:[{column:'shelf_entry_id',otherAlias:'base',otherColumn:'shelf_entry_id'},
          {column:'revision',otherAlias:'base',otherColumn:'canonical_identity_revision'}]}],
        filters:[{column:'status',kind:'equals',parameter:'status'},{alias:'person',column:'person_id',kind:'equals',parameter:'person_id'},
          {alias:'identity',column:'identity_kind',kind:'equals',parameter:'identity_kind'},{column:'shelf_entry_id',kind:'greater_than',parameter:'cursor',optional:true}],
        orderBy:[{column:'shelf_entry_id',direction:'asc'}],maxItems:101,safeIntegers:true},
      list_entries:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:[],safeIntegers:true},
      overview_entries:{kind:'select-page-after',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumn:'shelf_entry_id',fixedKeyColumns:['status'],maxItems:100,safeIntegers:true},
      list_entry_index:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','status'],keyColumns:[],safeIntegers:true},
      list_entries_by_shelf:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_id'],safeIntegers:true},
      list_shelves:{kind:'select-all',tableId:'arca_shelves',columns:['shelf_id','name','status'],keyColumns:[]},
      find_entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','structure_kind','status','canonical_identity_revision','canonical_identity_key','current_inventory_revision','current_deck_fact_revision','created_at_ms','terminal_at_ms'],keyColumns:['shelf_entry_id'],safeIntegers:true},
      find_identity:{kind:'select-one',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
      list_identities:{kind:'select-all',tableId:'arca_canonical_identity_revisions',columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],keyColumns:[],safeIntegers:true},
      find_identities:{kind:'select-in',tableId:'arca_canonical_identity_revisions',keyColumn:'shelf_entry_id',fixedKeyColumns:['revision'],maxItems:500,columns:['shelf_entry_id','revision','structure_kind','identity_kind','provider','provider_key','identity_digest','committed_at_ms'],safeIntegers:true},
      find_shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','name','status','target_root_location'],keyColumns:['shelf_id']},
      list_materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','size_bytes','active_guard','episode_claims_json',
        'mount_scope_id','inode','fingerprint_algorithm','fingerprint_version','content_fingerprint'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_all_materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','size_bytes','active_guard','episode_claims_json'],keyColumns:[],safeIntegers:true},
      find_materials:{kind:'select-in',tableId:'arca_inventory_materials',keyColumn:'shelf_entry_id',fixedKeyColumns:['inventory_revision'],maxItems:500,columns:['shelf_entry_id','inventory_revision','ordinal','material_key','role','endpoint_id','location','size_bytes','active_guard','episode_claims_json'],safeIntegers:true},
      list_facts:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_all_facts:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest'],keyColumns:[],safeIntegers:true},
      find_facts:{kind:'select-in',tableId:'arca_inventory_product_facts',keyColumn:'shelf_entry_id',fixedKeyColumns:['inventory_revision'],maxItems:500,columns:['shelf_entry_id','inventory_revision','fact_kind','fact_revision','fact_json','episode_metadata_schema_ref','episode_metadata_json','fact_digest'],safeIntegers:true},
      list_people:{kind:'select-all',tableId:'arca_inventory_person_relations',columns:['shelf_entry_id','inventory_revision','person_id','display_name','role','relation_digest'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      list_all_people:{kind:'select-all',tableId:'arca_inventory_person_relations',columns:['shelf_entry_id','inventory_revision','person_id','display_name','role','relation_digest'],keyColumns:[],safeIntegers:true},
      find_people:{kind:'select-in',tableId:'arca_inventory_person_relations',keyColumn:'shelf_entry_id',fixedKeyColumns:['inventory_revision'],maxItems:500,columns:['shelf_entry_id','inventory_revision','person_id','display_name','role','relation_digest'],safeIntegers:true},
    }});
  const execute=(participant,body)=>options.unitOfWork.execute([{participantId:participant,owner:'arca',repositories:[repository],execute:body}])[participant];
  const continuity=options.readAcceptedSubjectOrigin?createJavPerceptionContinuityReader(options):null;
  function group(rows,keyOf){const values=new Map();for(const row of rows){const key=keyOf(row),items=values.get(key)||[];items.push(row);values.set(key,items);}return values;}
  function currentRows(repo,statement,entries,identity=false){
    const revisions=group(entries,(row)=>Number(identity?row.canonical_identity_revision:row.current_inventory_revision));
    const result=[],column=identity?'revision':'inventory_revision';
    for(const [revision,members] of revisions){
      const ids=[...new Set(members.map((row)=>row.shelf_entry_id))].sort();
      for(let offset=0;offset<ids.length;offset+=500)result.push(...repo.invoke(statement,{[column]:revision,values:ids.slice(offset,offset+500)}));
    }
    return result;
  }
  function collectionCaches(repo,entries){
    return Object.freeze({
      identities:new Map(currentRows(repo,'find_identities',entries,true).map((row)=>[row.shelf_entry_id+':'+Number(row.revision),row])),
      shelves:new Map(repo.invoke('list_shelves',{}).map((row)=>[row.shelf_id,row])),
      materials:group(currentRows(repo,'find_materials',entries),(row)=>row.shelf_entry_id+':'+Number(row.inventory_revision)),
      facts:group(currentRows(repo,'find_facts',entries),(row)=>row.shelf_entry_id+':'+Number(row.inventory_revision)),
      people:group(currentRows(repo,'find_people',entries),(row)=>row.shelf_entry_id+':'+Number(row.inventory_revision)),
    });
  }
  function map(repo,row,caches=null){if(!row)return null;const identity=caches?caches.identities.get(row.shelf_entry_id+':'+Number(row.canonical_identity_revision)):repo.invoke('find_identity',{shelf_entry_id:row.shelf_entry_id,revision:Number(row.canonical_identity_revision)});
    if(!identity)throw new Error('Shelf Entry current Canonical Identity is absent.');
    const shelf=caches?caches.shelves.get(row.shelf_id):repo.invoke('find_shelf',{shelf_id:row.shelf_id});
    const revision=Number(row.current_inventory_revision),key=row.shelf_entry_id+':'+revision,facts=(caches?(caches.facts.get(key)||[]):repo.invoke('list_facts',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision})).map((item)=>{
      try{return Object.freeze({factKind:item.fact_kind,factValue:readStoredMetadataValue(item),factDigest:item.fact_digest});}catch{throw new Error('Shelf Entry Product Fact is corrupt.');}}),
      metadata=facts.find((item)=>item.factKind==='product_metadata')?.factValue||{},descriptive=new Map((metadata.descriptiveFacts?.entries||[]).map((item)=>[item.key,item.value])),
      genresValue=descriptive.get('genres')??descriptive.get('genre')??[],genres=Array.isArray(genresValue)?genresValue:(typeof genresValue==='string'?genresValue.split(/[,/|]/).map((item)=>item.trim()).filter(Boolean):[]),
      people=(caches?(caches.people.get(key)||[]):repo.invoke('list_people',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision}))
        .map((item)=>Object.freeze({personId:item.person_id,displayName:item.display_name,role:item.role}));
    const materials=caches?(caches.materials.get(key)||[]):repo.invoke('list_materials',{shelf_entry_id:row.shelf_entry_id,inventory_revision:revision});
    const series=collectionSeriesProjection(row,materials,facts);
    const occupancy=occupancyFromMaterials(materials);
    const spec=videoSpecFromFacts(facts);
    const defectManifest=facts.find((item)=>item.factKind==='authorized_defect_manifest')?.factValue||null;
    const defectAdmission=defectManifest?Object.freeze({
      defectCount:Number(defectManifest.defectCount)||0,
      defects:Object.freeze([...(defectManifest.defects||[])]),
    }):null;
    return Object.freeze({shelfEntryId:row.shelf_entry_id,shelfId:row.shelf_id,shelfName:shelf?.name||row.shelf_id,structureKind:row.structure_kind,status:row.status,
      canonicalIdentityRevision:Number(row.canonical_identity_revision),canonicalIdentityKey:row.canonical_identity_key,
      provider:identity.provider,providerKey:identity.provider_key,identityKind:identity.identity_kind,identityDigest:identity.identity_digest,
      displayIdentity:descriptive.get('title')||descriptive.get('display_title')||descriptive.get('series_title')||identity.provider_key,year:yearFromDescriptiveFacts(descriptive),
      overview:descriptive.get('overview')||descriptive.get('plot')||null,genres:Object.freeze(genres),people:Object.freeze(people),
      hasPoster:occupancy.hasPoster,hasNfo:occupancy.hasNfo,occupancyBytes:occupancy.occupancyBytes,
      primaryVideoBytes:series?materials.filter(item=>item.role==='primary_payload').reduce((sum,item)=>sum+Number(item.size_bytes),0):occupancy.primaryVideoBytes,primaryContainer:series?null:occupancy.primaryContainer,
      videoCodec:series?null:spec.codec,videoRaster:series?null:spec.raster,defectAdmission,series,
      currentInventoryRevision:revision,currentDeckFactRevision:Number(row.current_deck_fact_revision),
      createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)});}
  const emptyHealth=Object.freeze({state:'never_assessed'});
  function withHealth(item,health){
    if(!item)return null;
    const projection=health||options.healthReader?.(item.shelfEntryId)||emptyHealth;
    return Object.freeze({...item,health:projection,...(Object.hasOwn(projection,'defectAdmission')?{defectAdmission:projection.defectAdmission}:{})});
  }
  function getBase(shelfEntryId){return execute('arca_collection_entry_read',(context)=>map(context.repository(repository.repositoryId),context.repository(repository.repositoryId).invoke('find_entry',{shelf_entry_id:shelfEntryId})));}
  function get(shelfEntryId){return withHealth(getBase(shelfEntryId));}
  function relatedWorks(query){
    const kinds={normal:['tmdb_movie','tmdb_series_season'],jav:['jav_code'],us_adult:['internal_identity']},limit=Number(query?.limit??24),cursor=query?.cursor??'',personIds=query?.personIds??[query?.personId];
    if(!query||!Object.hasOwn(kinds,query.libraryKind)||typeof query.personId!=='string'||!query.personId||query.personId.length>256||
        typeof cursor!=='string'||cursor.length>256||!Number.isSafeInteger(limit)||limit<1||limit>100)
      throw Object.assign(new Error('Related works require an exact Person library and bounded cursor.'),{code:'PEOPLE_RELATED_WORKS_QUERY_INVALID'});
    if(!Array.isArray(personIds)||!personIds.length||personIds.length>256||new Set(personIds).size!==personIds.length||!personIds.includes(query.personId)||
      personIds.some(id=>typeof id!=='string'||!id||id.length>256)||query.libraryKind==='us_adult'&&personIds.length!==1)
      throw Object.assign(new Error('Related works require the exact People-owned identity scope.'),{code:'PEOPLE_RELATED_WORKS_QUERY_INVALID'});
    return execute('arca_person_related_works',context=>{
      const repo=context.repository(repository.repositoryId),found=personIds.flatMap(personId=>kinds[query.libraryKind].flatMap(identityKind=>repo.invoke('related_entries',{
        person_id:personId,identity_kind:identityKind,status:'active',cursor,limit:limit+1,offset:0}))),
        rows=[...new Map(found.map(row=>[row.shelf_entry_id,row])).values()]
          .sort((a,b)=>Buffer.compare(Buffer.from(a.shelf_entry_id),Buffer.from(b.shelf_entry_id))),page=rows.slice(0,limit),caches=collectionCaches(repo,page),
        items=page.map(row=>{const item=map(repo,row,caches);return Object.freeze({shelfEntryId:item.shelfEntryId,displayIdentity:item.displayIdentity,year:item.year,
          currentInventoryRevision:item.currentInventoryRevision,shelfName:item.shelfName,hasPoster:item.hasPoster,structureKind:item.structureKind});});
      return Object.freeze({personId:query.personId,libraryKind:query.libraryKind,items:Object.freeze(items),nextCursor:rows.length>limit?page.at(-1).shelf_entry_id:null});
    });
  }
  return Object.freeze({relatedWorks,list(query={}){const packed=execute('arca_collection_list',(context)=>{
      const repo=context.repository(repository.repositoryId);
      const index=repo.invoke('list_entry_index',{});
      const shelfRows=repo.invoke('list_shelves',{});
      const selected=filterCollectionIndex(index,query);
      const wanted=new Set(selected.map((row)=>row.shelf_entry_id));
      const source=query.shelfId?repo.invoke('list_entries_by_shelf',{shelf_id:query.shelfId}):repo.invoke('list_entries',{});
      let rows=source.filter((row)=>wanted.has(row.shelf_entry_id));
      let prePaged=null;
      if(query.sort==='recent'&&!String(query.q||'').trim()&&(!query.health||query.health==='all')){
        rows.sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)||a.shelf_entry_id.localeCompare(b.shelf_entry_id));
        const result=collectionPage(rows,query);
        if(result.items!==rows){prePaged=Object.freeze({resultCount:rows.length,nextCursor:result.nextCursor});rows=result.items;}
      }
      const caches=collectionCaches(repo,rows);
      return Object.freeze({
        rows:rows.map((row)=>map(repo,row,caches)),
        index, shelfRows, prePaged,
      });
    });
    const filterHealth=query.health&&query.health!=='all'&&query.status!=='history';
    const health=filterHealth?(options.healthReaderMany?.(packed.rows.map((row)=>row.shelfEntryId))||new Map()):new Map();
    const healthState=query.health && query.health !== 'all' ? query.health : null;
    const search=String(query.q||'').trim().toLocaleLowerCase('zh-CN');
    const items=collectionSort(packed.rows.map((row)=>withHealth(row,health.get(row.shelfEntryId)||emptyHealth))
      .filter((item)=>query.status==='history'||!healthState||item.health.state===healthState)
      .filter((item)=>!search||item.displayIdentity.toLocaleLowerCase('zh-CN').includes(search)||String(item.year||'').includes(search)),query.sort);
    let page=packed.prePaged?Object.freeze({items,nextCursor:packed.prePaged.nextCursor}):collectionPage(items,query);
    if(!filterHealth){
      const visibleHealth=options.healthReaderMany?.(page.items.map((row)=>row.shelfEntryId))||new Map();
      page=Object.freeze({...page,items:page.items.map((row)=>withHealth(row,visibleHealth.get(row.shelfEntryId)||emptyHealth))});
    }
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
    return Object.freeze({items:Object.freeze(page.items),shelves:Object.freeze(shelves),summary,resultCount:packed.prePaged?.resultCount??items.length,nextCursor:page.nextCursor});},
    async overviewStats(nowMs){
      const monthStartMs=Date.UTC(new Date(nowMs).getUTCFullYear(),new Date(nowMs).getUTCMonth(),1);
      let cursor=null,currentCount=0,monthNewCount=0,healthyCount=0,healthAttentionCount=0,recent=[];
      let sliceStarted=performance.now(),pagesInSlice=0;
      do {
        const rows=execute('arca_collection_overview_page',context=>context.repository(repository.repositoryId)
          .invoke('overview_entries',{status:'active',cursor,limit:10}));
        currentCount+=rows.length;
        monthNewCount+=rows.filter(row=>Number(row.created_at_ms)>=monthStartMs).length;
        recent=[...recent,...rows].sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms)||
          Buffer.compare(Buffer.from(a.shelf_entry_id),Buffer.from(b.shelf_entry_id))).slice(0,5);
        const health=options.healthReaderMany?.(rows.map(row=>row.shelf_entry_id))||new Map();
        for(const row of rows){const state=(health.get(row.shelf_entry_id)||emptyHealth).state;
          if(state==='healthy')healthyCount+=1;
          if(state==='attention_required')healthAttentionCount+=1;
        }
        cursor=rows.length===10?rows.at(-1).shelf_entry_id:null;
        // Keep individual health reads small, but do not pay a competing Owner
        // turn after every cheap page. Bound each slice by elapsed work and pages.
        pagesInSlice+=1;
        if(cursor&&(performance.now()-sliceStarted>=50||pagesInSlice>=10)){
          await new Promise(resolve=>setImmediate(resolve));
          sliceStarted=performance.now();pagesInSlice=0;
        }
      } while(cursor);
      const recentOnDeck=execute('arca_collection_overview_recent',context=>recent.map(row=>{
        const item=map(context.repository(repository.repositoryId),row);
        return Object.freeze({shelfEntryId:item.shelfEntryId,displayIdentity:item.displayIdentity,createdAtMs:item.createdAtMs});
      }));
      return Object.freeze({currentCount,monthNewCount,healthyCount,healthAttentionCount,recentOnDeck:Object.freeze(recentOnDeck)});
    },
    get,
    async getPoster(shelfEntryId,query={}){const reference=execute('arca_collection_poster_reference_read',(context)=>{const repo=context.repository(repository.repositoryId),row=repo.invoke('find_entry',{shelf_entry_id:shelfEntryId});
      if(!row||row.status!=='active')return null;const shelf=repo.invoke('find_shelf',{shelf_id:row.shelf_id}),poster=repo.invoke('list_materials',{
        shelf_entry_id:shelfEntryId,inventory_revision:Number(row.current_inventory_revision)}).find((item)=>item.role==='poster');
      if(!poster)return null;
      const pending=repo.invoke('pending_jav_correction',{shelf_entry_id:shelfEntryId}).filter(item=>item.terminal_at_ms===null);
      let retainedRead=null;
      if(pending.length===1) {
        const proof=JSON.parse(pending[0].preview_proof_json),material=proof.basis?.materials.find(item=>item.role==='poster'&&item.physicalIdentity.materialKey===poster.material_key);
        if(proof.basis?.basisDigest!==canonicalDigest(Object.fromEntries(Object.entries(proof.basis||{}).filter(([key])=>key!=='basisDigest'))))
          throw Object.assign(new Error('Correction poster projection has corrupt owned Basis evidence.'),{code:'ARCA_JAV_CORRECTION_RECORD_CORRUPT'});
        if(material&&proof.basis.inventoryRevision===Number(row.current_inventory_revision)&&proof.basis.basisDigest===pending[0].basis_digest&&material.location===poster.location)
          retainedRead={location:require('../../../contracts/jav-correction-retained-location').javCorrectionRetainedLocation(pending[0].correction_id,material.ordinal,material.location),physicalIdentity:material.physicalIdentity};
      }
      if(!retainedRead){
        const cases=repo.invoke('pending_actor_case',{shelf_entry_id:shelfEntryId}).filter(item=>item.state==='active'&&readActorRequirement(JSON.parse(item.care_requirement_json)));
        if(cases.length>1)throw Object.assign(new Error('Poster read has competing actor Cases.'),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});
        if(cases.length===1){const care=cases[0],basis=JSON.parse(care.care_basis_json),{digest,...body}=basis;
          if(digest!==canonicalDigest(body)||care.care_basis_digest!==digest||basis.shelfEntryId!==shelfEntryId)
            throw Object.assign(new Error('Actor poster read lost its frozen Case Basis.'),{code:'ARCA_US_ADULT_PHASE_PROOF_INVALID'});
          if(basis.inventoryRevision===Number(row.current_inventory_revision))retainedRead={
            location:path.join(path.dirname(poster.location),retainedName(care.aftercare_case_id,Number(poster.ordinal))),
            physicalIdentity:physicalIdentityFromInventoryRow(poster)};
        }
      }
      return Object.freeze({shelfEntryId,inventoryRevision:Number(row.current_inventory_revision),
        shelfTargetRoot:shelf.target_root_location,location:poster.location,materialKey:poster.material_key,sizeBytes:Number(poster.size_bytes),...(retainedRead?{retainedRead}: {})});});
      if(!reference||query.revision&&Number(query.revision)!==reference.inventoryRevision)return null;
      return options.posterReader(reference,query);},
    targetProjection(shelfEntryId){const item=getBase(shelfEntryId);if(!item)return null;
      const identity=buildRatingTargetIdentity({
        title:item.displayIdentity,year:item.year,
        providerIdentity:item.provider&&item.providerKey?item.provider+':'+item.providerKey:null,
      });
      const body={targetType:'shelf_entry',targetId:item.shelfEntryId,targetRevision:item.canonicalIdentityRevision,
        title:identity.title,year:identity.year,providerIdentity:identity.providerIdentity,canonicalIdentityDigest:item.identityDigest};
      const proof=continuity?.read(item);if(proof)body.javPerceptionContinuity=proof;
      return Object.freeze({...body,targetDigest:canonicalDigest(body)});},
  });
}

module.exports=Object.freeze({
  collectionPage,
  collectionSort,
  containerFromLocation,
  createArcaCollectionQuery,
  filterCollectionIndex,
  occupancyFromMaterials,
  yearFromDescriptiveFacts,
  videoSpecFromFacts,
});
