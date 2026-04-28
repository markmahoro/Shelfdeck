/**
 * [UI] 本地播放记录页面。
 *
 * 展示用户在海报墙 / 媒体库管理页面标记为"已看"的操作记录。
 * 数据来源：GET /v1/library/playback-log（本地日志，非 Emby 查询）。
 * 支持回撤操作（标记为未看并从日志移除）。
 */

import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { PlaybackLogEntry } from '../api/client';

export default function HistoryPage({ subLibraryId }: { subLibraryId: string }) {
  const [entries, setEntries] = useState<PlaybackLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLog = () => {
    setLoading(true);
    setError(null);
    apiClient
      .getPlaybackLog(subLibraryId || undefined)
      .then((data) => {
        setEntries(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(`加载播放记录失败：${e.message}`);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLog();
  }, [subLibraryId]);

  const handleRevert = (entry: PlaybackLogEntry) => {
    apiClient
      .markUnplayed(entry.itemId, entry.subLibraryId)
      .then(() => {
        // Remove from local state immediately
        setEntries((prev) => prev.filter((e) => e.itemId !== entry.itemId));
      })
      .catch((e) => {
        setError(`回撤失败：${e.message}`);
      });
  };

  const handleReplay = (entry: PlaybackLogEntry) => {
    if (!entry.path) return;
    try {
      window.embyApi?.launchPath({
        path: entry.path,
        config: {
          playerExePath: '',
          pathMapFrom: '',
          pathMapTo: '',
        },
      }).catch(() => {
        if (entry.embyWebUrl) window.open(entry.embyWebUrl, '_blank');
      });
    } catch (_) {
      if (entry.embyWebUrl) window.open(entry.embyWebUrl, '_blank');
    }
  };

  const typeLabel = (type: string) => {
    const t = (type || '').toLowerCase();
    if (t === 'movie') return '电影';
    if (t === 'episode') return '剧集';
    return '其他';
  };

  return (
    <div className="page">
      <div className="pageSidebar">
        <div className="sidebarMuted">本地播放记录</div>
        <p className="sidebarHint" style={{ fontSize: 12, marginTop: 4 }}>
          记录在海报墙或媒体库管理页面标记"已看"的操作。
        </p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
          {error && (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, color: '#b91c1c', fontSize: 13 }}>
              {error}
              <button onClick={() => setError(null)} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', textDecoration: 'underline' }}>关闭</button>
            </div>
          )}

          {loading ? (
            <p>加载中...</p>
          ) : entries.length === 0 ? (
            <p style={{ color: '#888' }}>暂无播放记录</p>
          ) : (
            <div className="historyList">
              {entries.map((entry) => (
                <div key={entry.itemId} className="historyItem">
                  {entry.posterUrl && (
                    <img
                      className="historyPoster"
                      src={entry.posterUrl}
                      alt={entry.itemName}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="historyItemBody">
                    <div className="historyItemTitle">{entry.itemName}</div>
                    <div className="historyItemMeta">
                      <span>{typeLabel(entry.type)}</span>
                      {entry.sectionName && (
                        <>
                          <span className="historyMetaSep">·</span>
                          <span>{entry.sectionName}</span>
                        </>
                      )}
                      <span className="historyMetaSep">·</span>
                      <span>{new Date(entry.playedAt).toLocaleDateString('zh-CN')} {new Date(entry.playedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="historyRowActions" style={{ marginTop: 6 }}>
                      <button type="button" onClick={() => handleReplay(entry)}>重播</button>
                      <button type="button" onClick={() => handleRevert(entry)}>回撤</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
