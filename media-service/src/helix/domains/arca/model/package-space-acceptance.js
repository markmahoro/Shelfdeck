'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {evaluateSeriesEpisodeSpace}=require('../../../contracts/episode-byte-allocation');

function evaluatePackageSpace(packageValue,requirement) {
  const manifest=packageValue.productMaterialManifest;
  const members=manifest.members.filter(item=>item.role==='primary_payload');
  const maximum=requirement.maxSizeBytes;
  if(packageValue.productStructureSnapshot.structureKind!=='season') {
    const total=members.reduce((sum,item)=>sum+BigInt(item.sizeBytes),0n);
    return Object.freeze({actualGapCodes:Object.freeze(maximum!==null&&total>BigInt(maximum)?['max_size_exceeded']:[])});
  }
  if(requirement.unit!=='episode'||manifest.scopeKind!=='episode_delivery')
    throw new TypeError('Season acceptance requires an Episode space requirement and delivery scope.');
  const episodeKeys=[...new Set(members.flatMap(item=>item.episodeClaims.map(claim=>claim.episodeKey)))];
  const allocations=evaluateSeriesEpisodeSpace({members,episodeKeys,maxSizeBytes:maximum});
  const body={schema:'arca.episode-space-evidence@1',productManifestDigest:manifest.manifestDigest,
    episodeScopeDigest:manifest.episodeScopeDigest,maxSizeBytes:maximum,allocations};
  return Object.freeze({actualGapCodes:Object.freeze(allocations.every(item=>item.withinLimit)?[]:['max_size_exceeded']),
    episodeSpaceEvidence:Object.freeze({...body,evidenceDigest:canonicalDigest(body)})});
}

module.exports=Object.freeze({evaluatePackageSpace});
