'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createProcurementRunSlices } = require('../../src/helix/domains/procurement/model/procurement-run-creator');

const BASIS = canonicalDigest({ fixture: 'run-creator-v2' });
test('the local grouping rule is frozen in revision 3 and cannot silently reinterpret a signed revision 2 basis',()=>{
  const {createDefaultTriageRuleRegistry,activeTriageRule,validateTriageRuleSnapshot,ruleDigestFor,authorityDigestFor}=
    require('../../src/helix/domains/procurement/model/procurement-run-contracts');
  const current=activeTriageRule(createDefaultTriageRuleRegistry());
  assert.equal(current.revision,3);assert.equal(current.rulePayload.selectionScopeRule.packing,'sequential_complete_groups');
  const historical=JSON.parse(JSON.stringify(current));historical.revision=2;delete historical.rulePayload.selectionScopeRule;
  historical.ruleDigest=ruleDigestFor(historical);historical.authorityDigest=authorityDigestFor(historical);
  assert.throws(()=>validateTriageRuleSnapshot(historical),{code:'P7_TRIAGE_RULE_INVALID'});
});
test('JAV root named parts stay in one admission scope across Run packing boundaries',()=>{
  const parts=['DDT-548A.mp4','DDT-548B.mp4'].map(relativeLocation=>({relativeLocation,materialKey:canonicalDigest({relativeLocation})}));
  const input={fieldId:'field',creationBasisDigest:BASIS,profileHint:'jav',maxRunPhysicalMembers:2,materials:[...rootFiles(3),...parts]};
  const sliced=createProcurementRunSlices(input),run=sliced.runs.find(run=>run.members.some(member=>member.relativeLocation==='DDT-548A.mp4'));
  assert.equal(run.members.filter(member=>member.relativeLocation.startsWith('DDT-548')).length,2);
  assert.deepEqual(run.selectionScopes.map(scope=>[scope.scopeKind,scope.scopeRootRelativeLocation,scope.memberCount]),[['local_media_group','.',2]]);
  assert.deepEqual(createProcurementRunSlices({...input,materials:[...input.materials].reverse()}),sliced);
  const movie=createProcurementRunSlices({...input,profileHint:'movie',materials:parts});
  assert.ok(movie.runs[0].selectionScopes.every(scope=>scope.scopeKind==='standalone_file'));
});

function group(folder, count) {
  return Array.from({ length: count }, (_, index) => ({
    materialKey: canonicalDigest({ folder, index }),
    relativeLocation: `${folder}/Movie.${String(index).padStart(4, '0')}.mkv`,
  }));
}

function rootFiles(count) {
  return Array.from({ length:count }, (_, index) => ({
    materialKey:canonicalDigest({ root:index }), relativeLocation:`Root-${String(index).padStart(4,'0')}.mkv`,
  }));
}

test('1024 root files fit one Run and 1025 split as 1024 plus 1 independent Scopes', () => {
  const exact=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:rootFiles(1024)});
  assert.deepEqual(exact.runs.map((run)=>run.physicalMemberCount),[1024]);
  assert.equal(exact.runs[0].selectionScopeCount,1024);
  assert.ok(exact.runs[0].selectionScopes.every((scope)=>scope.scopeKind==='standalone_file'&&scope.memberCount===1));
  const split=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:rootFiles(1025)});
  assert.deepEqual(split.runs.map((run)=>run.physicalMemberCount),[1024,1]);
});

test('category directories split independent movies without exceeding the atomic Run bound', () => {
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:group('Huge',1025)});
  assert.deepEqual(value.runs.map(run=>run.physicalMemberCount),[1024,1]);
  assert.equal(value.closedGroups.length,0);
});

test('255 ordinary members and a 760-member BDMV container form one 1015-member Run', () => {
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,
    materials:[...group('A',255),...group('B/BDMV/STREAM',760)]});
  assert.deepEqual(value.runs.map((run)=>run.physicalMemberCount),[1015]);
  assert.equal(value.runs[0].selectionScopes.filter(scope=>scope.scopeKind==='bdmv_container').length,1);
  assert.equal(value.runs[0].selectionScopeCount,256);
});

