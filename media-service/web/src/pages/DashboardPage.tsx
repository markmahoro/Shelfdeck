import { useQuery } from '@tanstack/react-query';
import { health, tasks, config } from '../api/client';
import type { MediaTask } from '../types';

const HEALTHY_COLOR: Record<string, string> = {
  green: '#27ae60',
  yellow: '#f39c12',
  red: '#e53',
};

const PAGE_TITLE: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  marginBottom: '24px',
  color: '#1a1a2e',
};

const CARD: React.CSSProperties = {
  background: '#fff',
  borderRadius: '10px',
  padding: '20px',
  marginBottom: '16px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 600,
  marginBottom: '16px',
  color: '#1a1a2e',
};

const STATUS_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '16px',
};

const STATUS_ITEM: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  padding: '12px',
  background: '#f9fafb',
  borderRadius: '8px',
};

const TABLE_STYLE: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
};

const TH_STYLE: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px',
  borderBottom: '2px solid #eee',
  color: '#666',
};

const TD_STYLE: React.CSSProperties = {
  padding: '8px',
  borderBottom: '1px solid #f0f0f0',
};

export default function DashboardPage() {
  const { data: healthData } = useQuery({
    queryKey: ['health'],
    queryFn: health.check,
    refetchInterval: 30000,
  });

  const { data: taskData = [] } = useQuery<MediaTask[]>({
    queryKey: ['tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 10000,
  });

  const { data: cfg } = useQuery({
    queryKey: ['config'],
    queryFn: config.get,
  });

  const activeTasks = taskData.filter(
    (t) => !['done', 'failed_hard'].includes(t.status),
  );
  const recentDone = taskData
    .filter((t) => t.status === 'done')
    .slice(0, 5);

  const healthColor = HEALTHY_COLOR[healthData?.healthy ?? 'red'];
  const healthLabel =
    healthData?.healthy === 'green' ? '正常' :
    healthData?.healthy === 'yellow' ? '降级' : '异常';

  return (
    <div>
      <h2 style={PAGE_TITLE}>仪表盘</h2>

      {/* Service Status */}
      <div style={CARD}>
        <h3 style={SECTION_TITLE}>服务状态</h3>
        <div style={STATUS_GRID}>
          <div style={STATUS_ITEM}>
            <span style={{ fontSize: '24px' }}>✅</span>
            <div>
              <div style={{ fontWeight: 600 }}>Service</div>
              <div style={{ color: healthColor, fontSize: '13px' }}>{healthLabel}</div>
            </div>
          </div>
          <div style={STATUS_ITEM}>
            <span style={{ fontSize: '24px' }}>⚙️</span>
            <div>
              <div style={{ fontWeight: 600 }}>Config</div>
              <div style={{ color: '#27ae60', fontSize: '13px' }}>
                {cfg ? '已加载' : '未加载'}
              </div>
            </div>
          </div>
          <div style={STATUS_ITEM}>
            <span style={{ fontSize: '24px' }}>📺</span>
            <div>
              <div style={{ fontWeight: 600 }}>Emby</div>
              <div style={{ color: '#666', fontSize: '13px' }}>
                {cfg?.embyClient?.baseUrl || '未配置'}
              </div>
            </div>
          </div>
          <div style={STATUS_ITEM}>
            <span style={{ fontSize: '24px' }}>⏰</span>
            <div>
              <div style={{ fontWeight: 600 }}>调度器</div>
              <div style={{ color: '#27ae60', fontSize: '13px' }}>
                {cfg?.executionMode === 'scheduled' ? '自动' : '手动'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Active Tasks */}
      <div style={CARD}>
        <h3 style={SECTION_TITLE}>进行中任务 ({activeTasks.length})</h3>
        {activeTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: '14px' }}>暂无进行中任务</p>
        ) : (
          <table style={TABLE_STYLE}>
            <thead>
              <tr>
                <th style={TH_STYLE}>名称</th>
                <th style={TH_STYLE}>类型</th>
                <th style={TH_STYLE}>状态</th>
                <th style={TH_STYLE}>进度</th>
              </tr>
            </thead>
            <tbody>
              {activeTasks.map((t) => (
                <tr key={t.id}>
                  <td style={TD_STYLE}>{t.itemName || t.itemId}</td>
                  <td style={TD_STYLE}>{t.actionType}</td>
                  <td style={TD_STYLE}>{t.status}</td>
                  <td style={TD_STYLE}>{t.progress ?? 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Recent Done */}
      <div style={CARD}>
        <h3 style={SECTION_TITLE}>最近完成</h3>
        {recentDone.length === 0 ? (
          <p style={{ color: '#888', fontSize: '14px' }}>暂无已完成任务</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {recentDone.map((t) => (
              <li
                key={t.id}
                style={{
                  padding: '8px 0',
                  borderBottom: '1px solid #eee',
                  fontSize: '14px',
                  display: 'flex',
                  gap: '8px',
                }}
              >
                <span style={{ flex: 1 }}>{t.itemName || t.itemId}</span>
                <span style={{ color: '#888' }}>{t.actionType}</span>
                <span style={{ color: '#27ae60' }}>已完成</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
