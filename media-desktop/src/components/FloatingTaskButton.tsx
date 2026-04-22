import { useState, useEffect } from 'react';
import { apiClient } from '../apiClient';

const BTN: React.CSSProperties = {
  position: 'fixed',
  bottom: '24px',
  right: '24px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  background: '#4a90d9',
  border: 'none',
  cursor: 'pointer',
  fontSize: '18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
  zIndex: 9999,
};

const PANEL: React.CSSProperties = {
  position: 'fixed',
  bottom: '80px',
  right: '24px',
  width: '320px',
  background: '#fff',
  borderRadius: '12px',
  boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
  padding: '16px',
  zIndex: 9999,
};

const SECTION: React.CSSProperties = {
  marginBottom: '12px',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#888',
  marginBottom: '8px',
  textTransform: 'uppercase',
};

export default function FloatingTaskButton() {
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
            .slice(0, 3)
        );
      } catch {}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span style={{ fontWeight: 600 }}>任务状态</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}>×</button>
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>进行中</div>
            {activeTasks.slice(0, 5).map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#4a90d9' }}>{t.progress ?? 0}%</span>
              </div>
            ))}
          </div>

          <div style={SECTION}>
            <div style={SECTION_TITLE}>最近完成</div>
            {recentDone.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>{t.itemName || t.itemId}</span>
                <span style={{ color: '#27ae60' }}>✅</span>
              </div>
            ))}
          </div>

          <a
            href="http://127.0.0.1:18080/admin"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '13px', color: '#4a90d9', textDecoration: 'none' }}
          >
            在浏览器中查看完整任务中心 →
          </a>
        </div>
      )}
    </>
  );
}
