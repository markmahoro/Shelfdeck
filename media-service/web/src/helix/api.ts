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

export type Shelf = {
  shelfId: string;
  name: string;
  status: 'active' | 'deregistered';
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
    value: { folderTemplate: string; collisionPolicy: string };
  };
  createdAtMs: number;
  updatedAtMs: number;
};

export type FormationSubject = {
  formationViewId: string;
  subjectId: string;
  displayIdentity: string;
  contentProfile: string;
  structureKind: string;
  status: string;
  stage: 'routing_preparing' | 'routing_unresolved' | 'routing_resolved';
  stageLabel: string;
  intakeCount: number;
  primaryMaterialCount: number;
  relatedMaterialCount: number;
  lastAcceptedAtMs: number;
  routingState: 'preparing' | 'unresolved' | 'resolved';
  routingPolicyMode: 'direct' | 'sorting' | null;
  routingPolicyRevision: number | null;
  targetShelfId: string | null;
  unresolvedReasonCode: string | null;
  routingDecisionRevision: number | null;
  routingDecisionDigest: string | null;
  routingDecisionHeadRevision: number | null;
  routingDecisionHeadDigest: string | null;
  acceptanceSpecId: string | null;
  acceptanceSpecRevision: number | null;
  acceptanceSpecDigest: string | null;
  acceptanceSpecPublishedAtMs: number | null;
};

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
  currentInventoryRevision: number;
  currentDeckFactRevision: number;
  createdAtMs: number;
  terminalAtMs: number;
};

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
};

export type FormationSummary = {
  subjectCount: number;
  preparingCount: number;
  unresolvedCount: number;
  resolvedCount: number;
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
  listMaterialFields() {
    return request<{ items: MaterialField[] }>('/v1/admin/material-fields');
  },
  listShelves() {
    return request<{ items: Shelf[] }>('/v1/admin/shelves');
  },
  listRuleTemplates() {
    return request<{ items: RuleTemplate[] }>('/v1/admin/rule-templates');
  },
  listFormation() {
    return request<{ items: FormationSubject[]; summary: FormationSummary }>('/v1/admin/formation');
  },
  listCollection() {
    return request<{ items: CollectionEntry[] }>('/v1/admin/collection');
  },
  listPerceptionRecords(filters: { cursor?: string; limit?: number; sourceKind?: string; rating?: number; resolutionStatus?: string; targetType?: string; targetId?: string } = {}) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key, String(value)); });
    return request<{ items: PerceptionRecord[]; nextCursor: string | null; currentRating?: { state:'ready'|'pending'; rating:number|null; sourceKind:string|null; expectedRevision:number; resolutionStatus?:string; resolutionRevision?:number } }>(`/v1/admin/perception/records${query.size ? `?${query}` : ''}`);
  },
  rate(targetType: 'subject' | 'shelf_entry', targetId: string, expectedRevision: number, rating: number) {
    return request<{ operationRef: string; state: string; expectedResultRevision: number }>('/v1/admin/perception/records', {
      method:'POST', body:JSON.stringify({ targetType, targetId, expectedRevision, rating,
        idempotencyKey:`rating:${targetType}:${targetId}:${expectedRevision + 1}:${rating}:${crypto.randomUUID()}` }),
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
    return request<{ latest: JsonValue | null; activeCount: number }>('/v1/admin/perception/sync-state');
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
  createShelf(body: JsonValue) {
    return request<{ shelf: Shelf; replayed: boolean }>('/v1/admin/shelves', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
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
    allowedExtensions: ['.avi', '.bdmv', '.clpi', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.mpls', '.ts', '.wmv'],
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
