export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ExtractionPolicyValue = {
  includedDirectories: string[];
  excludedDirectories: string[];
  allowedExtensions: string[];
  minimumSizeBytes: number;
  excludedMaterialKeys: string[];
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
    candidateCount: number;
    openOfferCount: number;
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
  formationViewId: string;
  subjectId: string;
  displayIdentity: string;
  contentProfile: string;
  structureKind: string;
  status: string;
  classification: 'pending' | 'in_progress' | 'attention_required' | 'completed';
  myRating: number | null;
  myRatingSource: string | null;
  myRatingRevision: number | null;
  ratingState?: 'pending'|'ready';
  ratingResolutionStatus?: 'found'|'not_found'|null;
  ratingReasonCode?: string|null;
  productIdentityIssue: null | { result:'not_found'|'ambiguous'|'conflicting'; reasonCode:string; candidateSetDigest:string; candidates:Array<{ providerKey:string; displayTitle:string; originalTitle:string|null; releaseYear:number|null }> };
  executorIssue: null | { phase:string; errorCode:string; attemptCount:number; owner:string; recoveryState:string;
    recoveryGeneration:number; automaticRecoveryUsed:boolean; canRetry:boolean; offerId:string };
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
  processDetail?: {
    receivedMaterials: { primaryCount:number; relatedCount:number; relatedRoles:string[]; state:'completed'; summary:string };
    mediaOrganization: { state:'completed'|'attention'|'pending'; summary:string; steps:FormationSubject['organizingSteps'] };
    acceptanceAndShelving: { state:'completed'|'attention'|'pending'; summary:string; reasonCode:string|null };
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
  outcome:'user_abandoned'; label:'已结束 · 用户放弃'; endedAtMs:number; stateRevision:number; stateDigest:string; evidenceDigest:string };

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

export type CollectionEntry = {
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
  defectAdmission: { defectCount:number; defects:Array<{defectCode:'actor_unavailable'|'external_source_exhausted';waivedRequirementCodes:string[]}> } | null;
  health: HealthSummary;
  currentInventoryRevision: number;
  currentDeckFactRevision: number;
  createdAtMs: number;
  terminalAtMs: number | null;
};
export type DefectAdmissionCandidate={candidateRevision:number;libraRunId:string;frozenRunStateRevision:number;frozenRunStateDigest:string;terminalEvidenceDigest:string;defects:Array<{defectCode:'actor_unavailable'|'external_source_exhausted';sourceFailureCode:string;waivedRequirementCodes:string[]}>;waivedRequirementCodes:string[];candidateDigest:string};
export type HealthState = 'never_assessed'|'healthy'|'observing'|'repairing'|'attention_required';
export type HealthSummary = { shelfEntryId?:string; state:HealthState; careBasisDigest?:string; basisCurrent?:boolean;
  dimensions?:Record<'custody'|'presentation'|'conformance',{state:string;assessedAtMs:number|null;evidenceDigest:string|null;findings:CareFinding[]}>;
  activeCase?:CareCase|null; nextCustodyDueAtMs?:number; nextDeepDueAtMs?:number; updatedAtMs?:number };
export type CareFinding = { findingId:string; findingKind:string; severity:string; repairability:string; state:string; createdAtMs:number };
export type CareCase = { aftercareCaseId:string; caseGeneration:number; triggerDigest:string; state:string;
  terminalReasonCode:string|null; terminalEvidenceDigest:string|null; createdAtMs:number; terminalAtMs:number|null; careBasisDigest:string };
export type CareDetail = { shelfEntryId:string; health:HealthSummary; basis:{inventoryRevision:number;standardRevision:number;placementRevision:number;careBasisDigest:string};
  activeCaseProgress:{aftercareCaseId:string;stage:string;progressPercent:number|null;progress?:{mode:string;currentValue:number;totalValue:number;unit:string;rate:number|null;etaMs:number|null;terminal:boolean}|null;goals:string[]}|null;
  history:{assessments:Array<{assessmentId:string;assessmentKind:string;result:string;assessedAtMs:number}>;findings:CareFinding[];cases:CareCase[];commits:Array<{inventoryCommitId:string;previousInventoryRevision:number;newInventoryRevision:number;committedAtMs:number}>} };
export type OffdeckPolicy={policyId:string;revision:number;status:'active'|'disabled';duplicateScheduleEnabled:boolean;entryRules:Array<{ruleId:string;ordinal:number;shelfScope:'all'|'selected';shelfIds:string[];condition:JsonValue}>;policyDigest:string};
export type OffdeckCandidate={candidate_id:string;candidate_kind:'entry'|'duplicate_group';shelf_entry_id:string|null;duplicate_group_id:string|null;state:string;created_at_ms:number};
export type OffdeckDuplicateGroup={duplicate_group_id:string;canonical_identity_digest:string;member_set_digest:string;state:string;members:Array<{shelf_entry_id:string;inventory_revision:number;member_digest:string}>};
export type OffdeckReview={reviewId:string;originKind:string;originRef:string;state:string;createdAtMs:number;reservations:Array<{reservationId:string;shelfEntryId:string;inventoryRevision:number;state:string}>;scopes:Array<{destructionScopeId:string;shelfEntryId:string;memberCount:number;totalBytes:number;scopeDigest:string;state:string;materials:Array<{ordinal:number;materialKey:string;role:string;location:string;sizeBytes:number;deleteCondition:string}>}>;selection:{selectionReceiptId:string;scopeSetDigest:string;entryCount:number;primaryCount:number;totalBytes:number;deckCoverageRatio:number;highVolume:boolean}|null;escalation:{escalationReceiptId:string}|null};
export type OffdeckCase={offdeckCaseId:string;shelfEntryId:string;state:'executing'|'blocked'|'awaiting_reauthorization'|'completed';recoveryRevision:number;retryAtMs:number|null;blockedReason:string|null;createdAtMs:number;terminalAtMs:number|null};

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
  settings?: { language?: string; maxDownloadAttempts?: number };
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

export type OverviewProjection = {
  generatedAt: string;
  systemState: { kind:'unconfigured'|'running'|'faulted'; label:string; href:string };
  metrics: Array<{ key:string; label:string; value:number; note:string; href?:string }>;
  todos: Array<{ key:string; label:string; count:number; href:string }>;
  inProgress: { count:number; label:string; href:string } | null;
  setup: { activeMaterialFieldCount:number; activeShelfCount:number; productChoice?:'full_auto'|'key_step_confirmation' };
  ledger: Array<{ key:string; label:string; href?:string; value?:number }>;
};

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
    productChoice: 'full_auto' | 'key_step_confirmation';
    fullAutoReady: boolean;
    productChoiceLabel: string;
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

export type AutomaticOperationCommandResult = {
  replayed: boolean;
  standingAuthorization: {
    authorizationId: string;
    revision: number;
    state: 'enabled' | 'revoked';
    authorizationScopeKind: string;
    coversExclusiveRelatedInput: boolean;
  } | null;
  ownerResults: Array<{ owner: string; topic: string; result: string; label: string }>;
  readiness: SetupReadinessProjection | null;
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

export type FormationSummary = {
  totalCount: number;
  pendingCount: number;
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
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, '0')).join('');
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
  createSession(apiKey: string) {
    return request<void>('/v1/admin/session', { method: 'POST', headers: { 'x-api-key': apiKey } });
  },
  getOverview() {
    return request<OverviewProjection>('/v1/admin/overview');
  },
  getSetupReadiness() {
    return request<SetupReadinessProjection>('/v1/admin/setup-readiness');
  },
  getAutomaticOperation() {
    return request<SetupReadinessProjection>('/v1/admin/settings/automatic-operation');
  },
  enableFullAutomaticOperation(expectedRevision: number) {
    return request<AutomaticOperationCommandResult>('/v1/admin/settings/automatic-operation/actions/enable-full', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `automatic-operation:enable-full:${expectedRevision}:${crypto.randomUUID()}`,
        expectedRevision,
        coverExclusiveRelatedInput: true,
      }),
    });
  },
  requireSettlementConfirmation(expectedRevision: number) {
    return request<AutomaticOperationCommandResult>('/v1/admin/settings/automatic-operation/actions/require-settlement-confirmation', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: `automatic-operation:require-settlement:${expectedRevision}:${crypto.randomUUID()}`,
        expectedRevision,
      }),
    });
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
      method:'POST', body:JSON.stringify({ ...body, idempotencyKey:`people-register:${body.canonicalName}:${crypto.randomUUID()}` }),
    });
  },
  acceptPeopleCandidate(candidateId:string) {
    return request<{ person: { personId:string } }>('/v1/admin/people', {
      method:'POST', body:JSON.stringify({ candidateId, idempotencyKey:`people-accept:${candidateId}:${crypto.randomUUID()}` }),
    });
  },
  dismissPeopleCandidate(candidateId:string) {
    return request<{ candidate: { candidateId:string } }>('/v1/admin/people/actions/dismiss-candidate', {
      method:'POST', body:JSON.stringify({ candidateId, idempotencyKey:`people-dismiss:${candidateId}:${crypto.randomUUID()}` }),
    });
  },
  listMaterialFields() {
    return request<{ items: MaterialField[] }>('/v1/admin/material-fields');
  },
  listShelves() {
    return request<{ items: Shelf[] }>('/v1/admin/shelves');
  },
  listRuleTemplates() {
    return request<{ items: RuleTemplate[] }>('/v1/admin/rule-templates');
  },
  listFormation(section:'active'|'completed'='active', cursor?:string, filters?:{
    classification?:'pending'|'in_progress'|'attention_required';
    shelfId?:string; needsUserAction?:boolean; expedited?:boolean; q?:string;
  }) {
    const query=new URLSearchParams({section,limit:'25'});
    if(cursor)query.set('cursor',cursor);
    if(section==='active' && filters){
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
  listFormationHistory(cursor?:string) {
    const query=new URLSearchParams({section:'ended',limit:'25'});if(cursor)query.set('cursor',cursor);
    return request<{ items: FormationRunHistory[]; summary: FormationSummary; nextCursor:string|null; projection:{status:'ready'|'rebuilding'|'stale';asOfMs:number} }>(`/v1/admin/formation?${query}`);
  },
  listCollection(filters?:{ shelfId?:string; status?:'current'|'history'; health?:HealthState|'all' }) {
    const query=new URLSearchParams();
    if(filters?.shelfId)query.set('shelfId',filters.shelfId);
    if(filters?.status)query.set('status',filters.status);
    if(filters?.health && filters.health !== 'all')query.set('health',filters.health);
    const suffix=query.toString()?`?${query}`:'';
    return request<{ items: CollectionEntry[]; shelves?: Array<{shelfId:string;name:string;currentCount:number;historyCount:number}>; summary?:{currentCount:number;historyCount:number} }>(`/v1/admin/collection${suffix}`);
  },
  collectionPosterUrl(shelfEntryId: string) {
    return `/v1/admin/collection/${encodeURIComponent(shelfEntryId)}/poster`;
  },
  getCare(shelfEntryId:string){return request<CareDetail>(`/v1/admin/care/${encodeURIComponent(shelfEntryId)}`);},
  checkCare(shelfEntryId:string){return request<{operationRef:string;state:string;shelfEntryId:string}>(`/v1/admin/care/${encodeURIComponent(shelfEntryId)}/actions/check`,{method:'POST',body:JSON.stringify({idempotencyKey:`care-check:${shelfEntryId}:${crypto.randomUUID()}`})});},
  getOffdeckPolicy(){return request<OffdeckPolicy>('/v1/admin/offdeck/policies');},
  publishOffdeckPolicy(body:JsonValue){return request<OffdeckPolicy>('/v1/admin/offdeck/policies',{method:'PATCH',body:JSON.stringify(body)});},
  listOffdeckCandidates(){return request<{candidates:OffdeckCandidate[];duplicateGroups:OffdeckDuplicateGroup[];suppressions:JsonValue[];whitelists:JsonValue[]}>('/v1/admin/offdeck/candidates');},
  evaluateOffdeck(){return request<{operations:JsonValue[];matchedCount:number}>('/v1/admin/offdeck/actions/evaluate',{method:'POST',body:JSON.stringify({idempotencyKey:`offdeck-evaluate:${crypto.randomUUID()}`})});},
  detectOffdeckDuplicates(){return request<JsonValue>('/v1/admin/offdeck/actions/detect-duplicates',{method:'POST',body:JSON.stringify({idempotencyKey:`offdeck-duplicates:${crypto.randomUUID()}`})});},
  suppressOffdeckCandidate(candidateId:string){return request<JsonValue>(`/v1/admin/offdeck/candidates/${encodeURIComponent(candidateId)}/actions/suppress`,{method:'POST',body:JSON.stringify({actorId:'admin',idempotencyKey:`offdeck-suppress:${candidateId}:${crypto.randomUUID()}`})});},
  whitelistOffdeckDuplicate(groupId:string){return request<JsonValue>(`/v1/admin/offdeck/duplicate-groups/${encodeURIComponent(groupId)}/actions/whitelist`,{method:'POST',body:JSON.stringify({actorId:'admin',idempotencyKey:`offdeck-whitelist:${groupId}:${crypto.randomUUID()}`})});},
  createOffdeckReview(body:JsonValue){return request<OffdeckReview>('/v1/admin/offdeck/reviews',{method:'POST',body:JSON.stringify(body)});},
  getOffdeckReview(reviewId:string){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}`);},
  cancelOffdeckReview(reviewId:string){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}`,{method:'DELETE',body:JSON.stringify({idempotencyKey:`offdeck-cancel:${reviewId}:${crypto.randomUUID()}`})});},
  confirmOffdeckSelection(reviewId:string,body:JsonValue){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}/actions/confirm-selection`,{method:'POST',body:JSON.stringify({...body as Record<string,JsonValue>,idempotencyKey:`offdeck-selection:${reviewId}:${crypto.randomUUID()}`})});},
  confirmOffdeckHighVolume(reviewId:string,body:JsonValue){return request<OffdeckReview>(`/v1/admin/offdeck/reviews/${encodeURIComponent(reviewId)}/actions/confirm-high-volume`,{method:'POST',body:JSON.stringify({...body as Record<string,JsonValue>,idempotencyKey:`offdeck-escalation:${reviewId}:${crypto.randomUUID()}`})});},
  authorizeOffdeck(reviewId:string){return request<{batchId:string;cases:string[]}>('/v1/admin/offdeck/authorizations',{method:'POST',body:JSON.stringify({reviewId,actorId:'admin',idempotencyKey:`offdeck-authorize:${reviewId}:${crypto.randomUUID()}`})});},
  listOffdeckCases(){return request<{items:OffdeckCase[]}>('/v1/admin/offdeck/cases');},
  getOffdeckCase(caseId:string){return request<JsonValue>(`/v1/admin/offdeck/cases/${encodeURIComponent(caseId)}`);},
  listPerceptionRecords(filters: { cursor?: string; limit?: number; sourceKind?: string; rating?: number; resolutionStatus?: string; targetType?: string; targetId?: string } = {}) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
    return request<{ items: PerceptionRecord[]; nextCursor: string | null; currentRating?: { state:'ready'|'pending'; rating:number|null; sourceKind:string|null; expectedRevision:number; resolutionStatus?:string; resolutionRevision?:number } }>(`/v1/admin/perception/records${query.size ? `?${query}` : ''}`);
  },
  rate(targetType: 'subject' | 'shelf_entry', targetId: string, expectedRevision: number, rating: number | null) {
    return request<{ operationRef: string; state: string; expectedResultRevision: number }>('/v1/admin/perception/records', {
      method:'POST', body:JSON.stringify({ targetType, targetId, expectedRevision, rating,
        idempotencyKey:`rating:${targetType}:${targetId}:${expectedRevision + 1}:${rating===null?'clear':rating}:${crypto.randomUUID()}` }),
    });
  },
  getIntegration(kind: string) {
    return request<IntegrationState>(`/v1/admin/settings/integrations/${encodeURIComponent(kind)}`);
  },
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
          idempotencyKey:`${action}:${run.libraRunId}:${run.stateRevision}:${crypto.randomUUID()}`,
        }),
      });
  },
  discardRun(subject:FormationSubject){if(!subject.currentRun)throw new Error('当前媒体没有可放弃的整理任务。');const run=subject.currentRun;return request<{resultKind:string;libraRunId:string;replayed?:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/discard`,{method:'POST',body:JSON.stringify({expectedRunStateRevision:run.stateRevision,expectedRunStateDigest:run.stateDigest,idempotencyKey:`discard:${run.libraRunId}:${run.stateRevision}:${crypto.randomUUID()}`})});},
  previewDefectAdmission(subject:FormationSubject){if(!subject.currentRun)throw new Error('当前媒体没有可操作的整理任务。');return request<DefectAdmissionCandidate>(`/v1/admin/formation/runs/${encodeURIComponent(subject.currentRun.libraRunId)}/defect-admission-candidate`);},
  admitWithDefects(subject:FormationSubject,candidate:DefectAdmissionCandidate){if(!subject.currentRun)throw new Error('当前媒体没有可操作的整理任务。');const run=subject.currentRun;return request<{resultKind:string;libraRunId:string;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/admit-with-defects`,{method:'POST',body:JSON.stringify({expectedRunStateRevision:run.stateRevision,expectedRunStateDigest:run.stateDigest,expectedDefectCandidateDigest:candidate.candidateDigest,acknowledged:true,idempotencyKey:`admit-with-defects:${run.libraRunId}:${run.stateRevision}:${crypto.randomUUID()}`})});},
  chooseProductIdentity(subject:FormationSubject,tmdbMovieId:string){if(!subject.currentRun)throw new Error('当前媒体没有可恢复的整理任务。');const run=subject.currentRun;return request<{selectionIntentId:string;libraRunId:string;providerKey:string;intentRevision:number;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/choose-product-identity`,{method:'POST',body:JSON.stringify({tmdbMovieId,expectedRunStateRevision:run.stateRevision,expectedIdentityRevision:run.currentIdentityRevision,candidateSetDigest:subject.productIdentityIssue?.candidateSetDigest||null,idempotencyKey:`choose-product-identity:${run.libraRunId}:${run.stateRevision}:${tmdbMovieId}:${crypto.randomUUID()}`})});},
  retryAcceptance(subject:FormationSubject){if(!subject.executorIssue?.canRetry)throw new Error('当前接纳故障不能重试。');return request(`/v1/admin/formation/acceptance/${encodeURIComponent(subject.executorIssue.offerId)}/actions/retry`,{method:'POST',body:JSON.stringify({})});},
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
          idempotencyKey: `shelf:${shelf.shelfId}:placement-preview:${shelf.currentPlacementRevision}:${crypto.randomUUID()}`,
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
    const newTemplateId = `movie-rule-${crypto.randomUUID()}`;
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
    return request<RuleTemplateDraft>(
      `/v1/admin/rule-templates/${encodeURIComponent(draft.templateId)}/draft`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          idempotencyKey: `rule-template:draft:${draft.templateId}:${draft.draftRevision}:${rulesDigest}`,
          templateId: draft.templateId,
          expectedDraftRevision: draft.draftRevision,
          basePublishedRevision: draft.basePublishedRevision,
          rulesSchemaRef: draft.rulesSchemaRef || RULE_TEMPLATE_SCHEMA_REF,
          rules,
          rulesDigest,
        }),
      },
    );
  },
  previewRuleTemplate(template: Pick<RuleTemplate, 'templateId' | 'currentRevision'>, draft: Pick<RuleTemplateDraft, 'draftRevision' | 'rulesDigest'>) {
    return request<RuleTemplatePreview>(
      `/v1/admin/rule-templates/${encodeURIComponent(template.templateId)}/actions/preview`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rule-template:preview:${template.templateId}:${draft.draftRevision}:${crypto.randomUUID()}`,
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
  observeMaterialField(field: MaterialField) {
    const observationRevision = field.currentObservationRevision ?? 0;
    return request<ProcurementJourneyResult>(
      `/v1/admin/material-fields/${encodeURIComponent(field.fieldId)}/actions/observe`,
      {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `movie-observation:${field.fieldId}:access-${field.currentAccessRevision}:observation-${observationRevision}`,
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
  const extractionPolicyId = `movie-policy-${input.fieldId}`;
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
    contentProfileHint: 'movie',
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
