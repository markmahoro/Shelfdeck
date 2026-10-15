'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {freezeCareObjective,readCareObjective,careFindingCodes}=require('../../src/helix/domains/arca/model/care-objective');
const {assertProcessingRequirement}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

function context(){return {basis:{inventoryRevision:1,standardRevision:2,placementRevision:1,decisionFactSetDigest:'d'.repeat(64)},
  raw:{identity:{identity_kind:'tmdb_movie'},shelf:{shelf_id:'shelf-1',target_root_location:'C:/collection',target_endpoint_id:'local',target_mount_scope_id:'mount',target_mount_scope_revision:1},placement:{value:{folderTemplate:'{title}'},policy_digest:canonicalDigest({folderTemplate:'{title}'})},entry:{structure_kind:'single'},facts:[],materials:[{role:'primary_payload',size_bytes:2000}],
    standard:{value:{profileRuleSets:[{contentProfile:'movie',baseRequirements:{space:{maxSizeBytes:1000},mandatoryMedia:{videoCodec:'hevc'}}}]}}}};}

test('UAT-213 creation snapshot survives serialization and later policy changes without changing finding semantics',()=>{
  const c=context(),value='conformance:max_size_exceeded';
  const requirement=JSON.parse(JSON.stringify({requiredEffects:[{}],typedParameters:[
    {parameter:'finding.size',valueType:'string',value,valueDigest:canonicalDigest(value)},...freezeCareObjective(c)]}));
  c.raw.standard.value.profileRuleSets[0].baseRequirements.space.maxSizeBytes=5000;
  assert.equal(readCareObjective(requirement).requirements.space.maxSizeBytes,1000);
  c.raw.shelf.target_root_location='C:/new-collection';c.raw.placement.value.folderTemplate='{year}';
  assert.equal(readCareObjective(requirement).placement.target.rootLocation,'C:/collection');
  assert.equal(readCareObjective(requirement).placement.policy.folderTemplate,'{title}');
  assert.deepEqual(careFindingCodes(requirement),[value]);
  assert.doesNotThrow(()=>assertProcessingRequirement(requirement));
  assert.equal(readCareObjective({typedParameters:[{parameter:'goal',value}]}),null);
});

test('UAT-213 missing, oversized and tampered objective evidence fails explicitly',()=>{
  const c=context();c.raw.standard.value.profileRuleSets=[];
  assert.throws(()=>freezeCareObjective(c),{code:'ARCA_CARE_OBJECTIVE_MISSING'});
  const large=context();large.raw.standard.value.profileRuleSets[0].baseRequirements.extra='x'.repeat(16385);
  assert.throws(()=>freezeCareObjective(large),{code:'ARCA_CARE_OBJECTIVE_TOO_LARGE'});
  const requirement=JSON.parse(JSON.stringify({typedParameters:freezeCareObjective(context())}));
  requirement.typedParameters[0].value='{}';
  assert.throws(()=>readCareObjective(requirement),/digest is invalid/);
});
