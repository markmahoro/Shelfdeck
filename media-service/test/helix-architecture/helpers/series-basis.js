'use strict';
const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json');
const D=value=>canonicalDigest({value});
const {buildSeriesPresentationSource,buildSeriesPresentationBasis}=require('../../../src/helix/contracts/series-presentation-basis');
const {buildMetadataFetchIntent,buildMetadataObservation}=require('../../../src/helix/domains/libra/model/product-fact-contracts');
function basis(seasonNumber=3,providerKey='1399'){
  const identity={provider:'tmdb',namespace:'tmdb_series',providerKey,seasonNumber};identity.identityAnchorDigest=canonicalDigest(identity);
  const intent=buildMetadataFetchIntent({libraRunId:'season-'+seasonNumber,runExecutionBasisDigest:D('run'),sourceKind:'provider',sourcePriority:0,
    contentProfile:'series',resolvedIdentityDigest:D(identity),requestedFields:['series_title'],providerKind:'tmdb',integrationId:'tmdb-main',
    configRevision:2,resolvedProviderIdentity:identity});
  const source=buildSeriesPresentationSource({provider:'tmdb',namespace:'tmdb_series',providerKey,seasonIdentityAnchorDigest:identity.identityAnchorDigest,
    integrationId:intent.integrationId,configRevision:2,language:'zh-CN',sourceRef:'tmdb:tv:'+providerKey,title:'A & B',originalTitle:'Original Show',
    firstAirDate:'2008-01-20',plot:'The whole show, not a Season synopsis.',genres:['Drama']});
  const observation=buildMetadataObservation({intent,descriptiveEntries:[{key:'series_title',value:source.title}],providerIdentities:[identity],
    seriesPresentationSource:source,observedAtMs:100});
  return {value:buildSeriesPresentationBasis(observation),identity,observation};
}

module.exports={basis};
