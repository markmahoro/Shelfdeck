'use strict';
const messages = Object.freeze({
  RESET_CONFIGURATION_REQUIRED: '尚未配置重置作业目录和备份目录，请完成配置后重新核对。',
  RESET_CONFIGURATION_INVALID: '重置作业配置无效，请修正后重新核对。',
  RESET_SUPERVISOR_REQUIRED: '重置管理进程尚未配置，请先完成作业配置。',
  RESET_OPERATOR_SPACE_INSUFFICIENT: '作业空间不足，请先整理备份，再重新核对。',
  RESET_PREFLIGHT_WORKSPACE_BACKUP_MISSING: '备份范围未覆盖全部工作区，请补齐作业配置后重新核对。',
  RESET_FENCE_CLOSE_NOT_PROVEN: '尚未取得旧进程停止写入的证明，重置不能继续。请核查停止记录。',
  RESET_OPERATOR_BUSY: '已有重置作业正在执行，请等待其结束。',
  RESET_STORAGE_BOUNDARY_OVERLAP: '临时清理目录与受保护目录重叠，请修正作业配置后重新核对。',
  RESET_WORKFLOW_AUTHORITY_CHANGED: '本次重置的授权或运行记录已变化，系统保持停止，请核查原始回执。',
});
const peopleMessages = Object.freeze({
  RESET_VERIFY_PEOPLE_REFERENCE_FACTS_INVALID: '人物参考资料不完整。请修复后重新核对。',
  RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_INVALID: '人物参考资料不完整。请修复后重新核对。',
  RESET_VERIFY_PEOPLE_REFERENCE_ARTIFACT_CHANGED: '人物参考资料的登记已变化。请重新核对。',
  RESET_VERIFY_PEOPLE_REFERENCE_CHANGED: '人物参考资料已变化。请重新核对。',
  RESET_VERIFY_PEOPLE_REFERENCE_ROOT_INVALID: '人物参考资料目录配置无效。请检查后重新核对。',
  RESET_VERIFY_PEOPLE_REFERENCE_STORAGE_INVALID: '人物参考资料无法读取或校验不符。请检查后重新核对。',
});
function resetErrorMessage(code, { preflight = false } = {}) {
  if (peopleMessages[code]) return (preflight ? '预检未通过：' : '重置无法继续：') + peopleMessages[code];
  return messages[code] || (preflight ? '预检未通过，请核查作业配置后重新核对。' :
    '重置未完成，系统保持停止。请查看恢复资料并核查失败阶段。');
}
module.exports = Object.freeze({ resetErrorMessage });
