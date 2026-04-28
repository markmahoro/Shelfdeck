/**
 * [UI] 实时日志页面 — 展示 ShelfDeck 系统实时活动。
 */

import { useEffect, useState, useRef } from 'react';
import { apiClient } from '../api/client';
import type { ActivityEntry } from '../api/client';

const SOURCE_LABELS: Record<string, string> = {
  media_library: '媒体库',
  strategy_engine: '策略引擎',
  smart_task_engine: '智能入队',
  task: '任务',
  health: '健康',
  user_action: '用户',
};

const SOURCE_COLORS: Record<string, string> = {
  media_library: '#60a5fa',
  strategy_engine: '#a78bfa',
  smart_task_engine: '#34d399',
  task: '#fbbf24',
  health: '#f87171',
  user_action: '#fb923c',
};

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => {
      apiClient.getActivityLog(50).then((data) => {
        setEntries(data);
      }).catch(() => {});
    };
    poll();
    timerRef.current = setInterval(poll, 5000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return (
    <div className="page">
      <div className="pageMain">
        <div className="pageMainInner">
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>实时日志</h2>
          <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 16 }}>
            ShelfDeck 系统实时活动，每 5 秒自动刷新
          </p>

          {entries.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', opacity: 0.5, fontSize: 14 }}>
              暂无活动记录，系统启动后将自动更新
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {entries.map((entry, i) => {
                const ts = new Date(entry.ts);
                const timeStr = ts.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                const dateStr = ts.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
                const color = SOURCE_COLORS[entry.source] || '#94a3b8';
                const label = SOURCE_LABELS[entry.source] || entry.source;

                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: i === 0 ? 'rgba(59,130,246,0.08)' : 'transparent',
                      border: i === 0 ? '1px solid rgba(59,130,246,0.15)' : '1px solid transparent',
                      fontSize: 13,
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color: '#6b7280', whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
                      {dateStr} {timeStr}
                    </span>
                    <span style={{ color, fontWeight: 600, flexShrink: 0, fontSize: 12 }}>
                      {label}
                    </span>
                    <span style={{ color: '#e5e7eb', wordBreak: 'break-word' }}>
                      {entry.message}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
