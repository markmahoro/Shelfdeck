'use strict';

const {requireLibraryKind} = require('../model/person-library');
const {canonicalDigest} = require('../../../contracts/canonical-json');

function createMediaCastReferenceQuery(store) {
  const unresolved=reasonCode=>Object.freeze({kind:'unresolved',reasonCode});
  function activeTarget(person) {
    const seen=new Set();
    for(let depth=0;person&&depth<16;depth++) {
      if(seen.has(person.personId))return null;
      seen.add(person.personId);
      if(person.status==='active')return person;
      if(person.status!=='merged'||!person.revision.mergedIntoPersonId)return null;
      person=store.getPerson(person.revision.mergedIntoPersonId);
    }
    return null;
  }
  return Object.freeze({resolve(input) {
    if(!input||!Array.isArray(input.providerIdentities)||input.providerIdentities.length>16)
      throw Object.assign(new Error('Media-Cast query requires bounded exact identity evidence.'),{code:'PEOPLE_MEDIA_CAST_QUERY_INVALID'});
    const libraryKind = requireLibraryKind(input.libraryKind);
    if (libraryKind === 'us_adult') return unresolved('user_actor_refresh_required');
    let target=null,reasonCode;
    if(input.personId) {
      const current=store.getPerson(input.personId);
      if(current && current.libraryKind !== libraryKind) return unresolved('cross_library_reference');
      if(current?.status==='active')return Object.freeze({kind:'unchanged',personId:input.personId});
      target=activeTarget(current);reasonCode='formal_merge';
    } else {
      const matches=new Map();
      for(const identity of input.providerIdentities) {
        if(!identity.provider||!identity.namespace||!identity.providerKey)continue;
        let person;
        try { person=store.findActivePersonByProviderIdentity({libraryKind,provider:identity.provider,namespace:identity.namespace,providerKey:identity.providerKey}); }
        catch(error) { if(error.code!=='P6_PEOPLE_PROVIDER_IDENTITY_CONFLICT')throw error;return unresolved('conflicting_provider_identities'); }
        if(person?.status==='active')matches.set(person.personId,person);
      }
      if(matches.size>1)return unresolved('conflicting_provider_identities');
      if(matches.size===1){target=[...matches.values()][0];reasonCode='exact_provider_identity';}
      else if(/^[a-f0-9]{64}$/.test(input.evidenceDigest||'')) {
        target=activeTarget(store.findUserAcceptedRegistrationPerson(input.evidenceDigest));reasonCode='accepted_origin_evidence';
      }
    }
    if(!target || target.libraryKind !== libraryKind)return unresolved('no_deterministic_person');
    const proof={schema:'people.media-cast-reference-proof@1',kind:'resolved',personId:target.personId,
      personRevision:target.currentRevision,personFactDigest:target.revision.factDigest,reasonCode,
      inputDigest:canonicalDigest(input)};
    return Object.freeze({...proof,proofDigest:canonicalDigest(proof)});
  }});
}

module.exports=Object.freeze({createMediaCastReferenceQuery});
