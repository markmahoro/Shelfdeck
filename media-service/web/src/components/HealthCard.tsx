interface HealthCheckItem {
  status: string;
  message?: string;
  // scheduler
  runningTasks?: number;
  // smartTask
  enabled?: boolean;
  enabledActions?: string[];
  disabledReason?: string;
  lastRunAt?: string | null;
  // mediaLib
  totalSubLibraries?: number;
  enabledCount?: number;
  scheduledRefreshCount?: number;
  manualFolderCount?: number;
  staleSubLibraries?: string[];
  // douban
  hasSession?: boolean;
  doubanEnabledSubLibCount?: number;
  // optimize target projection
  lastChanged?: number | null;
  // upgrade
  smartSelectEnabled?: boolean;
  // transcode
  ffmpegOk?: boolean;
  deviceCount?: number;
}

interface HealthCardProps {
  status: 'green' | 'yellow' | 'red';
  checks?: Record<string, HealthCheckItem>;
}

const COLORS: Record<string, string> = {
  green: '#27ae60',
  yellow: '#f39c12',
  red: '#e74c3c',
};

const LABELS: Record<string, string> = {
  green: '正常',
  yellow: '降级',
  red: '异常',
};

const CHECK_LABELS: Record<string, string> = {
  scheduler:  '任务调度器',
  smartTask:  '后台自动入队',
  mediaLib:   '媒体库入库同步',
  douban:     '豆瓣评分抓取',
  strategy:   '优化目标计算',
  emby:       'Emby 连接',
  upgrade:    '洗版服务',
  transcode:  '转码服务',
};

function describe(key: string, item: HealthCheckItem): string {
  if (item.message) return item.message;

  switch (key) {
    case 'scheduler':
      return item.runningTasks ? `${item.runningTasks} 个任务运行中` : '无运行中任务';
    case 'smartTask':
      if (item.enabled === false) {
        if (item.disabledReason === 'no_enabled_actions') return '未启用自动入队';
        return '已停用';
      }
      if (!item.lastRunAt) return '等待首次运行';
      return `上次运行 ${new Date(item.lastRunAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    case 'mediaLib':
      if (!item.totalSubLibraries || !item.enabledCount) return '未配置';
      if (item.staleSubLibraries && item.staleSubLibraries.length > 0) {
        return `超时：${item.staleSubLibraries.join('、')}`;
      }
      if (item.manualFolderCount) {
        return `${item.scheduledRefreshCount || 0} 个定时入库同步，${item.manualFolderCount} 个真实目录库`;
      }
      return `${item.enabledCount}/${item.totalSubLibraries} 个媒体库`;
    case 'douban':
      if (!item.doubanEnabledSubLibCount) return '未配置';
      return item.hasSession ? '会话有效' : '会话无效';
    case 'strategy':
      if (!item.lastRunAt) return '等待首次运行';
      return `上次运行 ${new Date(item.lastRunAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}${item.lastChanged ? `，变更 ${item.lastChanged} 条` : ''}`;
    case 'emby':
      return '已连接';
    case 'upgrade':
      if (item.smartSelectEnabled === false) return '未配置';
      return '已连接';
    case 'transcode':
      if (item.deviceCount) return `${item.deviceCount} 个设备`;
      return '';
    default:
      return '';
  }
}

export default function HealthCard({ status, checks }: HealthCardProps) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 10,
        padding: 20,
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        borderLeft: `4px solid ${COLORS[status]}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: checks ? 16 : 0 }}>
        <span
          style={{
            display: 'inline-block',
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: COLORS[status],
          }}
        />
        <span style={{ fontSize: 16, fontWeight: 600 }}>服务状态：{LABELS[status]}</span>
      </div>
      {checks && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {Object.entries(checks).map(([key, item]) => {
            const desc = describe(key, item);
            return (
              <div
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: '#f9fafb',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    background: COLORS[item.status] || '#999',
                  }}
                />
                <span style={{ fontWeight: 500, flexShrink: 0 }}>{CHECK_LABELS[key] || key}</span>
                {desc && <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
