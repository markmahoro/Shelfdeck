'use strict';
const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {offloadProductKeys}=require('./offload-product-targets');
function fail(){throw Object.assign(new Error('Episode thumbnail requires one exact source and final Primary mapping.'),{code:'SERIES_RELATED_PRIMARY_MAPPING_AMBIGUOUS'});}
function buildRelatedPrimaryMappings(assertions,offload,members){
  const mappings=[];
  for(const assertion of assertions){
    const source=offload.find(item=>item.sourceRelatedReferenceId===assertion.sourceRelatedReferenceId);
    if(assertion.role!=='sidecar'||!/-thumb\.(jpe?g|png|webp)$/i.test(source?.location||''))continue;
    const primary=offload.find(item=>item.contextRole==='original_input'&&item.materialKey===assertion.primaryMaterialKey);
    const keys=primary?offloadProductKeys(primary):[];
    if(keys.length!==1||!members.some(item=>item.materialKey===keys[0]&&item.role==='primary_payload')||
        !members.some(item=>item.materialKey===assertion.finalProductMaterialKey&&item.role==='sidecar'))fail();
    mappings.push({sourceRelatedReferenceId:assertion.sourceRelatedReferenceId,relatedMaterialKey:assertion.finalProductMaterialKey,
      sourcePrimaryMaterialKey:assertion.primaryMaterialKey,finalPrimaryMaterialKey:keys[0],namingKind:'episode_thumb'});
  }
  mappings.sort((a,b)=>Buffer.from(a.relatedMaterialKey).compare(Buffer.from(b.relatedMaterialKey)));
  if(mappings.length>1024||new Set(mappings.map(item=>item.relatedMaterialKey)).size!==mappings.length)fail();
  return mappings;
}
function relatedPrimaryName(packageValue,member,primaryName){
  const mapping=packageValue.relatedPrimaryMappings?.find(item=>item.relatedMaterialKey===member.materialKey);
  if(!mapping)return null;
  const primary=packageValue.productMaterialManifest.members.find(item=>item.materialKey===mapping.finalPrimaryMaterialKey&&item.role==='primary_payload');
  if(!primary||member.role!=='sidecar'||mapping.namingKind!=='episode_thumb')fail();
  const name=primaryName(primary),extension=path.extname(member.location?.location||'').toLowerCase();
  if(!['.jpg','.jpeg','.png','.webp'].includes(extension))fail();
  return path.basename(name,path.extname(name))+'-thumb'+extension;
}
const FACT_SCHEMA='helix://arca/inventory-related-primary-mapping/v1';
function inventoryMappingFact(mapping,relatedKey,primaryKey){
  const body={schemaRef:FACT_SCHEMA,schemaVersion:1,sourceRelatedReferenceId:mapping.sourceRelatedReferenceId,
    relatedMaterialKey:relatedKey,sourcePrimaryMaterialKey:mapping.sourcePrimaryMaterialKey,finalPrimaryMaterialKey:primaryKey,namingKind:mapping.namingKind};
  return {...body,mappingDigest:canonicalDigest(body)};
}
function readInventoryMapping(row){
  const value=JSON.parse(row.fact_json),{mappingDigest,...body}=value;
  if(row.fact_schema_ref!==FACT_SCHEMA||value.schemaRef!==FACT_SCHEMA||value.schemaVersion!==1||
      Object.keys(value).sort().join('|')!==['schemaRef','schemaVersion','sourceRelatedReferenceId','relatedMaterialKey','sourcePrimaryMaterialKey','finalPrimaryMaterialKey','namingKind','mappingDigest'].sort().join('|')||
      typeof value.sourceRelatedReferenceId!=='string'||!value.sourceRelatedReferenceId||value.sourceRelatedReferenceId.length>256||value.namingKind!=='episode_thumb'||
      [value.relatedMaterialKey,value.sourcePrimaryMaterialKey,value.finalPrimaryMaterialKey].some(key=>!/^[a-f0-9]{64}$/.test(key||''))||
      canonicalDigest(body)!==mappingDigest||canonicalDigest(value)!==row.fact_digest||Buffer.byteLength(canonicalJson(value))>4096)fail();
  return value;
}
function remapInventoryMappingFacts(facts,receipts){
  const targetFor=key=>{const matches=receipts.filter(receipt=>(receipt.retiredMaterials||[]).some(item=>item.identity.materialKey===key)||receipt.supersededMaterialIdentity?.materialKey===key);
    if(matches.length>1)fail();return matches.length?matches[0].finalMaterialIdentity.materialKey:key;};
  return facts.map(row=>{if(row.fact_kind!=='related_primary_mapping')return row;
    const prior=readInventoryMapping(row),value=inventoryMappingFact(prior,targetFor(prior.relatedMaterialKey),targetFor(prior.finalPrimaryMaterialKey));
    return {...row,fact_json:canonicalJson(value),fact_digest:canonicalDigest(value),value};});
}
function acceptedFactDigest(row){
  if(row.fact_kind!=='related_primary_mapping')return row.fact_digest;
  const value=readInventoryMapping(row);
  return canonicalDigest({schema:'arca.accepted-related-primary-association@1',sourceRelatedReferenceId:value.sourceRelatedReferenceId,
    sourcePrimaryMaterialKey:value.sourcePrimaryMaterialKey,namingKind:value.namingKind});
}
module.exports=Object.freeze({buildRelatedPrimaryMappings,relatedPrimaryName,inventoryMappingFact,readInventoryMapping,remapInventoryMappingFacts,acceptedFactDigest,FACT_SCHEMA});
