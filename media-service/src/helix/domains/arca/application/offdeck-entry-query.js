'use strict';

const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');

// Off-deck selection reads Arca facts without constructing Collection detail DTOs.
function createOffdeckEntryQuery(options){
  const entryColumns=['shelf_entry_id','shelf_id','current_inventory_revision'];
  const casePage={kind:'select-joined-page',tableId:'arca_offdeck_cases',
    columns:['offdeck_case_id','shelf_entry_id','state','recovery_revision','retry_at_ms','blocked_reason','created_at_ms','terminal_at_ms'],joins:[],
    orderBy:[{column:'created_at_ms',direction:'desc'},{column:'offdeck_case_id',direction:'asc'}],maxItems:101,safeIntegers:true};
  const repository=createRepositoryDefinition({repositoryId:'arca_offdeck_entry_query',owner:'arca',readOnly:true,
    schemaManifest:options.schemaManifest,statements:{
      counts:{kind:'count-grouped',tableId:'arca_shelf_entries',groupColumn:'status'},
      shelf_names:{kind:'select-all',tableId:'arca_shelves',columns:['shelf_id','name'],keyColumns:[]},
      case_counts:{kind:'count-grouped',tableId:'arca_offdeck_cases',groupColumn:'state'},
      candidate_counts:{kind:'count-grouped',tableId:'arca_offdeck_review_candidates',groupColumn:'state'},
      candidates:{kind:'select-page-after',tableId:'arca_offdeck_review_candidates',columns:['candidate_id','candidate_kind','shelf_entry_id','duplicate_group_id','state','created_at_ms'],
        keyColumn:'candidate_id',fixedKeyColumns:['state'],maxItems:26,safeIntegers:true},
      groups:{kind:'select-in',tableId:'arca_offdeck_duplicate_groups',columns:['duplicate_group_id','canonical_identity_digest','member_set_digest','state'],keyColumn:'duplicate_group_id',maxItems:25},
      members:{kind:'select-all',tableId:'arca_offdeck_duplicate_group_members',columns:['shelf_entry_id','inventory_revision','member_digest'],keyColumns:['duplicate_group_id'],safeIntegers:true},
      active_cases:{...casePage,filters:[{column:'state',kind:'not_equals',parameter:'state'}]},
      completed_cases:{...casePage,filters:[{column:'state',kind:'equals',parameter:'state'}],
        orderBy:[{column:'terminal_at_ms',direction:'desc'},{column:'created_at_ms',direction:'desc'},{column:'offdeck_case_id',direction:'asc'}]},
      selection:{kind:'select-all',tableId:'arca_shelf_entries',columns:['shelf_entry_id'],keyColumns:['status']},
      entries:{kind:'select-in',tableId:'arca_shelf_entries',columns:entryColumns,keyColumn:'shelf_entry_id',maxItems:100,safeIntegers:true},
      shelves:{kind:'select-in',tableId:'arca_shelves',columns:['shelf_id','name'],keyColumn:'shelf_id',maxItems:100},
      metadata:{kind:'select-all',tableId:'arca_inventory_product_facts',columns:['fact_json'],keyColumns:['shelf_entry_id','inventory_revision','fact_kind']},
      materials:{kind:'select-all',tableId:'arca_inventory_materials',columns:['size_bytes'],keyColumns:['shelf_entry_id','inventory_revision'],safeIntegers:true},
      search:{kind:'select-joined-page',tableId:'arca_shelf_entries',columns:entryColumns,
        joins:[{tableId:'arca_inventory_product_facts',alias:'metadata',on:[
          {column:'shelf_entry_id',otherAlias:'base',otherColumn:'shelf_entry_id'},
          {column:'inventory_revision',otherAlias:'base',otherColumn:'current_inventory_revision'}]}],
        filters:[{column:'status',kind:'equals',parameter:'status'},
          {alias:'metadata',column:'fact_kind',kind:'equals',parameter:'fact_kind',optional:true},
          {alias:'metadata',column:'fact_json',kind:'json_entry_text',path:'$.descriptiveFacts.entries',keys:['title','display_title'],parameter:'query',optional:true}],
        orderBy:[{column:'shelf_entry_id',direction:'asc'}],maxItems:101,safeIntegers:true}
    }});
  function read(body){return options.unitOfWork.execute([{participantId:'arca_offdeck_entry_read',owner:'arca',repositories:[repository],
    execute:context=>body(context.repository(repository.repositoryId))}]).arca_offdeck_entry_read;}
  function display(repo,rows){
    if(!rows.length)return [];
    const shelves=new Map(repo.invoke('shelves',{values:[...new Set(rows.map(row=>row.shelf_id))]}).map(row=>[row.shelf_id,row.name]));
    return rows.map(row=>{
      const key={shelf_entry_id:row.shelf_entry_id,inventory_revision:Number(row.current_inventory_revision)};
      const facts=repo.invoke('metadata',{...key,fact_kind:'product_metadata'});
      const metadata=facts.length?JSON.parse(facts[0].fact_json):{};
      const descriptive=new Map((metadata.descriptiveFacts?.entries||[]).map(fact=>[fact.key,fact.value]));
      return Object.freeze({shelfEntryId:row.shelf_entry_id,displayIdentity:descriptive.get('title')||descriptive.get('display_title')||'未命名收藏',
        shelfName:shelves.get(row.shelf_id)||'原收藏架',occupancyBytes:repo.invoke('materials',key).reduce((sum,item)=>sum+Number(item.size_bytes||0),0)});
    });
  }
  return Object.freeze({
    overviewStats:()=>read(repo=>Object.freeze({attentionCount:repo.invoke('candidate_counts',{})
      .filter(row=>row.group_value==='open')
      .reduce((sum,row)=>sum+Number(row.row_count),0)})),
    candidates(query={}){return read(repo=>{
      const rows=repo.invoke('candidates',{state:'open',cursor:query.cursor||null,limit:26});
      const candidates=rows.slice(0,25).map(row=>({...row,created_at_ms:Number(row.created_at_ms)}));
      const groupIds=[...new Set(candidates.map(row=>row.duplicate_group_id).filter(Boolean))];
      const duplicateGroups=groupIds.length?repo.invoke('groups',{values:groupIds}).map(row=>({...row,members:repo.invoke('members',{duplicate_group_id:row.duplicate_group_id})
        .map(member=>({...member,inventory_revision:Number(member.inventory_revision)}))})):[];
      const ids=[...new Set([...candidates.map(row=>row.shelf_entry_id),...duplicateGroups.flatMap(group=>group.members.map(member=>member.shelf_entry_id))].filter(Boolean))];
      const entries=[];for(let offset=0;offset<ids.length;offset+=100)entries.push(...display(repo,repo.invoke('entries',{values:ids.slice(offset,offset+100)})));
      return Object.freeze({candidates,duplicateGroups,entries,candidateCount:Number(repo.invoke('candidate_counts',{}).find(row=>row.group_value==='open')?.row_count||0),
        nextCursor:rows.length>25?candidates.at(-1).candidate_id:null});
    });},
    cases(query={}){
      const classification=query.classification||'active';
      if(!['active','completed'].includes(classification))throw new TypeError('Invalid Off-deck Case classification.');
      const limit=Math.min(100,Math.max(1,Math.floor(Number(query.limit)||25)));
      let offset=0;
      if(query.cursor){
        let cursor;try{cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw new TypeError('Invalid Off-deck Case cursor.');}
        if(cursor.version!==1||cursor.classification!==classification||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw new TypeError('Invalid Off-deck Case cursor.');
        offset=cursor.offset;
      }
      return read(repo=>{
        const rows=repo.invoke(classification==='active'?'active_cases':'completed_cases',{state:'completed',offset,limit:limit+1});
        const counts=repo.invoke('case_counts',{}).reduce((result,row)=>{result[row.group_value==='completed'?'completed':'active']+=Number(row.row_count);return result;},{active:0,completed:0});
        const selected=rows.slice(0,limit),values=[...new Set(selected.map(row=>row.shelf_entry_id))];
        const entries=values.length?display(repo,repo.invoke('entries',{values})):[];
        return Object.freeze({counts,entries:Object.freeze(entries),items:Object.freeze(selected.map(row=>Object.freeze({
          offdeckCaseId:row.offdeck_case_id,shelfEntryId:row.shelf_entry_id,state:row.state,recoveryRevision:Number(row.recovery_revision),
          retryAtMs:row.retry_at_ms===null?null:Number(row.retry_at_ms),blockedReason:row.blocked_reason,
          createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)}))),
          nextCursor:rows.length>limit?Buffer.from(JSON.stringify({version:1,classification,offset:offset+limit})).toString('base64url'):null});
      });
    },
    summary:()=>read(repo=>Object.freeze({currentCount:Number(repo.invoke('counts',{}).find(row=>row.group_value==='active')?.row_count||0),
      shelves:repo.invoke('shelf_names',{}).map(row=>({shelfId:row.shelf_id,name:row.name}))})),
    // One read transaction captures the complete explicit selection. It does not hydrate any media facts.
    selection:()=>read(repo=>Object.freeze({shelfEntryIds:Object.freeze(repo.invoke('selection',{status:'active'}).map(row=>row.shelf_entry_id).sort())})),
    display(ids){
      const values=[...new Set(ids)];
      if(values.length>100)throw new TypeError('Off-deck display reads are limited to 100 entries.');
      return read(repo=>Object.freeze(display(repo,values.length?repo.invoke('entries',{values}):[])));
    },
    search(query={}){
      const search=String(query.q||'').trim(),limit=Math.min(100,Math.max(1,Math.floor(Number(query.limit)||25)));
      let offset=0;
      if(query.cursor){
        let cursor;try{cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw new TypeError('Invalid Off-deck search cursor.');}
        if(cursor.version!==1||cursor.q!==search||!Number.isSafeInteger(cursor.offset)||cursor.offset<0)throw new TypeError('Invalid Off-deck search cursor.');
        offset=cursor.offset;
      }
      return read(repo=>{
        const rows=repo.invoke('search',{status:'active',query:search,fact_kind:search?'product_metadata':'',offset,limit:limit+1});
        return Object.freeze({items:Object.freeze(display(repo,rows.slice(0,limit))),nextCursor:rows.length>limit?
          Buffer.from(JSON.stringify({version:1,q:search,offset:offset+limit})).toString('base64url'):null});
      });
    }
  });
}
module.exports=Object.freeze({createOffdeckEntryQuery});
