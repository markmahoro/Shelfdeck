const recycleErrors: Record<string, string> = {
  ARCA_SERIES_RELOCATION_BUSY: '整剧目录移动尚未完成，请先在收藏中检查处理',
  ARCA_SERIES_RELOCATION_MEMBER_BUSY: '同剧其他季仍有维护或退出任务',
  ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER: '剧集目录中有未登记的文件或文件夹',
  ARCA_SERIES_RELOCATION_TARGET_CONFLICT: '目标目录已被占用或原目录不可用',
  ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT: '剧集文件已变化，暂时无法移动',
  ARCA_SERIES_RELOCATION_UNSAFE_PATH: '目录包含链接或无法确认的路径',
  ARCA_SERIES_RELOCATION_CROSS_VOLUME: '整剧目录移动需要位于同一文件系统',
  ARCA_JAV_CORRECTION_BUSY: '影片身份正在纠正，请稍后再检查目录',
  ARCA_JAV_CORRECTION_DIRECTORY_NOT_READY: '影片纠正尚未完成清理，请稍后再试',
  ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED: '影片目录范围已变化，请重新检查',
  ARCA_JAV_DIRECTORY_CHECK_CHANGED: '目录检查结果已更新，请刷新',
  ARCA_JAV_DIRECTORY_CHECK_CORRUPT: '目录检查记录无法核验，请检查服务状态',
  ARCA_RECYCLE_SOURCE_IN_USE: '文件仍在使用，已保留',
  ARCA_RECYCLE_PRIMARY_PRESENT: '目录仍含影片文件，已保留',
  ARCA_RECYCLE_SOURCE_NOT_BOUND: '无法确认目录属于这部影片',
  ARCA_RECYCLE_ROOT_OVERLAP: '回收目录与媒体目录重叠，请检查目录配置',
  ARCA_RECYCLE_SCOPE_TOO_LARGE: '目录文件过多或体积过大',
  ARCA_RECYCLE_SYMLINK: '目录包含链接，无法安全移动',
  ARCA_RECYCLE_SPECIAL_FILE: '目录包含无法移动的特殊文件',
  ARCA_RECYCLE_NOT_DIRECTORY: '所选位置不是文件夹',
  ARCA_RECYCLE_SOURCE_INVALID: '目录位置无效',
  ARCA_RECYCLE_SOURCE_CHANGED: '原目录内容已变化，请刷新后重新确认',
  ARCA_RECYCLE_CONTENT_CHANGED: '文件内容已变化，处理已暂停',
  ARCA_RECYCLE_CONFIRMATION_STALE: '文件清单已变化，请刷新后重新确认',
  ARCA_RECYCLE_CHECK_SCOPE_CHANGED: '影片目录已变化，请重新检查',
  ARCA_RECYCLE_CHECK_CHANGED: '检查结果已更新，请刷新',
  ARCA_RECYCLE_MANIFEST_CHANGED: '文件清单已变化，处理已暂停',
  ARCA_RECYCLE_MANIFEST_INVALID: '文件清单无效，请重新检查',
  ARCA_RECYCLE_STATE_CHANGED: '回收状态已更新，请刷新',
  ARCA_RECYCLE_TARGET_EXISTS: '目标位置已有文件，无法覆盖',
  ARCA_RECYCLE_BOTH_LOCATIONS_MISSING: '原目录和回收目录均不存在',
  ARCA_RECYCLE_COPY_CONFLICT: '复制结果与原文件不一致，处理已暂停',
  ARCA_RECYCLE_COPY_FAILED: '文件复制失败',
  ARCA_RECYCLE_IO_FAILED: '文件读写失败，请检查目录访问权限',
  ARCA_RECYCLE_PATH_ESCAPE: '文件超出已确认的目录范围',
  ARCA_RECYCLE_NOT_FOUND: '回收记录不存在，请刷新',
  ARCA_RECYCLE_ENTRY_NOT_FOUND: '收藏记录不存在，请刷新',
  ARCA_RECYCLE_SOURCE_ALREADY_QUEUED: '此目录已在回收队列中',
  ARCA_RECYCLE_NOT_ARCHIVED: '文件尚未移入回收站，暂不能恢复',
  ARCA_RECYCLE_NOT_EXPIRED: '文件仍在保留期内',
  ARCA_RECYCLE_OPERATION_INVALID: '当前状态暂不支持此操作，请刷新',
  ARCA_RECYCLE_EFFECT_CONFLICT: '回收处理记录不一致，处理已暂停',
  ARCA_RECYCLE_KEY_CONFLICT: '回收请求与已有记录不一致，请刷新',
  EACCES: '没有目录访问权限',
  EPERM: '没有文件操作权限',
  ENOENT: '文件或目录不存在',
  ENOSPC: '目标磁盘空间不足',
  EBUSY: '文件正被其他程序占用',
};

