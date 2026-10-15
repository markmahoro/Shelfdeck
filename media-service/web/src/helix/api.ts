import { newOpaqueId } from './id';
import { sha256Hex } from './sha256';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type DefectAuthorization = { authorizationId:string; revision:number; state:'enabled'|'revoked'; authorizationDigest:string };
export type LibraRunOutcome = {libraRunId:string;outcome:'on_deck'|'on_deck_with_defects'|'unable_to_on_deck';
  reasonCode:string;outcomeDigest:string;committedAtMs:number;
  terminalReasons?:Array<{failureClass:string;failureCode:string;capabilityRef:string}>};
export type AcceptedGap = {gapDigest:string;findingKind:string;requirementCode:string;targetKind:'media'|'artifact'|'metadata_field';targetId:string;requiredValue:{value?:unknown;field?:string;artifact?:string}};
export type CollectionDefectPreview = {shelfEntryId:string;inventoryRevision:number;careBasisDigest:string;authorizationRevision:number;
  candidateDigest:string;gapSetDigest:string;gaps:AcceptedGap[];acceptedGaps:AcceptedGap[];eligibility:'eligible'|'ineligible'|'evidence_pending';
  missingEvidence:string[];ineligibleReasons:string[];repairableGapDigests:string[];unavailableRepairs:Array<{findingKind:string;reasonCode:string}>};
export type SourceCleanupCheck={onDeckRunId:string;shelfEntryId:string;state:string;checkedAtMs:number|null;checks:{sourceLocation?:string;state:string;errorCode?:string|null;recycleEntryId?:string|null}[]};
export type CorrectionDirectoryCheck=Omit<SourceCleanupCheck,'onDeckRunId'>&{correctionId:string;errorCode:string|null};
export type RecycleEntry={id:string;shelfEntryId:string;sourceLocation:string;state:string;reasonCode:string;createdAtMs:number;archivedAtMs:number|null;expiresAtMs:number|null;fileCount:number;totalBytes:number;errorCode:string|null};
export type RecyclePreview={shelfEntryId:string;sourceLocation:string;manifestDigest?:string;errorCode?:string;manifest?:{totalBytes:number;entries:Array<{relativePath:string;kind:string;sizeBytes?:number}>}};

export type ExtractionPolicyValue = {
  includedDirectories: string[];
  excludedDirectories: string[];
  allowedExtensions: string[];
  minimumSizeBytes: number;
  excludedMaterialKeys: string[];
};

export type FieldIntakeAdmission = {
  fieldId: string;
  predeckPipelineSeats: number;
  policyRevision: number;
  updatedAtMs: number;
  pipelineTokensHeld: number;
  pipelineSeatsFree: number;
};

export type MaterialField = {
  fieldId: string;
  name: string;
  status: 'active' | 'deregistered';
  extractionPolicyId: string;
  extractionPolicyRevision: number;
  currentAccessRevision: number;
  currentObservationRevision?: number;
  currentProfileHintSnapshot: {
    revision: number;
    contentProfileHint: 'mixed' | 'movie' | 'series' | 'jav' | 'western_adult';
  };
  access: {
    endpointId: string;
    rootLocation: string;
    mountScopeId: string;
    mountScopeRevision: number;
  };
  policy: { policy: ExtractionPolicyValue };
  procurementStatus: {
    stage: 'not_started' | 'procurement_run_active' | 'candidate_published' | 'handoff_a_ready' | 'handoff_a_accepted' | 'handoff_a_rejected';
    observationScan: {
      state: 'waiting' | 'scanning' | 'completed' | 'failed';
      pageCount: number;
      observationRevision: number | null;
      inProgress: boolean;
      accessAvailable?: boolean;
      failureCode?: string;
      failureMessage?: string;
    };
    procurementRunId?: string;
    runCount: number;
    activeRunCount: number;
    sealedRunCount: number;
    generatedPackageCount: number;
    acceptedPackageCount: number;
    waitingAcceptanceCount: number;
    rejectedPackageCount: number;
    candidatePackage?: {
      candidatePackageId: string;
      packageRevision: number;
      packageDigest: string;
      displayIdentity: string;
      contentProfile: string;
    };
    delivery?: { offerId: string; state: string };
  };
};

export type ProcurementJourneyResult = {
  observation: {
    operationRef: { operationType: 'field_observation'; operationId: string };
    observationWorkId: string;
    fieldId: string;
    state: string;
    replayed: boolean;
  };
};

export type MediaRequirement = {
  mediaForm: string;
  videoCodec: string;
  container?: string;
  fileExtension?: string;
  minimumRasterClass: string;
  acceptedPrimaryAudioClasses: string[];
  forbidSystemUpscaleFor4k?: boolean;
};

export type MovieRuleBranch = {
  conditionKind: 'no_rating' | 'rating_equals';
  rating?: number;
  requirements: {
    mandatoryMedia: MediaRequirement;
    space: { unit?: string; maxSizeGiB: number | null; maxSizeBytes: number | null };
    identity?: JsonValue;
    structure?: JsonValue;
    metadata?: JsonValue;
    inventory?: JsonValue;
  };
};

export type ProfileRuleSet = {
  contentProfile: string;
  decisionInputKinds: string[];
  baseRequirements?: JsonValue;
  decisionBranches: MovieRuleBranch[];
  profileRuleSetDigest: string;
};

export type RuleTemplateRules = { profileRuleSets: ProfileRuleSet[] };

export type RuleTemplate = {
  templateId: string;
  name: string;
  ownerKind: 'system' | 'user';
  status: 'active' | 'archived';
  currentRevision: number;
  current: {
    revision: number;
    rulesDigest: string;
    rules: RuleTemplateRules;
  };
};

export type RuleTemplateDraft = {
  templateId: string;
  draftRevision: number;
  basePublishedRevision: number;
  rulesSchemaRef: string;
  rules: RuleTemplateRules;
  rulesDigest: string;
  updatedAtMs: number;
};

export type PlacementPreview = {
  previewId: string;
  previewDigest: string;
  shelfId: string;
  expectedPlacementRevision: number;
  currentTargetDigest: string;
  proposedTarget: {
    endpointId: string;
    rootLocation: string;
    mountScopeId: string;
    mountScopeRevision: number;
  };
  proposedTargetDigest: string;
  currentPlacementDigest: string;
  proposedPlacementDigest: string;
  affectedActiveEntryCount: number;
  physicalEffect: 'none';
  replayed?: boolean;
};

export type RuleTemplatePreview = {
  previewId: string;
  previewDigest: string;
  templateId: string;
  expectedCurrentRevision: number;
  expectedDraftRevision: number;
  expectedDraftDigest: string;
  affectedShelfCount: number;
  currentEntryPotentialGapCount: number;
  replayed?: boolean;
};

export const RULE_TEMPLATE_SCHEMA_REF = 'helix://contracts/policies/ArcaRuleTemplateRules/v1';
export const PLACEMENT_SCHEMA_REF = 'helix://contracts/policies/ArcaShelfPlacementPolicy/v1';

export type ShelfPlacementPolicy = {
  folderTemplate: string;
  primaryTemplate: string;
  nfoTemplate: string;
  subtitleTemplate: string;
  posterTemplate: string;
  fanartTemplate: string;
  collisionPolicy: 'reject' | 'suffix';
};

export type Shelf = {
  shelfId: string;
  name: string;
  status: 'active' | 'deregistering' | 'deregistered';
  target: {
    endpointId: string;
    rootLocation: string;
    mountScopeId: string;
    mountScopeRevision: number;
  };
  currentStandardRevision: number;
  currentPlacementRevision: number;
  routingProjection: { revision: number; digest: string };
  standard: {
    ruleTemplateId: string;
    ruleTemplateRevision: number;
    digest: string;
    value: { profileRuleSets: ProfileRuleSet[] };
  };
  placement: {
    revision: number;
    digest: string;
    value: ShelfPlacementPolicy;
  };
  createdAtMs: number;
  updatedAtMs: number;
  deregistrationSummary: {
    entryCount: number;
    primaryCount: number;
    controlledMaterialCount: number;
    responsibilityCounts: {
      onDeck: number;
      offdeck: number;
      aftercare: number;
      reservations: number;
    };
    process: null | {
      deregistrationId: string;
      phase: 'waiting_responsibility' | 'freezing_manifest' | 'verifying' | 'ready_to_commit' | 'attention_required' | 'completed';
      manifestRevision: number | null;
      memberCount: number;
      pageCount: number;
      blockingReason: string | null;
      createdAtMs: number;
      committedAtMs: number | null;
    };
  };
};

