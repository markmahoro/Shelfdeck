'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
const {offloadProductKeys}=require('../../src/helix/contracts/offload-product-targets');
const {buildDomainInputSchemas}=require('../../scripts/helix-architecture/domain-input-schema-builder');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const packageSchema=require('../../src/helix/contracts/types/OnDeckProductPackage/v1/schema.json');
const physicalSchema=require('../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json');
const keys=[d('first'),d('second')].sort();
const source=()=>({ordinal:0,materialKey:d('source'),contextRole:'original_input',sourceRelatedReferenceId:null,
  finalProductMaterialKeys:keys,dispositionKind:'replaced_and_settled',physicalIdentity:{schemaRef:physicalSchema.$id,schemaVersion:2,
    materialKey:d('source'),mountScopeId:'mount',inode:'1',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:d('bytes')},
  endpointId:'input',location:'source.mkv',bindingRevision:1,bindingEvidenceDigest:d('binding'),admittedControlRevision:1,
  admittedControlProjectionDigest:d('control'),derivedAuthorityDigest:null,settlementExpectation:'remove_after_place',memberDigest:d('source-member')});

test('Off-load cardinality union is identical in Promotion and Package and accepts exact single or multiple targets',()=>{
  const member=buildDomainInputSchemas().LibraDeliverablePromotionDecision.properties.offloadContextManifest.properties.members.items;
  assert.deepEqual(member,packageSchema.properties.offloadContextManifest.properties.members.items);
  const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:'helix://tests/series-offload-member',...member};
  const validator=createCapabilityContractValidator({schemas:[physicalSchema,schema]});
  const multiple=source();assert.equal(validator.validate(schema.$id,multiple),multiple);assert.deepEqual(offloadProductKeys(multiple),keys);
  const single={...multiple,finalProductMaterialKey:keys[0]};delete single.finalProductMaterialKeys;
  assert.equal(validator.validate(schema.$id,single),single);assert.deepEqual(offloadProductKeys(single),[keys[0]]);
  for(const invalid of [{...multiple,finalProductMaterialKey:keys[0]},
    {...multiple,finalProductMaterialKeys:[]},{...multiple,finalProductMaterialKeys:[keys[0]]},
    {...multiple,finalProductMaterialKeys:[keys[0],keys[0]]},{...multiple,contextRole:'related_input'},
    {...multiple,contextRole:'structural_dependency'},{...multiple,dispositionKind:'carried_forward'},
    {...multiple,settlementExpectation:'replace_or_move'}]){
    assert.throws(()=>validator.validate(schema.$id,invalid));assert.throws(()=>offloadProductKeys(invalid));
  }
  const neither={...multiple};delete neither.finalProductMaterialKeys;
  assert.throws(()=>validator.validate(schema.$id,neither));assert.throws(()=>offloadProductKeys(neither));
  assert.throws(()=>offloadProductKeys({...multiple,finalProductMaterialKeys:[...keys].reverse()}));
  assert.throws(()=>offloadProductKeys({...multiple,materialKey:keys[0]}));
});
