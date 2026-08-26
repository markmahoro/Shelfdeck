'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { finalGapDecision } = require('../model/acceptance-gap-decision');
const { P } = require('./on-deck-planners');
const { deriveAcceptedResponsibility } = require('../model/acceptance-responsibility');
const { DEFAULT_SHELF_PLACEMENT_POLICY } = require('../model/shelf-placement-policy-contracts');
const { requiresInputSettlement } = require('../model/offload-settlement');
const {
  ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS,
} = require('../model/mandatory-media-acceptance');

const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);
function typed(parameter, value) { return Object.freeze({ parameter,
  valueType:typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value,
  value, valueDigest:canonicalDigest({ parameter, value }) }); }
function contextFor(options, ownerScope, parameters, projectionRef) { const deps=parameters?.dependencyRefs||[];
  return ownerScope.processType === 'arca_ondeck_run'
    ? [P.settlementHandles,P.settlementApproval].includes(projectionRef)
      ? options.contextReader.readSettlement(ownerScope.processId,deps,parameters.materialKey)
      : options.contextReader.readAccepted(ownerScope.processId, deps)
    : options.contextReader.readOffer(deps); }
function attemptId(c) { return canonicalDigest({ schema:'arca.acceptance-attempt-id@1', offerId:c.offer.offerId,
  onDeckPackageId:c.offer.onDeckPackageId, packageDigest:c.offer.packageDigest,
  standardRevision:c.shelf.currentStandardRevision, placementRevision:c.shelf.currentPlacementRevision }); }
function withDigest(value) { return Object.freeze({ ...value, digest:canonicalDigest(value) }); }
function acceptanceRequirements(c) { const value=c.packageValue.productionProvenance?.acceptanceRequirementSnapshot;
  const body=value&&Object.fromEntries(Object.entries(value).filter(([key])=>key!=='snapshotDigest')),
    expectedStructure=c.packageValue.productStructureSnapshot?.structureKind==='season'?'season':'single';
  if(!value||value.schemaRef!=='helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1'||value.schemaVersion!==1||
      value.snapshotDigest!==canonicalDigest(body)||value.acceptanceSpecId!==c.packageValue.acceptanceSpecRef?.id||
      value.acceptanceSpecRecordDigest!==c.packageValue.acceptanceSpecRef?.recordDigest||value.targetShelfId!==c.packageValue.shelfId||
      value.structureKind!==expectedStructure||value.contentProfile!==(expectedStructure==='season'?'series':'movie'))
    throw Object.assign(new TypeError('Package Acceptance Requirement Snapshot is invalid.'),{code:'ARCA_ACCEPTANCE_REQUIREMENT_INVALID'});
  return value; }
function standard(c) { const snapshot=acceptanceRequirements(c),parameters=[
  typed('acceptanceRequirementSnapshotDigest',snapshot.snapshotDigest),
  typed('shelfStandardDigest',snapshot.shelfStandardDigest)];
  return withDigest({ schemaRef:'helix://contracts/domain-types/ShelfStandard/v1',schemaVersion:1,
    standardId:c.shelf.shelfId+':standard',revision:snapshot.shelfStandardRevision,shelfId:c.shelf.shelfId,
    contentProfile:snapshot.contentProfile,ruleSetRevision:c.shelf.standard.ruleTemplateRevision||1,
    acceptanceRuleDigest:snapshot.shelfStandardDigest,typedParameters:Object.freeze(parameters) }); }
function packageIdentity(c) { const raw=c.packageValue.resolvedIdentitySnapshot?.factValue?.resolvedProductIdentity||
  c.packageValue.resolvedIdentitySnapshot?.factValue||{}; return withDigest({schemaRef:'helix://contracts/domain-types/PackageIdentity/v1',schemaVersion:1,
    objectId:c.packageValue.onDeckPackageId,revision:c.packageValue.packageRevision,onDeckPackageId:c.packageValue.onDeckPackageId,
    resolvedIdentityDigest:raw.identityDigest||canonicalDigest(raw),packageDigest:c.packageValue.packageDigest}); }
