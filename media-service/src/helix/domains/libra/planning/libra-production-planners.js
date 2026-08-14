'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { executionCatalogDigest } = require('../../../foundation/execution/workflow-plan');
const { buildProductIdentityCommitBundle } = require('../model/product-identity-commit-contracts');
const { buildMetadataFetchIntent, buildMetadataObservationBasis, buildProductMetadataDraft } =
  require('../model/product-fact-contracts');
const { buildMediaCastDraft, buildProductFactHandle } = require('../model/product-fact-contracts');
const { factCommitFence, identityCommitFence } = require('../model/product-fact-execution-fences');
const { identityCommitWork, identityObservationWork } =
  require('./product-identity-work');
const {
  metadataObservationWork,
  nextMetadataStage,
  requiredMetadataFields,
} = require('./product-metadata-work');

const ROUTING_FACT = 'libra.routing.fact.observe@1';
const IDENTITY = 'libra.product_identity.resolve@1';
const ROUTING_INTENT = 'helix://libra/input-projections/ProductionIdentityRoutingFactIntent/v1';
const ROUTING_SOURCE = 'helix://libra/input-projections/ProductionIdentityRoutingSource/v1';
const IDENTITY_CLAIM = 'helix://libra/input-projections/ProductionIdentityClaim/v1';
const PRODUCT_STRUCTURE = 'helix://libra/input-projections/ProductionProductStructure/v1';
const DECISION_EVIDENCE = 'helix://libra/input-projections/ProductionIdentityDecisionEvidence/v1';
const IDENTITY_HANDLE = 'helix://libra/input-projections/ProductionIdentityDomainFactCommitHandle/v1';
const METADATA_INTENT = 'helix://libra/input-projections/ProductMetadataFetchIntent/v1';
const METADATA_SOURCE = 'helix://libra/input-projections/ProductMetadataSourceHandle/v1';
const METADATA = 'libra.product_metadata.fetch@1';
const ARTIFACT_ACQUIRE = 'libra.product_artifact.acquire@1';
const SIDECAR_RENDER = 'libra.product_sidecar.render@1';
const ARTIFACT_VERIFY = 'shared.artifact.manifest.verify@1';
const METADATA_DRAFT = 'helix://libra/input-projections/ProductMetadataDraft/v1';
const ARTIFACT_INTEGRATION = 'helix://libra/input-projections/ProductArtifactIntegrationHandle/v1';
const SIDECAR_PROFILE = 'helix://libra/input-projections/ProductSidecarProfile/v1';
const ARTIFACT_REQUIREMENT = 'helix://libra/input-projections/ProductArtifactRequirement/v1';
const ARTIFACT_HANDLE_LIST = 'helix://libra/input-projections/ProductArtifactHandleList/v1';
const MEDIA_CAST_RESOLVE = 'libra.media_cast.resolve@1';
const MEDIA_CAST_COMMIT = 'libra.media_cast.commit@1';
const METADATA_COMMIT = 'libra.product_metadata.commit@1';
const MEDIA_CAST_BASIS = 'helix://libra/input-projections/LibraMediaCastSourceBasis/v1';
const METADATA_BASIS = 'helix://libra/input-projections/LibraProductMetadataSourceBasis/v1';
const PERSON_REFERENCE_LIST = 'helix://libra/input-projections/PersonReferenceProjectionList/v1';
const MEDIA_CAST_DRAFT = 'helix://libra/input-projections/MediaCastDraft/v1';
const MEDIA_CAST_HANDLE = 'helix://libra/input-projections/MediaCastDomainFactCommitHandle/v1';
const VERIFIED_ARTIFACT_MANIFEST = 'helix://libra/input-projections/VerifiedArtifactManifest/v1';
const MEDIA_CAST_FACT_REF = 'helix://libra/input-projections/MediaCastFactReference/v1';
const METADATA_HANDLE = 'helix://libra/input-projections/ProductMetadataDomainFactCommitHandle/v1';

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function readRunSnapshot(reader,libraRunId){return typeof reader.readRunSnapshot==='function'
  ?reader.readRunSnapshot(libraRunId):reader.readRun(libraRunId);}
function bindings(values) { return Object.freeze({ schemaRef:'helix://foundation/types/EventInputBindingSet/v1', schemaVersion:1,
  bindings:Object.freeze(values) }); }
function demand(resourceKinds) { const value={resourceKinds:Object.freeze(resourceKinds)};
  return Object.freeze({...value,demandDigest:canonicalDigest(value)}); }
function owner(portName,request,projectionRef,parameters={}) { return Object.freeze({portName,bindingKind:'projected_owner_facts',
  ownerDomain:request.ownerDomain,processType:request.processType,processId:request.processId,projectionRef,
  parameters:Object.freeze(parameters)}); }
function projected(portName,eventId,resultSchemaRef,projectionRef,parameters={}) { return Object.freeze({portName,
  bindingKind:'projected_event_result',eventId,resultSchemaRef,projectionRef,parameters:Object.freeze(parameters)}); }

