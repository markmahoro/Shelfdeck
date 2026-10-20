'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {originalFromIdentity}=require('./us-adult-identity-evidence');
const {buildActorSelection,selectedPerson,selectedAsset}=require('./us-adult-actor-selection');
const {frameWork,exactResult,FRAME,EMBED,CLUSTER,resultRef}=require('./us-adult-analysis-work');
const {artifactRequirement}=require('../../../contracts/product-artifact-requirement');
const REQUEST='libra.western.analysis.request@1',OBSERVE='libra.western.analysis.observe@1',NORMALIZE='libra.western.metadata.normalize@1',POSTER='libra.western.poster.render@1';
function readActorContext(options,libraRunId){
  const snapshot=options.movieProductionReader.readRunSnapshot(libraRunId),identity=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1),
    basis=options.usAdultAnalysisStore.getByRun(libraRunId);
  if(!snapshot||!identity||!basis)throw new Error('US Adult product requires its formal Run, Identity and analysis Basis.');
  const selection=buildActorSelection({snapshot,analysisBasis:basis,resolvedIdentityDigest:identity.factValue.identityDigest,
    actorChoiceRecord:options.usAdultActorChoiceStore.current(snapshot.run.subjectId),
    matchCompletion:options.usAdultMatchCompletionStore.getByRun(libraRunId)});
  if(!selection)return Object.freeze({snapshot,identity,basis,selection:null});
  const person=selectedPerson(selection),asset=selectedAsset(selection),originalName=originalFromIdentity(identity.factValue),
    internal=identity.factValue.providerIdentities.filter(item=>item.provider==='internal'&&item.namespace==='internal_identity');
  if(internal.length!==1)throw new Error('US Adult product requires one exact internal Subject identity.');
  const actorPresentation=Object.freeze({libraryKind:'us_adult',personId:person.personId,personRevision:person.personRevision,
    canonicalName:person.canonicalName,referenceAssetId:asset.referenceAssetId,artifactHandleId:asset.artifactHandleId,
    artifactDigest:asset.artifactDigest,originalName,internalIdentity:internal[0].providerKey,actorSelectionDigest:selection.selectionDigest});
  return Object.freeze({snapshot,identity,basis,selection,actorPresentation});
}
function productWork(context,stage){
  if(!context.selection||!['analysis','normalize'].includes(stage))throw new TypeError('US Adult product Work requires a selected actor and exact stage.');
  const {snapshot,basis,selection}=context,scope={schema:'libra.us-adult-product-work@1',libraRunId:basis.libraRunId,
    basisDigest:basis.basisDigest,selectionDigest:selection.selectionDigest,stage},digest=canonicalDigest(scope),
    dependency=stage==='analysis'?frameWork(snapshot,basis):productWork(context,'analysis');
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:'libra-us-adult-'+stage+'-work-'+digest,ownerDomain:'libra',processType:'libra_run',processId:basis.libraRunId,
    workKind:'us_adult_product',workObjectiveTypeRef:'helix://libra/work/us-adult-'+stage+'/v1',workObjectiveVersion:1,
    executionBasisId:'libra-us-adult-product-basis-'+digest,executionBasisDigest:basis.runExecutionBasisDigest,
    dependencyRefs:Object.freeze([{ownerDomain:'libra',objectType:'supporting_work',objectId:dependency.workId,revision:1,digest:dependency.executionBasisDigest}]),
    priorityClass:snapshot.run.priorityClass==='expedited'?'expedited_formation':'normal_foreground',priorityRevision:snapshot.run.priorityRevision||1,
    capabilityCatalogScope:'libra',workspaceMaterialScope:Object.freeze([]),idempotencyKey:'libra-us-adult-product-key-'+digest,
    concurrencyScope:basis.libraRunId+'/us-adult-product/'+stage,outputContractRef:resultRef(stage==='analysis'?OBSERVE:NORMALIZE)});
}
function frameInputs(options,context){
  const work=frameWork(context.snapshot,context.basis);
  return Object.freeze({frameArtifactSet:exactResult(options,work,FRAME).result,faceEmbeddingSetHandle:exactResult(options,work,EMBED).result,
    faceClusterSetHandle:exactResult(options,work,CLUSTER).result});
}
function analysisSpec(context,frames){
  const {basis,actorPresentation:actor}=context,parameters={actor_name:actor.canonicalName,actor_selection_digest:actor.actorSelectionDigest,
    internal_identity:actor.internalIdentity,original_file_name:actor.originalName.originalFileName},
    typedParameters=Object.entries(parameters).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))).map(([parameter,value])=>{
      const item={parameter,valueType:'string',value};return Object.freeze({...item,valueDigest:canonicalDigest(item)});
    }),outputContractDigest=canonicalDigest({schemaRef:'helix://contracts/types/WesternAnalysisResult/v1',schemaVersion:1}),
    specId=canonicalDigest({schema:'libra.us-adult-analysis-spec-id@1',analysisId:basis.analysisId,selectionDigest:context.selection.selectionDigest}),
    value={specId,revision:1,schemaRef:'helix://contracts/domain-types/AnalysisSpec/v1',libraRunId:basis.libraRunId,
      runExecutionBasisDigest:basis.runExecutionBasisDigest,contentProfile:'western_adult',sourceMaterialDigest:canonicalDigest(basis.sourceHandle),
      frameArtifactSetDigest:frames.frameArtifactSet.manifestDigest,faceModelRefDigest:basis.faceModelRef.digest,
      clusterParameterDigest:basis.clusterParameters.digest,analysisVariantRef:'shelfdeck.us-adult-single-actor@1',
      outputContractRef:'helix://contracts/types/WesternAnalysisResult/v1',outputContractDigest,typedParameters:Object.freeze(typedParameters)};
  return Object.freeze({...value,specDigest:canonicalDigest(value)});
}
function analysisTarget(context,inputs,workspace,rootSnapshot){
  const {basis}=context,sourceInputDigest=canonicalDigest(inputs),targetRelativePath='analysis/results/'+sourceInputDigest+'.json',outputKind='western_analysis',
    targetId=canonicalDigest({schema:'libra.workspace-artifact-output-target-id@1',workspaceId:basis.workspaceId,targetRelativePath,outputKind,sourceInputDigest}),
    value={targetId,libraRunId:basis.libraRunId,executionBasisDigest:basis.runExecutionBasisDigest,workspaceId:basis.workspaceId,
      expectedWorkspaceRevision:workspace.currentRevision,expectedWorkspaceStateDigest:workspace.stateDigest,rootSnapshot,
      workspaceScopeDigest:workspace.workspaceScopeDigest,targetRelativePath,outputKind,sourceInputDigest};
  if(workspace.state!=='active'||workspace.libraRunId!==basis.libraRunId||workspace.workspaceId!==basis.workspaceId)
    throw new Error('US Adult product output requires its exact active Workspace.');
  const effectScopeDigest=canonicalDigest({schema:'libra.workspace-artifact-output-effect-scope@1',targetId,libraRunId:value.libraRunId,
    executionBasisDigest:value.executionBasisDigest,workspaceId:value.workspaceId,expectedWorkspaceRevision:value.expectedWorkspaceRevision,
    expectedWorkspaceStateDigest:value.expectedWorkspaceStateDigest,rootSnapshotDigest:rootSnapshot.snapshotDigest,
    workspaceScopeDigest:value.workspaceScopeDigest,outputKind,sourceInputDigest}),target={...value,effectScopeDigest};
  return Object.freeze({...target,targetDigest:canonicalDigest(target)});
}
function analysisVariant(context,record){
  if(record.workId!==productWork(context,'analysis').workId||record.capabilityRef!==OBSERVE||record.outcomeKind!=='succeeded'||
    record.resultDigest!==canonicalDigest(record.result))throw new Error('US Adult metadata requires its exact successful Analysis Result.');
  const analysisResults=Object.freeze([{eventId:record.eventId,resultId:record.resultId,resultDigest:record.resultDigest,result:record.result}]),
    value={libraRunId:context.basis.libraRunId,runExecutionBasisDigest:context.basis.runExecutionBasisDigest,
      resolvedIdentityDigest:context.identity.factValue.identityDigest,analysisResults},variantDigest=canonicalDigest(value),
    variantId=canonicalDigest({schema:'libra.western-analysis-variant-id@1',libraRunId:value.libraRunId,
      runExecutionBasisDigest:value.runExecutionBasisDigest,resolvedIdentityDigest:value.resolvedIdentityDigest,variantDigest});
  return Object.freeze({variantId,...value,variantDigest});
}
function metadataBasis(context,analysis,normalized,variant){
  const ref=record=>({workId:record.workId,attemptId:record.attemptId,planId:record.planId,eventId:record.eventId,resultId:record.resultId,
    resultDigest:record.resultDigest,inputBindingDigest:record.inputBindingDigest}),
    analysisRefs=Object.freeze([{...ref(analysis),analysisArtifactHandleId:analysis.result.resultArtifactHandle.artifactHandleId,
      analysisArtifactDigest:analysis.result.resultArtifactHandle.digestHex,evidenceId:analysis.result.evidenceId,evidenceDigest:analysis.result.payloadDigest}]),
    normalizeRef=Object.freeze({...ref(normalized),analysisVariantId:variant.variantId,productMetadataDraftDigest:normalized.result.draftDigest}),
    items=[...analysisRefs.map((item,ordinal)=>({ordinal,...ref(item),capabilityRef:OBSERVE,resultSchemaRef:resultRef(OBSERVE),sourceRef:item.analysisArtifactHandleId,sourceOrder:ordinal,
      evidenceId:item.evidenceId,evidenceDigest:item.evidenceDigest})),{ordinal:1,...ref(normalizeRef),capabilityRef:NORMALIZE,resultSchemaRef:resultRef(NORMALIZE),sourceRef:variant.variantId,sourceOrder:1,evidenceId:null,evidenceDigest:null}],
    sourceRefsDigest=canonicalDigest({schema:'libra.western-product-metadata-source-refs@1',items}),
    value={basisId:canonicalDigest({schema:'libra.western-product-metadata-basis-id@1',libraRunId:context.basis.libraRunId,
      runExecutionBasisDigest:context.basis.runExecutionBasisDigest,sourceRefsDigest}),basisKind:'western_analysis',libraRunId:context.basis.libraRunId,
      runExecutionBasisDigest:context.basis.runExecutionBasisDigest,resolvedIdentityDigest:context.identity.factValue.identityDigest,
      analysisVariantDigest:variant.variantDigest,analysisRefs,normalizeRef,sourceRefsDigest},basis={...value,basisDigest:canonicalDigest(value)};
  return Object.freeze({sourceBasisKind:'western_analysis',westernBasis:Object.freeze(basis),sourceBasisDigest:basis.basisDigest});
}
function assertSame(value,expected,message){if(canonicalJson(value)!==canonicalJson(expected))throw new Error(message);}
function productRequirements(snapshot){
  const waived=new Set((snapshot.run.authorizedDefectManifest?.defects||[]).flatMap(item=>item.metadataFieldCodes||[])),
    waivedKinds=new Set((snapshot.run.authorizedDefectManifest?.defects||[]).flatMap(item=>item.artifactKindCodes||[])),
    requiredFields=Object.freeze([...snapshot.spec.requirements.metadata.requiredFieldCodes].filter(item=>item!=='actor'&&!waived.has(item)).sort()),
    requirements=Object.freeze(require('../../../contracts/artifact-requirement-gaps').requiredArtifactKinds(snapshot.spec.requirements)
      .filter(kind=>!waivedKinds.has(kind)).map(kind=>artifactRequirement(kind))
      .sort((a,b)=>Buffer.compare(Buffer.from(a.artifactKind),Buffer.from(b.artifactKind))||Buffer.compare(Buffer.from(a.requirementId),Buffer.from(b.requirementId))));
  return Object.freeze({requiredFields,requirements});
}
function readUsAdultMetadataContext(options,libraRunId){
  const context=readActorContext(options,libraRunId),analysisWork=productWork(context,'analysis'),normalizeWork=productWork(context,'normalize');
  if(options.workResultReader.status(analysisWork.workId)?.state!=='succeeded'||options.workResultReader.status(normalizeWork.workId)?.state!=='succeeded')
    throw new Error('US Adult metadata requires complete terminal product Works.');
  const analysis=exactResult(options,analysisWork,OBSERVE),normalized=exactResult(options,normalizeWork,NORMALIZE),variant=analysisVariant(context,analysis),
    binding=normalized.inputBindings?.bindings?.find(item=>item.portName==='westernAnalysisVariant'&&item.bindingKind==='literal'),
    {requiredFields,requirements}=productRequirements(context.snapshot);
  assertSame(binding?.value,variant,'US Adult metadata Normalize Plan changed its Analysis Variant.');
  if(normalized.result.westernAnalysisVariantDigest!==variant.variantDigest||normalized.result.resolvedIdentityDigest!==context.identity.factValue.identityDigest)
    throw new Error('US Adult metadata Result differs from its exact Analysis or Identity.');
  assertSame(normalized.result.artifactRequirements,requirements,'US Adult metadata artifact requirements changed.');
  if(requiredFields.some(field=>!normalized.result.descriptiveFacts.entries.some(item=>item.key===field&&item.value!==null&&item.value!=='')))
    throw new Error('US Adult metadata Result is missing a mandatory field.');
  const actorBasis=Object.freeze({sourceBasisKind:'us_adult_actor',actorSelection:context.selection,sourceBasisDigest:context.selection.selectionDigest});
  return Object.freeze({...context,sources:Object.freeze([]),workIds:Object.freeze([analysisWork.workId,normalizeWork.workId]),
    results:Object.freeze([analysis,normalized]),basis:metadataBasis(context,analysis,normalized,variant),analysisBasis:context.basis,
    draft:normalized.result,requirements,actorBasis,episodeDrafts:Object.freeze([]),readEpisodeDraft(){throw new Error('US Adult has no Episode metadata.');}});
}
function artifactWorkIdentity(snapshot,workspaceId,artifactKinds,selection=null){
  const value={libraRunId:snapshot.run.libraRunId,executionBasisDigest:snapshot.run.executionBasisDigest,workspaceId,
    artifactRequirementDigest:canonicalDigest({schema:'libra.artifact-requirement-set@1',items:artifactKinds}),
    ...(selection?{actorSelectionDigest:selection.selectionDigest}:{})};
  return Object.freeze({basis:value,workId:'libra-artifact-production-work-'+canonicalDigest(value).slice(0,40)});
}
module.exports=Object.freeze({REQUEST,OBSERVE,NORMALIZE,POSTER,readActorContext,productWork,frameInputs,analysisSpec,analysisTarget,analysisVariant,
  metadataBasis,assertSame,productRequirements,readUsAdultMetadataContext,artifactWorkIdentity});
