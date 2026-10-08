'use strict';
const {canonicalJson}=require('../../../contracts/canonical-json');
const {offloadProductKeys}=require('../../../contracts/offload-product-targets');
const SCHEMA='helix://contracts/application-types/LibraOffloadProductMaterialKeys/v1';
function writeOffloadTargets(source){
  const keys=offloadProductKeys(source);
  return Object.freeze({final_product_material_key:keys.length===1?keys[0]:null,
    final_product_material_keys_schema_ref:keys.length>1?SCHEMA:null,final_product_material_keys_json:keys.length>1?canonicalJson(keys):null});
}
function readOffloadTargets(row){
  const single=row.final_product_material_key!==null,multiple=row.final_product_material_keys_json!==null;
  if((multiple?row.final_product_material_keys_schema_ref!==SCHEMA:row.final_product_material_keys_schema_ref!==null))throw new Error('Stored Off-load targets have an invalid schema reference.');
  if(single===multiple)throw new Error('Stored Off-load mapping does not have one exact cardinality representation.');
  const fields=single?{finalProductMaterialKey:row.final_product_material_key}:
    {finalProductMaterialKeys:JSON.parse(row.final_product_material_keys_json)};
  const keys=offloadProductKeys({...fields,materialKey:row.material_key,contextRole:row.context_role,
    dispositionKind:row.disposition_kind,settlementExpectation:row.settlement_expectation});
  if(multiple&&canonicalJson(keys)!==row.final_product_material_keys_json)throw new Error('Stored Off-load target list is not canonical.');
  return Object.freeze(multiple?{finalProductMaterialKeys:keys}:fields);
}
module.exports=Object.freeze({writeOffloadTargets,readOffloadTargets});
