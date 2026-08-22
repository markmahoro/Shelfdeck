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
      state: 'waiting' | 'scanning' | 'completed';
      pageCount: number;
      observationRevision: number | null;
      inProgress: boolean;
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
  minimumRasterClass: string;
  acceptedPrimaryAudioClasses: string[];
};

export type MovieRuleBranch = {
  conditionKind: 'no_rating' | 'rating_equals';
  rating?: number;
  requirements: {
    mandatoryMedia: MediaRequirement;
    space: { maxSizeGiB: number | null; maxSizeBytes: number | null };
  };
};

export type ProfileRuleSet = {
  contentProfile: string;
  decisionInputKinds: string[];
  decisionBranches: MovieRuleBranch[];
  profileRuleSetDigest: string;
};

export type RuleTemplate = {
  templateId: string;
  name: string;
  ownerKind: 'system' | 'user';
  status: 'active' | 'archived';
  currentRevision: number;
  current: {
    revision: number;
    rulesDigest: string;
    rules: { profileRuleSets: ProfileRuleSet[] };
  };
};

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
  productIdentityIssue: null | { result:'not_found'|'ambiguous'|'conflicting'; reasonCode:string; candidateSetDigest:string; candidates:Array<{ providerKey:string; displayTitle:string; originalTitle:string|null; releaseYear:number|null }> };
  executorIssue: null | { phase:string; errorCode:string; attemptCount:number; owner:string; recoveryState:string;
    recoveryGeneration:number; automaticRecoveryUsed:boolean; canRetry:boolean; offerId:string };
  primaryMaterialCount: number;
  addedAtMs: number;
  organizingRequirement: string;
  organizingAction: string;
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
  health: HealthSummary;
  currentInventoryRevision: number;
  currentDeckFactRevision: number;
  createdAtMs: number;
  terminalAtMs: number | null;
};
export type HealthState = 'never_assessed'|'healthy'|'observing'|'repairing'|'attention_required';
export type HealthSummary = { shelfEntryId?:string; state:HealthState; careBasisDigest?:string; basisCurrent?:boolean;
  dimensions?:Record<'custody'|'presentation'|'conformance',{state:string;assessedAtMs:number|null;evidenceDigest:string|null;findings:CareFinding[]}>;
  activeCase?:CareCase|null; nextCustodyDueAtMs?:number; nextDeepDueAtMs?:number; updatedAtMs?:number };
export type CareFinding = { findingId:string; findingKind:string; severity:string; repairability:string; state:string; createdAtMs:number };
export type CareCase = { aftercareCaseId:string; state:string; createdAtMs:number; terminalAtMs:number|null; careBasisDigest:string };
export type CareDetail = { shelfEntryId:string; health:HealthSummary; basis:{inventoryRevision:number;standardRevision:number;placementRevision:number;careBasisDigest:string};
  activeCaseProgress:{aftercareCaseId:string;stage:string;progressPercent:number;goals:string[]}|null;
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
  metrics: Array<{ key:string; label:string; value:number; note:string }>;
  setup: { activeMaterialFieldCount:number; activeShelfCount:number };
  ledger: Array<{ key:string; label:string; value:number }>;
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
  throw new AdminApiError(
    response.status,
    body.error?.code || `HTTP_${response.status}`,
    body.error?.message || '请求未完成。',
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
  listPeople(params:{cursor?:string;limit?:number;search?:string;status?:'active'|'merged'}={}) {
    const query=new URLSearchParams();Object.entries(params).forEach(([key,value])=>{if(value!==undefined&&value!=='')query.set(key,String(value));});
    return request<PeopleProjection>(`/v1/admin/people${query.size?`?${query}`:''}`);
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
  listFormation(section:'active'|'completed'='active', cursor?:string) {
    const query=new URLSearchParams({section,limit:'25'});if(cursor)query.set('cursor',cursor);
    return request<{ items: FormationSubject[]; summary: FormationSummary; nextCursor:string|null; projection:{status:'ready'|'rebuilding'|'stale';asOfMs:number} }>(`/v1/admin/formation?${query}`);
  },
  listFormationHistory(cursor?:string) {
    const query=new URLSearchParams({section:'ended',limit:'25'});if(cursor)query.set('cursor',cursor);
    return request<{ items: FormationRunHistory[]; summary: FormationSummary; nextCursor:string|null; projection:{status:'ready'|'rebuilding'|'stale';asOfMs:number} }>(`/v1/admin/formation?${query}`);
  },
  listCollection() {
    return request<{ items: CollectionEntry[] }>('/v1/admin/collection');
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
    return request<{ latest: { state?: string; createdAtMs?: number; terminalAtMs?: number | null } | null; activeCount: number }>('/v1/admin/perception/sync-state');
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
  chooseProductIdentity(subject:FormationSubject,tmdbMovieId:string){if(!subject.currentRun)throw new Error('当前媒体没有可恢复的整理任务。');const run=subject.currentRun;return request<{selectionIntentId:string;libraRunId:string;providerKey:string;intentRevision:number;replayed:boolean}>(`/v1/admin/formation/runs/${encodeURIComponent(run.libraRunId)}/actions/choose-product-identity`,{method:'POST',body:JSON.stringify({tmdbMovieId,expectedRunStateRevision:run.stateRevision,expectedIdentityRevision:run.currentIdentityRevision,candidateSetDigest:subject.productIdentityIssue?.candidateSetDigest||null,idempotencyKey:`choose-product-identity:${run.libraRunId}:${run.stateRevision}:${tmdbMovieId}:${crypto.randomUUID()}`})});},
  retryAcceptance(subject:FormationSubject){if(!subject.executorIssue?.canRetry)throw new Error('当前接纳故障不能重试。');return request(`/v1/admin/formation/acceptance/${encodeURIComponent(subject.executorIssue.offerId)}/actions/retry`,{method:'POST',body:JSON.stringify({})});},
  createShelf(body: JsonValue) {
    return request<{ shelf: Shelf; replayed: boolean }>('/v1/admin/shelves', {
      method: 'POST',
      body: JSON.stringify(body),
    });
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
    endpointId: `local-fs-${input.fieldId}`,
    rootLocation: input.rootLocation,
    mountScopeId: `local-mount-${input.fieldId}`,
    mountScopeRevision: 1,
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
    access: { ...access, accessDigest: await canonicalDigest(access) },
  };
}
