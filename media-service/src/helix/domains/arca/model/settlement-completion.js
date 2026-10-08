'use strict';
const {canonicalDigest:d}=require('../../../contracts/canonical-json');
const {offloadProductKeys}=require('../../../contracts/offload-product-targets');
const {requiresInputSettlement}=require('./offload-settlement');
function incomplete(){throw Object.assign(new Error('Off-load input settlement completion is missing or stale.'),{code:'ARCA_ONDECK_SETTLEMENT_INCOMPLETE'});}
function settlementTargetEntries(member,settled){
  if(!Object.hasOwn(member,'finalTargets'))return [
    {key:'final_material_key',value:settled.finalMaterialKey},{key:'final_target_location',value:settled.finalTargetLocation}];
  const targets=settled.finalTargets;
  if(!Array.isArray(targets)||targets.length!==member.finalTargets.length||
    targets.some((target,index)=>target.materialKey!==member.finalTargets[index].materialKey||target.targetLocation!==member.finalTargets[index].targetLocation||
      !/^[a-f0-9]{64}$/.test(target.finalRealityDigest))||
    settled.finalRealityDigest!==d({schema:'arca.settlement-final-targets@1',members:targets})||
    settled.sourceToFinalMappingDigest!==member.sourceToFinalMappingDigest||settled.absent!==true||settled.finalVerified!==true||settled.disposition!=='settled_to_final')incomplete();
  return [{key:'final_targets',value:targets}];
}
function dispositionCompletions(packageValue,staged,outcomes){
  return packageValue.offloadContextManifest.members.map(member=>{
    const keys=offloadProductKeys(member),mappingDigest=member.derivedAuthorityDigest||d(member),
      targets=keys.length===1?{finalMaterialKey:keys[0]}:{finalMaterialKeys:keys};
    const current=keys.map(key=>{
      const matches=staged.members.filter(item=>item.sourceMaterialKey===key);
      if(matches.length!==1)throw Object.assign(new Error('Final Inventory is missing or duplicates an Off-load mapping target.'),{code:'ARCA_ONDECK_DISPOSITION_FINAL_MISSING'});
      return matches[0];
    });
    if(!requiresInputSettlement(member))return Object.freeze({materialKey:member.materialKey,...targets,
      sourceToFinalMappingDigest:mappingDigest,completionKind:'retained_in_final_reality',evidenceDigest:staged.realityDigest});
    const matches=outcomes.filter(item=>item.materialKey===member.materialKey);
    if(matches.length!==1)incomplete();
    const evidence=matches[0],rows=evidence.postDeleteReality?.entries||[],entries=new Map(rows.map(item=>[item.key,item.value]));
    if(entries.size!==rows.length||entries.get('source_to_final_mapping_digest')!==mappingDigest||entries.get('final_verified')!==true||
      !['retained_as_final','settled_to_final'].includes(entries.get('disposition')))incomplete();
    if(keys.length===1){if(entries.get('final_material_key')!==keys[0]||entries.has('final_targets'))incomplete();}
    else{
      const observed=entries.get('final_targets'),record=evidence.postDeleteReality,
        recordBody=Object.fromEntries(Object.entries(record).filter(([key])=>key!=='recordDigest')),
        body=Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='payloadDigest'));
      if(entries.has('final_material_key')||entries.has('final_target_location')||entries.get('absent')!==true||entries.get('disposition')!=='settled_to_final'||
        !Array.isArray(observed)||observed.length!==keys.length||observed.some((target,index)=>target.materialKey!==keys[index]||
          target.targetLocation!==current[index].location||target.finalRealityDigest!==current[index].digestHex)||
        entries.get('final_reality_digest')!==d({schema:'arca.settlement-final-targets@1',members:observed})||record.recordDigest!==d(recordBody)||evidence.payloadDigest!==d(body))incomplete();
    }
    return Object.freeze({materialKey:member.materialKey,...targets,sourceToFinalMappingDigest:mappingDigest,
      completionKind:entries.get('disposition'),evidenceDigest:evidence.payloadDigest});
  });
}
module.exports=Object.freeze({settlementTargetEntries,dispositionCompletions});
