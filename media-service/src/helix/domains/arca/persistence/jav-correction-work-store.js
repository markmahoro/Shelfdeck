'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const PHASES=Object.freeze([
  ['admitted',null,'in_progress'],['active',null,'in_progress'],['attention_required',null,'attention_required'],
  ['committed','pending','in_progress'],['committed','active','in_progress'],['committed','attention_required','attention_required'],
  ['committed','completed','completed'],['cancelled',null,'ended'],
].map(([state,cleanup,classification],index)=>Object.freeze({key:String(index),state,cleanup,classification})));
const fail=()=>{throw Object.assign(new TypeError('Invalid correction work page query.'),{code:'ARCA_JAV_CORRECTION_PAGE_INVALID'});};
function createJavCorrectionWorkStore(options){
  const base={kind:'select-joined-page',tableId:'arca_jav_identity_corrections',
    columns:['correction_id','state','cleanup_state','created_at_ms','updated_at_ms'],
    joins:[{tableId:'arca_shelf_entries',alias:'entry',on:[{column:'shelf_entry_id',otherAlias:'base',otherColumn:'shelf_entry_id'}]},
      {tableId:'arca_inventory_product_facts',alias:'metadata',on:[{column:'shelf_entry_id',otherAlias:'entry',otherColumn:'shelf_entry_id'},
        {column:'inventory_revision',otherAlias:'entry',otherColumn:'current_inventory_revision'}]}],
    filters:[{column:'state',kind:'equals',parameter:'state'},
      {column:'cleanup_state',kind:'equals',parameter:'cleanup',optional:true},
      {column:'correction_id',kind:'equals',parameter:'correction',optional:true},
      {alias:'entry',column:'shelf_id',kind:'equals',parameter:'shelf',optional:true},
      {alias:'metadata',column:'fact_kind',kind:'equals',parameter:'metadata_kind',optional:true},
      {alias:'metadata',column:'fact_json',kind:'json_entry_text',path:'$.descriptiveFacts.entries',keys:['title','display_title'],parameter:'query',optional:true}],
    orderBy:[{column:'created_at_ms',direction:'desc'},{column:'correction_id',direction:'asc'}],maxItems:51,safeIntegers:true};
  const repository=createRepositoryDefinition({repositoryId:'arca_jav_correction_work_query',owner:'arca',readOnly:true,schemaManifest:options.schemaManifest,
    statements:{page:base,terminal_page:{...base,orderBy:[{column:'updated_at_ms',direction:'desc'},...base.orderBy]},
      counts:{kind:'count-grouped',tableId:'arca_jav_identity_corrections',groupColumn:'state'},
      cleanup_counts:{kind:'count-grouped',tableId:'arca_jav_identity_corrections',groupColumn:'cleanup_state'}}});
  return Object.freeze({list(query={}){
    if(Object.keys(query).some(key=>!['limit','cursor','classification','q','shelfId','correctionId'].includes(key)))fail();
    const limit=query.limit===undefined?25:Number(query.limit),filter=query.classification||null,search=String(query.q||'').trim(),shelf=String(query.shelfId||''),correction=String(query.correctionId||'');
    if(!Number.isSafeInteger(limit)||limit<1||limit>50||filter&&!['in_progress','attention_required','completed','ended','terminal'].includes(filter)||
        search.length>256||shelf.length>256||correction.length>256||query.cursor&&String(query.cursor).length>8192)fail();
    const scope=canonicalDigest({filter,search,shelf,correction}),offsets=Object.fromEntries(PHASES.map(p=>[p.key,0]));let finished=[];
    if(query.cursor){let decoded;try{decoded=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{fail();}
      if(decoded?.version!==1||decoded.scope!==scope||!Array.isArray(decoded.finished)||decoded.finished.some(key=>!Object.hasOwn(offsets,key))||
          !decoded.offsets||Object.keys(decoded.offsets).length!==PHASES.length||PHASES.some(p=>!Number.isSafeInteger(decoded.offsets[p.key])||decoded.offsets[p.key]<0))fail();
      Object.assign(offsets,decoded.offsets);finished=decoded.finished;}
    return options.unitOfWork.execute([{participantId:'arca_jav_correction_work_page',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),states=Object.fromEntries(repo.invoke('counts',{}).map(r=>[r.group_value,Number(r.row_count)])),
        cleanup=Object.fromEntries(repo.invoke('cleanup_counts',{}).map(r=>[r.group_value,Number(r.row_count)])),
        counts={in_progress:(states.admitted||0)+(states.active||0)+(cleanup.pending||0)+(cleanup.active||0),
          attention_required:(states.attention_required||0)+(cleanup.attention_required||0),completed:cleanup.completed||0,ended:states.cancelled||0};
      const phases=PHASES.filter(p=>!filter||filter==='terminal'&&['completed','ended'].includes(p.classification)||p.classification===filter),rows=[];
      for(const p of phases){if(finished.includes(p.key))continue;
        const terminal=['completed','ended'].includes(p.classification);
        rows.push(...repo.invoke(terminal?'terminal_page':'page',{state:p.state,cleanup:p.cleanup||'',correction,shelf,query:search,
          metadata_kind:search?'product_metadata':'',offset:offsets[p.key],limit:limit+1}).map(row=>({...row,phase:p.key,classification:p.classification,
            timestamp:Number(terminal?row.updated_at_ms:row.created_at_ms)})));}
      rows.sort((a,b)=>Number(['completed','ended'].includes(a.classification))-Number(['completed','ended'].includes(b.classification))||
        b.timestamp-a.timestamp||a.correction_id.localeCompare(b.correction_id));
      const items=rows.slice(0,limit);for(const row of items)offsets[row.phase]++;
      for(const p of phases)if(!finished.includes(p.key)&&rows.filter(r=>r.phase===p.key).length===items.filter(r=>r.phase===p.key).length)finished.push(p.key);
      return {items:items.map(row=>({correctionId:row.correction_id,classification:row.classification})),counts,
        nextCursor:phases.some(p=>!finished.includes(p.key))?Buffer.from(JSON.stringify({version:1,scope,offsets,finished})).toString('base64url'):null};
    }}]).arca_jav_correction_work_page;
  }});
}
module.exports=Object.freeze({createJavCorrectionWorkStore});