export type FormationSubject = {
  seriesDelivery?: { libraRunId:string; seasonNumber:number; episodeKeys:string[]; physicalFileCount:number } | null;
  formationViewId: string;
  subjectId: string;
  displayIdentity: string;
  contentProfile: string;
  structureKind: string;
  status: string;
  classification: 'in_progress' | 'attention_required' | 'completed';
  myRating: number | null;
  myRatingSource: string | null;
  myRatingRevision: number | null;
  ratingState?: 'pending'|'ready';
  ratingResolutionStatus?: 'found'|'not_found'|null;
  ratingReasonCode?: string|null;
  productIdentityIssue: null | { contentProfile?:'jav'; sourceLocation?:string|null; claimedCode?:string|null; result:'not_found'|'ambiguous'|'conflicting'; reasonCode:string; candidateSetDigest:string|null; candidates:Array<{ providerKey:string; displayTitle:string; originalTitle:string|null; releaseYear:number|null }> };
  failureDiagnostics?: Array<{eventId:string;code:string;diagnosticsUnavailable?:boolean;diagnostics:{sourceDirectory?:string;unknownNames?:string[];unknownMemberCount?:number;truncated?:boolean;field?:string;reasonCode?:string;networkCode?:string;stage?:string;timeout?:boolean}|null}>;
  executorIssue: null | { phase:string; errorCode:string; attemptCount:number|null; owner:string; recoveryState:string;
    recoveryGeneration:number|null; automaticRecoveryUsed:boolean; canRetry:boolean; offerId:string; onDeckRunId?:string };
  primaryMaterialCount: number;
  addedAtMs: number;
  organizingRequirement: string;
  organizingAction: string;
  organizingSteps: Array<{
    key: string;
    label: string;
    state: 'pending' | 'running' | 'done' | 'blocked';
    progress: null | { mode:'determinate'|'indeterminate'; currentValue:number|null; totalValue:number|null; unit:string|null; rate:number|null; etaMs:number|null; bucket:string };
  }>;
  currentPlan?: null | {
    stageKey:'material_preparation'|'media_organization'|'acceptance_shelving';
    planId:string;
    planNumber:number;
    title:string;
    label:string;
    state:'completed'|'running'|'attention'|'pending';
    statusText:string|null;
    configurationTarget?:'input_settlement_authorization';
    progress:FormationSubject['organizingSteps'][number]['progress'];
  };
  processDetail?: {
    contract: 'formation_process_actual_plans@1';
    stages: Array<{
      key:'material_preparation'|'media_organization'|'acceptance_shelving';
      label:string;
      description:string;
      state:'completed'|'running'|'attention'|'pending'|'cancelled';
      summary:string;
      plans:Array<{
        planId:string;
        title:string;
        state:'completed'|'running'|'attention'|'pending'|'cancelled';
        createdAtMs:number;
        nodes:Array<{
          nodeId:string;
          label:string;
          description:string;
          state:'completed'|'running'|'failed'|'cancelled'|'skipped'|'pending';
          statusText?:string;
          configurationTarget?:'input_settlement_authorization';
          progress:FormationSubject['organizingSteps'][number]['progress'];
          results:Array<{label:string;value:string}>;
          technicalDetail:null|{
            summary:string;
            fields:Array<{label:string;value:string}>;
            parameters:Array<{label:string;value:string}>;
          };
        }>;
      }>;
    }>;
  };
  nextAction: { label:string; state:string; progress:null | { mode:'determinate'|'indeterminate'; currentValue:number|null; totalValue:number|null; unit:string|null; rate:number|null; etaMs:number|null; bucket:string } };
  routingState: 'preparing' | 'unresolved' | 'resolved';
  routingPolicyMode: 'direct' | 'sorting' | null;
  routingPolicyRevision: number | null;
  targetShelfId: string | null;
  targetShelfName: string | null;
  unresolvedReasonCode: string | null;
  routingDecisionRevision: number | null;
  routingDecisionDigest: string | null;
  routingDecisionHeadRevision: number | null;
  routingDecisionHeadDigest: string | null;
  acceptanceSpecId: string | null;
  acceptanceSpecRevision: number | null;
  acceptanceSpecDigest: string | null;
  acceptanceSpecPublishedAtMs: number | null;
  productionStage: 'awaiting_libra_run' | 'production' | 'suspended' | 'frozen' | 'handoff_b_ready' | null;
  currentRun: { libraRunId:string; state:string; stateRevision:number; stateDigest:string; priorityClass:'normal'|'expedited'; packageRevisionHead:number; currentIdentityRevision:number|null } | null;
  handoffB: { onDeckPackageId:string; offerId:string; packageRevision:number; packageDigest:string; state:string } | null;
  completedAtMs: number | null;
};

export type FormationRunHistory = { historyId:string; libraRunId:string; subjectId:string; displayIdentity:string;
  outcome:'user_abandoned'|'unable_to_on_deck'; label:'已结束 · 用户放弃'|'无法上架'; endedAtMs:number; stateRevision:number; stateDigest:string; evidenceDigest:string };

export type PerceptionRecord = {
  perceptionId: string;
  sourceKind: string;
  recordKind: 'observation' | 'correction' | 'retraction';
  rating: number | null;
  watchedState: boolean | null;
  observedTitle: string;
  observedAtMs: number;
  committedAtMs: number;
  targetType: 'subject' | 'shelf_entry' | null;
  targetId: string | null;
  resolutionStatus: 'matched' | 'unmatched' | 'ambiguous' | 'superseded';
  current: boolean;
  sourceRecordKey: string;
  sourceRecordRevision: number;
  provenanceDigest: string;
  recordDigest: string;
};

export type PerceptionSyncState = {
  latest: { state?: string; createdAtMs?: number; terminalAtMs?: number | null } | null;
  activeCount: number;
  completionState: 'not_started' | 'in_progress' | 'complete' | 'incomplete';
  lastCursorOut: string | null;
  cursorRevision: number;
  committedPageCount: number;
  recordCount: number;
};

export type JavCorrectionStatus={correctionId:string;shelfEntryId:string;state:'admitted'|'active'|'attention_required'|'committed'|'cancelled';cleanupState:'pending'|'active'|'attention_required'|'completed'|null;stateRevision:number;admissionDigest:string;cancellation:{available:boolean;reasonCode:'not_attention_required'|'no_effect_unproven'|'collection_basis_changed'|null};recovery:{available:boolean;mode:'continue_correction'|'continue_cleanup'|null;previousIntentDigest:string|null};oldJavCode:string;newJavCode:string;updatedAtMs:number};
export type JavCorrectionWorkItem=JavCorrectionStatus&{taskType:'jav_identity_correction';classification:'in_progress'|'attention_required'|'completed'|'ended';displayIdentity:string;targetShelfId:string|null;targetShelfName:string|null;createdAtMs:number;terminalAtMs:number|null;
  processDetail:{contract:'jav_correction_process_actual_plans@1';stages:Array<Omit<NonNullable<FormationSubject['processDetail']>['stages'][number],'key'>&{key:string}>}|null};
export type JavCorrectionQualifiedPreview={result:'qualified';previewId:string;shelfEntryId:string;basisDigest:string;proposalDigest:string;placementPreviewDigest:string;
  oldIdentity:{javCode:string;title:string};newIdentity:{javCode:string;title:string;posterUrl:string;siteRef:string};
  paths:Array<{materialKey:string;role:string;previousLocation:string;targetLocation:string;targetEndpointId:string}>};
export type JavCorrectionPreview=JavCorrectionQualifiedPreview|{result:'not_qualified';javCode:string}|{result:'ambiguous';javCode:string;candidates:Array<{siteRef:string;resourceKey:string;javCode:string}>};
export type CollectionEntry = {
  series?: { seasonNumber: number; episodeCount: number; physicalFileCount: number; episodes: Array<{episodeKey: string; episodeNumber: number; title: string | null; files: Array<{materialKey: string; name: string; sizeBytes: number; coveredEpisodeCount: number}>}> } | null;
  shelfEntryId: string;
  shelfId: string;
  shelfName: string;
  structureKind: string;
  status: string;
  canonicalIdentityRevision: number;
  canonicalIdentityKey: string;
  provider: string;
  providerKey: string;
  identityKind: string;
  identityDigest: string;
  displayIdentity: string;
  year: number | null;
  overview: string | null;
  genres: string[];
  people: { personId: string; displayName: string; role: string }[];
  hasPoster: boolean;
  hasNfo: boolean;
  occupancyBytes: number;
  primaryVideoBytes: number | null;
  primaryContainer: string | null;
  videoCodec: string | null;
  videoRaster: string | null;
  defectAdmission: { defectCount:number; defects:Array<{defectCode:'actor_unavailable'|'external_source_exhausted'|'media_requirements_unmet'|'size_cap_exceeded';waivedRequirementCodes:string[]}> } | null;
  health: HealthSummary;
  currentInventoryRevision: number;
  currentDeckFactRevision: number;
  createdAtMs: number;
  terminalAtMs: number | null;
};
export type DefectAdmissionCandidate={candidateRevision:number;libraRunId:string;frozenRunStateRevision:number;frozenRunStateDigest:string;terminalEvidenceDigest:string;defects:Array<{defectCode:'actor_unavailable'|'metadata_fields_unavailable'|'artifacts_unavailable'|'external_source_exhausted'|'media_requirements_unmet'|'size_cap_exceeded';metadataFieldCodes?:string[];artifactKindCodes?:string[];sourceFailureCode:string;waivedRequirementCodes:string[]}>;waivedRequirementCodes:string[];candidateDigest:string;sizeForecast?:{maxSizeBytes:number;predictedBytes:number;overshootBytes:number;videoBitrateFloorBps:number;targetVideoBitrateBps:number;rasterClass:string}|null};
export type DefectAdmissionPreview=(DefectAdmissionCandidate&{eligibility:'eligible'})|{eligibility:'ineligible'|'evidence_pending';message:string;ineligibleReasons:string[];missingEvidence:string[]};
export type HealthState = 'never_assessed'|'healthy'|'unhealthy'|'observing'|'repairing'|'attention_required';
export type HealthSummary = { shelfEntryId?:string; state:HealthState; careBasisDigest?:string; basisCurrent?:boolean;
  healthState?:'healthy'|'unhealthy'|'unknown'; maintenanceState?:'none'|'queued'|'active'; maintenanceCaseId?:string|null;
  dimensions?:Record<'custody'|'presentation'|'conformance',{state:string;assessedAtMs:number|null;evidenceDigest:string|null;findings:CareFinding[]}>;
  activeCase?:CareCase|null; nextCustodyDueAtMs?:number; nextDeepDueAtMs?:number; updatedAtMs?:number };
