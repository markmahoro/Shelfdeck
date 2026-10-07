'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');

function canonicalContentIdentity(shelfId,identity) {
  if(!shelfId||!identity?.identityDigest)throw new TypeError('Canonical content identity requires a Shelf and resolved identity.');
  const provider=identity.providerIdentities?.[0]||{};
  let basis;
  if(identity.structureKind==='season') {
    const anchors=identity.providerIdentities.filter(item=>item.provider==='tmdb'&&item.namespace==='tmdb_series');
    const anchor=anchors[0];
    if(identity.contentProfile!=='series'||identity.identityKind!=='tmdb_series_season'||anchors.length!==1||
        !/^\d+$/.test(anchor.providerKey)||!Number.isSafeInteger(anchor.seasonNumber)||anchor.seasonNumber<1)
      throw new TypeError('Series canonical identity requires one exact Provider Season anchor.');
    // Run evidence, Subject identity and translated titles do not establish a new Season.
    basis={schema:'arca.canonical-season-identity-key@1',shelfId,provider:anchor.provider,
      namespace:anchor.namespace,providerKey:anchor.providerKey,seasonNumber:anchor.seasonNumber};
  } else {
    basis={schema:'arca.canonical-content-identity-key@1',shelfId,structureKind:identity.structureKind,
      identityKind:identity.identityKind,provider:provider.provider||null,providerKey:provider.providerKey||null,
      identityDigest:identity.identityDigest};
  }
  const canonicalIdentityKey=canonicalDigest(basis);
  return Object.freeze({canonicalIdentityKey,shelfEntryId:canonicalDigest({schema:'arca.shelf-entry-id@1',shelfId,canonicalIdentityKey})});
}
module.exports=Object.freeze({canonicalContentIdentity});
