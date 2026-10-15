'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');

function canonicalContentIdentity(shelfId,identity,onDeckRunId=null) {
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
  } else if(identity.contentProfile==='jav' || identity.identityKind==='jav_code') {
    const anchors=identity.providerIdentities.filter(item=>item.provider==='jav'&&item.namespace==='jav_code'),anchor=anchors[0];
    if(identity.structureKind!=='single'||identity.contentProfile!=='jav'||identity.identityKind!=='jav_code'||anchors.length!==1 ||
        require('../../../contracts/jav-source-contracts').buildJavQueryAnchor('jav_code',anchor.providerKey).javCode!==anchor.providerKey)
      throw new TypeError('JAV canonical identity requires one complete canonical release code.');
    basis={schema:'arca.canonical-jav-identity-key@1',shelfId,provider:'jav',namespace:'jav_code',providerKey:anchor.providerKey};
  } else {
    basis={schema:'arca.canonical-content-identity-key@1',shelfId,structureKind:identity.structureKind,
      identityKind:identity.identityKind,provider:provider.provider||null,providerKey:provider.providerKey||null,
      identityDigest:identity.identityDigest};
  }
  const canonicalIdentityKey=canonicalDigest(basis);
  if(identity.contentProfile==='jav') {
    if(onDeckRunId!==null&&(typeof onDeckRunId!=='string'||!onDeckRunId||onDeckRunId.length>256))
      throw new TypeError('JAV Entry identity requires its exact Arca On-deck admission.');
    return Object.freeze({canonicalIdentityKey,shelfEntryId:onDeckRunId===null?null:
      canonicalDigest({schema:'arca.jav-shelf-entry-id@1',shelfId,onDeckRunId})});
  }
  return Object.freeze({canonicalIdentityKey,shelfEntryId:canonicalDigest({schema:'arca.shelf-entry-id@1',shelfId,canonicalIdentityKey})});
}
module.exports=Object.freeze({canonicalContentIdentity});