function productManifest(c) { const source=c.packageValue.productMaterialManifest;
  const members=source.members.map((item)=>Object.freeze({objectId:item.materialKey,revision:item.bindingRevision||1,
    schemaRef:'helix://contracts/domain-types/ProductManifestMember/v1',digest:item.memberDigest||canonicalDigest(item),objectKind:'product-material-member'}));
  return withDigest({schemaRef:'helix://contracts/domain-types/ProductManifest/v1',schemaVersion:1,objectId:source.manifestId,revision:source.manifestRevision||1,
    manifestId:source.manifestId,members:Object.freeze(members),manifestDigest:source.manifestDigest}); }
function productMetadata(c) { const facts=(c.packageValue.productFactManifest?.items||[]).filter((item)=>
  ['product_metadata','resolved_identity','media_cast'].includes(item.factKind));
  const metadataFactRefs=facts.map((item)=>item.productFactId);
  const artifactHandles=(c.packageValue.artifactManifest?.items||[]).map((item)=>item.artifactHandle).filter(Boolean);
  const setDigest=canonicalDigest({metadataFactRefs,artifactHandles});return withDigest({schemaRef:'helix://contracts/domain-types/ProductMetadataArtifact/v1',schemaVersion:1,
    objectId:c.packageValue.onDeckPackageId+':metadata',revision:1,subjectId:c.packageValue.subjectId,
    metadataFactRefs:Object.freeze(metadataFactRefs),artifactHandles:Object.freeze(artifactHandles),setDigest}); }
function requirement(schemaRef,id,revision,extra) { return withDigest({schemaRef,schemaVersion:1,requirementId:id,revision,...extra}); }
function requirementParameters(prefix,value){return Object.entries(value||{}).flatMap(([key,item])=>Array.isArray(item)
  ?item.map((entry)=>typed(prefix+'.'+key+'.'+entry,true)):['string','number','boolean'].includes(typeof item)
    ?[typed(prefix+'.'+key,item)]:[]);}
function metadataRequirement(c) { const snapshot=acceptanceRequirements(c),nfo=(c.packageValue.artifactManifest?.items||[]).find((item)=>item.artifactKind==='nfo');
  const requiredFactKeys=(c.packageValue.productFactManifest?.items||[]).filter((item)=>
    ['product_metadata','resolved_identity','media_cast'].includes(item.factKind)).map((item)=>Object.freeze({
      objectId:item.productFactId,revision:item.factRevision,schemaRef:item.schemaRef,digest:item.factDigest,
      objectKind:'required-fact-key',
    }));
  return requirement('helix://contracts/domain-types/MetadataRequirement/v1',c.shelf.shelfId+':metadata',snapshot.shelfStandardRevision,
    {requiredFactKeys:Object.freeze(requiredFactKeys),artifactRequirementDigest:nfo?.requirementDigest||snapshot.snapshotDigest,
      typedParameters:Object.freeze(requirementParameters('metadata',snapshot.requirements.metadata))}); }
function structureRequirement(c) { const snapshot=acceptanceRequirements(c);return requirement(
  'helix://contracts/domain-types/StructureRequirement/v1',c.shelf.shelfId+':structure',snapshot.shelfStandardRevision,{
    structureKind:snapshot.requirements.structure.structureKind,
    memberConstraintDigest:canonicalDigest(snapshot.requirements.structure),
    typedParameters:Object.freeze(requirementParameters('structure',snapshot.requirements.structure))}); }
function mandatoryRequirement(c) { const snapshot=acceptanceRequirements(c),media=snapshot.requirements.mandatoryMedia;
  return requirement('helix://contracts/domain-types/MandatoryRequirement/v1',c.shelf.shelfId+':mandatory',snapshot.shelfStandardRevision,{
    shelfId:c.shelf.shelfId,shelfStandardRevision:snapshot.shelfStandardRevision,shelfStandardDigest:snapshot.shelfStandardDigest,
    contentProfile:snapshot.contentProfile,mediaForm:media.mediaForm,videoCodec:media.videoCodec,container:media.container,
    fileExtension:media.fileExtension,minimumRasterClass:media.minimumRasterClass,
    acceptedPrimaryAudioClasses:Object.freeze([...media.acceptedPrimaryAudioClasses]),maxSizeBytes:snapshot.requirements.space.maxSizeBytes,
    forbidSystemUpscaleFor4k:media.forbidSystemUpscaleFor4k,
    acceptedOutputDynamicRangeKinds:ACCEPTED_OUTPUT_DYNAMIC_RANGE_KINDS,sdrOutputPixelFormat:'yuv420p',
    sdrOutputColorProfile:Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}),
    forbidDolbyVisionMetadataOnSdr:true,decodeSamplePointsPercent:Object.freeze([5,50,95]),requireAllDecodeSamples:true}); }
