'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {currentActionSummary}=require('../../src/helix/foundation/execution/current-action-summary');
const {currentPlanSummary}=require('../../src/helix/domains/libra/application/formation-process-projection');
test('UAT-212 action summary shares selection across Owners without inventing empty future stages',()=>{
  const node={label:'Verify actual media',state:'running',statusText:'Executing',progress:null};
  const current={key:'owner-stage',state:'running',plans:[{planId:'current',title:'Owner plan',state:'running',nodes:[node]}]};
  const previous={key:'old',state:'attention',plans:[{planId:'old',state:'attention',nodes:[{label:'Old failure',state:'failed'}]}]};
  const detail={stages:[previous,current,{key:'future',state:'pending',plans:[]}]};
  assert.deepEqual(currentPlanSummary(detail),currentActionSummary(detail));
  assert.equal(currentActionSummary(detail).label,node.label);
  assert.equal(currentActionSummary({stages:[]}),null);
  node.state='completed';current.state='completed';current.plans[0].state='completed';
  assert.equal(currentActionSummary(detail).planId,'current');
});
