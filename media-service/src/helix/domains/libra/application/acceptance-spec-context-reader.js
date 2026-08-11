'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildDecisionInputSet } = require('../model/decision-front-half-contracts');
const { buildProductScope } = require('../model/acceptance-spec-contracts');
const { createDecisionBasisStore } = require('../persistence/decision-basis-store');

function createAcceptanceSpecContextReader(options){
  if(!options?.routingContextReader||typeof options.readArcaShelfStandard!=='function'||typeof options.resolvePerceptionRating!=='function')throw new TypeError('Acceptance Spec context requires Routing, Arca Standard, and Perception public inputs.');
  const basisStore=createDecisionBasisStore(options);
  function read(subjectId){const routingContext=options.routingContextReader.read(subjectId),routingDecision=options.routingContextReader.currentRoutingDecision(subjectId);
    if(!routingContext||!routingDecision||routingDecision.result!=='resolved')return Object.freeze({kind:'unresolved',reasonCode:'routing_not_resolved'});
    const standardResult=options.readArcaShelfStandard(routingDecision.targetShelfId);if(!standardResult||standardResult.resultKind!=='found')return Object.freeze({kind:'unresolved',reasonCode:'shelf_standard_unavailable'});
    const perception=options.resolvePerceptionRating(subjectId);if(!perception||perception.kind==='pending')return Object.freeze({kind:'pending_perception',workId:perception?.workId||null});
    if(!['found','not_found'].includes(perception.kind)||!perception.resolution||!perception.queryResult)throw new Error('Perception Resolution public result is invalid.');
    const inputSet=buildDecisionInputSet({basisKind:'acceptance_spec',subjectSnapshot:routingContext.subject,expectedDecisionHead:routingContext.expectedHead,readiness:{result:'ready'},
      routingAuthoritySnapshot:null,shelfRoutingTargets:[],routingDecision,shelfStandardProjection:standardResult.projection,
      productScope:buildProductScope(routingContext.subject,[]),decisionFacts:[perception.resolution],queryResults:[perception.queryResult]});
    if(routingContext.expectedHead.currentDecisionBasisId){
      const current=basisStore.readInputSet(routingContext.expectedHead.currentDecisionBasisId);
      if(current?.basis?.basisKind==='acceptance_spec'&&current.inputSet.specInputDigest===inputSet.specInputDigest){
        if(routingContext.expectedHead.currentAcceptanceSpecId)return Object.freeze({kind:'current',subjectId,
          acceptanceSpecId:routingContext.expectedHead.currentAcceptanceSpecId,decisionBasisId:current.basis.decisionBasisId,specInputDigest:inputSet.specInputDigest});
        return Object.freeze({kind:'basis_ready',subjectId,basis:current.basis,inputSet:current.inputSet});
      }
    }
    return Object.freeze({kind:'ready',subjectId,routingContext,routingDecision,perception,standardProjection:standardResult.projection,inputSet,
      contextDigest:canonicalDigest({inputSetDigest:inputSet.inputSetDigest,perceptionResolutionId:perception.resolution.factId})});}
  return Object.freeze({read});
}

module.exports=Object.freeze({createAcceptanceSpecContextReader});