function planNode(options) {
  const manifest=options.registry.resolve(options.capabilityRef,'libra').manifest;
  const policy=options.policyRegistry.bindingFor(options.capabilityRef,manifest.effectClass);
  const fence={basisDigest:options.request.executionBasisDigest,inputSetDigest:canonicalDigest(options.inputBindings),
    eventFenceDigest:canonicalDigest({schema:'libra.production-event-fence@1',eventId:options.eventId,workId:options.request.workId}),
    effectScopeDigest:canonicalDigest({schema:'libra.production-event-scope@1',eventId:options.eventId,
      libraRunId:options.request.processId,capabilityRef:options.capabilityRef})};
  return Object.freeze({nodeId:options.nodeId,eventId:options.eventId,capabilityRef:options.capabilityRef,contractVersion:1,
    inputBindingsSchemaRef:manifest.parametersSchemaRef.replace(/\/parameters$/,'/inputs'),inputBindings:bindings(options.inputBindings),
    parametersSchemaRef:manifest.parametersSchemaRef,parameters:Object.freeze(options.parameters||{}),dependsOn:Object.freeze(options.dependsOn||[]),
    whenSchemaRef:null,when:null,effectClass:manifest.effectClass,resourceDemandSchemaRef:manifest.resourceDemandSchemaRef,
    resourceDemand:demand(options.resourceKinds),approvalRequirementRef:null,authorizationRequirementRef:null,
    fenceSchemaRef:manifest.fenceSchemaRef,fenceBasis:Object.freeze(fence),retryPolicyRef:policy.retryPolicyRef,
    timeoutPolicyRef:policy.timeoutPolicyRef,outputContractRef:manifest.resultSchemaRef});
}

function productStructure(snapshot) {
  const episodeClaims=[...(snapshot.episodeClaims||[])];
  const body={objectId:stable('libra-product-structure-',{libraRunId:snapshot.run.libraRunId,
      runExecutionBasisDigest:snapshot.run.executionBasisDigest}),revision:1,subjectId:snapshot.run.subjectId,
    structureKind:snapshot.spec.structureKind,episodeClaims:Object.freeze(episodeClaims),structureDigest:canonicalDigest({
      schema:'libra.product-structure@1',libraRunId:snapshot.run.libraRunId,subjectId:snapshot.run.subjectId,
      structureKind:snapshot.spec.structureKind,episodeClaims})};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}

function decisionEvidence(sourceResult, snapshot) {
  if(!sourceResult||sourceResult.schemaRef!=='helix://contracts/types/RoutingFactObservation/v1'||
      sourceResult.subjectId!==snapshot.run.subjectId||sourceResult.result!=='observed') {
    throw new Error('Product Identity requires one uniquely observed provider identity.');
  }
  const providerFacts=sourceResult.facts.filter((item)=>item.factKind==='resolved_provider_identity');
  if(providerFacts.length!==1)throw new Error('Product Identity provider identity is absent or conflicting.');
  const queryResultBody={schemaRef:'helix://contracts/types/VersionedQueryResult/v1',schemaVersion:1,
    evidenceId:sourceResult.observationId,evidenceKind:'routing_fact_query_result',producerRef:ROUTING_FACT,
    basisDigest:sourceResult.evidenceDigest,payloadDigest:sourceResult.observationDigest,observedAtMs:0,
    providerDomain:'tmdb',queryContract:ROUTING_FACT,queryVersion:1,inputDigest:sourceResult.intentId,
    resultKind:'found',resultRevision:providerFacts[0].sourceRevision,resultDigest:canonicalDigest(sourceResult),
    expiresAtMs:Number.MAX_SAFE_INTEGER};
  const queryResult=Object.freeze(queryResultBody);
  const body={schemaRef:'helix://contracts/domain-types/DecisionEvidence/v1',schemaVersion:1,
    objectId:stable('libra-product-identity-decision-evidence-',{libraRunId:snapshot.run.libraRunId,
      observationId:sourceResult.observationId}),revision:1,subjectId:snapshot.run.subjectId,
    queryResults:Object.freeze([queryResult]),routingInputDigest:sourceResult.observationDigest,
    specInputDigest:snapshot.spec.recordDigest};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}

function createProductIdentityPlanner(options) {
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/ProductIdentity/v1',plannerVersion:1,plan(request) {
    const snapshot=readRunSnapshot(options.movieProductionReader,request.processId);
    if(!snapshot||snapshot.run.executionBasisDigest!==request.executionBasisDigest)throw new Error('Product Identity planning basis changed.');
    const observationWork=identityObservationWork(snapshot);
    let work,nodes;
    if(request.workId===observationWork.workId){
      const factEventId=stable('libra-product-identity-fact-event-',{attempt:request.workAttemptId});
      work=observationWork;
      nodes=[planNode({...options,request,nodeId:'provider_identity_observation',eventId:factEventId,
        capabilityRef:ROUTING_FACT,inputBindings:[
          owner('routingFactObservationIntent',request,ROUTING_INTENT),
          owner('physicalMaterialReadHandleOrIntegrationHandle',request,ROUTING_SOURCE),
        ],resourceKinds:['disk_io','network']})];
    }else{
      const source=options.workResultReader.read(observationWork.workId).find((item)=>
        item.outcomeKind==='succeeded'&&item.capabilityRef===ROUTING_FACT);
      if(!source||source.result?.result!=='observed'||
          source.result.facts.filter((item)=>item.factKind==='resolved_provider_identity').length!==1)
        throw new Error('Product Identity commit Work requires one terminal provider identity Observation.');
      work=identityCommitWork(snapshot,{workId:observationWork.workId,resultDigest:source.resultDigest});
      if(request.workId!==work.workId)throw new Error('Product Identity Work identity changed.');
      const identityEventId=stable('libra-product-identity-resolve-event-',{attempt:request.workAttemptId});
      const parameters={sourceWorkId:observationWork.workId,libraRunId:request.processId,
        workId:request.workId,eventId:identityEventId};
      nodes=[planNode({...options,request,nodeId:'product_identity_resolution',eventId:identityEventId,
        capabilityRef:IDENTITY,inputBindings:[
          owner('identityClaim',request,IDENTITY_CLAIM),
          owner('decisionEvidence',request,DECISION_EVIDENCE,parameters),
          owner('productStructure',request,PRODUCT_STRUCTURE),
          owner('domainFactCommitHandle',request,IDENTITY_HANDLE,parameters),
        ],resourceKinds:['cpu']})];
    }
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:stable('libra-product-identity-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,
      ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:work.workObjectiveTypeRef,workObjectiveVersion:1,
      executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',
      diagnosticClassification:null,nodes:Object.freeze(nodes)});
  }});
}

