'use strict';
const {relatedPrimaryName}=require('../../src/helix/domains/arca/model/related-primary-name');
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildRelatedPrimaryMappings,inventoryMappingFact,readInventoryMapping,remapInventoryMappingFacts,acceptedFactDigest,FACT_SCHEMA}=require('../../src/helix/contracts/related-primary-mappings');
function fixture(){const primary=D('primary'),video=D('video'),thumb=D('thumb');
  const members=[{materialKey:video,role:'primary_payload'},{materialKey:thumb,role:'sidecar',location:{location:'old-thumb.jpg'}}];
  const assertions=[{sourceRelatedReferenceId:'ref',primaryMaterialKey:primary,finalProductMaterialKey:thumb,role:'sidecar'}];
  const offload=[{contextRole:'original_input',materialKey:primary,finalProductMaterialKey:video},
    {contextRole:'related_input',sourceRelatedReferenceId:'ref',location:'old-thumb.jpg'}];
  return {primary,video,thumb,members,assertions,offload};}
test('thumb follows the exact mapped final video name without guessing Episode filenames',()=>{
  const f=fixture(),mappings=buildRelatedPrimaryMappings(f.assertions,f.offload,f.members);
  const pkg={productMaterialManifest:{members:f.members},relatedPrimaryMappings:mappings};
  assert.equal(relatedPrimaryName(pkg,f.members[1],primary=>{assert.equal(primary.materialKey,f.video);return 'Show - S01E02-part01.mp4';}),'Show - S01E02-part01-thumb.jpg');
  assert.equal(mappings[0].sourcePrimaryMaterialKey,f.primary);
  Object.assign(f.offload[0],{finalProductMaterialKeys:[D('one'),D('two')].sort(),dispositionKind:'replaced_and_settled',settlementExpectation:'remove_after_place'});delete f.offload[0].finalProductMaterialKey;
  assert.throws(()=>buildRelatedPrimaryMappings(f.assertions,f.offload,f.members),{code:'SERIES_RELATED_PRIMARY_MAPPING_AMBIGUOUS'});
});
test('Inventory mapping survives migration through exact receipts and rejects tampering or split targets',()=>{
  const f=fixture(),mapping=buildRelatedPrimaryMappings(f.assertions,f.offload,f.members)[0],value=inventoryMappingFact(mapping,f.thumb,f.video);
  const row={fact_kind:'related_primary_mapping',fact_schema_ref:FACT_SCHEMA,fact_json:canonicalJson(value),fact_digest:D(value)};
  assert.deepEqual(readInventoryMapping(row),value);
  assert.throws(()=>readInventoryMapping({...row,fact_json:canonicalJson({...value,finalPrimaryMaterialKey:D('wrong')})}));
  const receipt={retiredMaterials:[{identity:{materialKey:f.video}}],finalMaterialIdentity:{materialKey:D('migrated')}};
  const updated=remapInventoryMappingFacts([row],[receipt])[0];assert.equal(readInventoryMapping(updated).finalPrimaryMaterialKey,D('migrated'));
  assert.equal(readInventoryMapping(updated).relatedMaterialKey,f.thumb);
  assert.equal(acceptedFactDigest(updated),acceptedFactDigest(row));assert.notEqual(updated.fact_digest,row.fact_digest);
  const changed=inventoryMappingFact({...mapping,sourcePrimaryMaterialKey:D('foreign-source')},f.thumb,f.video);
  assert.notEqual(acceptedFactDigest({...row,fact_json:canonicalJson(changed),fact_digest:D(changed)}),acceptedFactDigest(row));
  assert.throws(()=>remapInventoryMappingFacts([row],[receipt,receipt]),{code:'SERIES_RELATED_PRIMARY_MAPPING_AMBIGUOUS'});
});