export type CareFinding = { findingId:string; findingKind:string; severity:string; repairability:string; state:string; createdAtMs:number };
export type CareCase = { aftercareCaseId:string; caseGeneration:number; triggerDigest:string; state:string;
  terminalReasonCode:string|null; terminalEvidenceDigest:string|null; createdAtMs:number; terminalAtMs:number|null; careBasisDigest:string };
export type CareWorkItem = { currentHealth?:HealthSummary|null; caseEvidence?:{objective?:{placement?:{shelfId:string;placementRevision:number;target:{rootLocation:string};policy:{folderTemplate?:string;primaryTemplate?:string}}|null;requirements:{space?:{maxSizeBytes?:number|null;maxSizeGiB?:number|null};mandatoryMedia?:{videoCodec?:string;container?:string;minimumRasterClass?:string;fileExtension?:string;acceptedPrimaryAudioClasses?:string[]};metadata?:{requiredArtifactKinds?:string[];requiredFieldCodes?:string[]};inventory?:{requiredMaterializedArtifactKinds?:string[]}};requirementsDigest:string}|null;inventoryRevision:number;standardRevision:number;originalPrimaryBytes:number|null;currentInventoryRevision:number|null;currentPrimaryBytes:number|null}|null; aftercareCaseId:string;shelfEntryId:string;displayIdentity:string;targetShelfId:string|null;targetShelfName:string|null;
  processDetail?:{contract:'aftercare_process_actual_plans@1';stages:Array<Omit<NonNullable<FormationSubject['processDetail']>['stages'][number],'key'>&{key:string}>}|null;
  state:string;classification:'queued'|'in_progress'|'attention_required'|'completed'|'ended';goals:string[];createdAtMs:number;terminalAtMs:number|null;
  reasonCode:string|null;progress:CareDetail['activeCaseProgress'] };
export type CareDetail = { shelfEntryId:string; health:HealthSummary; basis:{inventoryRevision:number;standardRevision:number;placementRevision:number;careBasisDigest:string};
  activeCaseProgress:{aftercareCaseId:string;stage:string;currentAction?:(Omit<NonNullable<FormationSubject['currentPlan']>,'stageKey'|'state'>&{stageKey:string;state:string})|null;progressPercent:number|null;progress?:{mode:string;currentValue:number;totalValue:number;unit:string;rate:number|null;etaMs:number|null;terminal:boolean}|null;goals:string[]}|null;
  history:{assessments:Array<{assessmentId:string;assessmentKind:string;result:string;assessedAtMs:number}>;findings:CareFinding[];cases:CareCase[];commits:Array<{inventoryCommitId:string;previousInventoryRevision:number;newInventoryRevision:number;committedAtMs:number}>} };
export type OffdeckPolicy={policyId:string;revision:number;status:'active'|'disabled';duplicateScheduleEnabled:boolean;entryRules:Array<{ruleId:string;ordinal:number;shelfScope:'all'|'selected';shelfIds:string[];condition:JsonValue}>;policyDigest:string};
export type OffdeckCandidate={candidate_id:string;candidate_kind:'entry'|'duplicate_group';shelf_entry_id:string|null;duplicate_group_id:string|null;state:string;created_at_ms:number};
export type OffdeckDuplicateGroup={duplicate_group_id:string;canonical_identity_digest:string;member_set_digest:string;state:string;members:Array<{shelf_entry_id:string;inventory_revision:number;member_digest:string}>};
export type OffdeckReview={reviewId:string;originKind:string;originRef:string;state:string;createdAtMs:number;reservations:Array<{reservationId:string;shelfEntryId:string;inventoryRevision:number;state:string}>;scopes:Array<{destructionScopeId:string;shelfEntryId:string;memberCount:number;totalBytes:number;scopeDigest:string;state:string;materials:Array<{ordinal:number;materialKey:string;role:string;location:string;sizeBytes:number;deleteCondition:string}>}>;selection:{selectionReceiptId:string;scopeSetDigest:string;entryCount:number;primaryCount:number;totalBytes:number;deckCoverageRatio:number;shelfCoverageRatios?:Record<string,number>|null;highVolume:boolean}|null;escalation:{escalationReceiptId:string}|null};
export type OffdeckCase={offdeckCaseId:string;shelfEntryId:string;state:'executing'|'blocked'|'awaiting_reauthorization'|'completed';recoveryRevision:number;retryAtMs:number|null;blockedReason:string|null;createdAtMs:number;terminalAtMs:number|null};
export type OffdeckEntry=Pick<CollectionEntry,'shelfEntryId'|'displayIdentity'|'shelfName'|'occupancyBytes'>&{seasonNumber:number|null};

export type IntegrationState = {
  kind: string;
  supported: boolean;
  configured: boolean;
  state: string;
  configRevision: number;
  endpoint: string | null;
  configDigest: string | null;
  capabilityCodes: string[];
  lastTestSummary: { identityProviderKey?: string; checkedAtMs?: number } | null;
  validation?: { status:'not_tested'|'passed'|'failed'; checkedAtMs:number|null; configRevision:number; errorCode:string|null };
  settings?: {
    language?: string;
    proxyServer?: string;
    networkRoute?: {mode:'direct'|'http_proxy';proxyEndpoint:string|null};
  };
  landingBinding: {
    bindingId: string;
    bindingRevision: number;
    providerRequestSaveRoot: string;
    providerOrganizedRoot: string;
    shelfDeckVisibleRoot: string;
    endpointId: string;
    mountScopeId: string;
    mountScopeRevision: number;
    bindingDigest: string;
  } | null;
};

export type WorkspaceRootSettings = {
  current:{rootPath:string;configRevision:number};
  pending:{rootPath:string;configRevision:number;validation:'passed'}|null;
  restartRequired:boolean;
};

export type OverviewProjection = {
  generatedAt: string;
  projection?: { state: 'ready' | 'stale' | 'failed'; ageMs: number };
  systemState: { kind:'unconfigured'|'running'|'faulted'; label:string; href:string };
  metrics: Array<{ key:string; label:string; value:number; note:string; href?:string }>;
  todos: Array<{ key:string; label:string; count:number; href:string }>;
  pipeline: { waitingAcceptanceCount:number; organizingCount:number };
  setup: { activeMaterialFieldCount:number; activeShelfCount:number };
  ledger: Array<{ key:string; label:string; href?:string; value?:number }>;
  backgroundOperations: {
    state:'waiting_first_check'|'running'|'normal'|'attention'|'stopped';
    cadenceMs:number; lastStartedAtMs:number|null; lastCompletedAtMs:number|null; pendingCount:number;
    registrations:Array<{ownerDomain:string;reconcilerKey:string;state:'waiting_first_check'|'waiting_business_time'|'running'|'normal'|'attention';
      lastStartedAtMs:number|null;lastCompletedAtMs:number|null;processed:number;pendingCount:number;errorCode:string|null;
      lastResultKind:'failed'|'not_due'|'no_pending'|'processed'|null;nextDueAtMs:number|null}>;
  } | null;
};

export type RuntimeOperation = {operationId:string;kind:'stop'|'resume'|'reset';state:'pending'|'completed'|'failed';
  result?:{backupId?:string;removedSubjects?:number};error?:{code:string;message:string}};
export type RuntimeStatus = {mode:'starting'|'running'|'stopping'|'stopped'|'resuming'|'resetting'|'error';desiredMode:'running'|'stopped';
  revision:number;normalSupplyAllowed:boolean;activity:{inFlightEvents:number;inFlightRecoveries:number;inFlightOwnerReconciliations:number;inFlightAdminCommands?:number};
  operation:RuntimeOperation|null;error:{code:string;message:string}|null;recoveryBackup:string|null};