function createProductIdentityProjections(options) {
  function snapshot(ownerScope) {
    const value=readRunSnapshot(options.movieProductionReader,ownerScope.processId);
    if(!value)throw new Error('Libra Run is unavailable for Product Identity projection.');
    return value;
  }
  function routingIntent(value) {
    const routing=options.routingContextReader.read(value.run.subjectId);
    if(!routing)throw new Error('Routing context is unavailable for Product Identity.');
    return options.routingContextReader.factObservationIntent(routing,'provider',['resolved_provider_identity'],[]);
  }
  return Object.freeze([
    {projectionRef:ROUTING_INTENT,projection:{project:({ownerScope})=>{
      const intent=routingIntent(snapshot(ownerScope)),handle=options.resolveRoutingIntegrationHandle(intent);
      if(!handle)throw new Error('TMDB Integration is unavailable for Product Identity.');
      const body={...Object.fromEntries(Object.entries(intent).filter(([key])=>!['intentId','intentDigest'].includes(key))),
        integrationId:handle.integrationId,configRevision:handle.configRevision};
      const intentDigest=canonicalDigest(body),intentId=canonicalDigest({schema:'libra.routing-fact-observation-intent-id@1',
        subjectId:body.subjectId,sourceKind:body.sourceKind,intentDigest});
      return Object.freeze({intentId,...body,intentDigest});
    }}},
    {projectionRef:ROUTING_SOURCE,projection:{project:({ownerScope})=>{
      const intent=routingIntent(snapshot(ownerScope)),handle=options.resolveRoutingIntegrationHandle(intent);
      if(!handle)throw new Error('TMDB Integration is unavailable for Product Identity.');
      return handle;
    }}},
    {projectionRef:IDENTITY_CLAIM,projection:{project:({ownerScope})=>snapshot(ownerScope).candidateIdentityClaim}},
    {projectionRef:PRODUCT_STRUCTURE,projection:{project:({ownerScope})=>productStructure(snapshot(ownerScope))}},
    {projectionRef:IDENTITY_HANDLE,projection:{project:({ownerScope,parameters})=>{
      const value=snapshot(ownerScope),results=options.workResultReader.read(parameters.sourceWorkId),source=results.find((item)=>
        item.outcomeKind==='succeeded'&&item.capabilityRef===ROUTING_FACT);
      if(!source)throw new Error('Provider identity Observation is unavailable for Product Fact Handle.');
      const evidence=decisionEvidence(source.result,value),prior=options.movieProductionReader.readFact(value.run.libraRunId,'resolved_identity',1);
      return buildProductIdentityCommitBundle({libraRunId:value.run.libraRunId,snapshot:value,
        identityClaim:value.candidateIdentityClaim,decisionEvidence:evidence,productStructure:productStructure(value),
        sourceResultItem:source,expectedRevision:prior?prior.factRevision:0,
        eventFenceDigest:identityCommitFence(parameters.workId,parameters.eventId)}).handle;
    }}},
    {projectionRef:DECISION_EVIDENCE,projection:{project:({parameters})=>{
      const source=options.workResultReader.read(parameters.sourceWorkId).find((item)=>
        item.outcomeKind==='succeeded'&&item.capabilityRef===ROUTING_FACT);
      if(!source)throw new Error('Provider identity Observation is unavailable for Decision Evidence.');
      return decisionEvidence(source.result,readRunSnapshot(options.movieProductionReader,parameters.libraRunId));
    }}},
  ].map(Object.freeze));
}

function createProductMetadataObservationPlanner(options) {
  const catalogDigest = executionCatalogDigest(options.registry, options.policyRegistry);
  return Object.freeze({
    plannerContractRef: 'helix://libra/planners/ProductMetadataObservation/v1',
    plannerVersion: 1,
    plan(request) {
      const snapshot = readRunSnapshot(options.movieProductionReader,
        request.processId);
      const identity = options.movieProductionReader.readFact(
        request.processId, 'resolved_identity', 1);
      if (!snapshot || !identity) {
        throw new Error('Product Metadata requires a resolved Product Identity.');
      }
      if (snapshot.run.executionBasisDigest !== request.executionBasisDigest) {
        throw new Error('Product Metadata planning basis changed.');
      }
      const stage = nextMetadataStage(options, snapshot, identity);
      if (stage.kind === 'unavailable') {
        return Object.freeze({
          schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1',
          schemaVersion: 1,
          planId: stable('libra-product-metadata-plan-', { attempt:request.workAttemptId }),
          workAttemptId: request.workAttemptId,
          ownerDomain: 'libra',
          plannerContractRef: this.plannerContractRef,
          plannerVersion: 1,
          workObjectiveTypeRef: 'helix://libra/work/product-metadata-observation/v1',
          workObjectiveVersion: 1,
          executionBasisDigest: request.executionBasisDigest,
          capabilityCatalogDigest: catalogDigest,
          resolution: 'temporarily_unplannable',
          diagnosticClassification: stage.reasonCode,
          nodes: Object.freeze([]),
        });
      }
      if (stage.kind !== 'source') {
        throw new Error('Product Metadata Work cannot be planned after the source stage is terminal.');
      }
      const work = metadataObservationWork(snapshot, stage.source);
      if (request.workId !== work.workId) {
        throw new Error('Product Metadata source Work identity changed before planning.');
      }
      const eventId = stable('libra-product-metadata-event-', {
        workAttemptId: request.workAttemptId,
        intentDigest: stage.source.intent.intentDigest,
      });
      const parameters = Object.freeze({ intent:stage.source.intent });
      const nodes = [planNode({
        ...options,
        request,
        nodeId: 'metadata_source',
        eventId,
        capabilityRef: METADATA,
        inputBindings: [
          owner('metadataFetchIntent', request, METADATA_INTENT, parameters),
          owner('physicalMaterialReadHandleOrIntegrationHandle', request,
            METADATA_SOURCE, parameters),
        ],
        resourceKinds: ['disk_io', 'network'],
      })];
      return Object.freeze({
        schemaRef: 'helix://foundation/types/WorkflowPlanDefinition/v1',
        schemaVersion: 1,
        planId: stable('libra-product-metadata-plan-', { attempt:request.workAttemptId }),
        workAttemptId: request.workAttemptId,
        ownerDomain: 'libra',
        plannerContractRef: this.plannerContractRef,
        plannerVersion: 1,
        workObjectiveTypeRef: work.workObjectiveTypeRef,
        workObjectiveVersion: 1,
        executionBasisDigest: request.executionBasisDigest,
        capabilityCatalogDigest: catalogDigest,
        resolution: 'planned',
        diagnosticClassification: null,
        nodes: Object.freeze(nodes),
      });
    },
  });
}

