'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
function projectionItem(scope,sourceKind){
  const libraries={movie:'normal',series:'normal',jav:'jav',western_adult:'us_adult'};
  if(!Object.hasOwn(libraries,scope.contentProfile))throw Object.assign(new TypeError('Arca Person Evidence requires its exact content profile.'),{code:'ARCA_PERSON_EVIDENCE_PROFILE_INVALID'});
  const libraryKind=libraries[scope.contentProfile],
    providerIdentities=(scope.providerIdentities||[]).map(identity=>({provider:identity.provider,namespace:identity.namespace,providerKey:identity.providerKey,
      provenanceDigest:identity.provenanceDigest||D({schema:'arca.person-identity-provenance@1',evidenceDigest:scope.evidenceDigest,identity})})),
    body={projectionItemId:'arca-person-evidence-'+D({sourceKind,shelfEntryId:scope.shelfEntryId,evidenceDigest:scope.evidenceDigest}),
      sourceKind,libraryKind,shelfEntryId:scope.shelfEntryId,inventoryRevision:scope.inventoryRevision,relationId:scope.relationId??null,relationDigest:scope.relationDigest??null,
      displayName:scope.displayName,displayNameNormalized:scope.displayNameNormalized,role:scope.role,providerIdentities,
      originEvidenceDigest:scope.originEvidenceDigest??null,nfoObservationDigest:scope.nfoObservationDigest??null,projectionRevision:scope.inventoryRevision},
    value={...body,projectionItemDigest:D(body)};
  if(Buffer.byteLength(canonicalJson(value),'utf8')>16*1024)throw Object.assign(new Error('Person Evidence Projection exceeds its complete byte bound.'),{code:'ARCA_PERSON_EVIDENCE_TOO_LARGE'});
  return Object.freeze(value);
}
function matchesProjection(value,input){return value.shelfEntryId===input.shelfEntryId&&value.inventoryRevision===input.inventoryRevision&&
  value.projectionItemId===input.projectionItemId&&value.projectionItemDigest===input.projectionItemDigest;}
module.exports=Object.freeze({projectionItem,matchesProjection});
