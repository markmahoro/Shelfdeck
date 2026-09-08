'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {buildRatingTargetIdentity}=require('./decision-identity-evidence-contracts');
function subjectRatingTarget(context){
  if(!context)return null;
  const subject=context.subject,claim=context.deliverySnapshot?.candidatePackage?.identityClaim||{},formal=context.rows?.identity;
  let title=claim.claimedTitle||claim.displayTitle||subject.subjectId,year=claim.claimedYear,providerIdentity=null;
  if(formal){
    const display=JSON.parse(formal.display_identity),{recordDigest,...body}=display;
    if(!Array.isArray(display.entries)||canonicalDigest(body)!==recordDigest||formal.identity_digest!==subject.currentIdentityDigest)
      throw Object.assign(new Error('Formal rating identity failed its evidence fence.'),{code:'LIBRA_RATING_IDENTITY_INVALID'});
    const value=display.entries.find(item=>item.key==='title')||display.entries.find(item=>item.key==='display_title');
    // Non-Movie profiles retain their existing identity contract.
    if(subject.contentProfile==='movie'){
      if(typeof value?.value!=='string'||!value.value.trim())throw Object.assign(new Error('Formal Movie identity has no title.'),{code:'LIBRA_RATING_IDENTITY_TITLE_MISSING'});
      title=value.value;year=display.entries.find(item=>item.key==='year')?.value||null;
      const providerKey=display.entries.find(item=>item.key==='tmdb_movie_id')?.value;
      if(formal.identity_kind==='tmdb_movie'&&typeof providerKey==='string'&&/^[0-9]+$/.test(providerKey))providerIdentity='tmdb:'+providerKey;
    }
  }
  const identity=buildRatingTargetIdentity({title,year,providerIdentity}),body={targetType:'subject',targetId:subject.subjectId,
    targetRevision:formal?Number(formal.revision):subject.intakeRevision,title:identity.title,year:identity.year,providerIdentity:identity.providerIdentity,
    subjectSnapshotDigest:subject.snapshotDigest};
  return Object.freeze({...body,targetDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({subjectRatingTarget});
