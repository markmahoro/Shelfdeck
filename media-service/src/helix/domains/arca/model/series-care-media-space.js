'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {evaluateSeriesEpisodeSpace,deriveSeriesMemberSizeBudgets}=require('../../../contracts/episode-byte-allocation');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {parseArcaMaterialEpisodeClaims}=require('./material-episode-claims');

function evaluateSeriesCareMediaSpace(context,maxSizeBytes) {
  const raw=context.raw,inventoryRevision=Number(raw.entry.current_inventory_revision);
  if(raw.entry.structure_kind!=='season'||!Number.isSafeInteger(inventoryRevision)||inventoryRevision<1||
      typeof context.shelfEntryId!=='string'||!context.shelfEntryId||!/^[a-f0-9]{64}$/.test(context.basis?.digest||''))
    throw new TypeError('Series care space requires an exact current Entry revision and Care Basis.');
  const members=raw.materials.filter(item=>item.role==='primary_payload').map(row=>{
    const identity=physicalIdentityFromInventoryRow(row),claims=parseArcaMaterialEpisodeClaims(row);
    if(!Number.isSafeInteger(Number(row.binding_revision))||Number(row.binding_revision)<1||
        typeof row.endpoint_id!=='string'||!row.endpoint_id||typeof row.location!=='string'||!row.location)
      throw new TypeError('Series care space requires canonical Inventory Claims and exact bindings.');
    return Object.freeze({materialKey:row.material_key,role:'primary_payload',sizeBytes:identity.sizeBytes,
      episodeClaims:claims.items,physicalIdentityDigest:canonicalDigest(identity),episodeClaimSetDigest:claims.episodeClaimSetDigest,
      bindingDigest:canonicalDigest({endpointId:row.endpoint_id,location:row.location,bindingRevision:Number(row.binding_revision)})});
  }).sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey)));
  const episodeKeys=[...new Set(members.flatMap(item=>item.episodeClaims.map(claim=>claim.episodeKey)))].sort(),
    input={members,episodeKeys,maxSizeBytes},basis={schema:'arca.series-care-media-space@1',shelfEntryId:context.shelfEntryId,
      inventoryRevision,careBasisDigest:context.basis.digest,members,episodeKeys,maxSizeBytes};
  return Object.freeze({...basis,members:Object.freeze(members),episodeKeys:Object.freeze(episodeKeys),basisDigest:canonicalDigest(basis),
    episodeAllocations:evaluateSeriesEpisodeSpace(input),memberBudgets:deriveSeriesMemberSizeBudgets(input)});
}
function seriesMemberAssessmentEventId(workAttemptId,materialKey) {
  if(typeof workAttemptId!=='string'||!workAttemptId||typeof materialKey!=='string'||!materialKey)
    throw new TypeError('Series member Event requires an exact Work Attempt and material key.');
  return 'care-member-'+canonicalDigest({workAttemptId,materialKey}).slice(0,40);
}
module.exports=Object.freeze({evaluateSeriesCareMediaSpace,seriesMemberAssessmentEventId});