function spaceRequirement(c) { const snapshot=acceptanceRequirements(c),bytes=c.packageValue.productMaterialManifest.members.reduce((sum,item)=>sum+Number(item.sizeBytes||0),0),
  maximum=snapshot.requirements.space.maxSizeBytes,parameters=[typed('space.hasMaxSize',maximum!==null)];if(maximum!==null)parameters.push(typed('space.maxSizeBytes',maximum));
  return requirement('helix://contracts/domain-types/SpaceRequirement/v1',c.shelf.shelfId+':space',snapshot.shelfStandardRevision,{
    requiredBytes:bytes,reserveBytes:0,typedParameters:Object.freeze(parameters)}); }
function offload(c) { const source=c.packageValue.offloadContextManifest;
  const materials=(source.members||[]).map((item)=>Object.freeze({objectId:item.materialKey,revision:item.bindingRevision||1,
    schemaRef:'helix://contracts/domain-types/OffLoadContextMember/v1',digest:item.memberDigest||canonicalDigest(item),objectKind:'offload-material'}));
  return withDigest({schemaRef:'helix://contracts/domain-types/OffLoadContext/v1',schemaVersion:1,objectId:source.manifestId,revision:source.manifestRevision||1,
    onDeckPackageId:c.packageValue.onDeckPackageId,materials:Object.freeze(materials),contextDigest:source.manifestDigest}); }
function placement(c) { const p=c.shelf.placement, value={...DEFAULT_SHELF_PLACEMENT_POLICY,...p.value}; return withDigest({schemaRef:'helix://contracts/domain-types/PlacementPolicy/v1',schemaVersion:1,
  policyId:c.shelf.shelfId+':placement',revision:p.revision,shelfId:c.shelf.shelfId,targetEndpointIds:Object.freeze([c.shelf.target.endpointId]),minimumFreeBytes:0,
  typedParameters:Object.freeze(['folderTemplate','primaryTemplate','nfoTemplate','subtitleTemplate','posterTemplate','fanartTemplate','collisionPolicy']
    .map((parameter)=>typed(parameter,value[parameter])))}); }
function targetEndpoint(c) { return withDigest({schemaRef:'helix://contracts/domain-types/TargetEndpoint/v1',schemaVersion:1,objectId:c.shelf.target.endpointId,revision:1,
  endpointId:c.shelf.target.endpointId,mountScopeRevision:c.shelf.target.mountScopeRevision,
  capacityObservationDigest:c.feasibility?.payloadDigest||canonicalDigest(c.shelf.target)}); }
function acceptedPayload(options,c) { const assessment=options.contextReader.acceptance.readAssessment(attemptId(c))||{acceptanceAttemptId:attemptId(c),offerId:c.offer.offerId,
  onDeckPackageId:c.offer.onDeckPackageId,packageDigest:c.offer.packageDigest,shelfId:c.shelf.shelfId,
  standardRevision:c.shelf.currentStandardRevision,placementRevision:c.shelf.currentPlacementRevision,checks:[]};
  const responsibility=deriveAcceptedResponsibility(assessment);return withDigest({schemaRef:'helix://contracts/domain-types/AcceptedPayload/v1',schemaVersion:1,
    objectId:c.packageValue.onDeckPackageId,revision:c.packageValue.packageRevision,onDeckProductPackage:c.packageValue,
    acceptanceDecisionId:responsibility.acceptanceDecisionId,custodyDigest:canonicalDigest(responsibility)}); }