function createProductMetadataObservationProjections(options) {
  function intent(parameters) {
    return buildMetadataFetchIntent(parameters?.intent);
  }
  return Object.freeze([
    Object.freeze({ projectionRef:METADATA_INTENT, projection:Object.freeze({
      project:({parameters}) => intent(parameters),
    }) }),
    Object.freeze({ projectionRef:METADATA_SOURCE, projection:Object.freeze({
      project:({ownerScope,parameters}) => {
        const frozenIntent = intent(parameters);
        if (frozenIntent.sourceKind === 'provider') {
          return options.productProductionPort.resolveIntegrationHandle({
            intent:frozenIntent, operationId:METADATA });
        }
        const snapshot = readRunSnapshot(options.movieProductionReader,ownerScope.processId);
        const reference = snapshot.relatedReferences.find((item) =>
          item.referenceId === frozenIntent.relatedReferenceId &&
          item.referenceDigest === frozenIntent.relatedReferenceDigest);
        if (!reference ||
            reference.identity.contentFingerprint !== frozenIntent.expectedChecksum) {
          throw new Error('Product Metadata NFO reference changed after planning.');
        }
        return options.productProductionPort.issuePhysicalReadHandle({
          libraRunId: snapshot.run.libraRunId,
          runExecutionBasisDigest: snapshot.run.executionBasisDigest,
          runCreatedAtMs: snapshot.run.createdAtMs,
          physicalIdentity: reference.identity,
          sizeBytes: reference.identity.sizeBytes,
          endpointId: reference.endpointId,
          location: reference.location,
          bindingRevision: 1,
          mountScopeRevision: 1,
        });
      },
    }) }),
  ]);
}

function artifactRequirement(kind) {
  const value={requirementId:'',revision:1,
    schemaRef:kind==='nfo'?'shelfdeck.product-artifact.nfo-renderable@1':'shelfdeck.product-artifact.image-decodable@1',
    artifactKind:kind,requirementPayload:Object.freeze({mediaType:kind==='nfo'?'application/xml':'image/jpeg'}),
    requirementDigest:''};
  value.requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',revision:value.revision,
    schemaRef:value.schemaRef,artifactKind:value.artifactKind,requirementPayload:value.requirementPayload});
  value.requirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:value.requirementDigest});
  return Object.freeze(value);
}

function resolvedMetadataInputs(options, source, snapshot) {
  if(source.kind==='provider')return Object.freeze({metadataFetchIntent:source.intent,
    physicalMaterialReadHandleOrIntegrationHandle:options.productProductionPort.resolveIntegrationHandle({
      intent:source.intent,operationId:METADATA})});
  const reference=source.reference;
  return Object.freeze({metadataFetchIntent:source.intent,
    physicalMaterialReadHandleOrIntegrationHandle:options.productProductionPort.issuePhysicalReadHandle({
      libraRunId:snapshot.run.libraRunId,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
      runCreatedAtMs:snapshot.run.createdAtMs,physicalIdentity:reference.identity,sizeBytes:reference.identity.sizeBytes,
      endpointId:reference.endpointId,location:reference.location,bindingRevision:1,mountScopeRevision:1})});
}

