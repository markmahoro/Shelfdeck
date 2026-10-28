'use strict';

const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {buildEpisodeMetadataScope}=require('./episode-metadata-scope');
const POLICY='libra.user-custom-requirements@1';
const MEDIA={minimum_raster_unmet:['minimumRasterClass','none'],primary_audio_unmet:['acceptedPrimaryAudioClasses',[]],
  video_codec_unmet:['videoCodec','any'],container_unmet:['container','any'],file_extension_unmet:['fileExtension','any']};
const FIELDS=new Set(['plot','genre','actor','director','release_date','year_or_release_date','episode_plot']);
const compare=(a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b));
const clone=value=>JSON.parse(canonicalJson(value));
function fail(code,message){throw Object.assign(new Error(message),{code});}
function scopeKey(scope){return scope?canonicalJson(buildEpisodeMetadataScope(scope)):'global';}
function currentRequirement(requirements,change,episodeScopes){
  if(!requirements||!['identity','structure','metadata','mandatoryMedia','space','inventory'].every(key=>
      requirements[key]&&typeof requirements[key]==='object'&&!Array.isArray(requirements[key])))
    fail('CUSTOM_TARGET_BASE_INVALID','Custom target requires one validated complete base Requirement Set.');
  const fields=['requirementCode','targetId',...(change?.episodeScope?['episodeScope']:[]),...(Object.hasOwn(change||{},'requiredValueDigest')?['requiredValueDigest']:[])];
  if(!change||canonicalJson(Object.keys(change).sort())!==canonicalJson(fields.sort()))
    fail('CUSTOM_TARGET_CHANGE_INVALID','Custom target changes use a closed requirement identity.');
  const scope=change.episodeScope;
  if(scope&&(!Array.isArray(episodeScopes)||!episodeScopes.some(item=>scopeKey(item)===scopeKey(scope))))
    fail('CUSTOM_TARGET_SCOPE_INVALID','Custom target Episode lies outside the exact frozen delivery scope.');
  const media=Object.hasOwn(MEDIA,change.requirementCode)?MEDIA[change.requirementCode]:null;let value;
  if(media){
    if(scope||change.targetId!==media[0])fail('CUSTOM_TARGET_CHANGE_INVALID','Media changes require their exact global requirement.');
    value=requirements.mandatoryMedia[media[0]];
    if(value===undefined||canonicalJson(value)===canonicalJson(media[1]))fail('CUSTOM_TARGET_NO_CHANGE','The media requirement is already relaxed.');
  }else if(change.requirementCode==='max_size_exceeded'){
    if(scope||change.targetId!=='maxSizeBytes')fail('CUSTOM_TARGET_CHANGE_INVALID','Space changes require their exact product allocation.');
    value={maxSizeGiB:requirements.space.maxSizeGiB,maxSizeBytes:requirements.space.maxSizeBytes};
    if(value.maxSizeGiB==null||value.maxSizeBytes==null)fail('CUSTOM_TARGET_NO_CHANGE','The product already has no size cap.');
  }else if(change.requirementCode==='metadata_field_unmet'){
    if(!FIELDS.has(change.targetId)||Boolean(scope)!==change.targetId.startsWith('episode_'))
      fail('CUSTOM_TARGET_PROTECTED_REQUIREMENT','Identity, structure and unscoped Episode requirements cannot be waived.');
    value=requirements.metadata.requiredFieldCodes.includes(change.targetId);
    if(!value)fail('CUSTOM_TARGET_NO_CHANGE','The metadata field is not required by the base target.');
  }else if(change.requirementCode==='metadata_artifact_unmet'){
    if(scope||!['poster','fanart'].includes(change.targetId))
      fail('CUSTOM_TARGET_PROTECTED_REQUIREMENT','Formal identity sidecars and exact file safety cannot be waived.');
    value={metadata:requirements.metadata.requiredArtifactKinds.includes(change.targetId),
      inventory:requirements.inventory.requiredMaterializedArtifactKinds.includes(change.targetId)};
    if(!value.metadata&&!value.inventory)fail('CUSTOM_TARGET_NO_CHANGE','The image role is not required by the base target.');
  }else fail('CUSTOM_TARGET_PROTECTED_REQUIREMENT','This requirement has no declared user-custom relaxation.');
  return value;
}
function describeCustomRequirement(requirements,change,episodeScopes=[]){
  const value=currentRequirement(requirements,change,episodeScopes),body={requirementCode:change.requirementCode,targetId:change.targetId,
    ...(change.episodeScope?{episodeScope:buildEpisodeMetadataScope(change.episodeScope)}:{}),requiredValueDigest:canonicalDigest(value)};
  return Object.freeze(body);
}
function applyCustomRequirementChanges({requirements,changes,episodeScopes=[]}){
  if(!Array.isArray(changes)||!changes.length||changes.length>256||Buffer.byteLength(canonicalJson(changes))>32*1024)
    fail('CUSTOM_TARGET_CHANGE_LIMIT','Custom target requires 1..256 exact bounded requirement changes.');
  const normalized=changes.map(change=>{
    const expected=describeCustomRequirement(requirements,change,episodeScopes);
    if(change.requiredValueDigest!==expected.requiredValueDigest)
      fail('CUSTOM_TARGET_REQUIREMENT_STALE','Custom target preview no longer describes the current requirement.');
    return expected;
  }).sort((a,b)=>compare(scopeKey(a.episodeScope)+'/'+a.requirementCode+'/'+a.targetId,
    scopeKey(b.episodeScope)+'/'+b.requirementCode+'/'+b.targetId));
  const seen=new Set(),target=clone(requirements),episodes=new Map();
  for(const change of normalized){
    const key=scopeKey(change.episodeScope)+'/'+change.requirementCode+'/'+change.targetId;
    if(seen.has(key))fail('CUSTOM_TARGET_DUPLICATE_CHANGE','The same exact requirement was selected more than once.');seen.add(key);
    if(change.episodeScope){
      const scope=scopeKey(change.episodeScope),row=episodes.get(scope)||{episodeScope:change.episodeScope,
        requiredFieldCodes:[...requirements.metadata.requiredFieldCodes]};
      row.requiredFieldCodes=row.requiredFieldCodes.filter(field=>field!==change.targetId);episodes.set(scope,row);
    }else if(Object.hasOwn(MEDIA,change.requirementCode))target.mandatoryMedia[change.targetId]=clone(MEDIA[change.requirementCode][1]);
    else if(change.requirementCode==='max_size_exceeded'){target.space.maxSizeGiB=null;target.space.maxSizeBytes=null;}
    else if(change.requirementCode==='metadata_field_unmet')target.metadata.requiredFieldCodes=target.metadata.requiredFieldCodes.filter(field=>field!==change.targetId);
    else{
      target.metadata.requiredArtifactKinds=target.metadata.requiredArtifactKinds.filter(kind=>kind!==change.targetId);
      target.inventory.requiredMaterializedArtifactKinds=target.inventory.requiredMaterializedArtifactKinds.filter(kind=>kind!==change.targetId);
    }
  }
  const episodeMetadataOverrides=[...episodes.values()].map(row=>({...row,requiredFieldCodes:row.requiredFieldCodes.filter(field=>target.metadata.requiredFieldCodes.includes(field))}))
    .sort((a,b)=>a.episodeScope.seasonNumber-b.episodeScope.seasonNumber||a.episodeScope.episodeNumber-b.episodeScope.episodeNumber),
    body={schema:'libra.user-custom-requirements@1',policyRef:POLICY,baseRequirementsDigest:canonicalDigest(requirements),
      requirements:target,episodeMetadataOverrides,changes:normalized};
  if(Buffer.byteLength(canonicalJson(body))>64*1024)fail('CUSTOM_TARGET_CHANGE_LIMIT','Custom target projection exceeds its canonical byte limit.');
  return Object.freeze({...body,targetRequirementsDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({POLICY,describeCustomRequirement,applyCustomRequirementChanges});
