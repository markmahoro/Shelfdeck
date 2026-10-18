'use strict';
const {createProductionSourceScopeResolver}=require('./production-source-scope-resolver');
const {buildUsAdultIdentityIntent}=require('../model/us-adult-identity-evidence');
const {identityObservationWork}=require('./product-identity-work');
function usAdultIdentitySource(options,snapshot){
  const resolver=createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,productionPort:options.productProductionPort}),sources=resolver.primarySources(snapshot);
  if(sources.length!==1)throw new TypeError('US Adult requires exactly one frozen Primary.');
  return sources[0].readHandle;
}
function nextUsAdultIdentityStage(options,snapshot){
  const work=identityObservationWork(snapshot,'internal_source'),status=options.workResultReader.status(work.workId);
  if(status?.state==='failed')return {kind:'failed',work,status};
  if(status?.state==='succeeded'){
    const results=options.workResultReader.read(work.workId).filter(item=>item.outcomeKind==='succeeded'&&item.capabilityRef==='libra.product_identity.evidence.observe@1');
    if(results.length!==1||results[0].result.contentProfile!=='western_adult'||results[0].result.sourceKind!=='internal_source'||results[0].result.result!=='resolved')
      throw new Error('US Adult internal identity lacks its unique formal Observation.');
    return {kind:'resolved',work,sourceResult:results[0]};
  }
  const context=options.routingContextReader.read(snapshot.run.subjectId),establishedIdentity=context?.subject.currentIdentityDigest?
    options.movieProductionReader.readSubjectIdentityFact(snapshot.run.subjectId,context.subject.currentIdentityDigest):null;
  if(context?.subject.currentIdentityDigest&&!establishedIdentity)throw new Error('Established US Adult Subject identity cannot be read.');
  return {kind:'observation',work,intent:buildUsAdultIdentityIntent({snapshot,sourceHandle:usAdultIdentitySource(options,snapshot),establishedIdentity})};
}
module.exports=Object.freeze({nextUsAdultIdentityStage,usAdultIdentitySource});
