'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const Ajv=require('ajv/dist/2020');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createOnDeckCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/on-deck-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/on-deck-contract');
const {evaluatePackageSpace}=require('../../src/helix/domains/arca/model/package-space-acceptance');
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schema=require('../../src/helix/contracts/types/AcceptanceCheck/v1/schema.json');
const validate=new Ajv({strict:false,allErrors:true}).compile(schema);
const {fixture}=require('./helpers/acceptance-evidence-fixture');
const D=value=>canonicalDigest({value});
const member=(key,sizeBytes,keys)=>({materialKey:D(key),role:'primary_payload',sizeBytes,
  episodeClaims:keys.map(episodeKey=>({episodeKey}))});

async function execute(members,maxSizeBytes,{series=true,stale=false,capability=C.space}={}) {
  const requirements={space:{unit:series?'episode':'product',maxSizeBytes},
    structure:{structureKind:series?'season':'single',requireOnePrimaryPerEpisode:series}};
  const snapshot={schemaRef:'helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1',schemaVersion:1,
    acceptanceSpecId:'spec',acceptanceSpecRecordDigest:D('spec'),targetShelfId:'shelf',
    structureKind:series?'season':'single',contentProfile:series?'series':'movie',
    shelfStandardRevision:1,shelfStandardDigest:D('standard'),requirements};
  snapshot.snapshotDigest=canonicalDigest(snapshot);
  const manifest={members,scopeKind:series?'episode_delivery':'single',episodeScopeDigest:D('episodes')};
  manifest.manifestDigest=canonicalDigest(manifest);
  const packageValue={onDeckPackageId:'package',packageDigest:D('package'),shelfId:'shelf',
    acceptanceSpecRef:{id:'spec',recordDigest:D('spec')},productStructureSnapshot:{structureKind:series?'season':'single'},
    productMaterialManifest:manifest,productionProvenance:{acceptanceRequirementSnapshot:snapshot}};
  const native=fixture(capability);
  try {
  const ports=createOnDeckCapabilityPorts({...native.options,
    now:()=>100,workResultReader:{readBindings:()=>[]},inventoryPort:{},contextReader:{readOffer:()=>({
      offer:{offerId:'offer',onDeckPackageId:'package',packageDigest:D('package')},
      shelf:{shelfId:'shelf',currentStandardRevision:stale?2:1,currentPlacementRevision:1,standard:{digest:D('standard')}},packageValue})}});
  const record=(await ports[capability].execute({...native.execution,
    namedInputs:{productManifest:manifest,spaceRequirement:{digest:D('requirement')},structureRequirement:{digest:D('structure')}}})).result;
  const result=native.store.resolve(record);
  assert.equal(validate(result),true,JSON.stringify(validate.errors));
  return {result,packageValue,requirements};
  } finally { native.close(); }
}

for(const {name,members,maximum,passed} of [
  {name:'Season total above the cap with each Episode exactly at the cap',members:[member('a',100,['E001']),member('b',100,['E002'])],maximum:100,passed:true},
  {name:'one oversized Episode',members:[member('a',101,['E001']),member('b',99,['E002'])],maximum:100,passed:false},
  {name:'shared file equally split at the cap',members:[member('a',200,['E001','E002'])],maximum:100,passed:true},
  {name:'multiple parts accumulated before comparison',members:[member('a',9,['E001','E002']),member('b',3,['E001'])],maximum:7,passed:false},
  {name:'unbounded space still retains exact allocation evidence',members:[member('a',9,['E001','E002'])],maximum:null,passed:true},
])test('Formal Arca space Capability: '+name,async()=>{
  const {result,packageValue}=await execute(members,maximum);
  assert.equal(result.result,passed?'passed':'failed');
  assert.deepEqual(result.actualGapCodes,passed?[]:['max_size_exceeded']);
  const evidence=result.episodeSpaceEvidence;
  assert.equal(evidence.productManifestDigest,packageValue.productMaterialManifest.manifestDigest);
  assert.equal(evidence.episodeScopeDigest,packageValue.productMaterialManifest.episodeScopeDigest);
  assert.equal(evidence.evidenceDigest,canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='evidenceDigest'))));
  if(name.startsWith('multiple'))assert.deepEqual(evidence.allocations[0].allocatedBytes,{numerator:'15',denominator:'2'});
  assert.deepEqual(result.primaryMediaObservations,[]);
});

test('Movie retains product-total comparison and stale Series never publishes allocation approval',async()=>{
  const members=[member('a',60,['E001']),member('b',60,['E002'])];
  const movie=(await execute(members,100,{series:false})).result;
  assert.equal(movie.result,'failed');assert.equal(movie.episodeSpaceEvidence,undefined);
  const stale=(await execute(members,100,{stale:true})).result;
  assert.equal(stale.evidenceStatus,'stale_basis');assert.equal(stale.episodeSpaceEvidence,undefined);
  assert.deepEqual(stale.actualGapCodes,[]);
});

test('Space evidence is bounded, typed, and forbidden on another Check dimension',async()=>{
  const {result,packageValue,requirements}=await execute([member('a',9,['E001','E002'])],5);
  for(const mutate of [value=>{value.episodeSpaceEvidence.allocations[0].allocatedBytes.denominator='0';},
    value=>{value.episodeSpaceEvidence.allocations[0].allocatedBytes.numerator=4.5;},value=>{value.checkKind='metadata';},
    value=>{value.episodeSpaceEvidence.unregistered=true;}]) {
    const value=structuredClone(result);mutate(value);assert.equal(validate(value),false);
  }
  packageValue.productMaterialManifest.members.push(packageValue.productMaterialManifest.members[0]);
  assert.throws(()=>evaluatePackageSpace(packageValue,requirements.space));
});

test('Series Structure accepts multiple Primary parts per Episode and rejects an unclaimed Primary',async()=>{
  const members=[member('a',2,['E001']),member('b',3,['E001'])];
  assert.equal((await execute(members,10,{capability:C.structure})).result.result,'passed');
  members[1].episodeClaims=[];
  assert.deepEqual((await execute(members,10,{capability:C.structure})).result.actualGapCodes,['episode_coverage_unmet']);
});
