'use strict';
const {canonicalJson}=require('./canonical-json');
function hasRequiredUsAdultActor(value){
  const identity=value?.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||value?.resolvedIdentitySnapshot?.factValue;
  if(identity?.contentProfile!=='western_adult')return true;
  const cast=value.mediaCastSnapshot,relations=cast?.relations,actor=relations?.[0],fact=cast?.factValue,
    manifest=value.productFactManifest?.items?.filter(item=>item.factKind==='media_cast');
  return identity.identityKind==='internal_identity'&&identity.structureKind==='single'&&Array.isArray(relations)&&relations.length===1&&
    actor.role==='actor'&&typeof actor.personId==='string'&&actor.personId.length>0&&typeof actor.displayName==='string'&&actor.displayName.trim().length>0&&
    ['user_actor_choice','face_reference_match','face_catalogue'].includes(actor.source)&&
    fact?.schemaRef==='helix://contracts/types/MediaCastFact/v1'&&fact.sourceBasisKind==='us_adult_actor'&&fact.relationCount===1&&
    Array.isArray(fact.relations)&&Array.isArray(manifest)&&manifest.length===1&&manifest[0].factValue&&manifest[0].productFactId===cast.mediaCastFactId&&
    manifest[0].factRevision===cast.mediaCastFactRevision&&manifest[0].factDigest===cast.factDigest&&
    canonicalJson(manifest[0].factValue)===canonicalJson(fact)&&canonicalJson(fact.relations)===canonicalJson(relations)&&fact.relationsDigest===cast.relationsDigest;
}
function assertRequiredUsAdultActor(value){
  if(!hasRequiredUsAdultActor(value))throw Object.assign(new TypeError('US Adult on-deck product requires its exact single confirmed actor Fact.'),{code:'US_ADULT_ACTOR_REQUIRED'});
  return value;
}
module.exports=Object.freeze({hasRequiredUsAdultActor,assertRequiredUsAdultActor});
