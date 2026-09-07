'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createArcaCareApplication}=require('../../src/helix/domains/arca/application/care-query');

test('Care work pages prioritize live Cases and read only the requested page',()=>{
  const cases=Array.from({length:80},(_,i)=>({aftercareCaseId:'case-'+i,shelfEntryId:'entry-'+i,
    state:i===0?'active':i===1?'queued':'resolved',createdAtMs:i+1,terminalAtMs:i>1?100+i:null,
    careRequirement:{typedParameters:[{value:'video_codec_unmet'}]}}));
  const reads=[];
  const app=createArcaCareApplication({contextReader:{store:{listCases:()=>cases,
    workDisplay(ids){reads.push(...ids);return new Map(ids.map(id=>[id,{displayIdentity:id,targetShelfId:'shelf',targetShelfName:'Films'}]));}},
    read(){throw Error('A work list must not hydrate full Aftercare context for display metadata.');}},coordinator:{caseProgress:()=>({stage:'queued'})}});
  const first=app.list({view:'work',limit:2});
  assert.deepEqual(first.items.map(row=>row.state),['active','queued']);
  assert.deepEqual(reads,['entry-0','entry-1']);
  assert.equal(first.nextCursor,'2');
  assert.deepEqual(first.counts,{in_progress:1,queued:1,completed:78});
  assert.equal(app.list({view:'work',classification:'completed',limit:1}).items[0].aftercareCaseId,'case-79');
  reads.length=0;
  assert.equal(app.list({view:'work',aftercareCaseId:'case-2'}).items[0].aftercareCaseId,'case-2');
  assert.deepEqual(reads,['entry-2']);
});

test('Shelf basis updates wake reconciliation without running one workflow per Entry in HTTP',()=>{
  let wake=0;
  const app=createArcaCareApplication({contextReader:{store:{listShelfEntryIds:()=>['a','b']},
    read(){throw Error('A settings request must not hydrate every Entry.');}},
    coordinator:{reconcile(){throw Error('A settings request must not start workflows.');}},wake(){wake++;}});
  assert.deepEqual(app.shelfBasisChanged('shelf'),['a','b']);assert.equal(wake,1);
});
