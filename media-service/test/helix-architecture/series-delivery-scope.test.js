"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const {pendingSeriesBatch,bindingsForEpisodeScope}=require('../../src/helix/domains/libra/model/series-delivery-scope');
const binding=(material_key,origin_candidate_package_id)=>({material_key,origin_candidate_package_id,authority_kind:'primary_control',binding_revision:1});
const bindings=[binding('old','a'),binding('running','b'),binding('new','c')];
test('Series selects an unassigned Candidate without reusing an accepted or active Run input',()=>{
  const scopes=[{state:'completed',accepted:true,materialKeys:['old']},{state:'active',accepted:false,materialKeys:['running']}];
  assert.deepEqual(pendingSeriesBatch(bindings,scopes),[bindings[2]]);
  assert.deepEqual(pendingSeriesBatch(bindings.slice(0,2),scopes),[bindings[1]]);
  assert.deepEqual(pendingSeriesBatch(bindings.slice(0,1),scopes),[]);
  // Run state alone is not evidence of responsibility handoff.
  assert.deepEqual(pendingSeriesBatch(bindings.slice(0,1),[{state:'completed',accepted:false,materialKeys:['old']}]),[bindings[0]]);
});
test('Series freezes only the requested batch and its associated Related bindings',()=>{
  const related={material_key:'nfo',authority_kind:'related_derived',primary_material_key:'new'};
  const claims=bindings.map((row,index)=>({material_key:row.material_key,binding_revision:1,episode_key:'E00'+(index+1)}));
  assert.deepEqual(bindingsForEpisodeScope([...bindings,related],claims,['E003']),[bindings[2],related]);
  assert.deepEqual(bindingsForEpisodeScope(bindings,[{...claims[2],binding_revision:2}],['E003']),[]);
});
