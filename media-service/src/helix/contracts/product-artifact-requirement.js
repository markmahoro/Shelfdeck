'use strict';
const { canonicalDigest } = require('./canonical-json');

function artifactRequirement(kind, episodeScope = null, sourcePolicy = null) {
  if(sourcePolicy!==null&&(kind!=='poster'||episodeScope||sourcePolicy!==require('./series-season-poster-source').POLICY))
    throw new TypeError('Artifact source policy requires the exact Season poster policy.');
  if(episodeScope && (kind!=='nfo'||Object.keys(episodeScope).sort().join(',')!=='episodeKey,episodeNumber,seasonNumber'||
      !Number.isSafeInteger(episodeScope.episodeNumber)||episodeScope.episodeNumber<1||
      !Number.isSafeInteger(episodeScope.seasonNumber)||episodeScope.seasonNumber<1||
      episodeScope.episodeKey!=='E'+String(episodeScope.episodeNumber).padStart(3,'0')))
    throw new TypeError('Episode Artifact Requirement requires an exact canonical positive scope.');
  const value={requirementId:'',revision:1,
    schemaRef:kind==='nfo'?'shelfdeck.product-artifact.nfo-renderable@1':'shelfdeck.product-artifact.image-decodable@1',
    artifactKind:kind,requirementPayload:Object.freeze({mediaType:kind==='nfo'?'application/xml':'image/jpeg',...(episodeScope?{episodeScope:Object.freeze({...episodeScope})}:{}),...(sourcePolicy?{sourcePolicy}:{})}),
    requirementDigest:''};
  value.requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',revision:value.revision,
    schemaRef:value.schemaRef,artifactKind:value.artifactKind,requirementPayload:value.requirementPayload});
  value.requirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:value.requirementDigest});
  return Object.freeze(value);
}

module.exports=Object.freeze({artifactRequirement});
