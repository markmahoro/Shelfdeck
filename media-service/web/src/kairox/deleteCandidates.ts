import type { DeleteCandidate } from '../api/client';

export type DeleteCandidateTab = 'pending_review' | 'confirmed' | 'snoozed' | 'kept_archived' | 'suppressed' | 'deleted';

export interface KairoxDeleteCandidateView {
  itemId: string;
  title: string;
  status: DeleteCandidateTab;
  statusLabel: string;
  archivedAt: string;
  eligibleAt: string;
  reason: string;
  rule: string;
  rating: string;
  decision: string;
  taskId?: string;
  raw: DeleteCandidate;
}

export const DELETE_CANDIDATE_TABS: Array<{ value: DeleteCandidateTab; label: string }> = [
  { value: 'pending_review', label: '待处理' },
  { value: 'confirmed', label: '删除执行中' },
  { value: 'snoozed', label: '已延后' },
  { value: 'kept_archived', label: '继续归档' },
  { value: 'suppressed', label: '不再建议' },
  { value: 'deleted', label: '已删除' },
];

export const DELETE_CANDIDATE_STATUS_LABELS: Record<DeleteCandidateTab, string> = {
  pending_review: '待处理',
  confirmed: '删除执行中',
  snoozed: '已延后',
  kept_archived: '继续归档',
  suppressed: '不再建议',
  deleted: '已删除',
};

export function toKairoxDeleteCandidateView(candidate: DeleteCandidate): KairoxDeleteCandidateView {
  const status = candidate.candidateStatus as DeleteCandidateTab;
  return {
    itemId: candidate.itemId,
    title: candidate.itemName || candidate.itemId,
    status,
    statusLabel: DELETE_CANDIDATE_STATUS_LABELS[status] || candidate.candidateStatus,
    archivedAt: formatDate(candidate.archivedAt),
    eligibleAt: formatDate(candidate.eligibleAt),
    reason: reasonLabel(candidate.eligibilityReason),
    rule: candidate.matchedRule?.ruleName || '-',
    rating: candidate.matchedRule?.rating == null ? '-' : `${candidate.matchedRule.rating}★`,
    decision: candidate.decision || '-',
    taskId: candidate.taskId,
    raw: candidate,
  };
}

export function canConfirmDelete(candidate: KairoxDeleteCandidateView): boolean {
  return !['confirmed', 'deleted'].includes(candidate.status);
}

export function canReview(candidate: KairoxDeleteCandidateView): boolean {
  return candidate.status !== 'deleted';
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function reasonLabel(value?: string): string {
  if (value === 'delete_policy_matched') return '命中处置策略';
  return value || '-';
}
