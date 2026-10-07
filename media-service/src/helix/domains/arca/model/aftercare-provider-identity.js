'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {canonicalContentIdentity}=require('./canonical-content-identity');

function aftercareProviderIdentity(context,stableIdentity) {
  const raw=context.raw,provider=stableIdentity.providerId,providerKey=String(stableIdentity.providerObjectId);
  const stale=()=>{throw Object.assign(new Error('Aftercare Provider identity does not match the accepted collection.'),
    {code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'});};
  if(provider!==raw.identity.provider||providerKey!==String(raw.identity.provider_key)||
      stableIdentity.identityDigest!==raw.identity.identity_digest)stale();
  if(raw.entry.structure_kind!=='season')return Object.freeze({provider,providerKey,
    namespace:provider==='tmdb'?'tmdb_movie':provider,seasonNumber:null,identityAnchorDigest:stableIdentity.identityDigest});
  const identities=raw.facts.filter(item=>item.fact_kind==='resolved_identity')
    .map(item=>item.value?.resolvedProductIdentity||item.value);
  if(provider!=='tmdb'||raw.identity.identity_kind!=='tmdb_series_season'||!identities.length)stale();
  let seasonNumber;
  for(const identity of identities) {
    try {
      if(identity.structureKind!=='season'||canonicalContentIdentity(raw.entry.shelf_id,identity).canonicalIdentityKey!==raw.entry.canonical_identity_key)stale();
    }catch {stale();}
    const anchor=identity.providerIdentities.find(item=>item.provider==='tmdb'&&item.namespace==='tmdb_series');
    if(anchor.providerKey!==providerKey||(seasonNumber!==undefined&&anchor.seasonNumber!==seasonNumber))stale();
    seasonNumber=anchor.seasonNumber;
  }
  const anchor={provider,namespace:'tmdb_series',providerKey,seasonNumber};
  return Object.freeze({...anchor,identityAnchorDigest:canonicalDigest(anchor)});
}

module.exports=Object.freeze({aftercareProviderIdentity});
