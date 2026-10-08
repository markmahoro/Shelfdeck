'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {offloadProductKeys}=require('../../../contracts/offload-product-targets');

function dispositionRole(member) {
  if(member.controlOperation==='assert_related_input')return 'related';
  return ['primary_payload','structural_dependency'].includes(member.role)?member.role:'artifact';
}

function productDispositionMembers(packageValue) {
  const products=packageValue.productMaterialManifest.members;
  const members=packageValue.offloadContextManifest.members.map((source,ordinal)=>{
    const keys=offloadProductKeys(source),targets=keys.map(key=>{
      const matches=products.filter(item=>item.materialKey===key);
      if(matches.length!==1)throw new Error('Off-load target is missing or ambiguous in the Product Manifest.');
      return matches[0];
    });
    if(keys.length>1&&(packageValue.productStructureSnapshot?.structureKind!=='season'||targets.some(item=>
      item.role!=='primary_payload'||item.controlOperation!=='acquire_workspace_product'||!item.episodeClaims?.length)))
      throw new Error('Multiple Off-load targets require Series Workspace Primary members with Episode Claims.');
    const body={ordinal,sourceMaterialKey:source.materialKey,sourceRelatedReferenceId:source.sourceRelatedReferenceId,
      ...(keys.length===1?{finalMaterialKey:keys[0]}:{finalMaterialKeys:Object.freeze([...keys])}),
      finalRole:dispositionRole(targets[0]),dispositionKind:source.dispositionKind,
      sourceToFinalMappingDigest:source.derivedAuthorityDigest||canonicalDigest(source)};
    return Object.freeze({...body,memberDigest:canonicalDigest(body)});
  });
  if(!members.length)throw new Error('Product Disposition Manifest cannot be empty.');
  return Object.freeze(members);
}

function assertDispositionFinalReality(manifest,reality) {
  for(const member of manifest.members){
    const scalar=Object.hasOwn(member,'finalMaterialKey'),multi=Object.hasOwn(member,'finalMaterialKeys');
    if(scalar===multi)throw new Error('Disposition requires exactly one target representation.');
    const keys=scalar?[member.finalMaterialKey]:member.finalMaterialKeys;
    if(!Array.isArray(keys)||keys.length<(multi?2:1)||keys.length>1024||
      keys.some((key,index)=>typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key)||index>0&&Buffer.compare(Buffer.from(keys[index-1]),Buffer.from(key))>=0)||
      multi&&(member.finalRole!=='primary_payload'||member.dispositionKind!=='replaced_and_settled'||member.sourceRelatedReferenceId!==null))
      throw new Error('Disposition targets violate their canonical cardinality or role.');
    for(const key of keys)if(reality.members.filter(item=>item.sourceMaterialKey===key).length!==1)
      throw new Error('Final Reality does not contain exactly one member for every disposition target.');
  }
}

module.exports=Object.freeze({productDispositionMembers,assertDispositionFinalReality});
