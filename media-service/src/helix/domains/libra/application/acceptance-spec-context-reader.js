'use strict';

const { deliveryScopeStatements,readDeliveryScopes } = require('../persistence/series-delivery-scope-reader');
const { pendingSeriesBatch } = require('../model/series-delivery-scope');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildDecisionInputSet } = require('../model/decision-front-half-contracts');
const { buildProductScope } = require('../model/acceptance-spec-contracts');
const { createDecisionBasisStore } = require('../persistence/decision-basis-store');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createAcceptanceSpecContextReader(options){
  if(!options?.routingContextReader||typeof options.readArcaShelfStandard!=='function'||typeof options.resolvePerceptionRating!=='function')throw new TypeError('Acceptance Spec context requires Routing, Arca Standard, and Perception public inputs.');
  const basisStore=createDecisionBasisStore(options);
  const repository=createRepositoryDefinition({repositoryId:'libra_spec_episode_scope_reader',owner:'libra',
    schemaManifest:options.schemaManifest,statements:{
      ...deliveryScopeStatements,
      find_scope_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','acceptance_spec_id','execution_basis_digest'],keyColumns:['libra_run_id']},
      find_scope_spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['subject_id','spec_json','record_digest'],keyColumns:['acceptance_spec_id']},
      find_subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','intake_revision','current_episode_scope_digest'],
        keyColumns:['subject_id']},
      list_bindings:{kind:'select-all',tableId:'libra_material_bindings',columns:['subject_id','material_key',
        'binding_revision','authority_kind','health_state','current','origin_candidate_package_id'],keyColumns:['subject_id']},
      list_claims:{kind:'select-all',tableId:'libra_material_binding_episode_claims',columns:['subject_id','material_key',
        'binding_revision','episode_key'],keyColumns:['subject_id']},
    }});
  function deliveryEpisodeKeys(subject,scopeRunId) {
    if(subject.contentProfile!=='series')return [];
    return options.unitOfWork.execute([{participantId:'libra_spec_episode_scope_read',owner:'libra',repositories:[repository],
      execute(context) {
        const repo=context.repository(repository.repositoryId),key={subject_id:subject.subjectId};
        const current=repo.invoke('find_subject',key);
        if(!current||Number(current.intake_revision)!==subject.intakeRevision||
            current.current_episode_scope_digest!==subject.episodeScopeDigest)throw new Error('Spec Subject Episode scope is stale.');
        if(scopeRunId){
          const run=repo.invoke('find_scope_run',{libra_run_id:scopeRunId});
          if(!run||run.subject_id!==subject.subjectId)throw new Error('Spec delivery scope belongs to another Subject.');
          const row=repo.invoke('find_scope_spec',{acceptance_spec_id:run.acceptance_spec_id}),spec=row&&JSON.parse(row.spec_json);
          if(!spec||row.subject_id!==subject.subjectId||spec.recordDigest!==row.record_digest||spec.productScope?.scopeKind!=='episode_manifest')
            throw new Error('Spec delivery scope requires an immutable Series Run Spec.');
          return Object.freeze([...spec.productScope.episodeKeys]);
        }
        const bindings=pendingSeriesBatch(repo.invoke('list_bindings',key).filter(row=>Number(row.current)===1&&
          row.health_state==='active'),readDeliveryScopes(repo,subject.subjectId));
        const claims=repo.invoke('list_claims',key).filter(claim=>bindings.some(binding=>
          binding.material_key===claim.material_key&&Number(binding.binding_revision)===Number(claim.binding_revision)));
        if(bindings.some(binding=>!claims.some(claim=>claim.material_key===binding.material_key)))
          throw new Error('Series Spec requires Episode claims on every current Primary Binding.');
        return Object.freeze([...new Set(claims.map(claim=>claim.episode_key))].sort((a,b)=>Buffer.from(a).compare(Buffer.from(b))));
      }}]).libra_spec_episode_scope_read;
  }
  function read(subjectId,scopeRunId=null){const routingContext=options.routingContextReader.read(subjectId),routingDecision=options.routingContextReader.currentRoutingDecision(subjectId);
    if(!routingContext||!routingDecision||routingDecision.result!=='resolved')return Object.freeze({kind:'unresolved',reasonCode:'routing_not_resolved'});
    const standardResult=options.readArcaShelfStandard(routingDecision.targetShelfId);if(!standardResult||standardResult.resultKind!=='found')return Object.freeze({kind:'unresolved',reasonCode:'shelf_standard_unavailable'});
    const perception=options.resolvePerceptionRating(subjectId);if(!perception||perception.kind==='pending')return Object.freeze({kind:'pending_perception',workId:perception?.workId||null});
    if(['failed','cancelled'].includes(perception.kind))return Object.freeze({kind:'perception_'+perception.kind,workId:perception.workId||null,reasonCode:perception.reasonCode||null});
    if(!['found','not_found'].includes(perception.kind)||!perception.resolution||!perception.queryResult)throw new Error('Perception Resolution public result is invalid.');
    const episodeKeys=deliveryEpisodeKeys(routingContext.subject,scopeRunId);
    if(routingContext.subject.contentProfile==='series'&&!episodeKeys.length)
      return Object.freeze({kind:'unresolved',reasonCode:'no_pending_episode_delivery'});
    const inputSet=buildDecisionInputSet({basisKind:'acceptance_spec',subjectSnapshot:routingContext.subject,expectedDecisionHead:routingContext.expectedHead,readiness:{result:'ready'},
      routingAuthoritySnapshot:null,shelfRoutingTargets:[],routingDecision,shelfStandardProjection:standardResult.projection,
      productScope:buildProductScope(routingContext.subject,episodeKeys),decisionFacts:[perception.resolution],queryResults:[perception.queryResult]});
    if(routingContext.expectedHead.currentDecisionBasisId){
      const current=basisStore.readInputSet(routingContext.expectedHead.currentDecisionBasisId);
      if(current?.basis?.basisKind==='acceptance_spec'&&current.inputSet.specInputDigest===inputSet.specInputDigest){
        if(routingContext.expectedHead.currentAcceptanceSpecId)return Object.freeze({kind:'current',subjectId,
          acceptanceSpecId:routingContext.expectedHead.currentAcceptanceSpecId,decisionBasisId:current.basis.decisionBasisId,specInputDigest:inputSet.specInputDigest,inputSet});
        return Object.freeze({kind:'basis_ready',subjectId,basis:current.basis,inputSet:current.inputSet});
      }
    }
    return Object.freeze({kind:'ready',subjectId,routingContext,routingDecision,perception,standardProjection:standardResult.projection,inputSet,
      contextDigest:canonicalDigest({inputSetDigest:inputSet.inputSetDigest,perceptionResolutionId:perception.resolution.factId})});}
  function readScopeRef(subjectId,libraRunId){
    return options.unitOfWork.execute([{participantId:'libra_spec_scope_ref',owner:'libra',repositories:[repository],execute(context){
      const run=context.repository(repository.repositoryId).invoke('find_scope_run',{libra_run_id:libraRunId});
      if(!run||run.subject_id!==subjectId)throw new Error('Spec Run scope reference belongs to another Subject.');
      return Object.freeze({ownerDomain:'libra',objectType:'libra_run',objectId:libraRunId,revision:1,digest:run.execution_basis_digest});
    }}]).libra_spec_scope_ref;
  }
  return Object.freeze({read,readScopeRef});
}

module.exports=Object.freeze({createAcceptanceSpecContextReader});
