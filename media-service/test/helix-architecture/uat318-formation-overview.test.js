'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createFormationQuery}=require('../../src/helix/domains/libra/application/formation-query');
test('Formation overview matches four list responses and refreshes on the next overview',()=>{
  let revision=1,summaryReads=0;
  const rows=Array.from({length:32},(_,i)=>({subject_id:'subject-'+i,current_libra_run_id:'run-'+i,classification:i%2?'in_progress':'attention_required',added_at_ms:32-i,organizing_action:'[]'}));
  const query=createFormationQuery({now:()=>100,store:{listActiveScan:(offset,limit)=>rows.slice(offset,offset+limit),listCompleted:()=>[],
    counts:()=>[{group_value:'in_progress',row_count:16},{group_value:'attention_required',row_count:16}]},
    readPipelineSubjectIds:()=>new Set(),detailSource:{getMany:ids=>ids.map(subjectId=>({subjectId,revision})),
      getManyWithProcessSummary:ids=>{summaryReads++;return ids.map(subjectId=>({subjectId,revision,currentPlan:null}));}}});
  const expected={summary:query.list({section:'active',limit:1}).summary,
    attentionItems:query.list({section:'active',classification:'attention_required',limit:5}).items,
    inProgressItems:query.list({section:'active',classification:'in_progress',limit:5}).items,
    completedItems:query.list({section:'completed',limit:5}).items};
  summaryReads=0;assert.deepEqual(query.overview(),expected);assert.equal(summaryReads,1);
  revision=2;const next=query.overview();assert.equal(summaryReads,2);assert.ok(next.attentionItems.every(x=>x.revision===2));
});
