/**
 * [UI] 播放记录页面。
 *
 * 展示 Emby 已观看历史（只读浏览）。数据源为 Emby，通过 service 代理。
 */

import { useEffect, useState } from 'react';
import { getBaseUrl } from '../connection/baseUrl';

type PlayedItem = {
  id: string;
  name: string;
  type: 'Movie' | 'Episode' | 'Other' | 'Unknown';
  datePlayed?: string;
  sectionId?: string;
  sectionName?: string;
  posterTag?: string;
  seriesName?: string;
  indexLabel?: string;
};

export default function HistoryPage({ subLibraryId }: { subLibraryId: string }) {
  const [items, setItems] = useState<PlayedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<7 | 30 | 0>(30);
  const [typeFilter, setTypeFilter] = useState<'all' | 'Movie' | 'Episode'>('all');
  const [sectionId, setSectionId] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    const base = getBaseUrl();
    if (!base || !window.embyApi?.getPlayedItems) {
      if (active) setLoading(false);
      return;
    }
    // 通过 preload 桥接获取 Emby 已观看历史
    // TODO: 切换到 apiClient 方式（待 service 端实现 /v1/library/queries/played）
    setLoading(false);
    setItems([]);
    return () => {
      active = false;
    };
  }, [days, typeFilter, sectionId]);

  const filtered = items.filter((it) => {
    if (typeFilter !== 'all' && it.type !== typeFilter) return false;
    if (sectionId && it.sectionId !== sectionId) return false;
    return true;
  });

  if (loading) return <div className="page"><p>加载播放记录...</p></div>;

  return (
    <div className="page">
      <div className="sidebar">
        <div className="sidebarMuted">筛选</div>
        <select value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 0)}>
          <option value={7}>最近 7 天</option>
          <option value={30}>最近 30 天</option>
          <option value={0}>全部</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as 'all' | 'Movie' | 'Episode')}>
          <option value="all">全部类型</option>
          <option value="Movie">电影</option>
          <option value="Episode">剧集</option>
        </select>
      </div>
      <div className="main">
        {filtered.length === 0 ? (
          <p>暂无播放记录</p>
        ) : (
          <div className="historyList">
            {filtered.map((it) => (
              <div key={it.id} className="historyItem">
                <div className="historyItemBody">
                  <div className="historyItemTitle">{it.name}</div>
                  <div className="historyItemMeta">
                    {it.seriesName && <span>{it.seriesName}</span>}
                    {it.indexLabel && <span>{it.indexLabel}</span>}
                    <span className="historyMetaSep">·</span>
                    <span>{it.type === 'Movie' ? '电影' : it.type === 'Episode' ? '剧集' : '其他'}</span>
                    {it.sectionName && (
                      <>
                        <span className="historyMetaSep">·</span>
                        <span>{it.sectionName}</span>
                      </>
                    )}
                    {it.datePlayed && (
                      <>
                        <span className="historyMetaSep">·</span>
                        <span>{new Date(it.datePlayed).toLocaleDateString('zh-CN')}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