export type FormationResetPreview={previewDigest:string;ready:boolean;empty:boolean;items:Array<{subjectId:string;displayIdentity:string;contentProfile:string}>;
  counts:{subjects:number;runs:number;works:number;workspaces:number};protected:{collectionCount:number;endedRunCount:number};blockers:Array<{code:string;message:string}>};

export type SetupReadinessItem = {
  key: string;
  owner: string;
  ready: boolean;
  label: string;
  href: string;
};

export type SetupReadinessProjection = {
  projectionVersion: number;
  asOf: string;
  freshness: 'fresh' | 'stale' | 'rebuilding';
  data: {
    fullAutoReady: boolean;
    fullAutoReadyLabel: string;
    standingInputSettlement: {
      enabled: boolean;
      authorizationId: string;
      revision: number;
      authorizationScopeKind: string;
      coversExclusiveRelatedInput: boolean;
    } | null;
    offdeckDestruction: { independentlyDisabled: boolean; grantedByFullAuto: boolean; label: string };
    items: SetupReadinessItem[];
    consequences: Array<{ owner: string; topic: string; text: string }>;
  };
  availableActions: Array<{ actionCode: string; label: string; expectedRevision: number; requiresConfirmation: boolean }>;
};

export type PeopleProjection = {
  items: Array<{
    personId:string; status:'active'|'merged'; currentRevision:number; canonicalName:string;
    aliases:string[]; providerIdentities:Array<{provider:string;namespace:string;providerKey:string}>;
    currentPreferenceRevision:number|null; currentReferenceRevision:number|null; createdAtMs:number;
  }>;
  nextCursor:string|null;
  summary:{activePersonCount:number;mergedPersonCount:number;openRegistrationCandidateCount:number;openMergeCandidateCount:number};
};

export type FormationSummary = { endedCount?:number;
  totalCount: number;
  inProgressCount: number;
  attentionRequiredCount: number;
  completedCount: number;
};

export type RoutingExpression =
  | { nodeKind: 'always' }
  | { nodeKind: 'predicate'; factKind: string; operator: 'eq' | 'one_of' | 'gte' | 'lte' | 'exists'; expectedValue: JsonValue }
  | { nodeKind: 'all' | 'any'; children: RoutingExpression[] }
  | { nodeKind: 'not'; child: RoutingExpression };
export type RoutingPolicy = { routingPolicyId: string; revision: number; fieldId: string; mode: 'direct' | 'sorting';
  targets: { shelfId: string; rank: number; matchExpression: RoutingExpression; matchRuleDigest: string }[]; policyDigest: string };

const ADMIN_AUTH_ERROR_COPY: Record<string, string> = {
  ADMIN_CREDENTIAL_INVALID: '管理凭据验证失败。',
  ADMIN_SESSION_INVALID: '管理会话已失效，请重新登录。',
  ADMIN_SESSION_EXPIRED: '管理会话已过期，请重新登录。',
};

export function adminAuthErrorCopy(code: string, fallback = '管理凭据验证失败。') {
  return ADMIN_AUTH_ERROR_COPY[code] || fallback;
}

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: Record<string, JsonValue> = {}) {
    super(message);
    this.name = 'AdminApiError';
  }
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function canonicalDigest(value: JsonValue): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  if (typeof crypto.subtle?.digest === 'function') {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(bytes);
}

async function responseJson<T>(response: Response): Promise<T> {
  if (response.ok) return response.status === 204 ? undefined as T : response.json() as Promise<T>;
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string; details?: Record<string, JsonValue> } };
  const code = body.error?.code || `HTTP_${response.status}`;
  throw new AdminApiError(
    response.status,
    code,
    adminAuthErrorCopy(code, body.error?.message || '请求未完成。'),
    body.error?.details || {},
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...init.headers,
    },
  });
  return responseJson<T>(response);
}