function productMetadataContext(options, libraRunId) {
  const snapshot=readRunSnapshot(options.movieProductionReader,libraRunId);
  const identity=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1);
  if(!snapshot||!identity)throw new Error('Product Metadata requires a resolved Product Identity.');
  const works=options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,
    workKind:'product_metadata_observation'}).filter((item)=>item.state==='succeeded')
    .sort((left,right)=>Buffer.from(left.work_id).compare(Buffer.from(right.work_id)));
  if(!works.length)throw new Error('Product Metadata Work is not terminal.');
  const sources=[];
  const results=works.flatMap((work)=>options.workResultReader.read(work.work_id)
    .filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===METADATA)
    .map((item)=>{
      const binding=(item.inputBindings?.bindings||[]).find((candidate)=>
        candidate.portName==='metadataFetchIntent');
      const frozenIntent=buildMetadataFetchIntent(binding?.parameters?.intent);
      if(frozenIntent.intentDigest!==item.result?.fetchIntentDigest)
        throw new Error('Product Metadata Result does not match its frozen Plan Intent.');
      const source=frozenIntent.sourceKind==='provider'
        ?Object.freeze({kind:'provider',intent:frozenIntent})
        :Object.freeze({kind:'related_nfo',intent:frozenIntent,
          reference:snapshot.relatedReferences.find((reference)=>
            reference.referenceId===frozenIntent.relatedReferenceId&&
            reference.referenceDigest===frozenIntent.relatedReferenceDigest)});
      if(source.kind==='related_nfo'&&!source.reference)
        throw new Error('Product Metadata NFO source is absent from the frozen Run snapshot.');
      sources.push(source);
      const resolvedInputs=resolvedMetadataInputs(options,source,snapshot);
      if(item.inputSnapshotDigest&&item.inputSnapshotDigest!==canonicalDigest(resolvedInputs))
        throw new Error('Product Metadata execution input snapshot changed.');
      return Object.freeze({...item,ownerDomain:'libra',processType:'libra_run',processId:libraRunId,
        workKind:'product_metadata_observation',workState:'succeeded',attemptState:'succeeded',planState:'planned',
        eventState:item.state,eventOwnerDomain:'libra',attemptWorkId:work.work_id,planAttemptId:item.attemptId,
        eventWorkId:work.work_id,eventAttemptId:item.attemptId,eventPlanId:item.planId,eventResultId:item.resultId,
        nodeCapabilityRef:item.capabilityRef,planInputBindings:item.inputBindings,resolvedInputs});
    }));
  sources.sort((left,right)=>left.intent.sourcePriority-right.intent.sourcePriority);
  const basis=buildMetadataObservationBasis({intents:sources.map((item)=>item.intent),results,
    factKind:'product_metadata',expectedRevision:0});
  const requirements=[...snapshot.spec.requirements.metadata.requiredArtifactKinds].map(artifactRequirement)
    .sort((left,right)=>Buffer.from(left.artifactKind).compare(Buffer.from(right.artifactKind))||
      Buffer.from(left.requirementId).compare(Buffer.from(right.requirementId)));
  const requiredFields=requiredMetadataFields(snapshot);
  const draftResult=buildProductMetadataDraft({sourceBasis:basis,requiredFields,
    producedAtMs:Math.max(...basis.observationSet.observations.map((item)=>item.observedAtMs)),
    providerIdentities:identity.factValue.providerIdentities,artifactRequirements:requirements});
  if(!draftResult.ready)throw new Error('Product Metadata remains unresolved: '+draftResult.missingFields.join(','));
  return Object.freeze({snapshot,identity,sources:Object.freeze(sources),workIds:Object.freeze(works.map((item)=>item.work_id)),
    results:Object.freeze(results),basis,draft:draftResult.draft,
    requirements:Object.freeze(requirements)});
}

function artifactVerificationContext(options, libraRunId) {
  const metadata=productMetadataContext(options,libraRunId);
  const works=options.workResultReader.listWorks({ownerDomain:'libra',processType:'libra_run',processId:libraRunId,
    workKind:'artifact_production'}).filter((item)=>item.state==='succeeded')
    .sort((left,right)=>Buffer.from(left.work_id).compare(Buffer.from(right.work_id)));
  const work=works[0];
  if(!work)throw new Error('Artifact Production Work is not terminal.');
  const all=options.workResultReader.read(work.work_id);
  const verificationItems=all.filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===ARTIFACT_VERIFY)
    .map((item)=>{
      const binding=(item.inputBindings?.bindings||[]).find((candidate)=>candidate.portName==='artifactHandleList');
      const producer=binding&&all.find((candidate)=>candidate.eventId===binding.eventId&&candidate.outcomeKind==='succeeded');
      const artifact=producer?.result?.schemaRef==='helix://contracts/types/ArtifactAcquisitionResult/v1'
        ?producer.result.artifactHandle:producer?.result;
      const verification=item.result,requirement=verification?.requirement;
      if(!artifact||!verification||verification.result!=='passed'||!requirement||artifact.artifactKind!==requirement.artifactKind)
        throw new Error('Artifact Verification Result lacks its exact producer or requirement.');
      const resolvedInputs=Object.freeze({artifactHandleList:Object.freeze([artifact]),artifactRequirement:requirement});
      if(!item.inputSnapshotDigest||item.inputSnapshotDigest!==canonicalDigest(resolvedInputs))
        throw new Error('Artifact Verification execution input snapshot changed.');
      const resultRef=Object.freeze({workId:item.workId,attemptId:item.attemptId,planId:item.planId,eventId:item.eventId,
        resultId:item.resultId,capabilityRef:item.capabilityRef,
        resultSchemaRef:'helix://contracts/types/ArtifactManifestVerification/v1',
        resultDigest:item.resultDigest,inputBindingDigest:item.inputBindingDigest});
      const value={ordinal:0,artifactHandleId:artifact.artifactHandleId,artifactKind:artifact.artifactKind,
        artifactRevision:artifact.referenceRevision,artifactDigest:artifact.digestHex,requirementId:requirement.requirementId,
        requirementRevision:requirement.revision,requirementSchemaRef:requirement.schemaRef,
        requirementDigest:requirement.requirementDigest,verificationEvidenceId:verification.verificationId,
        verificationEvidenceDigest:verification.verificationDigest,verificationResultRef:resultRef};
      return Object.freeze({...value,referenceDigest:canonicalDigest(value)});
    }).sort((left,right)=>Buffer.from(left.artifactKind).compare(Buffer.from(right.artifactKind))||
      Buffer.from(left.artifactHandleId).compare(Buffer.from(right.artifactHandleId)));
  const canonicalItems=verificationItems.map((item,ordinal)=>{const value={...Object.fromEntries(
    Object.entries(item).filter(([key])=>key!=='referenceDigest')),ordinal};
    return Object.freeze({...value,referenceDigest:canonicalDigest(value)});});
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:canonicalItems});
  const manifest={manifestId:canonicalDigest({schema:'libra.verified-artifact-manifest-id@1',libraRunId,artifactSetDigest}),
    libraRunId,items:Object.freeze(canonicalItems),artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  if(canonicalItems.length!==metadata.requirements.length)throw new Error('Verified Artifact Manifest is incomplete.');
  const artifactMaterials=canonicalItems.map((verifiedManifestItem)=>{
    const verificationItem=all.find((item)=>item.resultId===verifiedManifestItem.verificationResultRef.resultId);
    const binding=(verificationItem?.inputBindings?.bindings||[]).find((candidate)=>candidate.portName==='artifactHandleList');
    const producer=binding&&all.find((candidate)=>candidate.eventId===binding.eventId&&candidate.outcomeKind==='succeeded');
    const artifactHandle=producer?.result?.schemaRef==='helix://contracts/types/ArtifactAcquisitionResult/v1'
      ?producer.result.artifactHandle:producer?.result;
    if(!artifactHandle||!verificationItem?.result)throw new Error('Verified Artifact material cannot be reconstructed.');
    return Object.freeze({artifactHandle,requirement:verificationItem.result.requirement,
      verification:verificationItem.result,verifiedManifestItem});
  });
  return Object.freeze({...metadata,artifactWorkId:work.work_id,verifiedArtifactManifest:Object.freeze(manifest),
    artifactMaterials:Object.freeze(artifactMaterials)});
}

