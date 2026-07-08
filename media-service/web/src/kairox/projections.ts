import type { MediaTask } from '../types';
import type { KairoxTargetGate, KairoxTaskProjection } from './types';

const TARGET_GATES = new Set(['ingest', 'metadata', 'optimize', 'archive', 'delete']);

export function normalizeTargetGate(value: unknown): KairoxTargetGate | null {
  return typeof value === 'string' && TARGET_GATES.has(value)
    ? value as KairoxTargetGate
    : null;
}

export function toKairoxTaskProjection(task: MediaTask): KairoxTaskProjection {
  const targetGate = normalizeTargetGate(task.taskTarget?.targetGate) || 'metadata';
  const itemInfo = task.itemInfo as { subLibraryId?: string } | undefined;
  const flowPlan = task.flowPlan as { flowKind?: unknown } | undefined;
  const object = task.taskTarget?.object || {
    type: 'media_item',
    itemId: task.itemId,
    subLibraryId: itemInfo?.subLibraryId,
  };
  return {
    id: task.id,
    object: {
      type: typeof object.type === 'string' ? object.type : 'media_item',
      itemId: typeof object.itemId === 'string' ? object.itemId : task.itemId,
      subLibraryId: typeof object.subLibraryId === 'string' ? object.subLibraryId : itemInfo?.subLibraryId,
    },
    targetGate,
    gateObjective: task.taskTarget?.gateObjective || null,
    status: task.status,
    flowPlan: {
      flowKind: typeof flowPlan?.flowKind === 'string' ? flowPlan.flowKind : undefined,
    },
    controlState: task.controlState,
    needsUserAction: !!task.controlState?.requiresUserAction || task.status === 'awaiting_user_confirm',
  };
}
