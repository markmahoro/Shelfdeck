'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buffaloModelReference}=require('../../../contracts/buffalo-model-reference');
const {SYSTEM,operationIdentityFromDigest}=require('./us-adult-catalogue-registration');
const SCHEMA='people.catalogue-image-operation-request@1',HASH=/^[a-f0-9]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function fail(){throw Object.assign(new TypeError('System image preparation differs from its frozen catalogue request.'),{code:'PEOPLE_CATALOGUE_IMAGE_OPERATION_INVALID'});}
function assertCatalogueImagePayload(payload){
  if(!exact(payload,['schema','operationKind','expectedPersonRevision','expectedReferenceRevision','operationId','personId','actorId',
    'canonicalName','aliases','selectedImage','faceModelRef','catalogueDecisionInputDigest','nameResolutionDigest','imageSourceProofDigest'])||
    payload.schema!==SCHEMA||payload.operationKind!=='catalogue_registration'||payload.actorId!==SYSTEM||payload.expectedPersonRevision!==1||
    payload.expectedReferenceRevision!==0||typeof payload.canonicalName!=='string'||!payload.canonicalName.trim()||payload.canonicalName.length>200||
    !Array.isArray(payload.aliases)||payload.aliases.length<1||payload.aliases.length>17||payload.aliases[0]!==payload.canonicalName||
    payload.aliases.some(value=>typeof value!=='string'||!value.trim()||value.length>200)||
    new Set(payload.aliases.map(value=>value.toLowerCase())).size!==payload.aliases.length||
    canonicalDigest(payload.faceModelRef)!==canonicalDigest(buffaloModelReference('single_reference_face'))||
    Buffer.byteLength(canonicalJson(payload))>16384)fail();
  const identity=operationIdentityFromDigest({inputDigest:payload.catalogueDecisionInputDigest,nameResolutionDigest:payload.nameResolutionDigest,
    imageSourceProofDigest:payload.imageSourceProofDigest}),selected=payload.selectedImage;
  if(payload.operationId!==identity.operationId||payload.personId!==identity.personId||
    !exact(selected,['schemaRef','schemaVersion','uploadId','digestHex','sizeBytes','mediaType','provenance','handleDigest'])||
    selected.schemaRef!=='helix://contracts/domain-types/PeopleSelectedImageHandle/v1'||selected.schemaVersion!==1||
    !HASH.test(selected.uploadId||'')||!HASH.test(selected.digestHex||'')||!HASH.test(selected.handleDigest||'')||
    !Number.isSafeInteger(selected.sizeBytes)||selected.sizeBytes<1||selected.sizeBytes>10485760||
    !['image/jpeg','image/png','image/webp'].includes(selected.mediaType)||!['stashbox','catalogue_frame'].includes(selected.provenance?.source))fail();
  const {handleDigest,...body}=selected;if(canonicalDigest(body)!==handleDigest)fail();
  return payload;
}
module.exports=Object.freeze({SCHEMA,assertCatalogueImagePayload});