function mediaCastRelations(context) {
  const relations=[];
  for(const observation of context.basis.observationSet.observations)for(const hint of observation.peopleHints||[]){
    const seed={subjectId:context.snapshot.run.subjectId,role:hint.role,displayName:hint.displayName,
      providerIdentities:hint.providerIdentities||[],originEvidenceDigest:observation.payloadDigest};
    relations.push({relationId:stable('libra-media-cast-relation-',seed),personId:null,displayName:hint.displayName,
      displayNameNormalized:hint.displayName.normalize('NFKC').toLowerCase(),role:hint.role,source:observation.sourceRef,
      providerIdentities:Object.freeze([...(hint.providerIdentities||[])]),originEvidenceDigest:observation.payloadDigest,
      confidenceClass:'provider_asserted'});
  }
  return Object.freeze(relations.sort((left,right)=>Buffer.from(left.role).compare(Buffer.from(right.role))||
    Buffer.from(left.displayNameNormalized).compare(Buffer.from(right.displayNameNormalized))||
    Buffer.from(left.relationId).compare(Buffer.from(right.relationId))));
}

function createProductFactAssemblyPlanner(options) {
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/ProductFactAssembly/v1',plannerVersion:1,plan(request){
    const context=artifactVerificationContext(options,request.processId);
    if(context.snapshot.run.executionBasisDigest!==request.executionBasisDigest)throw new Error('Product Fact planning basis changed.');
    const castResolveEvent=stable('libra-media-cast-resolve-event-',{attempt:request.workAttemptId});
    const castCommitEvent=stable('libra-media-cast-commit-event-',{attempt:request.workAttemptId});
    const metadataCommitEvent=stable('libra-product-metadata-commit-event-',{attempt:request.workAttemptId});
    const nodes=[
      planNode({...options,request,nodeId:'media_cast_resolve',eventId:castResolveEvent,capabilityRef:MEDIA_CAST_RESOLVE,
        inputBindings:[owner('libraMediaCastSourceBasisMetadataObservationOrWesternMatch',request,MEDIA_CAST_BASIS),
          owner('personReferenceProjectionList',request,PERSON_REFERENCE_LIST)],resourceKinds:['cpu','disk_io']}),
      planNode({...options,request,nodeId:'media_cast_commit',eventId:castCommitEvent,capabilityRef:MEDIA_CAST_COMMIT,
        inputBindings:[owner('libraMediaCastSourceBasisMetadataObservationOrWesternMatch',request,MEDIA_CAST_BASIS),
          projected('mediaCastDraft',castResolveEvent,options.registry.resolve(MEDIA_CAST_RESOLVE,'libra').manifest.resultSchemaRef,MEDIA_CAST_DRAFT),
          projected('domainFactCommitHandle',castResolveEvent,options.registry.resolve(MEDIA_CAST_RESOLVE,'libra').manifest.resultSchemaRef,
            MEDIA_CAST_HANDLE,{workId:request.workId,eventId:castCommitEvent,processId:request.processId})],
        dependsOn:[{eventId:castResolveEvent,satisfaction:'success'}],resourceKinds:['disk_io']}),
      planNode({...options,request,nodeId:'product_metadata_commit',eventId:metadataCommitEvent,capabilityRef:METADATA_COMMIT,
        inputBindings:[owner('libraProductMetadataSourceBasisMetadataObservationOrWesternAnalysis',request,METADATA_BASIS),
          owner('productMetadataDraft',request,METADATA_DRAFT),owner('verifiedArtifactManifest',request,VERIFIED_ARTIFACT_MANIFEST),
          owner('mediaCastFactRefProductFactIdFactRevisionFactDigest',request,MEDIA_CAST_FACT_REF),
          owner('domainFactCommitHandle',request,METADATA_HANDLE,{workId:request.workId,eventId:metadataCommitEvent})],
        dependsOn:[{eventId:castCommitEvent,satisfaction:'success'}],resourceKinds:['compute_device','cpu','disk_io']}),
    ];
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:stable('libra-product-fact-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,
      ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:'helix://libra/work/product-fact-assembly/v1',workObjectiveVersion:1,
      executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',
      diagnosticClassification:null,nodes:Object.freeze(nodes)});
  }});
}