function assessmentFacts(options,c) { const rows=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_acceptance',
  processId:c.offer.offerId,workKind:'acceptance_assessment'});if(rows.length!==1)throw new Error('Arca Acceptance Assessment Work is not unique.');
  const values=options.workResultReader.read(rows[0].work_id).filter((item)=>item.outcomeKind==='succeeded').map((item)=>item.result),checks=values.map((value)=>
    value.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'?Object.freeze({kind:value.checkKind,outcome:value.result,evidenceDigest:canonicalDigest(value),reasonCode:value.reasonCodes[0]||null}):
      value.schemaRef==='helix://contracts/types/InventoryFeasibilityEvidence/v1'?Object.freeze({kind:'inventory_feasibility',
        outcome:value.availableBytes>=value.requiredBytes?'passed':'failed',evidenceDigest:value.payloadDigest,reasonCode:'inventory_feasibility_unmet'}):null).filter(Boolean)
    .sort((a,b)=>a.kind.localeCompare(b.kind));if(checks.length!==6)throw new Error('Arca Acceptance Assessment Result set is incomplete.');
  const assessment={acceptanceAttemptId:attemptId(c),offerId:c.offer.offerId,onDeckPackageId:c.offer.onDeckPackageId,packageDigest:c.offer.packageDigest,
    shelfId:c.shelf.shelfId,standardRevision:c.shelf.currentStandardRevision,placementRevision:c.shelf.currentPlacementRevision,
    checks:Object.freeze(checks.map(({kind,outcome,evidenceDigest})=>Object.freeze({kind,outcome,evidenceDigest})))};
  const gapDecision=finalGapDecision({acceptanceChecks:values.filter((value)=>value.schemaRef==='helix://contracts/types/AcceptanceCheck/v1'),acceptanceAttemptId:attemptId(c),
    packageDigest:c.packageValue.packageDigest,standardRevision:c.shelf.currentStandardRevision,
    authorizedDefectManifest:c.packageValue.productionAttestation?.authorizedDefectManifest||null});
  return Object.freeze({...assessment,acceptanceEvidenceSetDigest:canonicalDigest({schema:'arca.acceptance-evidence-set@1',
    acceptanceAttemptId:assessment.acceptanceAttemptId,checks:assessment.checks}),failed:Object.freeze(checks.filter((item)=>item.outcome!=='passed')),gapDecision}); }
function rejectionDecision(options,c) { const assessment=assessmentFacts(options,c);if(!assessment.failed.length)throw new Error('Accepted Handoff B cannot produce a Rejection Decision.');
  const structuredBase={handoffKind:'libra_to_arca',offerId:c.offer.offerId,deliverableId:c.offer.onDeckPackageId,
    rejectionCode:assessment.failed[0].reasonCode||'shelf_acceptance_rejected',acceptanceEvidenceSetDigest:assessment.acceptanceEvidenceSetDigest},
    structuredRejection=Object.freeze({...structuredBase,rejectionDigest:canonicalDigest(structuredBase)}),responsibility=deriveAcceptedResponsibility(assessment),
    base={acceptanceDecisionId:responsibility.acceptanceDecisionId,acceptanceAttemptId:assessment.acceptanceAttemptId,offerId:c.offer.offerId,
      onDeckPackageId:c.offer.onDeckPackageId,packageDigest:c.offer.packageDigest,shelfId:c.shelf.shelfId,standardRevision:c.shelf.currentStandardRevision,
      placementRevision:c.shelf.currentPlacementRevision,acceptanceCheckSetDigest:assessment.gapDecision.acceptanceCheckSetDigest,
      actualGapUnionCodes:assessment.gapDecision.actualGapUnionCodes,actualGapUnionDigest:assessment.gapDecision.actualGapUnionDigest,
      authorizedDefectManifestDigestOrNull:assessment.gapDecision.authorizedDefectManifestDigestOrNull,
      authorizedGapComparison:assessment.gapDecision.authorizedGapComparison,structuredRejection,decidedAtMs:0};return Object.freeze({...base,decisionDigest:canonicalDigest(base)}); }
function rejectionCommitHandle(options,c,eventId) { const decision=rejectionDecision(options,c);return Object.freeze({schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,
  handleId:stable('arca-rejection-commit-',{eventId,decision:decision.acceptanceDecisionId}),ownerDomain:'arca',aggregateType:'acceptance_decision',
  aggregateId:decision.acceptanceDecisionId,factType:'handoff_b_rejection',factSchemaRef:'helix://contracts/domain-types/ArcaAcceptanceRejectionDecision/v1',
  expectedRevision:0,payloadDigest:decision.decisionDigest,resultSchemaRef:'helix://contracts/types/RejectionReceipt/v1',
  commitIdempotencyKey:stable('arca-rejection-key-',{decision:decision.acceptanceDecisionId}),eventFenceDigest:canonicalDigest({schema:'arca.rejection-event-fence@1',eventId})}); }