test('BDMV and sibling CERTIFICATE persist one container Scope', () => {
  const materials=[
    {materialKey:'a'.repeat(64),relativeLocation:'Movie/BDMV/STREAM/00000.m2ts'},
    {materialKey:'b'.repeat(64),relativeLocation:'Movie/BDMV/PLAYLIST/00000.mpls'},
    {materialKey:'c'.repeat(64),relativeLocation:'Movie/BDMV/CLIPINF/00000.clpi'},
    {materialKey:'d'.repeat(64),relativeLocation:'Movie/CERTIFICATE/id.bdmv'},
  ];
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials});
  assert.equal(value.runs.length,1);
  assert.deepEqual(value.runs[0].selectionScopes.map((scope)=>[scope.scopeKind,scope.scopeRootRelativeLocation,scope.memberCount]),
    [['bdmv_container','Movie',4]]);
  assert.ok(value.runs[0].members.every((member)=>member.selectionScopeKey==='bdmv:Movie'));
});

test('multiple BDMV and ordinary Scopes pack sequentially without splitting or bin packing', () => {
  const materials=[...group('A/BDMV/STREAM',500),...group('B/BDMV/STREAM',500),...group('C',100),...group('D',400)];
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials});
  assert.deepEqual(value.runs.map((run)=>run.physicalMemberCount),[1024,476]);
  assert.deepEqual(value.runs.map((run)=>run.selectionScopeCount),[26,476]);
  assert.ok(value.runs.every((run)=>run.selectionScopes.every((scope)=>
    run.members.filter((member)=>member.scopeOrdinal===scope.scopeOrdinal).length===scope.memberCount)));
});

test('1025-member BDMV container is closed whole', () => {
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:group('Movie/BDMV/STREAM',1025)});
  assert.equal(value.runs.length,0);
  assert.equal(value.closedGroups[0].scopeKind,'bdmv_container');
  assert.equal(value.closedGroups[0].reasonCode,'procurement_selection_scope_too_large');
});

test('replay is stable and no Physical Material appears across Runs twice', () => {
  const materials=[...rootFiles(300),...Array.from({length:100},(_,index)=>group(`Folder-${String(index).padStart(3,'0')}`,10)).flat()];
  const first=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials});
  const replay=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:[...materials].reverse()});
  assert.deepEqual(first,replay);
  assert.deepEqual(first.runs.map((run)=>run.physicalMemberCount),[1024,276]);
  const keys=first.runs.flatMap((run)=>run.members.map((member)=>member.materialKey));
  assert.equal(new Set(keys).size,1300);
});

test('1081 videos from 22 shows preserve every complete Season across category subdirectories',()=>{
  const materials=Array.from({length:1081},(_,index)=>{
    const show=index%22,season=Math.floor(index/440)+1,episode=Math.floor(index/22)%20+1;
    const relativeLocation=`4star/Show ${show}/Season ${season}/Disc ${index%2}/Show ${show}.S${String(season).padStart(2,'0')}E${String(episode).padStart(2,'0')}.${index}.mkv`;
    return {materialKey:canonicalDigest({relativeLocation}),relativeLocation};
  });
  const input={fieldId:'field',creationBasisDigest:BASIS,profileHint:'series',materials};
  const value=createProcurementRunSlices(input),seen=new Map();
  assert.equal(value.closedGroups.length,0);assert.equal(value.runs.length,2);
  assert.equal(value.runs.flatMap(run=>run.members).length,1081);
  assert.equal(new Set(value.runs.flatMap(run=>run.members.map(member=>member.materialKey))).size,1081);
  for(const run of value.runs){assert.ok(run.physicalMemberCount<=1024);
    for(const scope of run.selectionScopes){assert.ok(!seen.has(scope.scopeKey));seen.set(scope.scopeKey,run.procurementRunId);}}
  assert.equal(seen.size,66);
  assert.deepEqual(createProcurementRunSlices({...input,materials:[...materials].reverse()}),value);
});

test('one genuinely indivisible Season larger than 1024 remains a closed group',()=>{
  const materials=Array.from({length:1025},(_,index)=>({materialKey:canonicalDigest({index}),relativeLocation:`category/Show.S01E01.part${index}.mkv`}));
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,profileHint:'series',materials});
  assert.equal(value.runs.length,0);assert.equal(value.closedGroups.length,1);
  assert.equal(value.closedGroups[0].memberCount,1025);
});
