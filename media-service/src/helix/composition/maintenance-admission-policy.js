'use strict';

const MAINTENANCE = Object.freeze({
  'procurement:field-observation-entry-retention': '清理过期文件观察记录',
  'perception:periodic-douban-acquisitions': '同步豆瓣评分',
  'perception:active-periodic-acquisitions': '同步豆瓣评分',
  'people:ondeck-nfo-person-evidence': '收纳演员资料',
  'people:ondeck-person-evidence': '完善演员身份',
  'people:reliable-person-merge': '归并可靠演员身份',
  'people:us-adult-recommendations': '整理演员推荐',
  'arca:due-aftercare-shelf-entries': '检查收藏健康',
  'arca:aftercare-workspace-lifecycle': '清理到期维护工作区',
  'libra:completed-workspace-reclamation': '清理到期整理工作区',
  'libra:discarded-workspace-leftovers': '清理无引用残留',
  'arca:daily-offdeck-policy-evaluation': '评估退出收藏建议',
  'arca:weekly-offdeck-duplicate-detection': '检测重复收藏',
  'arca:recycle-expiry': '清理到期回收站',
  'execution-foundation:storage-maintenance': '维护内部数据库',
});
const SAFETY = new Set(['arca:recycle-maintenance', 'libra:active-workspace-cleanup-scopes']);
const NORMAL = new Set([
  'people:image-operations',
  'people:us-adult-recommendation-claims',
  'procurement:active-procurement-runs', 'procurement:active-material-fields', 'libra:pending-intake-offers',
  'libra:active-routing-subjects', 'perception:active-acquisitions', 'perception:active-subject-rating-resolutions',
  'perception:active-shelf-entry-rating-resolutions', 'arca:jav-identity-corrections', 'arca:failed-acceptance-assessments',
  'arca:acceptance-technical-recovery', 'arca:pending-ondeck-settlement-approvals', 'arca:blocked-ondeck-recovery',
  'libra:active-acceptance-spec-subjects', 'libra:ready-libra-runs', 'libra:active-libra-runs',
  'arca:active-aftercare-cases', 'libra:frozen-libra-outcomes', 'libra:completed-libra-outcomes',
  'arca:preparing-offdeck-reviews', 'arca:active-offdeck-cases', 'arca:active-shelf-deregistrations',
]);
const MAINTENANCE_WORKS = new Set([
  'people:system_person_registration',
  'people:system_person_merge',
  'arca:periodic_health_assessment', 'arca:periodic_custody_assessment', 'arca:care_workspace_reclaim',
  'arca:offdeck_policy_evaluation', 'arca:offdeck_duplicate_detection',
]);

function reconcilerCategory(scope) {
  const key = scope.ownerDomain + ':' + scope.reconcilerKey;
  if (Object.hasOwn(MAINTENANCE, key)) return 'maintenance';
  if (SAFETY.has(key)) return 'safety';
  if (NORMAL.has(key)) return 'normal';
  throw Object.assign(new Error('Reconciler has no explicit scheduling classification.'), { code: 'RECONCILER_SCHEDULING_CLASS_MISSING', details: { key } });
}

function workCategory(scope, acquisitionSchedulingClass) {
  if (scope.ownerDomain === 'perception' && scope.processType === 'perception_acquisition') {
    return acquisitionSchedulingClass(scope.processId);
  }
  return MAINTENANCE_WORKS.has(scope.ownerDomain + ':' + scope.workKind) ? 'maintenance' : 'normal';
}

function maintenanceTaskTitle(scope) {
  return MAINTENANCE[scope.ownerDomain + ':' + scope.reconcilerKey] || null;
}

module.exports = Object.freeze({ reconcilerCategory, workCategory, maintenanceTaskTitle });
