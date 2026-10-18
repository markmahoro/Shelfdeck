'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const model=require('../model/us-adult-recommendations');
const CYCLE=['cycle_id','state','revision','progress_schema_ref','progress_json','progress_digest','created_at_ms','updated_at_ms'],
  SOURCE=['cycle_id','source_id','libra_run_id','group_id','observation_schema_ref','observation_json','observation_digest','created_at_ms'],
  GROUP=['cycle_id','group_id','representative_source_id','coverage_count','quality_score','rank_pass_id','rank_coverage_count','rank_representative_source_id','rank_quality_score','revision'],
  PUBLICATION=['window_key','cycle_id','revision','snapshot_schema_ref','snapshot_json','snapshot_digest','updated_at_ms'];
function fail(code,message){throw Object.assign(new Error(message),{code});}
function stale(){fail('PEOPLE_RECOMMENDATION_REVISION_CONFLICT','Recommendation build revision changed.');}
function corrupt(){fail('PEOPLE_RECOMMENDATION_RECORD_INVALID','Recommendation record no longer conserves its typed content.');}
function safe(value){
  if(typeof value==='bigint'){const number=Number(value);if(!Number.isSafeInteger(number))corrupt();return number;}
  if(Array.isArray(value))return value.map(safe);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,safe(item)]));
  return value;
}
function json(row,prefix,maximum){
  let value;try{value=JSON.parse(row[prefix+'_json']);}catch{corrupt();}
  if(Buffer.byteLength(row[prefix+'_json'],'utf8')>maximum||canonicalJson(value)!==row[prefix+'_json']||
    canonicalDigest(value)!==row[prefix+'_digest']||value.schema!==row[prefix+'_schema_ref'])corrupt();
  return value;
}
function encoded(prefix,value,maximum){
  const serialized=canonicalJson(value);if(Buffer.byteLength(serialized,'utf8')>maximum)corrupt();
  return {[prefix+'_schema_ref']:value.schema,[prefix+'_json']:serialized,[prefix+'_digest']:canonicalDigest(value)};
}
function createUsAdultRecommendationStore(options){
  const repository=createRepositoryDefinition({repositoryId:'people_us_recommendations',owner:'people',schemaManifest:options.schemaManifest,statements:{
    cycle:{kind:'select-one',tableId:'people_us_recommendation_cycles',keyColumns:['cycle_id'],columns:CYCLE,safeIntegers:true},
    recent:{kind:'select-filtered-page',tableId:'people_us_recommendation_cycles',columns:CYCLE,orderBy:[{column:'cycle_id',direction:'desc'}],maxItems:1,safeIntegers:true},
    insert_cycle:{kind:'insert',tableId:'people_us_recommendation_cycles',columns:CYCLE},
    save_cycle:{kind:'update',tableId:'people_us_recommendation_cycles',setColumns:['state','revision','progress_schema_ref','progress_json','progress_digest','updated_at_ms'],
      keyColumns:['cycle_id'],compareColumns:[{column:'revision',parameter:'expected_revision'}]},
    source:{kind:'select-one',tableId:'people_us_recommendation_sources',keyColumns:['cycle_id','source_id'],columns:SOURCE,safeIntegers:true},
    source_run:{kind:'select-one',tableId:'people_us_recommendation_sources',keyColumns:['cycle_id','libra_run_id'],columns:SOURCE,safeIntegers:true},
    sources:{kind:'select-page-after',tableId:'people_us_recommendation_sources',fixedKeyColumns:['cycle_id'],keyColumn:'source_id',maxItems:64,columns:SOURCE,safeIntegers:true},
    insert_source:{kind:'insert',tableId:'people_us_recommendation_sources',columns:SOURCE},
    assign_source:{kind:'update',tableId:'people_us_recommendation_sources',setColumns:['group_id'],keyColumns:['cycle_id','source_id'],
      compareColumns:[{column:'group_id',parameter:'expected_group_id',nullSafe:true}]},
    group:{kind:'select-one',tableId:'people_us_recommendation_groups',keyColumns:['cycle_id','group_id'],columns:GROUP,safeIntegers:true},
    groups:{kind:'select-page-after',tableId:'people_us_recommendation_groups',fixedKeyColumns:['cycle_id'],keyColumn:'group_id',maxItems:64,columns:GROUP,safeIntegers:true},
    insert_group:{kind:'insert',tableId:'people_us_recommendation_groups',columns:GROUP},
    save_group:{kind:'update',tableId:'people_us_recommendation_groups',setColumns:GROUP.filter(key=>!['cycle_id','group_id'].includes(key)),
      keyColumns:['cycle_id','group_id'],compareColumns:[{column:'revision',parameter:'expected_revision'}]},
    publication:{kind:'select-one',tableId:'people_us_recommendation_publications',keyColumns:['window_key'],columns:PUBLICATION,safeIntegers:true},
    publications:{kind:'select-filtered-page',tableId:'people_us_recommendation_publications',columns:PUBLICATION,orderBy:[{column:'window_key',direction:'desc'}],maxItems:2,safeIntegers:true},
    insert_publication:{kind:'insert',tableId:'people_us_recommendation_publications',columns:PUBLICATION},
    save_publication:{kind:'update',tableId:'people_us_recommendation_publications',setColumns:['cycle_id','revision','snapshot_schema_ref','snapshot_json','snapshot_digest','updated_at_ms'],
      keyColumns:['window_key'],compareColumns:[{column:'revision',parameter:'expected_revision'}]},
  }});
  const execute=body=>options.unitOfWork.execute([{participantId:'people_us_recommendations',owner:'people',repositories:[repository],
    execute:context=>{const bound=context.repository(repository.repositoryId);
      return body({invoke:(...args)=>safe(bound.invoke(...args))},context.commitTimeMs);}}]).people_us_recommendations;
  function mapCycle(row){
    if(!row)return null;const progress=model.assertProgress(json(row,'progress',16384));
    if(!['active','complete'].includes(row.state)||!Number.isSafeInteger(row.revision)||row.revision<1)corrupt();
    return Object.freeze({cycleId:row.cycle_id,state:row.state,revision:row.revision,progress});
  }
  function current(repo,expected){const cycle=mapCycle(repo.invoke('cycle',{cycle_id:expected.cycleId}));
    if(!cycle||cycle.revision!==expected.revision||canonicalJson(cycle)!==canonicalJson(expected))stale();return cycle;}
  function source(repo,cycleId,sourceId){
    const row=repo.invoke('source',{cycle_id:cycleId,source_id:sourceId});if(!row)return null;
    const observation=model.assertObservation(json(row,'observation',131072));
    options.contractValidator.validate(observation.source.schemaRef,observation.source);
    if(observation.source.sourceId!==row.source_id||observation.source.libraRunId!==row.libra_run_id)corrupt();
    return Object.freeze({cycleId:row.cycle_id,sourceId:row.source_id,groupId:row.group_id,observation});
  }
  function group(repo,row,rankPassId=null){
    if(!row)return null;
    const ranking=rankPassId!==null;if(ranking&&(row.rank_pass_id!==rankPassId||row.rank_coverage_count===0))return null;
    const sourceId=ranking?row.rank_representative_source_id:row.representative_source_id,
      representative=source(repo,row.cycle_id,sourceId),quality=ranking?row.rank_quality_score:row.quality_score;
    if(!representative||representative.groupId!==row.group_id||quality!==representative.observation.image.qualityScore)corrupt();
    const body={schema:'people.us-adult-recommendation-group@1',groupId:row.group_id,
      coverageCount:ranking?row.rank_coverage_count:row.coverage_count,representative:representative.observation};
    return model.assertGroup({...body,groupDigest:canonicalDigest(body)});
  }
  function save(repo,cycle,progress,at,state=cycle.state){
    model.assertProgress(progress);
    const result=repo.invoke('save_cycle',{cycle_id:cycle.cycleId,expected_revision:cycle.revision,revision:cycle.revision+1,state,
      ...encoded('progress',progress,16384),updated_at_ms:at});if(result.changes!==1)stale();
    return mapCycle(repo.invoke('cycle',{cycle_id:cycle.cycleId}));
  }
  function beginRank(cycle){return {...cycle.progress,stage:'refresh_sources',rankSourceCursor:null,rankGroupCursor:null,leaders:[],
    rankPassId:canonicalDigest({cycleId:cycle.cycleId,revision:cycle.revision,windowKey:cycle.progress.windowKey})};}
  function assertWindow(cycle,at){
    if(cycle.progress.windowKey<=at||options.maintenanceWindowKey?.()!==cycle.progress.windowKey)
      fail('PEOPLE_RECOMMENDATION_WINDOW_CLOSED','Recommendation batches require the exact remaining maintenance window.');
  }
  return Object.freeze({
    start(windowKey){return execute((repo,at)=>{
      const recent=mapCycle(repo.invoke('recent',{offset:0,limit:1})[0]);
      if(recent&&recent.progress.windowKey===windowKey)return recent;
      if(recent?.state==='active'){
        const next={...recent,progress:{...recent.progress,windowKey}};assertWindow(next,at);
        return save(repo,recent,beginRank(next),at);
      }
      const cycleId='us-recommendation-'+String(windowKey).padStart(16,'0'),progress=model.initialProgress(windowKey);
      assertWindow({progress},at);
      repo.invoke('insert_cycle',{cycle_id:cycleId,state:'active',revision:1,...encoded('progress',progress,16384),created_at_ms:at,updated_at_ms:at});
      return mapCycle(repo.invoke('cycle',{cycle_id:cycleId}));
    });},
    get:cycleId=>execute(repo=>mapCycle(repo.invoke('cycle',{cycle_id:cycleId}))),
    saveProgress(expected,progress){return execute((repo,at)=>{const cycle=current(repo,expected);assertWindow(cycle,at);return save(repo,cycle,progress,at);});},
    beginRanking(expected){return execute((repo,at)=>{const cycle=current(repo,expected);assertWindow(cycle,at);return save(repo,cycle,beginRank(cycle),at);});},
    acceptSource(expected,observation,nextCursor){return execute((repo,at)=>{
      const cycle=current(repo,expected);assertWindow(cycle,at);model.assertObservation(observation);
      options.contractValidator.validate(observation.source.schemaRef,observation.source);
      if(cycle.progress.stage!=='source_scan'||cycle.progress.pendingSourceId!==null)stale();
      const previous=repo.invoke('source_run',{cycle_id:cycle.cycleId,libra_run_id:observation.source.libraRunId});
      if(previous)return save(repo,cycle,{...cycle.progress,sourceCursor:nextCursor,sourceExhausted:nextCursor===null},at);
      repo.invoke('insert_source',{cycle_id:cycle.cycleId,source_id:observation.source.sourceId,libra_run_id:observation.source.libraRunId,group_id:null,
        ...encoded('observation',observation,131072),created_at_ms:at});
      return save(repo,cycle,{...cycle.progress,sourceCursor:nextCursor,sourceExhausted:nextCursor===null,stage:'group_scan',
        pendingSourceId:observation.source.sourceId,groupCursor:null,bestGroup:null},at);
    });},
    readSource:(cycleId,sourceId)=>execute(repo=>source(repo,cycleId,sourceId)),
    sourcePage(cycleId,cursor,limit=8){return execute(repo=>repo.invoke('sources',{cycle_id:cycleId,cursor,limit})
      .map(row=>source(repo,cycleId,row.source_id)));},
    groupPage(cycleId,cursor,rankPassId=null){return execute(repo=>{
      const rows=repo.invoke('groups',{cycle_id:cycleId,cursor,limit:model.POLICY.pageSize});
      return {items:rows.map(row=>group(repo,row,rankPassId)).filter(Boolean),nextCursor:rows.length===model.POLICY.pageSize?rows.at(-1).group_id:null};
    });},
    readGroup:(cycleId,groupId,rankPassId=null)=>execute(repo=>group(repo,repo.invoke('group',{cycle_id:cycleId,group_id:groupId}),rankPassId)),
    assignSource(expected,groupId){return execute((repo,at)=>{
      const cycle=current(repo,expected);assertWindow(cycle,at);
      if(cycle.progress.stage!=='group_scan'||!cycle.progress.pendingSourceId)stale();
      const pending=source(repo,cycle.cycleId,cycle.progress.pendingSourceId);if(!pending||pending.groupId!==null)stale();
      const row=groupId?repo.invoke('group',{cycle_id:cycle.cycleId,group_id:groupId}):null;if(groupId&&!row)stale();
      const existing=group(repo,row);
      if(existing&&!model.bestGroup(pending.observation,[existing]))stale();
      const next=model.addToGroup(existing,pending.observation),fields={cycle_id:cycle.cycleId,group_id:next.groupId,
        representative_source_id:next.representative.source.sourceId,coverage_count:next.coverageCount,quality_score:next.representative.image.qualityScore,
        rank_pass_id:row?.rank_pass_id||null,rank_coverage_count:row?.rank_coverage_count||0,rank_representative_source_id:row?.rank_representative_source_id||null,
        rank_quality_score:row?.rank_quality_score??null,revision:(row?.revision||0)+1};
      if(row){if(repo.invoke('save_group',{...fields,expected_revision:row.revision}).changes!==1)stale();}else repo.invoke('insert_group',fields);
      if(repo.invoke('assign_source',{cycle_id:cycle.cycleId,source_id:pending.sourceId,group_id:next.groupId,expected_group_id:null}).changes!==1)stale();
      return save(repo,cycle,{...cycle.progress,stage:'source_scan',pendingSourceId:null,groupCursor:null,bestGroup:null,
        assignedSinceRank:cycle.progress.assignedSinceRank+1},at);
    });},
    refreshRankingSources(expected,records,nextCursor){return execute((repo,at)=>{
      const cycle=current(repo,expected);assertWindow(cycle,at);
      if(cycle.progress.stage!=='refresh_sources'||!Array.isArray(records)||records.length>8)stale();
      const expectedRows=repo.invoke('sources',{cycle_id:cycle.cycleId,cursor:cycle.progress.rankSourceCursor,limit:8});
      if(canonicalJson(records.map(item=>item.sourceId))!==canonicalJson(expectedRows.map(row=>row.source_id))||
        records.some(item=>typeof item.current!=='boolean')||nextCursor!==(expectedRows.length===8?expectedRows.at(-1).source_id:null))stale();
      for(const record of records){
        if(!record.current)continue;const observed=source(repo,cycle.cycleId,record.sourceId);if(!observed?.groupId)continue;
        const row=repo.invoke('group',{cycle_id:cycle.cycleId,group_id:observed.groupId});if(!row)corrupt();
        const samePass=row.rank_pass_id===cycle.progress.rankPassId,oldCount=samePass?row.rank_coverage_count:0,
          quality=observed.observation.image.qualityScore,better=!oldCount||quality>row.rank_quality_score||
            quality===row.rank_quality_score&&record.sourceId<row.rank_representative_source_id;
        const fields={...row,rank_pass_id:cycle.progress.rankPassId,rank_coverage_count:oldCount+1,
          rank_representative_source_id:better?record.sourceId:row.rank_representative_source_id,
          rank_quality_score:better?quality:row.rank_quality_score,revision:row.revision+1,expected_revision:row.revision};
        if(repo.invoke('save_group',fields).changes!==1)stale();
      }
      return save(repo,cycle,{...cycle.progress,rankSourceCursor:nextCursor,stage:nextCursor===null?'rank_groups':'refresh_sources'},at);
    });},
    publish(expected,leaders){return execute((repo,at)=>{
      const cycle=current(repo,expected);assertWindow(cycle,at);
      if(cycle.progress.stage!=='rank_groups'||!Array.isArray(leaders)||leaders.length>5)stale();
      const items=leaders.map(leader=>group(repo,repo.invoke('group',{cycle_id:cycle.cycleId,group_id:leader.groupId}),cycle.progress.rankPassId));
      if(items.some(item=>!item)||canonicalJson(model.rankGroups(items))!==canonicalJson(items))stale();
      const snapshot={schema:'people.us-adult-recommendation-publication@1',windowKey:cycle.progress.windowKey,cycleId:cycle.cycleId,policy:model.POLICY,items},
        previous=repo.invoke('publication',{window_key:cycle.progress.windowKey}),fields={window_key:cycle.progress.windowKey,cycle_id:cycle.cycleId,
          revision:(previous?.revision||0)+1,...encoded('snapshot',snapshot,1048576),updated_at_ms:at};
      if(previous){if(repo.invoke('save_publication',{...fields,expected_revision:previous.revision}).changes!==1)stale();}else repo.invoke('insert_publication',fields);
      const complete=cycle.progress.sourceExhausted&&cycle.progress.pendingSourceId===null;
      return save(repo,cycle,{...cycle.progress,stage:cycle.progress.pendingSourceId?'group_scan':'source_scan',rankSourceCursor:null,rankGroupCursor:null,
        rankPassId:null,leaders:[],assignedSinceRank:0},at,complete?'complete':'active');
    });},
    readPublication(now){return execute(repo=>{
      const row=repo.invoke('publications',{offset:0,limit:2}).find(item=>item.window_key<=now);if(!row)return null;
      const snapshot=json(row,'snapshot',1048576);
      if(snapshot.schema!=='people.us-adult-recommendation-publication@1'||snapshot.windowKey!==row.window_key||snapshot.cycleId!==row.cycle_id||
        canonicalJson(snapshot.policy)!==canonicalJson(model.POLICY)||!Array.isArray(snapshot.items)||snapshot.items.length>5||
        Object.keys(snapshot).sort().join(',')!=='cycleId,items,policy,schema,windowKey'||canonicalJson(model.rankGroups(snapshot.items))!==canonicalJson(snapshot.items))corrupt();
      return Object.freeze({...snapshot,publicationRevision:row.revision,snapshotDigest:row.snapshot_digest});
    });},
  });
}
module.exports=Object.freeze({createUsAdultRecommendationStore});
