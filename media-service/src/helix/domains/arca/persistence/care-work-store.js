'use strict';
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const STATES=['active','resolved','unresolved','invalidated'];
const classification=state=>({active:'in_progress',resolved:'completed',unresolved:'attention_required',invalidated:'ended'})[state];
const visible=row=>row.state!=='queued'&&!(row.state==='invalidated'&&row.terminal_reason_code==='queued_basis_changed');
function createCareWorkStore(options){
  const columns=['aftercare_case_id','shelf_entry_id','care_requirement_json','state','terminal_reason_code','created_at_ms','terminal_at_ms'],
    page={kind:'select-filtered-page',tableId:'arca_aftercare_cases',columns,fixedKeyColumns:['state'],
      orderBy:[{column:'terminal_at_ms',direction:'desc'},{column:'created_at_ms',direction:'desc'},{column:'aftercare_case_id',direction:'asc'}],maxItems:50,safeIntegers:true},
    repository=createRepositoryDefinition({repositoryId:'arca_care_work_query',owner:'arca',readOnly:true,schemaManifest:options.schemaManifest,
      statements:{page,invalidated_page:{...page,excludedKeyColumns:['terminal_reason_code']},
        counts:{kind:'count-grouped',tableId:'arca_aftercare_cases',groupColumn:'state'},
        reasons:{kind:'count-grouped',tableId:'arca_aftercare_cases',groupColumn:'terminal_reason_code'},
        exact:{kind:'select-one',tableId:'arca_aftercare_cases',columns,keyColumns:['aftercare_case_id'],safeIntegers:true}}});
  const map=row=>Object.freeze({aftercareCaseId:row.aftercare_case_id,shelfEntryId:row.shelf_entry_id,state:row.state,
    careRequirement:JSON.parse(row.care_requirement_json),terminalReasonCode:row.terminal_reason_code,
    createdAtMs:Number(row.created_at_ms),terminalAtMs:row.terminal_at_ms===null?null:Number(row.terminal_at_ms)});
  return Object.freeze({list(query={}){
    const limit=Math.min(50,Math.max(1,Math.floor(Number(query.limit)||25))),filter=query.classification||null;
    let offsets=Object.fromEntries(STATES.map(state=>[state,0]));
    if(query.cursor){
      let decoded;try{decoded=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));}catch{throw new TypeError('Invalid maintenance page cursor.');}
      if(decoded.version!==1||decoded.filter!==filter||STATES.some(state=>!Number.isSafeInteger(decoded.offsets?.[state])||decoded.offsets[state]<0))
        throw new TypeError('Invalid maintenance page cursor.');
      offsets=decoded.offsets;
    }
    return options.unitOfWork.execute([{participantId:'arca_care_work_page',owner:'arca',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),stateCounts=Object.fromEntries(repo.invoke('counts',{}).map(row=>[row.group_value,Number(row.row_count)])),
        unadmitted=repo.invoke('reasons',{}).find(row=>row.group_value==='queued_basis_changed');
      stateCounts.invalidated=Math.max(0,(stateCounts.invalidated||0)-Number(unadmitted?.row_count||0));
      const counts=Object.fromEntries(STATES.filter(state=>stateCounts[state]>0).map(state=>[classification(state),stateCounts[state]]));
      if(query.aftercareCaseId){const row=repo.invoke('exact',{aftercare_case_id:query.aftercareCaseId});
        return Object.freeze({items:Object.freeze(row&&visible(row)&&(!filter||classification(row.state)===filter)?[map(row)]:[]),counts,nextCursor:null});}
      const states=STATES.filter(state=>!filter||classification(state)===filter),rows=[];
      for(const state of states){if(offsets[state]>=(stateCounts[state]||0))continue;
        rows.push(...repo.invoke(state==='invalidated'?'invalidated_page':'page',{state,offset:offsets[state],limit,
          ...(state==='invalidated'?{excluded_terminal_reason_code:'queued_basis_changed'}:{})}));}
      rows.sort((a,b)=>(a.state==='active'?0:1)-(b.state==='active'?0:1)||
        Number(b.terminal_at_ms||0)-Number(a.terminal_at_ms||0)||Number(b.created_at_ms)-Number(a.created_at_ms)||
        (a.aftercare_case_id<b.aftercare_case_id?-1:a.aftercare_case_id>b.aftercare_case_id?1:0));
      const selected=rows.slice(0,limit);for(const row of selected)offsets[row.state]++;
      const more=states.some(state=>offsets[state]<(stateCounts[state]||0));
      return Object.freeze({items:Object.freeze(selected.map(map)),counts,nextCursor:more?
        Buffer.from(JSON.stringify({version:1,filter,offsets})).toString('base64url'):null});
    }}]).arca_care_work_page;
  }});
}
module.exports=Object.freeze({createCareWorkStore});