function createProductFactAssemblyProjections(options) {
  const context=(ownerScope)=>artifactVerificationContext(options,ownerScope.processId);
  const basis=(ownerScope,factKind)=>buildMetadataObservationBasis({intents:context(ownerScope).sources.map((item)=>item.intent),
    results:context(ownerScope).results,factKind,expectedRevision:0});
  const handle=(ownerScope,parameters,factKind,payload)=>buildProductFactHandle({libraRunId:ownerScope.processId,factKind,
    expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:factCommitFence(parameters.workId,parameters.eventId,factKind)});
  return Object.freeze([
    Object.freeze({projectionRef:MEDIA_CAST_BASIS,projection:Object.freeze({project:({ownerScope})=>basis(ownerScope,'media_cast')})}),
    Object.freeze({projectionRef:METADATA_BASIS,projection:Object.freeze({project:({ownerScope})=>basis(ownerScope,'product_metadata')})}),
    Object.freeze({projectionRef:PERSON_REFERENCE_LIST,projection:Object.freeze({project:()=>Object.freeze([])})}),
    Object.freeze({projectionRef:MEDIA_CAST_DRAFT,projection:Object.freeze({project:({sourceResult})=>sourceResult})}),
    Object.freeze({projectionRef:VERIFIED_ARTIFACT_MANIFEST,projection:Object.freeze({project:({ownerScope})=>context(ownerScope).verifiedArtifactManifest})}),
    Object.freeze({projectionRef:MEDIA_CAST_FACT_REF,projection:Object.freeze({project:({ownerScope})=>{
      const value=options.movieProductionReader.readFact(ownerScope.processId,'media_cast',1);
      if(!value)throw new Error('Media Cast Fact is absent for Product Metadata input projection.');
      return Object.freeze({productFactId:value.productFactId,factRevision:value.factRevision,factDigest:value.factDigest});
    }})}),
    Object.freeze({projectionRef:MEDIA_CAST_HANDLE,projection:Object.freeze({project:({parameters,sourceResult})=>{
      const ownerScope={processId:parameters.processId};
      const sourceBasis=basis(ownerScope,'media_cast');
      return handle(ownerScope,parameters,'media_cast',{sourceBasis,mediaCastDraft:sourceResult});
    }})}),
    Object.freeze({projectionRef:METADATA_HANDLE,projection:Object.freeze({project:({ownerScope,parameters})=>{
      const value=context(ownerScope),sourceBasis=basis(ownerScope,'product_metadata');
      const cast=options.movieProductionReader.readFact(ownerScope.processId,'media_cast',1);
      if(!cast)throw new Error('Media Cast Fact is absent for Product Metadata commit.');
      const mediaCastFactRef={productFactId:cast.productFactId,factRevision:cast.factRevision,factDigest:cast.factDigest};
      return handle(ownerScope,parameters,'product_metadata',{sourceBasis,productMetadataDraft:value.draft,
        verifiedArtifactManifest:value.verifiedArtifactManifest,mediaCastFactRef});
    }})}),
  ]);
}

function artifactProviderIntent(options, context) {
  const provider = context.sources.find((item) => item.kind === 'provider');
  if (provider) return provider.intent;
  const providerIdentity = context.identity.factValue.providerIdentities[0];
  if (!providerIdentity) throw new Error('Provider identity is absent for Artifact acquisition.');
  const seed = {
    libraRunId: context.snapshot.run.libraRunId,
    runExecutionBasisDigest: context.snapshot.run.executionBasisDigest,
    sourceKind: 'provider',
    sourcePriority: context.sources.length,
    contentProfile: context.snapshot.spec.contentProfile,
    resolvedIdentityDigest: context.identity.factValue.identityDigest,
    resolvedProviderIdentity: providerIdentity,
    requestedFields: requiredMetadataFields(context.snapshot),
    providerKind: providerIdentity.provider,
    integrationId: providerIdentity.provider + '-main',
    configRevision: 1,
  };
  const resolved = options.productProductionPort.resolveIntegrationHandle({
    intent: buildMetadataFetchIntent(seed), operationId: ARTIFACT_ACQUIRE,
  });
  return buildMetadataFetchIntent({
    ...seed, integrationId: resolved.integrationId, configRevision: resolved.configRevision,
  });
}

function sidecarProfile(context) {
  const contentProfile=context.snapshot.spec.contentProfile;
  const relativePath=contentProfile==='series'?'product/season.nfo':'product/movie.nfo';
  const body={schemaRef:'helix://contracts/domain-types/SidecarProfile/v1',schemaVersion:1,
    profileId:'helix-sidecar-'+(contentProfile==='series'?'series':contentProfile)+'-nfo',revision:1,format:'nfo_xml',
    fileNamePolicyDigest:canonicalDigest({schema:'libra.product-sidecar-filename-policy@1',contentProfile,relativePath}),
    contentSchemaRef:'helix://contracts/records/descriptive-facts/v1',typedParameters:Object.freeze([])};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}

