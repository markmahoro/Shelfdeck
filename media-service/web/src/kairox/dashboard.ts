import type { DashboardHealthSummary, SpaceStats } from '../types';
import type { KairoxDashboardProjection } from './types';

function countFromRecord(record: Record<string, number> | undefined, keys: string[]) {
  if (!record) return 0;
  return keys.reduce((sum, key) => sum + (Number(record[key]) || 0), 0);
}

export function toKairoxDashboardProjection(
  summary: DashboardHealthSummary | undefined,
  space: SpaceStats | undefined,
): KairoxDashboardProjection {
  const checks = [
    ...(summary?.serviceAvailability?.checks || []),
    ...(summary?.externalIntegrations?.checks || []),
  ];
  const media = summary?.media;
  const tasks = summary?.tasks;
  const risks = [
    {
      code: 'awaiting_confirmation',
      label: '等待确认',
      count: Number(tasks?.awaitingConfirmationTasks || 0),
      target: '/tasks?attention=confirmation',
    },
    {
      code: 'failed_tasks',
      label: '失败待恢复',
      count: Number(tasks?.failedTasks || 0),
      target: '/tasks?attention=recovery',
    },
    ...((summary?.businessStatus?.signals || []).map((signal) => ({
      code: signal.code,
      label: signal.label,
      count: Number(signal.count || 0),
      target: signal.code.includes('delete') ? '/delete-candidates' : undefined,
    }))),
  ].filter((risk) => risk.count > 0);

  return {
    health: {
      status: summary?.status || 'yellow',
      generatedAt: summary?.generatedAt,
      checks: checks.map((check) => ({
        key: check.key,
        label: check.label,
        status: check.status,
        message: check.message,
      })),
    },
    outcomes: {
      totalItems: Number(media?.totalItems || 0),
      metadataReadyItems: Math.max(0, Number(media?.totalItems || 0) - Number(media?.metadataIncompleteItems || 0)),
      optimizedItems: countFromRecord(media?.byLifecycleStage, ['optimized', 'archive_ready', 'archived']),
      archivedItems: Number(media?.archiveLikeItems || media?.closedItems || 0),
      deleteCandidateItems: countFromRecord(media?.byRecommendedTargetGate, ['delete']),
    },
    optimization: {
      reclaimableBytes: Number(space?.reclaimableBytes || 0),
      realizedReclaimedBytes: Number(space?.realizedReclaimedBytes || 0),
      optimizedItemCount: Number(space?.transcode?.itemCount || 0) + Number(space?.upgrade?.itemCount || 0),
    },
    risks,
  };
}
