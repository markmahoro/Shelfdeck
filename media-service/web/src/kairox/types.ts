import type { TaskControlState } from '../types';

export type KairoxTargetGate = 'ingest' | 'metadata' | 'optimize' | 'archive' | 'delete';

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

export interface KairoxMediaProjection {
  id: string;
  title: string;
  subLibraryId: string;
  sourceFacts: Record<string, unknown>;
  mediaFacts: Record<string, unknown>;
  metadataFacts: Record<string, unknown>;
  userPerceptionFacts: Record<string, unknown>;
  gateFacts: Record<string, unknown>;
  lifecycle: {
    stage?: string;
    currentGate?: string;
    nextTargetGate?: KairoxTargetGate | null;
    reason?: string;
  };
  objective?: Record<string, unknown> | null;
  activeTask?: KairoxTaskProjection | null;
  deleteCandidate?: Record<string, unknown> | null;
  nextAction?: {
    kind: 'none' | 'set_perception' | 'create_task' | 'view_task' | 'review_delete_candidate';
    targetGate?: KairoxTargetGate;
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
    archivedItems: number;
    deleteCandidateItems: number;
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
  disposal: Record<string, unknown>;
}