export function recycleErrorLabel(code: string) {
  return recycleErrors[code] || '回收处理未完成，请刷新后重试';
}

const networkErrors: Record<string, string> = {
  ENOTFOUND: '无法找到服务地址',
  EAI_AGAIN: '暂时无法解析服务地址',
  ECONNREFUSED: '服务拒绝连接',
  ECONNRESET: '网络连接中断',
  ETIMEDOUT: '网络请求超时',
  ENETUNREACH: '网络不可达',
  EHOSTUNREACH: '服务主机不可达',
  UND_ERR_CONNECT_TIMEOUT: '连接服务超时',
  UND_ERR_HEADERS_TIMEOUT: '等待服务响应超时',
  UND_ERR_SOCKET: '网络连接中断',
  CERT_HAS_EXPIRED: '服务证书已过期',
  DEPTH_ZERO_SELF_SIGNED_CERT: '服务证书不受信任',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证服务证书',
  ERR_TLS_CERT_ALTNAME_INVALID: '服务证书与地址不匹配',
};

export function networkErrorLabel(code: string) {
  return networkErrors[code] || '网络连接失败';
}

export function processFailureLabel(code: string, message?: string) {
  const known: Record<string, string> = {
    ARCA_SERIES_REQUIRED_ASSET_UNAVAILABLE:'缺少可用的剧集图片',
    ARCA_SERIES_ASSET_SOURCE_CHANGED:'本次选中的剧集资料已变化',
    ARCA_SERIES_EXTERNAL_CHANGE:'剧集资料被其他程序修改',
    ARCA_SERIES_IDENTITY_CONFLICT:'现有剧集资料属于另一部剧',
    ARCA_SERIES_LOCAL_IDENTITY_UNPROVEN:'现有剧集图片缺少可核验的剧集信息',
    ARCA_SERIES_TARGET_CONFLICT:'目标位置已有不同的剧集资料',
    ARCA_SERIES_SOURCE_STALE:'剧集资料来源配置已变化',
    P4_OBSERVATION_RESULT_STORAGE_BOUND_EXCEEDED: '返回的信息超出处理上限',
    RECOVERY_EXECUTION_BUDGET_EXHAUSTED: '恢复处理超过允许时长',
    CLEAN_ARCA_STAGE_TARGET_OCCUPIED: '写入目标已被占用',
    CLEAN_ARCA_JAV_SHORT_TARGET_OCCUPIED: '目标目录已存在',
    CLEAN_ARCA_SHORT_STAGE_UNCERTAIN: '暂存文件状态无法确认',
    CLEAN_ARCA_JAV_CODE_REQUIRED: '影片番号无法核对',
    CLEAN_ARCA_JAV_TITLE_UNFITTING: '影片名称无法安全缩短',
    CLEAN_ARCA_JAV_SHORT_STEM_MISMATCH: '收藏架命名规则不匹配',
    CLEAN_ARCA_JAV_NAME_INVALID: '上架名称包含无效字符',
    CLEAN_ARCA_JAV_TARGET_COLLISION: '影片资料的目标名称冲突',
    PRODUCT_IDENTITY_EDITION_REQUIRED:'无法从来源确定版本名，请手动指定版本名',
  };
  return known[code] || networkErrors[code] || recycleErrors[code]
    || (message && /[\u3400-\u9fff]/.test(message) && !message.includes(code) ? message : '具体失败原因暂不可用');
}
