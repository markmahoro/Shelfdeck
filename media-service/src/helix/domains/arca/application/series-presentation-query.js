'use strict';
const {createSeriesPresentationStore}=require('../persistence/series-presentation-store');
const {canonicalDigest}=require('../../../contracts/canonical-json');

function createSeriesPresentationQuery(options){
  const store=createSeriesPresentationStore(options);
  function readRootBinding({shelfId,providerKey}){
    if(typeof shelfId!=='string'||!shelfId||!/^\d+$/.test(providerKey||''))throw new TypeError('Series root query requires an exact Shelf and Provider identity.');
    const row=store.findByIdentity(shelfId,providerKey);if(!row)return null;
    const value={scopeId:row.scope_id,shelfId:row.shelf_id,provider:'tmdb',providerKey:row.provider_key,endpointId:row.endpoint_id,
      mountScopeId:row.mount_scope_id,rootLocation:row.root_location,placementRevision:Number(row.placement_revision)};
    return Object.freeze({...value,bindingDigest:canonicalDigest(value)});
  }
  return Object.freeze({readRootBinding});
}
module.exports=Object.freeze({createSeriesPresentationQuery});
