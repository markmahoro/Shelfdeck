'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { buildProductIdentityCommitBundle, findProductIdentitySourceResult } = require('../model/product-identity-commit-contracts');
const { buildMediaCastDraft, buildProductFactHandle } = require('../model/product-fact-contracts');
const { identityCommitFence, factCommitFence } = require('../model/product-fact-execution-fences');

const IDENTITY = 'libra.product_identity.resolve@1';
const MEDIA_CAST_RESOLVE = 'libra.media_cast.resolve@1';
const MEDIA_CAST_COMMIT = 'libra.media_cast.commit@1';
const METADATA_COMMIT = 'libra.product_metadata.commit@1';
const RESULT_SCHEMA = 'helix://contracts/capabilities/libra.product_identity.resolve/v1/result';
const EVIDENCE_SCHEMA = 'helix://contracts/capabilities/libra.product_identity.resolve/v1/evidence';

function requireNamed(context,names) {
  for(const name of names)if(!context?.namedInputs||!Object.hasOwn(context.namedInputs,name))
    throw new TypeError('Product Fact Capability input is absent: '+name);
}

function resultSchemas(capabilityRef){const base='helix://contracts/capabilities/'+capabilityRef.replace('@1','/v1/');
  return Object.freeze({result:base+'result',evidence:base+'evidence'});}

function eventEvidence(capabilityRef,result,basisDigest,now,payloadDigest=canonicalDigest(result)){return Object.freeze({
  evidenceId:'libra-product-fact-evidence-'+canonicalDigest({capabilityRef,result}).slice(0,40),
  evidenceKind:'libra_product_fact_execution',producerRef:capabilityRef,basisDigest,
  payloadDigest,observedAtMs:now(),
});}

function relationsFromBasis(sourceBasis,subjectId){
  const unique=new Map();
  for(const observation of sourceBasis?.observationSet?.observations||[])for(const hint of observation.peopleHints||[]){
    const seed={subjectId,role:hint.role,displayName:hint.displayName,providerIdentities:hint.providerIdentities||[],
      originEvidenceDigest:observation.payloadDigest};
    const relationId='libra-media-cast-relation-'+canonicalDigest(seed).slice(0,40);
    if(!unique.has(relationId))unique.set(relationId,{relationId,personId:null,displayName:hint.displayName,
      displayNameNormalized:hint.displayName.normalize('NFKC').toLowerCase(),role:hint.role,source:observation.sourceRef,
      providerIdentities:Object.freeze([...(hint.providerIdentities||[])]),originEvidenceDigest:observation.payloadDigest,
      confidenceClass:'provider_asserted'});
  }
  return Object.freeze([...unique.values()].sort((left,right)=>Buffer.from(left.role).compare(Buffer.from(right.role))||
    Buffer.from(left.displayNameNormalized).compare(Buffer.from(right.displayNameNormalized))||
    Buffer.from(left.relationId).compare(Buffer.from(right.relationId))));
}

