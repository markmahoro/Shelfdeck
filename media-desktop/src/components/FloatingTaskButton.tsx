/**
 * [UI] 悬浮任务按钮（任务卡 UI）。
 *
 * 始终显示活跃任务数 Badge，点击展开摘要面板。
 * 不做全量任务管理（在 admin web /tasks）。
 */

import { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

const BTN: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  right: 24,
  width: 48,
  height: 48,
  borderRadius: '50%',
  background: '#4a90d9',
  border: 'none',
  cursor: 'pointer',
  fontSize: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
  zIndex: 9999,
};

const PANEL: React.CSSProperties = {
  position: 'fixed',
  bottom: 80,
  right: 24,
  width: 320,
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
  padding: 16,
  zIndex: 9999,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#888',
  marginBottom: 8,
  textTransform: 'uppercase',
};

export default function FloatingTaskButton({ baseUrl }: { baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const [activeTasks, setActiveTasks] = useState<any[]>([]);
  const [recentDone, setRecentDone] = useState<any[]>([]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const all = await apiClient.getTasks();
        setActiveTasks(all.filter((t: any) => !['done', 'failed_hard'].includes(t.status)));
        setRecentDone(
          all
            .filter((t: any) => t.status === 'done')
            .sort((a: any, b: any) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
            .slice(0, 3),
        );
      } catch {
        /* 静默 */
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (activeTasks.length === 0) return null;

  return (
    <>
      <button style={BTN} onClick={() => setOpen(!open)}>
        {activeTasks.length}
      </button>
      {open && (
        <div style={PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 600 }}>任务状态</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>
              ×
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={SECTION_TITLE}>进行中</div>
            {activeTasks.slice(0, 5).map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#4a90d9' }}>{t.progress ?? 0}%</span>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={SECTION_TITLE}>最近完成</div>
            {recentDone.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#27ae60' }}>已完成</span>
              </div>
            ))}
          </div>

          <a
            href={`${baseUrl}/admin`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, color: '#4a90d9', textDecoration: 'none' }}
          >
            在浏览器中查看完整任务中心 →
          </a>
        </div>
      )}
    </>
  );
}
