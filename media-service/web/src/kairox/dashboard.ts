import type { DashboardHealthSummary, SpaceStats } from '../types';
import type { KairoxDashboardProjection } from './types';

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
      target: signal.code.includes('offboarding') ? '/offboarding' : undefined,
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
      optimizedItems: Number(media?.maintenanceCompleteItems || 0),
      maintenanceCompleteItems: Number(media?.maintenanceCompleteItems || 0),
      offboardingCandidateItems: Number(media?.offboardingCandidateItems || 0),
    },
    optimization: {
      reclaimableBytes: Number(space?.reclaimableBytes || 0),
      realizedReclaimedBytes: Number(space?.realizedReclaimedBytes || 0),
      optimizedItemCount: Number(space?.optimize?.itemCount || 0),
    },
    risks,
  };
}
