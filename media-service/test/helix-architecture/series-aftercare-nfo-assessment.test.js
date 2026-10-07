'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {nfoInventoryFindings,custodyIdentityChangedFinding,createAftercareCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'series-nfo-care-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const materials=['season','S01E01','S01E02'].map((name,index)=>{
    const location=path.join(root,name+'.nfo');fs.writeFileSync(location,'External NFO '+name);
    return {role:'metadata_sidecar',location,material_key:canonicalDigest(name),endpoint_id:'endpoint',binding_revision:1,ordinal:index};
  });
  return {root,materials,context:{shelfEntryId:'entry',basis:{digest:canonicalDigest('basis'),inventoryRevision:1,standardRevision:1,
    placementRevision:1,decisionFactSetDigest:canonicalDigest([])},raw:{entry:{structure_kind:'season'},identity:{},materials}}};
}
const codes=findings=>findings.map(item=>item.schemaRef.split('/')[5]);
test('all registered Season and Episode NFOs may be external readable text',t=>{
  const f=fixture(t),before=f.materials.map(item=>fs.readFileSync(item.location));
  assert.deepEqual(nfoInventoryFindings(f.context),[]);
  assert.deepEqual(f.materials.map(item=>fs.readFileSync(item.location)),before);
});
for(const failure of ['missing','empty','directory'])test('a healthy Season NFO cannot hide a later Episode NFO '+failure,t=>{
  const f=fixture(t),location=f.materials[2].location;
  if(failure==='empty')fs.writeFileSync(location,'');else {fs.unlinkSync(location);if(failure==='directory')fs.mkdirSync(location);}
  const result=nfoInventoryFindings(f.context);
  assert.deepEqual(codes(result),[failure==='empty'?'nfo_corrupt':'nfo_missing']);
  assert.match(result[0].schemaRef,/attention_required/);
  f.materials.reverse();assert.deepEqual(nfoInventoryFindings(f.context),result);
});
test('missing and empty Episode files remain independent conditions',t=>{
  const f=fixture(t);fs.unlinkSync(f.materials[1].location);fs.writeFileSync(f.materials[2].location,'');
  assert.deepEqual(codes(nfoInventoryFindings(f.context)),['nfo_missing','nfo_corrupt']);
});
test('finding digest changes when another registered Episode is missing',t=>{
  const f=fixture(t);fs.unlinkSync(f.materials[1].location);const first=nfoInventoryFindings(f.context);
  fs.unlinkSync(f.materials[2].location);assert.notEqual(nfoInventoryFindings(f.context)[0].snapshotDigest,first[0].snapshotDigest);
});
test('a Season with no registered NFO cannot pass presentation',t=>{
  const f=fixture(t);f.context.raw.materials=[];assert.deepEqual(codes(nfoInventoryFindings(f.context)),['nfo_missing']);
});
test('readability does not impose the generated NFO parsing byte limit',t=>{
  const f=fixture(t);fs.writeFileSync(f.materials[2].location,Buffer.alloc(300*1024,65));
  assert.deepEqual(nfoInventoryFindings(f.context),[]);
});
test('Movie keeps its existing alternative NFO selection and repairability',t=>{
  const f=fixture(t);f.context.raw.entry.structure_kind='single';fs.unlinkSync(f.materials[2].location);
  assert.deepEqual(nfoInventoryFindings(f.context),[]);
  fs.unlinkSync(f.materials[0].location);fs.unlinkSync(f.materials[1].location);
  assert.match(nfoInventoryFindings(f.context)[0].schemaRef,/nfo_missing\/warning\/auto_repair/);
});
test('Series Custody does not offer the unscoped Movie renderer for an empty NFO',t=>{
  const f=fixture(t);fs.writeFileSync(f.materials[2].location,'');
  assert.match(custodyIdentityChangedFinding(f.materials[2],true).schemaRef,/attention_required/);
  assert.match(custodyIdentityChangedFinding(f.materials[2],false).schemaRef,/auto_repair/);
  fs.writeFileSync(f.materials[2].location,'Changed external text');
  assert.match(custodyIdentityChangedFinding(f.materials[2],true).schemaRef,/nfo_identity_changed\/warning\/observe/);
});
test('formal Presentation reads every NFO while unscoped Series TextRender performs no effect',async t=>{
  const f=fixture(t);fs.unlinkSync(f.materials[2].location);f.context.raw.shelf={status:'active'};f.context.raw.reservations=[];
  const untouched=()=>{throw new Error('Unscoped repair must not access Workspace or persistence.');};
  const ports=createAftercareCapabilityPorts({
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute:untouched},computeBoundedMaterialFingerprintSync:untouched,
    contextReader:{read:()=>f.context,store:{history:()=>({cases:[{state:'active',aftercareCaseId:'case',careBasisDigest:f.context.basis.digest}],findings:[],commits:[]}),ensureAftercareWorkspace:untouched}},
    workResultReader:{read:()=>[{outcomeKind:'succeeded',capabilityRef:C.custody,result:{assessmentState:'healthy',findingDrafts:[]}}]}});
  const execution={ownerScope:{processId:'entry'},workId:'work',namedInputs:{}};
  const result=await ports[C.presentation].execute(execution);
  assert.equal(result.result.assessmentState,'degraded');
  assert.ok(codes(result.result.findingDrafts).includes('nfo_missing'));
  const before=f.materials.slice(0,2).map(item=>fs.readFileSync(item.location));
  const rejected=await ports[C.textRender].execute(execution);
  assert.equal(rejected.kind,'failed');assert.equal(rejected.code,'ARCA_AFTERCARE_SERIES_NFO_SCOPE_REQUIRED');
  assert.equal(rejected.evidence.writeStarted,false);ports[C.textRender].validateResult(execution,rejected);
  assert.deepEqual(f.materials.slice(0,2).map(item=>fs.readFileSync(item.location)),before);
  assert.equal(fs.existsSync(f.materials[2].location),false);
});