function createArtifactProductionPlanner(options) {
  const catalogDigest=executionCatalogDigest(options.registry,options.policyRegistry);
  return Object.freeze({plannerContractRef:'helix://libra/planners/ArtifactProduction/v1',plannerVersion:1,plan(request){
    const context=productMetadataContext(options,request.processId);
    if(context.snapshot.run.executionBasisDigest!==request.executionBasisDigest)throw new Error('Artifact planning basis changed.');
    const nodes=[];
    for(const [ordinal,requirement] of context.requirements.entries()){
      const producerRef=requirement.artifactKind==='nfo'?SIDECAR_RENDER:ARTIFACT_ACQUIRE;
      const producerEventId=stable('libra-artifact-producer-event-',{attempt:request.workAttemptId,requirementDigest:requirement.requirementDigest});
      const inputBindings=[owner('productMetadataDraft',request,METADATA_DRAFT)];
      if(producerRef===SIDECAR_RENDER)inputBindings.push(owner('sidecarProfile',request,SIDECAR_PROFILE));
      else inputBindings.push(owner('integrationHandle',request,ARTIFACT_INTEGRATION,{artifactKind:requirement.artifactKind}));
      nodes.push(planNode({...options,request,nodeId:'artifact_'+ordinal,eventId:producerEventId,capabilityRef:producerRef,
        inputBindings,parameters:producerRef===ARTIFACT_ACQUIRE?{artifactKind:requirement.artifactKind}:{},
        resourceKinds:producerRef===ARTIFACT_ACQUIRE?['disk_io','network']:['cpu']}));
      const verifyEventId=stable('libra-artifact-verify-event-',{attempt:request.workAttemptId,requirementDigest:requirement.requirementDigest});
      nodes.push(planNode({...options,request,nodeId:'artifact_verify_'+ordinal,eventId:verifyEventId,capabilityRef:ARTIFACT_VERIFY,
        inputBindings:[projected('artifactHandleList',producerEventId,options.registry.resolve(producerRef,'libra').manifest.resultSchemaRef,
          ARTIFACT_HANDLE_LIST,{artifactKind:requirement.artifactKind}),
        owner('artifactRequirement',request,ARTIFACT_REQUIREMENT,{artifactKind:requirement.artifactKind})],
        dependsOn:[{eventId:producerEventId,satisfaction:'success'}],resourceKinds:['cpu','disk_io']}));
    }
    return Object.freeze({schemaRef:'helix://foundation/types/WorkflowPlanDefinition/v1',schemaVersion:1,
      planId:stable('libra-artifact-production-plan-',{attempt:request.workAttemptId}),workAttemptId:request.workAttemptId,
      ownerDomain:'libra',plannerContractRef:this.plannerContractRef,plannerVersion:1,
      workObjectiveTypeRef:'helix://libra/work/artifact-production/v1',workObjectiveVersion:1,
      executionBasisDigest:request.executionBasisDigest,capabilityCatalogDigest:catalogDigest,resolution:'planned',
      diagnosticClassification:null,nodes:Object.freeze(nodes)});
  }});
}

function createArtifactProductionProjections(options) {
  const context=(ownerScope)=>productMetadataContext(options,ownerScope.processId);
  const requirement=(ownerScope,parameters)=>{
    const item=context(ownerScope).requirements.find((candidate)=>candidate.artifactKind===parameters.artifactKind);
    if(!item)throw new Error('Artifact Requirement is absent.');
    return item;
  };
  return Object.freeze([
    Object.freeze({projectionRef:METADATA_DRAFT,projection:Object.freeze({project:({ownerScope})=>context(ownerScope).draft})}),
    Object.freeze({projectionRef:SIDECAR_PROFILE,projection:Object.freeze({project:({ownerScope})=>sidecarProfile(context(ownerScope))})}),
    Object.freeze({projectionRef:ARTIFACT_REQUIREMENT,projection:Object.freeze({project:({ownerScope,parameters})=>requirement(ownerScope,parameters)})}),
    Object.freeze({projectionRef:ARTIFACT_INTEGRATION,projection:Object.freeze({project:({ownerScope,parameters})=>{
      const value=context(ownerScope);
      return options.productProductionPort.resolveIntegrationHandle({
        intent:artifactProviderIntent(options,value),operationId:ARTIFACT_ACQUIRE,
        artifactKind:parameters.artifactKind});
    }})}),
    Object.freeze({projectionRef:ARTIFACT_HANDLE_LIST,projection:Object.freeze({project:({sourceResult,parameters})=>{
      const handle=sourceResult?.schemaRef==='helix://contracts/types/ArtifactAcquisitionResult/v1'
        ?sourceResult.artifactHandle:sourceResult;
      if(!handle||handle.artifactKind!==parameters.artifactKind)throw new Error('Required Product Artifact is unavailable.');
      return Object.freeze([handle]);
    }})}),
  ]);
}

module.exports=Object.freeze({DECISION_EVIDENCE,IDENTITY_CLAIM,IDENTITY_HANDLE,PRODUCT_STRUCTURE,ROUTING_INTENT,ROUTING_SOURCE,
  METADATA_INTENT,METADATA_SOURCE,METADATA_DRAFT,ARTIFACT_INTEGRATION,SIDECAR_PROFILE,ARTIFACT_REQUIREMENT,ARTIFACT_HANDLE_LIST,
  createProductIdentityPlanner,createProductIdentityProjections,
  createProductMetadataObservationPlanner,createProductMetadataObservationProjections,decisionEvidence,identityCommitFence,
  createArtifactProductionPlanner,createArtifactProductionProjections,artifactRequirement,productMetadataContext,
  artifactVerificationContext,createProductFactAssemblyPlanner,createProductFactAssemblyProjections,factCommitFence,mediaCastRelations,
  productStructure,sidecarProfile});
