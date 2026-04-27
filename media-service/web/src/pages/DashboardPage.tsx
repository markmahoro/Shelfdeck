import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { health, tasks } from '../api/client';
import HealthCard from '../components/HealthCard';
import LoadingSpinner from '../components/LoadingSpinner';

export default function DashboardPage() {
  const { data: h, isLoading: hLoading } = useQuery({
    queryKey: ['admin-health'],
    queryFn: health.check,
    refetchInterval: 30000,
  });

  const { data: taskList, isLoading: tLoading } = useQuery({
    queryKey: ['admin-tasks'],
    queryFn: () => tasks.list(),
    refetchInterval: 10000,
  });

  if (hLoading) return <LoadingSpinner />;

  const recentTasks = (taskList?.tasks || []).slice(0, 5);

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: '#1a1a2e' }}>仪表盘</h2>

      <div style={{ marginBottom: 24 }}>
        <HealthCard status={h?.status || 'red'} checks={h?.checks as Record<string, { status: string; message?: string }> | undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { to: '/media-libraries', label: '媒体库管理', desc: '管理子库与豆瓣同步' },
          { to: '/transcode', label: '转码设置', desc: '编码设备池与参数' },
          { to: '/moviepilot', label: '洗版设置', desc: 'MoviePilot 连接与路径' },
          { to: '/tasks', label: '任务监控', desc: '查看所有任务状态' },
        ].map(({ to, label, desc }) => (
          <Link
            key={to}
            to={to}
            style={{
              background: '#fff',
              borderRadius: 10,
              padding: 20,
              textDecoration: 'none',
              color: 'inherit',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 13, color: '#888' }}>{desc}</div>
          </Link>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: '#1a1a2e' }}>最近任务</h3>
        {tLoading ? (
          <LoadingSpinner text="加载任务中..." />
        ) : recentTasks.length === 0 ? (
          <p style={{ color: '#888', fontSize: 14 }}>暂无任务</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' }}>类型</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' }}>状态</th>
                <th style={{ textAlign: 'left', padding: '8px', borderBottom: '2px solid #eee', color: '#666' }}>进度</th>
              </tr>
            </thead>
            <tbody>
              {recentTasks.map((t) => (
                <tr key={t.id}>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0', fontFamily: 'monospace', fontSize: 12 }}>
                    {t.id.slice(0, 12)}...
                  </td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{t.actionType}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{t.status}</td>
                  <td style={{ padding: '8px', borderBottom: '1px solid #f0f0f0' }}>{t.progress}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