function controlHandle(c,processType,processId,eventId,operationKind='transfer') { const values=[...(c.packageValue.productMaterialManifest?.members||[]),
  ...(c.packageValue.offloadContextManifest?.members||[])],byKey=new Map(values.map((item)=>[item.materialKey,item]));
  const refs=[...byKey.values()].map((item)=>({materialKey:item.materialKey,revision:item.committedControlRevision??item.admittedControlRevision??0}));
  return Object.freeze({schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
    handleId:stable('arca-control-',{processId,eventId}),operationKind,ownerDomain:'arca',...(operationKind==='transfer'?{receivingDomain:'arca',transferPoint:'handoff_b_accepted'}:{}),
    processType,processId,basisRef:Object.freeze({objectType:'on_deck_package',objectId:c.packageValue.onDeckPackageId,revision:c.packageValue.packageRevision,digest:c.packageValue.packageDigest}),
    basisDigest:c.packageValue.packageDigest,canonicalFactSetDigest:canonicalDigest(c.packageValue.productFactManifest?.items||[]),
    bindingSetDigest:canonicalDigest({items:[...byKey.keys()].sort()}),controlScopeDigest:canonicalDigest({processId,refs}),expectedControlRevisions:Object.freeze(refs),
    receiptContract:Object.freeze({receiptSchemaRef:operationKind==='transfer'?'CustodyAndTransferReceipt@1':'OnDeckCommitReceipt@1',controlRevisionSetSchemaRef:'arca.control-revision-set@1'}),
    eventFenceDigest:canonicalDigest({schema:'arca.control-event-fence@1',eventId,processId})}); }
const finalDecision=(c)=>c.finalInventoryDecision||c.accepted?.finalInventoryDecision;
function targetHandle(c) { return c.inventoryPort?.slotHandle?.({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,shelf:c.shelf,
  onDeckProductPackage:c.packageValue,finalInventoryDecision:finalDecision(c),observedAtMs:0,replayCommitted:false})||Object.freeze({}); }
function productHandles(c) { return Object.freeze(c.packageValue.productMaterialManifest.members.map((item)=>item.workspaceMaterialHandle||Object.freeze({
  schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,handleId:stable('arca-read-',{run:c.responsibility.onDeckRunId,key:item.materialKey}),
  identity:item.physicalIdentity,ownerDomain:'arca',ownerScope:Object.freeze({scopeType:'on_deck_custody',scopeId:c.responsibility.custodyId}),bindingRevision:item.bindingRevision||1,
  endpointId:item.location.endpointId,location:item.location.location,mountScopeRevision:1,expectedSizeBytes:item.sizeBytes,expectedMtimeNs:0,expectedCtimeNs:0,
  fingerprintVerifiedAtMs:0,readScope:'exact_inventory_input',expiresAtMs:Number.MAX_SAFE_INTEGER,
  fenceDigest:canonicalDigest({key:item.materialKey,run:c.responsibility.onDeckRunId})}))); }
function finalBindings(c,staged) { const bindings=(staged?.stagedMembers||[]).map((member)=>{const body={objectId:stable('arca-binding-',{run:c.responsibility.onDeckRunId,key:member.physicalIdentity.materialKey}),
  revision:1,schemaRef:'helix://contracts/domain-types/ArcaMaterialBinding/v1',objectKind:'arca-material-binding'};return Object.freeze({...body,digest:canonicalDigest({...body,member})});});
  const body={schemaRef:'helix://contracts/domain-types/FinalBindings/v1',schemaVersion:1,objectId:c.responsibility.onDeckRunId+':bindings',revision:1,
    shelfEntryId:stable('arca-entry-preview-',{run:c.responsibility.onDeckRunId}),bindings:Object.freeze(bindings),bindingSetDigest:canonicalDigest({schema:'arca.final-bindings@1',items:bindings})};
  return withDigest(body); }
function targetBindings(c,staged) { const bindings=(staged?.stagedMembers||[]).map((member)=>{const body={objectId:stable('arca-target-binding-',{run:c.responsibility.onDeckRunId,key:member.physicalIdentity.materialKey}),
  revision:1,schemaRef:'helix://contracts/domain-types/TargetMaterialBinding/v1',objectKind:'target-material-binding'};return Object.freeze({...body,digest:canonicalDigest({...body,member})});});
  return withDigest({schemaRef:'helix://contracts/domain-types/TargetBindings/v1',schemaVersion:1,objectId:c.responsibility.onDeckRunId+':target-bindings',revision:1,
    targetCommitSlotId:staged.targetCommitSlotId,bindings:Object.freeze(bindings),bindingSetDigest:canonicalDigest({schema:'arca.target-bindings@1',items:bindings})}); }
