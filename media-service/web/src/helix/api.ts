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

export class AdminApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
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
  const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
  throw new AdminApiError(response.status, body.error?.code || `HTTP_${response.status}`, body.error?.message || '请求未完成。');
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
    allowedExtensions: ['.avi', '.m2ts', '.m4v', '.mkv', '.mov', '.mp4', '.ts', '.wmv'],
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
