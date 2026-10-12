'use strict';
const path=require('node:path');
function fail(){throw Object.assign(new Error('Episode thumbnail requires one exact source and final Primary mapping.'),{code:'SERIES_RELATED_PRIMARY_MAPPING_AMBIGUOUS'});}
function relatedPrimaryName(packageValue,member,primaryName){
  const mapping=packageValue.relatedPrimaryMappings?.find(item=>item.relatedMaterialKey===member.materialKey);
  if(!mapping)return null;
  const primary=packageValue.productMaterialManifest.members.find(item=>item.materialKey===mapping.finalPrimaryMaterialKey&&item.role==='primary_payload');
  if(!primary||member.role!=='sidecar'||mapping.namingKind!=='episode_thumb')fail();
  const name=primaryName(primary),extension=path.extname(member.location?.location||'').toLowerCase();
  if(!['.jpg','.jpeg','.png','.webp'].includes(extension))fail();
  return path.basename(name,path.extname(name))+'-thumb'+extension;
}
module.exports=Object.freeze({relatedPrimaryName});