export const helixAdminApi = {
  previewCollectionDefects(shelfEntryId:string) {return request<CollectionDefectPreview>(`/v1/admin/care/${encodeURIComponent(shelfEntryId)}/defect-admission-candidate`);},
  decideCollectionDefects(preview:CollectionDefectPreview,action:'accept-defects'|'repair-accepted-defects',idempotencyKey:string) {
    return request<{resultKind?:string;aftercareCaseId?:string}>(`/v1/admin/care/${encodeURIComponent(preview.shelfEntryId)}/actions/${action}`,{
      method:'POST',body:JSON.stringify({expectedCandidateDigest:preview.candidateDigest,expectedInventoryRevision:preview.inventoryRevision,
        expectedCareBasisDigest:preview.careBasisDigest,expectedAuthorizationRevision:preview.authorizationRevision,acknowledged:true,idempotencyKey})});
  },
  getDefectAuthorization() { return request<{authorization:DefectAuthorization|null}>('/v1/admin/formation/defect-authorization'); },
  setDefectAuthorization(enabled:boolean, expectedRevision:number, idempotencyKey:string) {
    return request<{authorization:DefectAuthorization|null;replayed:boolean}>('/v1/admin/formation/defect-authorization', {
      method:'PATCH',body:JSON.stringify({enabled,expectedRevision,idempotencyKey,acknowledged:enabled}),
    });
  },
  createSession(apiKey: string) {
    return request<void>('/v1/admin/session', { method: 'POST', headers: { 'x-api-key': apiKey } });
  },
  getOverview() {
    return request<OverviewProjection>('/v1/admin/overview');
  },
  getRuntimeStatus(){return request<RuntimeStatus>('/v1/admin/runtime');},
  stopRuntime(idempotencyKey:string){return request<RuntimeOperation>('/v1/admin/runtime/actions/stop',{method:'POST',body:JSON.stringify({idempotencyKey})});},
  resumeRuntime(idempotencyKey:string){return request<RuntimeOperation>('/v1/admin/runtime/actions/resume',{method:'POST',body:JSON.stringify({idempotencyKey})});},
  previewFormationReset(){return request<FormationResetPreview>('/v1/admin/runtime/reset-preview');},
  resetFormation(previewDigest:string,idempotencyKey:string){return request<RuntimeOperation>('/v1/admin/runtime/actions/reset',{
    method:'POST',body:JSON.stringify({previewDigest,idempotencyKey,confirmed:true})});},
  getSetupReadiness() {
    return request<SetupReadinessProjection>('/v1/admin/setup-readiness');
  },
  listPeople(params:{cursor?:string;limit?:number;search?:string;status?:'active'|'merged'}={}) {
    const query=new URLSearchParams();Object.entries(params).forEach(([key,value])=>{if(value!==undefined&&value!=='')query.set(key,String(value));});
    return request<PeopleProjection>(`/v1/admin/people${query.size?`?${query}`:''}`);
  },
  listPeopleRegistrationCandidates() {
    return request<{ items: Array<{ candidateId: string; currentState: string; currentRevision: number; proposedName: string; evidenceDigest: string }> }>('/v1/admin/people/registration-candidates');
  },
  personAvatarUrl(personId: string) {
    return `/v1/admin/people/${encodeURIComponent(personId)}/avatar`;
  },
  registerPerson(body:{ canonicalName:string; aliases?:string[]; providerIdentities?:Array<{provider?:string;namespace?:string;providerKey:string}> }) {
    return request<{ person: { personId:string; revision?:{canonicalName:string} } }>('/v1/admin/people/actions/register', {
      method:'POST', body:JSON.stringify({ ...body, idempotencyKey:`people-register:${body.canonicalName}:${newOpaqueId()}` }),
    });
  },
  acceptPeopleCandidate(candidateId:string) {
    return request<{ person: { personId:string } }>('/v1/admin/people', {
      method:'POST', body:JSON.stringify({ candidateId, idempotencyKey:`people-accept:${candidateId}:${newOpaqueId()}` }),
    });
  },
  dismissPeopleCandidate(candidateId:string) {
    return request<{ candidate: { candidateId:string } }>('/v1/admin/people/actions/dismiss-candidate', {
      method:'POST', body:JSON.stringify({ candidateId, idempotencyKey:`people-dismiss:${candidateId}:${newOpaqueId()}` }),
    });
  },
  listMaterialFields() {
    return request<{ items: MaterialField[] }>('/v1/admin/material-fields');
  },
  getFieldIntakeAdmission(fieldId: string) {
    return request<FieldIntakeAdmission>(`/v1/admin/libra/material-fields/${encodeURIComponent(fieldId)}/intake-admission`);
  },
  patchFieldIntakeAdmission(fieldId: string, body: { predeckPipelineSeats: number }) {
    return request<FieldIntakeAdmission>(`/v1/admin/libra/material-fields/${encodeURIComponent(fieldId)}/intake-admission`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, idempotencyKey: `field-intake:${fieldId}:${newOpaqueId()}` }),
    });
  },
  setInputSettlementAuthorization(enabled: boolean, expectedRevision: number) {
    const action = enabled ? 'enable-full' : 'require-settlement-confirmation';
    return request<unknown>(`/v1/admin/settings/automatic-operation/actions/${action}`, {
      method: 'POST',
      body: JSON.stringify({ expectedRevision, idempotencyKey: newOpaqueId('input-settlement-'),
        ...(enabled ? { coverExclusiveRelatedInput: true } : {}) }),
    });
  },
  listShelves() {
    return request<{ items: Shelf[] }>('/v1/admin/shelves');
  },
  listRuleTemplates() {
    return request<{ items: RuleTemplate[] }>('/v1/admin/rule-templates');
  },
  listFormation(section:'active'|'completed'='active', cursor?:string, filters?:{
    classification?:'in_progress'|'attention_required';
    shelfId?:string; needsUserAction?:boolean; expedited?:boolean; q?:string;
  }) {
    const query=new URLSearchParams({section,limit:'25'});
    if(cursor)query.set('cursor',cursor);
    if(filters){
      if(filters.classification)query.set('classification',filters.classification);
      if(filters.shelfId)query.set('shelfId',filters.shelfId);
      if(filters.needsUserAction)query.set('needsUserAction','1');
      if(filters.expedited)query.set('expedited','1');
      if(filters.q)query.set('q',filters.q);
    }
    return request<{ items: FormationSubject[]; summary: FormationSummary; nextCursor:string|null; projection:{status:'ready'|'rebuilding'|'stale';asOfMs:number} }>(`/v1/admin/formation?${query}`);
  },
  getFormation(formationViewId:string) {
    return request<FormationSubject>(`/v1/admin/formation/${encodeURIComponent(formationViewId)}`);
  },
  listFormationHistory(cursor?:string,filters?:{q?:string;shelfId?:string}) {
    const query=new URLSearchParams({section:'ended',limit:'25'});if(cursor)query.set('cursor',cursor);
    if(filters?.q)query.set('q',filters.q);if(filters?.shelfId)query.set('shelfId',filters.shelfId);
    return request<{ items: FormationRunHistory[]; summary: FormationSummary; nextCursor:string|null; projection:{status:'ready'|'rebuilding'|'stale';asOfMs:number} }>(`/v1/admin/formation?${query}`);
  },
  listCollection(filters?:{ shelfId?:string; status?:'current'|'history'; health?:HealthState|'all'; q?:string; sort?:'title'|'recent'|'year_desc'; cursor?:string; limit?:number }) {
    const query=new URLSearchParams();
    if(filters?.shelfId)query.set('shelfId',filters.shelfId);
    if(filters?.status)query.set('status',filters.status);
    if(filters?.health && filters.health !== 'all')query.set('health',filters.health);
    if(filters?.q)query.set('q',filters.q);
    if(filters?.sort)query.set('sort',filters.sort);
    if(filters?.cursor)query.set('cursor',filters.cursor);
    if(filters?.limit)query.set('limit',String(filters.limit));
    const suffix=query.toString()?`?${query}`:'';
    return request<{ items: CollectionEntry[]; shelves?: Array<{shelfId:string;name:string;currentCount:number;historyCount:number}>; summary?:{currentCount:number;historyCount:number}; resultCount?:number; nextCursor?:string|null }>(`/v1/admin/collection${suffix}`);
  },
  previewJavCorrection(shelfEntryId:string,javCode:string,candidate?:{siteRef:string;resourceKey:string}){
    return request<JavCorrectionPreview>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/actions/preview-jav-correction?${new URLSearchParams({javCode,...candidate})}`);
  },
  confirmJavCorrection(shelfEntryId:string,preview:JavCorrectionQualifiedPreview,idempotencyKey:string){
    return request<{correctionId:string;shelfEntryId:string;state:'admitted';stateRevision:number;admissionDigest:string;updatedAtMs:number;replayed:boolean}>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/actions/confirm-jav-correction`,
      {method:'POST',body:JSON.stringify({previewId:preview.previewId,basisDigest:preview.basisDigest,proposalDigest:preview.proposalDigest,placementPreviewDigest:preview.placementPreviewDigest,idempotencyKey})});
  },
  listJavCorrectionWork(cursor?:string,correctionId?:string,filters?:{classification?:string;q?:string;shelfId?:string}){const query=new URLSearchParams({limit:'25'});if(cursor)query.set('cursor',cursor);if(correctionId)query.set('correctionId',correctionId);Object.entries(filters||{}).forEach(([key,value])=>{if(value)query.set(key,value);});return request<{items:JavCorrectionWorkItem[];counts:Record<string,number>;nextCursor:string|null}>(`/v1/admin/collection/jav-corrections?${query}`);},
  getJavCorrection(shelfEntryId:string,correctionId:string){return request<JavCorrectionStatus>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/jav-corrections/${encodeURIComponent(correctionId)}`);},
  cancelJavCorrection(shelfEntryId:string,status:Pick<JavCorrectionStatus,'correctionId'|'stateRevision'|'admissionDigest'>,idempotencyKey:string){
    return request<{state:'cancelled';stateRevision:number;cancelledAtMs:number;replayed:boolean}>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/jav-corrections/${encodeURIComponent(status.correctionId)}/actions/cancel`,
      {method:'POST',body:JSON.stringify({expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,idempotencyKey})});
  },
  recoverJavCorrection(shelfEntryId:string,status:Pick<JavCorrectionStatus,'correctionId'|'stateRevision'|'admissionDigest'|'cleanupState'|'recovery'>,idempotencyKey:string){
    return request<{correctionId:string;shelfEntryId:string;state:'active'|'committed';stateRevision:number;admissionDigest:string;cleanupState:'active'|null;recoveryIntentDigest:string;updatedAtMs:number;replayed:boolean}>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/jav-corrections/${encodeURIComponent(status.correctionId)}/actions/recover`,
      {method:'POST',body:JSON.stringify({expectedStateRevision:status.stateRevision,expectedAdmissionDigest:status.admissionDigest,expectedCleanupState:status.cleanupState,
        expectedRecoveryIntentDigest:status.recovery.previousIntentDigest,idempotencyKey})});
  },
  getLatestJavCorrection(shelfEntryId:string){return request<{correction:JavCorrectionStatus|null}>(`/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/jav-correction`);},
  collectionPosterUrl(shelfEntryId: string, inventoryRevision?:number, size?:'wall'|'detail') {
    const query=new URLSearchParams();
    if(inventoryRevision)query.set('revision',String(inventoryRevision));
    if(size)query.set('size',size);
    const suffix=query.toString()?`?${query}`:'';
    return `/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/poster${suffix}`;
  },
  listCareWork(cursor?:string,aftercareCaseId?:string,filters?:{classification?:string;q?:string;shelfId?:string}){const query=new URLSearchParams({view:'work',limit:'25'});if(cursor)query.set('cursor',cursor);if(aftercareCaseId)query.set('aftercareCaseId',aftercareCaseId);Object.entries(filters||{}).forEach(([key,value])=>{if(value)query.set(key,value);});return request<{items:CareWorkItem[];counts:Record<string,number>;nextCursor:string|null}>(`/v1/admin/care?${query}`);},
  getCare(shelfEntryId:string){return request<CareDetail>(`/v1/admin/care/${encodeURIComponent(shelfEntryId)}`);},
  listRecycle(cleanupCursor?:string,correctionCursor?:string){const query=new URLSearchParams();if(cleanupCursor)query.set('cleanupCursor',cleanupCursor);if(correctionCursor)query.set('correctionCursor',correctionCursor);
    return request<{items:RecycleEntry[];cleanupChecks?:SourceCleanupCheck[];cleanupNextCursor?:string|null;correctionChecks?:CorrectionDirectoryCheck[];correctionNextCursor?:string|null}>('/v1/admin/care-recycle'+(query.size?'?'+query:''));},
  previewRecycle(shelfEntryId:string){return request<{items:RecyclePreview[]}>(`/v1/admin/care-recycle/${encodeURIComponent(shelfEntryId)}/preview`);},
  archiveRecycle(value:RecyclePreview){return request<RecycleEntry>(`/v1/admin/care-recycle/${encodeURIComponent(value.shelfEntryId)}/actions/archive`,{method:'POST',body:JSON.stringify({idempotencyKey:newOpaqueId(),sourceLocation:value.sourceLocation,manifestDigest:value.manifestDigest,confirmManifestDigest:value.manifestDigest})});},
  restoreRecycle(id:string){return request<RecycleEntry>(`/v1/admin/care-recycle/${encodeURIComponent(id)}/actions/restore`,{method:'POST',body:'{}'});},
  checkCare(shelfEntryId:string){return request<{operationRef:string;state:string;shelfEntryId:string}>(`/v1/admin/care/${encodeURIComponent(shelfEntryId)}/actions/check`,{method:'POST',body:JSON.stringify({idempotencyKey:`care-check:${shelfEntryId}:${newOpaqueId()}`})});},
  getOffdeckPolicy(){return request<OffdeckPolicy>('/v1/admin/offdeck/policies');},
  publishOffdeckPolicy(body:JsonValue){return request<OffdeckPolicy>('/v1/admin/offdeck/policies',{method:'PATCH',body:JSON.stringify(body)});},
  listOffdeckCandidates(){return request<{candidates:OffdeckCandidate[];duplicateGroups:OffdeckDuplicateGroup[];suppressions:JsonValue[];whitelists:JsonValue[]}>('/v1/admin/offdeck/candidates');},
  getOffdeckWorkbench(cursor?:string){const query=new URLSearchParams({view:'workbench'});if(cursor)query.set('cursor',cursor);return request<{candidates:OffdeckCandidate[];duplicateGroups:OffdeckDuplicateGroup[];entries:OffdeckEntry[];currentCount:number;candidateCount:number;nextCursor:string|null;shelves:{shelfId:string;name:string}[]}>(`/v1/admin/offdeck/candidates?${query}`);},
  searchOffdeckEntries(q:string,cursor?:string){const query=new URLSearchParams({view:'search',q,limit:'25'});if(cursor)query.set('cursor',cursor);return request<{items:OffdeckEntry[];nextCursor:string|null}>(`/v1/admin/offdeck/candidates?${query}`);},
  selectAllOffdeckEntries(){return request<{shelfEntryIds:string[]}>('/v1/admin/offdeck/candidates?view=selection');},
  getOffdeckEntryDisplay(shelfEntryIds:string[]){const query=new URLSearchParams({view:'display',shelfEntryIds:JSON.stringify(shelfEntryIds)});return request<{items:OffdeckEntry[]}>(`/v1/admin/offdeck/candidates?${query}`);},
  listOffdeckWorkCases(classification:'active'|'completed',cursor?:string){const query=new URLSearchParams({view:'workbench',classification,limit:'25'});if(cursor)query.set('cursor',cursor);return request<{items:OffdeckCase[];entries:OffdeckEntry[];counts:{active:number;completed:number};nextCursor:string|null}>(`/v1/admin/offdeck/cases?${query}`);},
  evaluateOffdeck(){return request<{operations:JsonValue[];matchedCount:number}>('/v1/admin/offdeck/actions/evaluate',{method:'POST',body:JSON.stringify({idempotencyKey:`offdeck-evaluate:${newOpaqueId()}`})});},
  detectOffdeckDuplicates(){return request<JsonValue>('/v1/admin/offdeck/actions/detect-duplicates',{method:'POST',body:JSON.stringify({idempotencyKey:`offdeck-duplicates:${newOpaqueId()}`})});},
  suppressOffdeckCandidate(candidateId:string){return request<JsonValue>(`/v1/admin/offdeck/candidates/${encodeURIComponent(candidateId)}/actions/suppress`,{method:'POST',body:JSON.stringify({actorId:'admin',idempotencyKey:`offdeck-suppress:${candidateId}:${newOpaqueId()}`})});},
  whitelistOffdeckDuplicate(groupId:string){return request<JsonValue>(`/v1/admin/offdeck/duplicate-groups/${encodeURIComponent(groupId)}/actions/whitelist`,{method:'POST',body:JSON.stringify({actorId:'admin',idempotencyKey:`offdeck-whitelist:${groupId}:${newOpaqueId()}`})});},
  createOffdeckReview(body:JsonValue){return request<OffdeckReview>('/v1/admin/offdeck/reviews',{method:'POST',body:JSON.stringify(body)});},
  getOffdeckReviewProgress(reviewId:string){return request<Pick<OffdeckReview,'reviewId'|'state'|'createdAtMs'>>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}?view=progress`);},
  getOffdeckReview(reviewId:string){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}`);},
  cancelOffdeckReview(reviewId:string){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}`,{method:'DELETE',body:JSON.stringify({idempotencyKey:`offdeck-cancel:${reviewId}:${newOpaqueId()}`})});},
  confirmOffdeckSelection(reviewId:string,body:JsonValue){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}/actions/confirm-selection`,{method:'POST',body:JSON.stringify({...body as Record<string,JsonValue>,idempotencyKey:`offdeck-selection:${reviewId}:${newOpaqueId()}`})});},
  confirmOffdeckHighVolume(reviewId:string,body:JsonValue){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}/actions/confirm-high-volume`,{method:'POST',body:JSON.stringify({...body as Record<string,JsonValue>,idempotencyKey:`offdeck-escalation:${reviewId}:${newOpaqueId()}`})});},
  authorizeOffdeck(reviewId:string){return request<{batchId:string;cases:string[]}>('/v1/admin/offdeck/authorizations',{method:'POST',body:JSON.stringify({reviewId,actorId:'admin',idempotencyKey:`offdeck-authorize:${reviewId}:${newOpaqueId()}`})});},
  listOffdeckCases(){return request<{items:OffdeckCase[]}>('/v1/admin/offdeck/cases');},
  getOffdeckCase(caseId:string){return request<JsonValue>(`/v1/admin/offdeck/cases/${encodeURIComponent(caseId)}`);},
  listPerceptionRecords(filters: { cursor?: string; limit?: number; sourceKind?: string; rating?: number; resolutionStatus?: string; targetType?: string; targetId?: string } = {}) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
    return request<{ items: PerceptionRecord[]; nextCursor: string | null; currentRating?: { state:'ready'|'pending'; rating:number|null; sourceKind:string|null; expectedRevision:number; resolutionStatus?:string; resolutionRevision?:number }; currentWatched?: { state:'ready'|'pending'; watchedState:boolean|null; sourceKind:string|null; expectedRevision:number } }>(`/v1/admin/perception/records${query.size ? `?${query}` : ''}`);
  },
  rate(targetType: 'subject' | 'shelf_entry', targetId: string, expectedRevision: number, rating: number | null) {
    return request<{ operationRef: string; state: string; expectedResultRevision: number }>('/v1/admin/perception/records', {
      method:'POST', body:JSON.stringify({ targetType, targetId, expectedRevision, rating,
        idempotencyKey:`rating:${targetType}:${targetId}:${expectedRevision + 1}:${rating===null?'clear':rating}:${newOpaqueId()}` }),
    });
  },
  setWatched(targetType: 'subject' | 'shelf_entry', targetId: string, expectedRevision: number, watched: boolean | null) {
    return request<{ operationRef: string; state: string; expectedResultRevision: number }>('/v1/admin/perception/records', {
      method:'POST', body:JSON.stringify({targetType,targetId,expectedRevision,watched,
        idempotencyKey:`watched:${targetType}:${targetId}:${expectedRevision+1}:${watched===null?'clear':watched}:${newOpaqueId()}`}),
    });
  },
  getIntegration(kind: string) {
    return request<IntegrationState>(`/v1/admin/settings/integrations/${encodeURIComponent(kind)}`);
  },
  getWorkspaceRootSettings(){return request<WorkspaceRootSettings>('/v1/admin/settings/workspaces');},
  probeWorkspaceRoot(rootPath:string){return request<{rootPath:string;validation:'passed';availableBytes:number}>(
    '/v1/admin/settings/workspaces/actions/probe',{method:'POST',body:JSON.stringify({rootPath,idempotencyKey:`workspace-probe:${newOpaqueId()}`})});},
  configureWorkspaceRoot(rootPath:string,expectedConfigRevision:number){return request<WorkspaceRootSettings>(
    '/v1/admin/settings/workspaces',{method:'PATCH',body:JSON.stringify({rootPath,expectedConfigRevision,
      idempotencyKey:`workspace-configure:${expectedConfigRevision + 1}:${newOpaqueId()}`})});},
  testIntegration(kind: string, body: JsonValue) {
    return request<{ connectionProofId: string; identityProviderKey: string; expiresAtMs: number }>(`/v1/admin/settings/integrations/${encodeURIComponent(kind)}/actions/test`, { method:'POST', body:JSON.stringify(body) });
  },
  configureIntegration(kind: string, body: JsonValue) {
    return request<IntegrationState>(`/v1/admin/settings/integrations/${encodeURIComponent(kind)}`, { method:'PATCH', body:JSON.stringify(body) });
  },
  disconnectIntegration(kind: string, body: JsonValue) {
    return request<IntegrationState>(`/v1/admin/settings/integrations/${encodeURIComponent(kind)}/actions/disconnect`, { method:'POST', body:JSON.stringify(body) });
  },
  syncDouban() {
    return request<{ operationRef: string; state: string }>('/v1/admin/perception/actions/sync', { method:'POST', body:JSON.stringify({ idempotencyKey:`douban-sync:${new Date().toISOString()}` }) });
  },
  getPerceptionSyncState() {
    return request<PerceptionSyncState>('/v1/admin/perception/sync-state');
  },
  getRoutingPolicy(fieldId: string) {
    return request<{ policy: RoutingPolicy | null }>(`/v1/admin/routing/material-fields/${encodeURIComponent(fieldId)}`);
  },
  listRoutingPolicyRevisions(fieldId: string) {
    return request<{ items: RoutingPolicy[] }>(`/v1/admin/routing/material-fields/${encodeURIComponent(fieldId)}/revisions`);
  },
  previewRoutingPolicy(fieldId: string, body: JsonValue) {
    return request<{ result: string; targetShelfId: string | null; unresolvedReasonCode: string | null; previewDigest: string }>(
      `/v1/admin/routing/material-fields/${encodeURIComponent(fieldId)}/actions/preview`, { method: 'POST', body: JSON.stringify(body) });
  },
  publishRoutingPolicy(fieldId: string, body: JsonValue) {
    return request<{ policy: RoutingPolicy; replayed: boolean }>(`/v1/admin/routing/material-fields/${encodeURIComponent(fieldId)}`,
      { method: 'PATCH', body: JSON.stringify(body) });
  },
  chooseShelf(subject: FormationSubject, targetShelfId: string) {
    return request<{ decision: JsonValue; replayed: boolean }>(`/v1/admin/formation/subjects/${encodeURIComponent(subject.subjectId)}/actions/choose-shelf`, {
      method: 'POST', body: JSON.stringify({ targetShelfId,
        expectedDecisionHead: { revision: subject.routingDecisionHeadRevision, digest: subject.routingDecisionHeadDigest },
        idempotencyKey: `choose-shelf:${subject.subjectId}:${subject.routingDecisionDigest}:${targetShelfId}` }),
    });
  },
  setRunExpedited(subject: FormationSubject, expedited: boolean) {
    if (!subject.currentRun) throw new Error('当前 Subject 没有可操作的 Libra Run。');
    const run = subject.currentRun;
    const action = expedited ? 'expedite' : 'cancel-expedite';
    return request<{ libraRunId:string; stateRevision:number; stateDigest:string; priorityClass:'normal'|'expedited'; replayed:boolean }>(
      `/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/${action}`, {
        method:'POST',
        body:JSON.stringify({
          expectedRunStateRevision:run.stateRevision,
          expectedRunStateDigest:run.stateDigest,
          idempotencyKey:`${action}:${run.libraRunId}:${run.stateRevision}:${newOpaqueId()}`,
        }),
      });
  },
  discardRun(subject:FormationSubject,idempotencyKey:string){if(!subject.currentRun)throw new Error('当前媒体没有可放弃的整理任务。');const run=subject.currentRun;return request<{resultKind:'discarded'|'closure_pending'|'not_found'|'stale'|'invalid_state'|'conflict'|'integrity_error';libraRunId:string;reasonCode?:string;replayed?:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/discard`,{method:'POST',body:JSON.stringify({expectedRunStateRevision:run.stateRevision,expectedRunStateDigest:run.stateDigest,idempotencyKey})});},
  previewDefectAdmission(subject:FormationSubject){if(!subject.currentRun)throw new Error('当前媒体没有可操作的整理任务。');return request<DefectAdmissionPreview>(`/v1/admin/formation/runs/${encodeURIComponent(subject.currentRun.libraRunId)}/defect-admission-candidate`);},
  readRunOutcome(libraRunId:string){return request<{outcome:LibraRunOutcome|null}>(`/v1/admin/formation/runs/${encodeURIComponent(libraRunId)}/outcome`);},
  reprocessRun(outcome:LibraRunOutcome,idempotencyKey:string){return request<{intentId:string;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(outcome.libraRunId)}/actions/reprocess`,{method:'POST',body:JSON.stringify({expectedOutcomeDigest:outcome.outcomeDigest,idempotencyKey})});},
  admitWithDefects(subject:FormationSubject,candidate:DefectAdmissionCandidate){if(!subject.currentRun)throw new Error('当前媒体没有可操作的整理任务。');const run=subject.currentRun;return request<{resultKind:string;libraRunId:string;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/admit-with-defects`,{method:'POST',body:JSON.stringify({expectedRunStateRevision:run.stateRevision,expectedRunStateDigest:run.stateDigest,expectedDefectCandidateDigest:candidate.candidateDigest,acknowledged:true,idempotencyKey:`admit-with-defects:${run.libraRunId}:${run.stateRevision}:${newOpaqueId()}`})});},
  previewProductIdentity(subject:FormationSubject,providerId:string) {
    if(!subject.currentRun)throw new Error('当前整理已变化，请刷新。');
    return request<ProductIdentityPreview>(`/v1/admin/formation/runs/${encodeURIComponent(subject.currentRun.libraRunId)}/product-identity-preview?${subject.contentProfile === 'series' ? 'tmdbSeriesId' : 'tmdbMovieId'}=${encodeURIComponent(providerId)}`);
  },
  previewJavIdentity(subject:FormationSubject,javCode:string,candidate?:{siteRef:string;resourceKey:string}) {
    if(!subject.currentRun)throw new Error('当前整理已变化，请刷新。');
    const query=new URLSearchParams({javCode,...candidate});
    return request<JavIdentityPreview>(`/v1/admin/formation/runs/${encodeURIComponent(subject.currentRun.libraRunId)}/product-identity-preview?${query}`);
  },
  chooseJavIdentity(subject:FormationSubject,preview:JavQualifiedIdentityPreview,idempotencyKey:string) {
    if(!subject.currentRun)throw new Error('当前整理已变化，请刷新。');
    return request<{selectionIntentId:string;intentRevision:number;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(subject.currentRun.libraRunId)}/actions/choose-product-identity`,{method:'POST',body:JSON.stringify({
      javCode:preview.javCode,previewId:preview.previewId,candidateSetDigest:preview.candidateSetDigest,
      expectedRunStateRevision:preview.expectedRunStateRevision,expectedIdentityRevision:preview.expectedIdentityRevision,
      expectedSelectionIntentRevision:preview.expectedSelectionIntentRevision,idempotencyKey})});
  },
  chooseProductIdentity(subject:FormationSubject,providerId:string,idempotencyKey?:string){if(!subject.currentRun)throw new Error('当前媒体没有可恢复的整理任务。');const run=subject.currentRun;return request<{selectionIntentId:string;libraRunId:string;providerKey:string;intentRevision:number;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/choose-product-identity`,{method:'POST',body:JSON.stringify({... (subject.contentProfile === 'series' ? {tmdbSeriesId:providerId} : {tmdbMovieId:providerId}),expectedRunStateRevision:run.stateRevision,expectedIdentityRevision:run.currentIdentityRevision,candidateSetDigest:subject.productIdentityIssue?.candidateSetDigest||null,idempotencyKey:idempotencyKey||`choose-product-identity:${run.libraRunId}:${run.stateRevision}:${providerId}:${newOpaqueId()}`})});},
  retryAcceptance(subject:FormationSubject){if(!subject.executorIssue?.canRetry)throw new Error('当前接纳或上架故障不能重试。');const offerId=subject.executorIssue.offerId;return request(`/v1/admin/formation/acceptance/${encodeURIComponent(offerId)}/actions/retry`,{method:'POST',body:JSON.stringify({idempotencyKey:`acceptance-retry:${offerId}:${newOpaqueId()}`})});},
  createShelf(body: JsonValue) {
    return request<{ shelf: Shelf; replayed: boolean }>('/v1/admin/shelves', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  bindShelfTemplate(shelf: Shelf, template: Pick<RuleTemplate, 'templateId' | 'currentRevision'>) {
    return request<{ binding: { shelfId: string; standard: { ruleTemplateId: string } }; replayed: boolean }>(
      `/v1/admin/shelves/${encodeURIComponent(shelf.shelfId)}/actions/bind-template`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `shelf:${shelf.shelfId}:bind:${template.templateId}:${template.currentRevision}:${shelf.currentStandardRevision}`,
          shelfId: shelf.shelfId,
          expectedStandardRevision: shelf.currentStandardRevision,
          expectedRoutingProjectionRevision: shelf.routingProjection.revision,
          ruleTemplateId: template.templateId,
          expectedTemplateRevision: template.currentRevision,
        }),
      },
    );
  },
  async previewPlacement(shelf: Shelf, placementPolicy: ShelfPlacementPolicy, targetRootLocation = shelf.target.rootLocation) {
    const value = Object.fromEntries(Object.entries(placementPolicy).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : item])) as ShelfPlacementPolicy;
    return request<PlacementPreview>(
      `/v1/admin/shelves/${encodeURIComponent(shelf.shelfId)}/placement/actions/preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `shelf:${shelf.shelfId}:placement-preview:${shelf.currentPlacementRevision}:${newOpaqueId()}`,
          shelfId: shelf.shelfId,
          expectedPlacementRevision: shelf.currentPlacementRevision,
          target: { ...shelf.target, rootLocation: targetRootLocation.trim() },
          placement: {
            schemaRef: PLACEMENT_SCHEMA_REF,
            value,
            digest: await canonicalDigest(value as unknown as JsonValue),
          },
        }),
      },
    );
  },
  async publishPlacement(shelf: Shelf, placementPolicy: ShelfPlacementPolicy, preview: PlacementPreview, targetRootLocation = shelf.target.rootLocation) {
    const value = Object.fromEntries(Object.entries(placementPolicy).map(([key, item]) => [key, typeof item === 'string' ? item.trim() : item])) as ShelfPlacementPolicy;
    return request<{ shelf: Shelf; replayed: boolean }>(
      `/v1/admin/shelves/${encodeURIComponent(shelf.shelfId)}/placement`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          idempotencyKey: `shelf:${shelf.shelfId}:placement-publish:${preview.previewId}`,
          shelfId: shelf.shelfId,
          expectedPlacementRevision: shelf.currentPlacementRevision,
          expectedCurrentTargetDigest: preview.currentTargetDigest,
          target: { ...shelf.target, rootLocation: targetRootLocation.trim() },
          previewId: preview.previewId,
          previewDigest: preview.previewDigest,
          placement: {
            schemaRef: PLACEMENT_SCHEMA_REF,
            value,
            digest: await canonicalDigest(value as unknown as JsonValue),
          },
        }),
      },
    );
  },
  copyRuleTemplate(source: Pick<RuleTemplate, 'templateId' | 'currentRevision'>, name: string) {
    const newTemplateId = `movie-rule-${newOpaqueId()}`;
    return request<{ template: RuleTemplate; draft: { templateId: string; draftRevision: number; basePublishedRevision: number; rulesDigest: string }; replayed: boolean }>(
      `/v1/admin/rule-templates/${encodeURIComponent(source.templateId)}/actions/copy`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rule-template:copy:${newTemplateId}`,
          sourceTemplateId: source.templateId,
          newTemplateId,
          name,
          expectedSourceRevision: source.currentRevision,
        }),
      },
    );
  },
  getRuleTemplateDraft(templateId: string) {
    return request<{ templateId: string; writable: boolean; reasonCode: string | null; draft: RuleTemplateDraft | null }>(
      `/v1/admin/rule-templates/${encodeURIComponent(templateId)}/draft`,
    );
  },
  async reviseRuleTemplateDraft(draft: RuleTemplateDraft, rules: RuleTemplateRules) {
    const rulesDigest = await canonicalDigest(rules as unknown as JsonValue);
    const response = await request<{ draft: RuleTemplateDraft; replayed: boolean }>(
      `/v1/admin/rule-templates/${encodeURIComponent(draft.templateId)}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          idempotencyKey: `rule-template:draft:${draft.templateId}:${draft.basePublishedRevision}:${draft.draftRevision}:${rulesDigest}`,
          templateId: draft.templateId,
          expectedDraftRevision: draft.draftRevision,
          basePublishedRevision: draft.basePublishedRevision,
          rulesSchemaRef: draft.rulesSchemaRef || RULE_TEMPLATE_SCHEMA_REF,
          rules,
          rulesDigest,
        }),
      },
    );
    return response.draft;
  },
  previewRuleTemplate(template: Pick<RuleTemplate, 'templateId' | 'currentRevision'>, draft: Pick<RuleTemplateDraft, 'draftRevision' | 'rulesDigest'>) {
    return request<RuleTemplatePreview>(
      `/v1/admin/rule-templates/${encodeURIComponent(template.templateId)}/actions/preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rule-template:preview:${template.templateId}:${draft.draftRevision}:${newOpaqueId()}`,
          templateId: template.templateId,
          expectedCurrentRevision: template.currentRevision,
          expectedDraftRevision: draft.draftRevision,
          expectedDraftDigest: draft.rulesDigest,
        }),
      },
    );
  },
  publishRuleTemplate(preview: RuleTemplatePreview) {
    return request<{ template: RuleTemplate; affectedShelfCount: number; replayed: boolean }>(
      `/v1/admin/rule-templates/${encodeURIComponent(preview.templateId)}/actions/publish`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rule-template:publish:${preview.templateId}:${preview.previewId}`,
          templateId: preview.templateId,
          expectedCurrentRevision: preview.expectedCurrentRevision,
          expectedDraftRevision: preview.expectedDraftRevision,
          expectedDraftDigest: preview.expectedDraftDigest,
          previewId: preview.previewId,
          previewDigest: preview.previewDigest,
        }),
      },
    );
  },
  deregisterShelf(shelf:Shelf,enteredShelfName:string,preservePhysicalFilesAcknowledged:boolean,releaseControlAcknowledged:boolean){return request<{operationRef:string;deregistrationId:string;replayed:boolean}>(`/v1/admin/shelves/${encodeURIComponent(shelf.shelfId)}/actions/deregister`,{method:'POST',body:JSON.stringify({idempotencyKey:`shelf-deregister:${shelf.shelfId}:${shelf.updatedAtMs}:${shelf.routingProjection.revision}`,shelfId:shelf.shelfId,expectedStatus:'active',expectedUpdatedAtMs:shelf.updatedAtMs,expectedRoutingProjectionRevision:shelf.routingProjection.revision,confirmation:{decision:'deregister_shelf',enteredShelfName,preservePhysicalFilesAcknowledged,releaseControlAcknowledged}})});},
  registerMaterialField(body: JsonValue) {
    return request<{ materialField: MaterialField }>('/v1/admin/material-fields', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
  observeMaterialField(field: MaterialField, idempotencyKey = newOpaqueId('movie-observation-')) {
    const observationRevision = field.currentObservationRevision ?? 0;
    return request<ProcurementJourneyResult>(
      `/v1/admin/material-fields/${encodeURIComponent(field.fieldId)}/actions/observe`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey,
          fieldId: field.fieldId,
          expectedAccessRevision: field.currentAccessRevision,
          expectedObservationRevision: observationRevision,
          pageBudget: 100,
        }),
      },
    );
  },
  deregisterMaterialField(field: MaterialField) {
    return request<{ materialField: MaterialField }>(
      `/v1/admin/material-fields/${encodeURIComponent(field.fieldId)}/actions/deregister`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `material-field:${field.fieldId}:deregister:access-${field.currentAccessRevision}:policy-${field.extractionPolicyRevision}`,
          fieldId: field.fieldId,
          expectedAccessRevision: field.currentAccessRevision,
          expectedPolicyRevision: field.extractionPolicyRevision,
        }),
      },
    );
  },
};

export async function materialFieldRegistration(input: {
  fieldId: string;
  contentProfileHint: 'movie' | 'series' | 'jav' | 'mixed';
  name: string;
  rootLocation: string;
  includedDirectories: string[];
  excludedDirectories: string[];
}): Promise<JsonValue> {
  const policy: ExtractionPolicyValue = {
    includedDirectories: [...input.includedDirectories].sort(),
    excludedDirectories: [...input.excludedDirectories].sort(),
    // A Movie BDMV is one indivisible Procurement scope.  Its Playlist,
    // ClipInfo and BDMV control files must therefore pass the same Extraction
    // Policy as the selected M2TS payload; otherwise Run Admission freezes an
    // incomplete container that can never produce topology evidence.
    // ISO disc images are likewise one Movie unit and must be admitted by default.
    allowedExtensions: ['.avi', '.bdmv', '.clpi', '.iso', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpls', '.ts', '.wmv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  const extractionPolicyId = `${input.contentProfileHint}-policy-${input.fieldId}`;
  const access = {
    fieldId: input.fieldId,
    revision: 1,
    rootLocation: input.rootLocation,
    accessSchemaRef: 'helix://shelfdeck/platform/local-filesystem-field-access/v1',
  };
  return {
    idempotencyKey: `material-field:${input.fieldId}:register:v1`,
    fieldId: input.fieldId,
    name: input.name,
    contentProfileHint: input.contentProfileHint,
    policy: {
      extractionPolicyId,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy,
      policyDigest: await canonicalDigest({ extractionPolicyId, revision: 1, ...policy }),
    },
    access,
  };
}

export type MovieIdentityPreview = {tmdbMovieId:string;displayTitle:string;originalTitle:string|null;releaseYear:number|null;posterUrl:string|null};

export type SeriesIdentityPreview = Omit<MovieIdentityPreview, 'tmdbMovieId'> & { tmdbSeriesId: string; seasonNumber: number };
export type ProductIdentityPreview = MovieIdentityPreview | SeriesIdentityPreview;
export type JavQualifiedIdentityPreview={result:'qualified';javCode:string;displayTitle:string;posterUrl:string;siteRef:string;resourceKey:string;
  candidateSetDigest:string;previewId:string;expectedRunStateRevision:number;expectedIdentityRevision:0;expectedSelectionIntentRevision:number};
export type JavIdentityPreview=JavQualifiedIdentityPreview|{result:'ambiguous';javCode:string;candidates:Array<{siteRef:string;resourceKey:string;javCode:string}>}|{result:'not_qualified';javCode:string};
