'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createProcurementRunSlices } = require('../../src/helix/domains/procurement/model/procurement-run-creator');

const BASIS = canonicalDigest({ fixture: 'run-creator-v2' });

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

test('ordinary first-level directory is indivisible at the unified 1024 bound', () => {
  const exact=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:group('Huge',1024)});
  assert.equal(exact.runs.length,1);
  assert.deepEqual(exact.runs[0].selectionScopes.map((scope)=>[scope.scopeKind,scope.scopeRootRelativeLocation,scope.memberCount]),
    [['ordinary_directory','Huge',1024]]);
  const closed=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,materials:group('Huge',1025)});
  assert.equal(closed.runs.length,0);
  assert.deepEqual(closed.closedGroups,[{scopeKind:'ordinary_directory',scopeKey:'ordinary-directory:Huge',
    scopeRootRelativeLocation:'Huge',memberCount:1025,reasonCode:'procurement_selection_scope_too_large'}]);
});

test('255 ordinary members and a 760-member BDMV container form one 1015-member Run', () => {
  const value=createProcurementRunSlices({fieldId:'field',creationBasisDigest:BASIS,
    materials:[...group('A',255),...group('B/BDMV/STREAM',760)]});
  assert.deepEqual(value.runs.map((run)=>run.physicalMemberCount),[1015]);
  assert.deepEqual(value.runs[0].selectionScopes.map((scope)=>[scope.scopeKind,scope.memberCount]),
    [['bdmv_container',760],['ordinary_directory',255]]);
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
  assert.deepEqual(value.runs.map((run)=>run.physicalMemberCount),[1000,500]);
  assert.deepEqual(value.runs.map((run)=>run.selectionScopeCount),[2,2]);
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