function createProductFactCapabilityPorts(options) {
  if(!options?.workResultReader||typeof options.workResultReader.read!=='function'||
      !options.movieProductionReader||typeof options.movieProductionReader.readRun!=='function'||
      !options.domainCommitCoordinator||typeof options.domainCommitCoordinator.execute!=='function')
    throw new TypeError('Product Fact Capability ports require durable Work, Libra Run, and Domain Commit services.');
  const now=typeof options.now==='function'?options.now:Date.now;
  const identityPort=Object.freeze({
    validateInputs(context){requireNamed(context,['identityClaim','decisionEvidence','productStructure','domainFactCommitHandle']);},
    execute(context) {
      const {identityClaim,decisionEvidence,productStructure}=context.namedInputs;
      const runSnapshot=typeof options.movieProductionReader.readRunSnapshot==='function'
        ?options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
        :options.movieProductionReader.readRun(context.ownerScope.processId);
      if(!runSnapshot)throw new TypeError('Libra Run snapshot is unavailable for Product Identity commit.');
      const source=findProductIdentitySourceResult(options.workResultReader,context.workId,decisionEvidence,context.ownerScope);
      const prior=options.movieProductionReader.readFact(runSnapshot.run.libraRunId,'resolved_identity',1);
      const bundle=buildProductIdentityCommitBundle({libraRunId:runSnapshot.run.libraRunId,snapshot:runSnapshot,
        identityClaim,decisionEvidence,productStructure,sourceResultItem:source,expectedRevision:prior?prior.factRevision:0,
        eventFenceDigest:identityCommitFence(context.workId,context.eventId)});
      if(canonicalDigest(bundle.handle)!==canonicalDigest(context.namedInputs.domainFactCommitHandle))
        throw new TypeError('Product Identity Domain Fact Commit Handle is stale.');
      const commitMarker='libra-product-identity-marker-'+canonicalDigest({eventId:context.eventId,
        handleId:bundle.handle.handleId}).slice(0,40);
      const effectId=canonicalDigest(['domain_fact_commit',context.idempotencyKey]);
      const effectReceiptId='libra-product-identity-effect-'+canonicalDigest({eventId:context.eventId}).slice(0,40);
      const commitDigest=canonicalDigest({schema:'libra.product-identity-commit@1',
        bundleDigest:bundle.bundleDigest,eventId:context.eventId});
      const domainEvidence=Object.freeze({schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,
        evidenceId:'libra-product-identity-commit-evidence-'+canonicalDigest({eventId:context.eventId}).slice(0,40),
        evidenceDigest:canonicalDigest({schema:'libra.product-identity-commit-evidence@1',bundleDigest:bundle.bundleDigest,
          eventId:context.eventId})});
      const resultId='libra-product-identity-result-'+canonicalDigest({eventId:context.eventId}).slice(0,40);
      const committed=options.domainCommitCoordinator.execute({transactionId:'helix.transaction.domain-fact-commit',
        handle:bundle.handle,payload:bundle.payload,supportingWorkId:context.workId,outboxMessages:[],
        commitMarker:{commitMarker,effectId,commitDigest},resultBinding:{resultId,eventId:context.eventId,
          evidenceSchemaRef:domainEvidence.schemaRef,evidence:domainEvidence,effectReceiptId}});
      const result=committed.typedResult;
      const evidence=Object.freeze({evidenceId:result.evidenceId,evidenceKind:'resolved_product_identity_commit',producerRef:IDENTITY,
        basisDigest:decisionEvidence.digest,payloadDigest:canonicalDigest(domainEvidence),observedAtMs:result.observedAtMs});
      const effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,
        effectReceiptId,effectId,effectClass:'domain_fact_commit',
        idempotencyKey:context.idempotencyKey,commitMarker,externalReceiptRef:null,outputDigest:canonicalDigest(result),
        verificationEvidenceDigest:commitDigest,committedAtMs:committed.commitMarkerRecord.committedAtMs});
      return Object.freeze({kind:'succeeded',resultSchemaRef:RESULT_SCHEMA,result,evidenceSchemaRef:EVIDENCE_SCHEMA,evidence,effectReceipt});
    },
    validateResult(_context,outcome){if(!outcome?.result?.identityDigest)throw new TypeError('Resolved Product Identity is absent.');},
  });
  const mediaCastResolvePort=Object.freeze({
    validateInputs(context){requireNamed(context,['libraMediaCastSourceBasisMetadataObservationOrWesternMatch','personReferenceProjectionList']);},
    execute(context){
      const sourceBasis=context.namedInputs.libraMediaCastSourceBasisMetadataObservationOrWesternMatch;
      const run=typeof options.movieProductionReader.readRunSnapshot==='function'
        ?options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
        :options.movieProductionReader.readRun(context.ownerScope.processId);
      if(!run)throw new TypeError('Libra Run snapshot is unavailable for Media Cast resolution.');
      const observations=sourceBasis?.observationSet?.observations||[];
      const result=buildMediaCastDraft({subjectId:run.run.subjectId,sourceBasis,
        relations:relationsFromBasis(sourceBasis,run.run.subjectId),
        personProjection:{items:context.namedInputs.personReferenceProjectionList},
        producedAtMs:Math.max(...observations.map((item)=>item.observedAtMs))});
      const schemas=resultSchemas(MEDIA_CAST_RESOLVE);
      return Object.freeze({kind:'succeeded',resultSchemaRef:schemas.result,result,
        evidenceSchemaRef:schemas.evidence,evidence:eventEvidence(MEDIA_CAST_RESOLVE,result,sourceBasis.sourceBasisDigest,now)});
    },
    validateResult(_context,outcome){if(outcome?.result?.schemaRef!=='helix://contracts/types/MediaCastDraft/v1')
      throw new TypeError('Media Cast Draft is invalid.');},
  });
  function commitPort(capabilityRef,factKind,inputNames,payloadBuilder){return Object.freeze({
    validateInputs(context){requireNamed(context,inputNames);},
    execute(context){
      const run=typeof options.movieProductionReader.readRunSnapshot==='function'
        ?options.movieProductionReader.readRunSnapshot(context.ownerScope.processId)
        :options.movieProductionReader.readRun(context.ownerScope.processId);
      if(!run)throw new TypeError('Libra Run snapshot is unavailable for Product Fact commit.');
      const payload=payloadBuilder(context.namedInputs);
      const prior=options.movieProductionReader.readFact(run.run.libraRunId,factKind,1);
      const expected=buildProductFactHandle({libraRunId:run.run.libraRunId,factKind,expectedRevision:prior?prior.factRevision:0,
        payloadDigest:canonicalDigest(payload),eventFenceDigest:factCommitFence(context.workId,context.eventId,factKind)});
      if(canonicalDigest(expected)!==canonicalDigest(context.namedInputs.domainFactCommitHandle))
        throw new TypeError('Product Fact Domain Fact Commit Handle is stale.');
      const commitMarker='libra-product-fact-marker-'+canonicalDigest({eventId:context.eventId,handleId:expected.handleId}).slice(0,40);
      const effectId=canonicalDigest(['domain_fact_commit',context.idempotencyKey]);
      const commitDigest=canonicalDigest({schema:'libra.product-fact-commit@1',payloadDigest:expected.payloadDigest,eventId:context.eventId});
      const domainEvidence=Object.freeze({schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,
        evidenceId:'libra-product-fact-commit-evidence-'+canonicalDigest({eventId:context.eventId}).slice(0,40),
        evidenceDigest:canonicalDigest({schema:'libra.product-fact-commit-evidence@1',payloadDigest:expected.payloadDigest,eventId:context.eventId})});
      const effectReceiptId='libra-product-fact-effect-'+canonicalDigest({eventId:context.eventId}).slice(0,40);
      const committed=options.domainCommitCoordinator.execute({transactionId:'helix.transaction.domain-fact-commit',
        handle:expected,payload,supportingWorkId:context.workId,outboxMessages:[],commitMarker:{commitMarker,effectId,commitDigest},
        resultBinding:{resultId:'libra-product-fact-result-'+canonicalDigest({eventId:context.eventId}).slice(0,40),eventId:context.eventId,
          evidenceSchemaRef:domainEvidence.schemaRef,evidence:domainEvidence,effectReceiptId}});
      const result=committed.typedResult,schemas=resultSchemas(capabilityRef);
      const effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',schemaVersion:1,effectReceiptId,
        effectId,effectClass:'domain_fact_commit',idempotencyKey:context.idempotencyKey,commitMarker,externalReceiptRef:null,
        outputDigest:canonicalDigest(result),verificationEvidenceDigest:commitDigest,committedAtMs:committed.commitMarkerRecord.committedAtMs});
      return Object.freeze({kind:'succeeded',resultSchemaRef:schemas.result,result,evidenceSchemaRef:schemas.evidence,
        evidence:eventEvidence(capabilityRef,result,payload.sourceBasis.sourceBasisDigest,now,canonicalDigest(domainEvidence)),effectReceipt});
    },
    validateResult(_context,outcome){if(outcome?.result?.factId===undefined||outcome.result.factDigest===undefined)
      throw new TypeError('Committed Product Fact is invalid.');},
  });}
  const mediaCastCommitPort=commitPort(MEDIA_CAST_COMMIT,'media_cast',[
    'libraMediaCastSourceBasisMetadataObservationOrWesternMatch','mediaCastDraft','domainFactCommitHandle'],(inputs)=>Object.freeze({
      sourceBasis:inputs.libraMediaCastSourceBasisMetadataObservationOrWesternMatch,mediaCastDraft:inputs.mediaCastDraft}));
  const metadataCommitPort=commitPort(METADATA_COMMIT,'product_metadata',[
    'libraProductMetadataSourceBasisMetadataObservationOrWesternAnalysis','productMetadataDraft','verifiedArtifactManifest',
    'mediaCastFactRefProductFactIdFactRevisionFactDigest','domainFactCommitHandle'],(inputs)=>Object.freeze({
      sourceBasis:inputs.libraProductMetadataSourceBasisMetadataObservationOrWesternAnalysis,
      productMetadataDraft:inputs.productMetadataDraft,verifiedArtifactManifest:inputs.verifiedArtifactManifest,
      mediaCastFactRef:inputs.mediaCastFactRefProductFactIdFactRevisionFactDigest}));
  return Object.freeze({[IDENTITY]:identityPort,[MEDIA_CAST_RESOLVE]:mediaCastResolvePort,
    [MEDIA_CAST_COMMIT]:mediaCastCommitPort,[METADATA_COMMIT]:metadataCommitPort});
}

module.exports=Object.freeze({IDENTITY,MEDIA_CAST_RESOLVE,MEDIA_CAST_COMMIT,METADATA_COMMIT,createProductFactCapabilityPorts});