function dispositionRole(member) {
  if (member.controlOperation === 'assert_related_input') return 'related';
  if (member.role === 'primary_payload' || member.role === 'structural_dependency') return member.role;
  return 'artifact';
}
function disposition(c) { const product=new Map(c.packageValue.productMaterialManifest.members.map((item)=>[item.materialKey,item]));
  const members=(c.packageValue.offloadContextManifest?.members||[]).map((source,ordinal)=>{const target=product.get(source.finalProductMaterialKey);
    if(!target)throw new Error('Off-load Context does not resolve to a Product member.');const body={ordinal,sourceMaterialKey:source.materialKey,
      sourceRelatedReferenceId:source.sourceRelatedReferenceId,finalMaterialKey:source.finalProductMaterialKey,finalRole:dispositionRole(target),
      dispositionKind:source.dispositionKind,sourceToFinalMappingDigest:source.derivedAuthorityDigest||canonicalDigest(source)};
    return Object.freeze({...body,memberDigest:canonicalDigest(body)});});
  if(!members.length)throw new Error('Product Disposition Manifest cannot be empty.');
  const body={schemaRef:'helix://contracts/domain-types/ProductDispositionManifest/v1',schemaVersion:1,
    objectId:c.packageValue.onDeckPackageId+':disposition',revision:1,manifestId:c.packageValue.onDeckPackageId+':disposition',onDeckRunId:c.responsibility.onDeckRunId,
    productManifestDigest:c.packageValue.productMaterialManifest.manifestDigest,relatedDispositionSetDigest:c.offer.relatedDispositionSetDigest||
      canonicalDigest({schema:'libra.related-disposition-set@1',items:[]}),members:Object.freeze(members),memberSetDigest:canonicalDigest({schema:'arca.disposition-members@1',items:members})};
  const manifestDigest=canonicalDigest(body);return withDigest({...body,manifestDigest}); }
function settlementHandles(c,materialKey) { const source=(c.packageValue.offloadContextManifest?.members||[]).find((item)=>item.materialKey===materialKey&&
  requiresInputSettlement(item));
  if(!source)throw new Error('Settlement Material is outside the approved Off-load Context.');
  const handle=Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    handleId:stable('arca-settlement-read-',{run:c.responsibility.onDeckRunId,key:source.materialKey}),identity:source.physicalIdentity,ownerDomain:'arca',
    ownerScope:Object.freeze({scopeType:'on_deck_custody',scopeId:c.responsibility.custodyId}),bindingRevision:source.bindingRevision,endpointId:source.endpointId,
    location:source.location,mountScopeRevision:1,expectedSizeBytes:source.physicalIdentity.sizeBytes,expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:0,
    readScope:'exact_input_settlement',expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest({run:c.responsibility.onDeckRunId,memberDigest:source.memberDigest})});
  const role=source.contextRole==='original_input'?'primary_payload':source.contextRole==='structural_dependency'?'structural_dependency':'exclusive_related';
  const finalMember=c.settlementFinalMember;
  if(!finalMember)throw new Error('Settlement source-to-final mapping is absent from the Final Inventory Decision.');
  if(finalMember.sourceMaterialKey!==source.finalProductMaterialKey)throw new Error('Settlement source-to-final mapping drifted from the bounded Final Inventory member.');
  const memberBody={ordinal:0,materialKey:source.materialKey,role,sourceRelatedReferenceId:source.sourceRelatedReferenceId,materialHandle:handle,
    finalMaterialKey:source.finalProductMaterialKey,finalTargetLocation:finalMember.targetLocation,settlementExpectation:source.settlementExpectation,
    dispositionMemberRef:source.memberDigest,sourceToFinalMappingDigest:source.derivedAuthorityDigest||canonicalDigest(source),
    finalProductVerificationDigest:c.packageValue.productionAttestation.productConformanceEvidenceDigest};
  const member=Object.freeze({...memberBody,memberDigest:canonicalDigest(memberBody)}),members=Object.freeze([member]),memberSetDigest=canonicalDigest({schema:'arca.settlement-members@1',items:members});
  const body={schemaRef:'helix://contracts/domain-types/OldPrimaryStructuralExclusiveRelatedHandles/v1',schemaVersion:1,
    objectId:c.responsibility.onDeckRunId+':settlement:'+materialKey,revision:1,onDeckRunId:c.responsibility.onDeckRunId,
    approvalScopeDigest:canonicalDigest({schema:'arca.settlement-approval-scope@1',onDeckRunId:c.responsibility.onDeckRunId,materialKey,memberSetDigest}),
    members,memberSetDigest,handleSetDigest:canonicalDigest({schema:'arca.settlement-handles@1',items:[handle.fenceDigest]})};return withDigest(body); }
