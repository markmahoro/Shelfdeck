import type { TaskControlState } from '../types';

export type KairoxTargetGate = 'basedata' | 'metadata' | 'optimize';

export interface KairoxTaskProjection {
  id: string;
  object: { type: string; itemId?: string; subLibraryId?: string };
  targetGate: KairoxTargetGate;
  gateObjective: Record<string, unknown> | null;
  status: string;
  flowPlan?: {
    flowKind?: string;
    explanation?: Record<string, unknown>;
  };
  controlState?: TaskControlState;
  needsUserAction: boolean;
}

export type FactsFreshnessStatus = 'fresh' | 'needs_check' | 'stale' | 'unknown' | 'refreshing' | 'blocked' | 'invalidated';

export interface FactsFreshnessEntry {
  status: FactsFreshnessStatus | string;
  ownerGate?: string;
  updatedAt?: string;
  observedAt?: string;
  staleReason?: string;
  staleSource?: string;
  refreshTargetGate?: KairoxTargetGate | string;
  refreshTaskId?: string;
  evidence?: Record<string, unknown>;
}

export interface FactsFreshnessProjection {
  basedataFacts?: FactsFreshnessEntry;
  metadataFacts?: FactsFreshnessEntry;
  userPerceptionFacts?: FactsFreshnessEntry;
  gateFacts?: FactsFreshnessEntry;
}

export interface MediaFreezeProjection {
  frozen: boolean;
  frozenUntil?: string;
  reason?: string;
  sourceTaskId?: string;
  sourceTargetGate?: string;
  sourceFlowKind?: string;
}

export interface KairoxMediaProjection {
  id: string;
  title: string;
  subLibraryId: string;
  sourceProjection: Record<string, unknown>;
  basedataFacts: Record<string, unknown>;
  metadataFacts: Record<string, unknown>;
  userPerceptionFacts: Record<string, unknown>;
  gateFacts: Record<string, unknown>;
  helix?: Record<string, unknown> | null;
  factsFreshness: FactsFreshnessProjection;
  mediaFreeze: MediaFreezeProjection;
  lifecycle: {
    stage?: string;
    currentGate?: string;
    nextTargetGate?: KairoxTargetGate | null;
    reason?: string;
  };
  objective?: Record<string, unknown> | null;
  activeTask?: KairoxTaskProjection | null;
  nextAction?: {
    kind: 'none' | 'set_perception' | 'create_task' | 'view_task' | 'wait_media_freeze';
    targetGate?: KairoxTargetGate;
    gateObjective?: Record<string, unknown>;
    label: string;
  };
}

export interface KairoxDashboardProjection {
  health: {
    status: 'green' | 'yellow' | 'red';
    generatedAt?: string;
    checks: Array<{ key: string; label: string; status: 'green' | 'yellow' | 'red'; message?: string }>;
  };
  outcomes: {
    totalItems: number;
    metadataReadyItems: number;
    optimizedItems: number;
    maintenanceCompleteItems: number;
    offboardingCandidateItems: number;
  };
  optimization: {
    reclaimableBytes: number;
    realizedReclaimedBytes: number;
    optimizedItemCount: number;
  };
  risks: Array<{ code: string; label: string; count: number; target?: string }>;
}

export interface KairoxPolicyProjection {
  library: Record<string, unknown>;
  perception: Record<string, unknown>;
  optimizationObjectives: Record<string, unknown>;
  automation: Record<string, unknown>;
  offboarding: Record<string, unknown>;
}
