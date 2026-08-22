export const healthLabels: Record<string, string> = {
  never_assessed: '尚未检查',
  healthy: '健康',
  observing: '观察中',
  repairing: '修复中',
  attention_required: '需要处理',
};

export const reviewStateLabels: Record<string, string> = {
  open: '待确认范围',
  preparing: '正在准备范围',
  selection_confirmed: '范围已确认',
  awaiting_escalation: '需要二次确认',
  authorized: '已授权退出',
  cancelled: '已取消',
};

export const caseStateLabels: Record<string, string> = {
  executing: '正在退出',
  blocked: '已暂停',
  awaiting_reauthorization: '需要重新授权',
  completed: '已完成',
};

export const resolutionLabels: Record<string, string> = {
  matched: '已匹配',
  unmatched: '未匹配',
  ambiguous: '有歧义',
  superseded: '已更正',
};

export const recordKindLabels: Record<string, string> = {
  observation: '观察',
  correction: '更正',
  retraction: '撤回',
};

export const procurementStageLabels: Record<string, string> = {
  not_started: '等待扫描',
  procurement_run_active: '正在扫描',
  candidate_published: '已发现电影',
  handoff_a_ready: '已发现电影',
  handoff_a_accepted: '已交给整理',
  handoff_a_rejected: '未被接收',
  triage_not_ready: '还不能整理',
};

export function labelOf(map: Record<string, string>, value: string | null | undefined, fallback = value || '—') {
  if (!value) return fallback;
  return map[value] || fallback;
}