function finalReality(options,c) { const reality=options.inventoryPort.readFinal({onDeckRunId:c.responsibility.onDeckRunId,custodyId:c.responsibility.custodyId,
  shelf:c.shelf,onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,observedAtMs:0,replayCommitted:true});
  return withDigest({schemaRef:'helix://contracts/domain-types/FinalReality/v1',schemaVersion:1,objectId:c.responsibility.onDeckRunId+':reality',revision:1,
    shelfEntryId:stable('arca-entry-preview-',{run:c.responsibility.onDeckRunId}),inventoryRevision:1,realityDigest:reality.realityDigest}); }

function createOnDeckProjections(options) { const definitions=[
  [P.packageIdentity,(c)=>packageIdentity(c)],[P.shelfStandard,(c)=>standard(c)],[P.productMetadata,(c)=>productMetadata(c)],
  [P.metadataRequirement,(c)=>metadataRequirement(c)],[P.productManifest,(c,source)=>source||productManifest(c)],
  [P.structureRequirement,(c)=>structureRequirement(c)],[P.productMedia,(c)=>c.packageValue],[P.mandatoryRequirement,(c)=>mandatoryRequirement(c)],
  [P.spaceRequirement,(c)=>spaceRequirement(c)],[P.offload,(c)=>offload(c)],[P.placementPolicy,(c)=>placement(c)],[P.targetEndpoint,(c)=>targetEndpoint(c)],
  [P.acceptedPayload,(c)=>acceptedPayload(options,c)],[P.acceptanceControl,(c,_s,p)=>controlHandle(c,'arca_acceptance',c.offer.offerId,p.eventId)],
  [P.rejectionDecision,(c)=>rejectionDecision(options,c)],[P.rejectionCommit,(c,_s,p)=>rejectionCommitHandle(options,c,p.eventId)],
  [P.finalDecision,(c)=>finalDecision(c)],[P.targetHandle,(c,source)=>source||options.inventoryPort.slotHandle({onDeckRunId:c.responsibility.onDeckRunId,
    custodyId:c.responsibility.custodyId,shelf:c.shelf,onDeckProductPackage:c.packageValue,finalInventoryDecision:c.finalInventoryDecision,observedAtMs:0,replayCommitted:false})],
  [P.productHandles,(c)=>productHandles(c)],[P.finalBindings,(c,source)=>finalBindings(c,source)],[P.disposition,(c)=>disposition(c)],
  [P.targetBindings,(c,source)=>targetBindings(c,source)],[P.settlementHandles,(c,_s,p)=>settlementHandles(c,p.materialKey)],
  [P.settlementApproval,(c,_s,p)=>{const scope=settlementHandles(c,p.materialKey);return Object.freeze({schemaRef:'helix://contracts/types/ApprovalHandle/v1',schemaVersion:1,
    approvalId:stable('arca-settlement-approval-',{run:c.responsibility.onDeckRunId,key:p.materialKey}),ownerDomain:'arca',processType:'arca_ondeck_run',
    processId:c.responsibility.onDeckRunId,eventId:p.eventId,exactEffectScopeDigest:scope.approvalScopeDigest,approvalRevision:1,actorId:'system-policy',
    invalidatingFactDigests:Object.freeze([c.finalInventoryDecisionRef.decisionDigest]),approvedAtMs:0});}],
  [P.finalReality,(c,source)=>source||finalReality(options,c)],[P.onDeckControl,(c,_s,p)=>controlHandle(c,'arca_ondeck_run',c.responsibility.onDeckRunId,p.eventId,'replace_control_set')],
  ];
  return Object.freeze(definitions.map(([projectionRef,build])=>Object.freeze({projectionRef,projection:Object.freeze({project({ownerScope,sourceResult,parameters}){
    return build(contextFor(options,ownerScope,parameters,projectionRef),sourceResult,parameters||{});}})})));
}

module.exports=Object.freeze({createOnDeckProjections,attemptId,packageIdentity,standard,productManifest});
