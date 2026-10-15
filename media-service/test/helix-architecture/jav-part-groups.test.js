'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {groupJavNamedParts}=require('../../src/helix/domains/procurement/model/jav-part-groups');
const member=(materialKey,relativeLocation)=>({materialKey,relativeLocation});
test('Procurement named-part grouping is independent of enumeration order and freezes one code, folder and A/B order',()=>{
  const items=[member('b','DDT-548/DDT-548B.mp4'),member('a','DDT-548/DDT-548A.mp4')],result=groupJavNamedParts(items);
  assert.equal(result.groups.length,1);assert.equal(result.groups[0].javCode,'DDT-548');
  assert.deepEqual(result.groups[0].parts.map(part=>[part.ordinal,part.partLabel,part.materialKey]),[[0,'A','a'],[1,'B','b']]);
  assert.deepEqual(groupJavNamedParts([...items].reverse()),result);
});
test('actual named parts do not create a missing-part requirement and root-level files have one exact parent',()=>{
  for(const part of ['A','B']) {
    const result=groupJavNamedParts([member(part,'DDT-548'+part+'.mp4')]);
    assert.equal(result.groups.length,1);assert.equal(result.groups[0].parentRelativeLocation,'.');
    assert.equal(result.groups[0].parts.length,1);assert.equal(result.conflicts.length,0);
  }
});
test('grouping never crosses directories or code identity and never silently selects a duplicate part',()=>{
  const result=groupJavNamedParts([member('a','one/DDT-548A.mp4'),member('b','two/DDT-548B.mp4'),member('c','one/IPX-177B.mp4'),member('full','one/DDT-548.mp4')]);
  assert.equal(result.groups.length,3);assert.deepEqual(result.ungrouped,['full']);
  const duplicate=groupJavNamedParts([member('a','one/DDT-548A.mp4'),member('copy','one/DDT-548A.mkv')]);
  assert.equal(duplicate.groups.length,0);assert.equal(duplicate.conflicts[0].reasonCode,'jav_part_label_conflict');
  assert.deepEqual(duplicate.conflicts[0].materialKeys,['a','copy']);
  assert.throws(()=>groupJavNamedParts([member('a','../DDT-548A.mp4')]),TypeError);
});
