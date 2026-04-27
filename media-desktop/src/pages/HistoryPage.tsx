/**
 * [UI] 播放记录页面。
 *
 * 展示 Emby 已观看历史（只读浏览），支持重播、标记未看。
 * 数据来源：POST /v1/library/queries/played（service → Emby 实时查询）。
 */

import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import type { PlayedItem } from '../api/client';

export default function HistoryPage({ subLibraryId }: { subLibraryId: string }) {
  const [items, setItems] = useState<PlayedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<7 | 30 | 0>(30);
  const [typeFilter, setTypeFilter] = useState<'all' | 'Movie' | 'Episode'>('all');
  const [sectionId, setSectionId] = useState('');

  const fetchItems = () => {
    if (!subLibraryId) {
      setLoading(false);
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .getPlayedItems(subLibraryId, {
        days: days || undefined,
        type: typeFilter,
        sectionId: sectionId || undefined,
      })
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(`加载播放记录失败：${e.message}`);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchItems();
  }, [subLibraryId, days, typeFilter, sectionId]);

  const handleMarkUnplayed = (itemId: string) => {
    apiClient.markUnplayed(itemId, subLibraryId).then(() => fetchItems()).catch((e) => {
      setError(`标记未看失败：${e.message}`);
    });
  };

  const handleReplay = async (item: PlayedItem) => {
    if (!item.path) {
      if (item.embyWebUrl) window.open(item.embyWebUrl, '_blank');
      return;
    }
    try {
      const raw = await window.embyApi?.getSettings();
      await window.embyApi?.launchPath({
        path: item.path,
        config: {
          playerExePath: raw?.playerExePath || '',
          pathMapFrom: raw?.localPathMapFrom || '',
          pathMapTo: raw?.localPathMapTo || '',
        },
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('未配置播放器')) setError('请先在设置（⚙）中配置 PotPlayer 播放器路径');
      else setError(`播放失败：${msg}`);
    }
  };

  if (loading) return <div className="page"><p>加载播放记录...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

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
        {!subLibraryId ? (
          <p>请先选择一个子库。</p>
        ) : items.length === 0 ? (
          <p>暂无播放记录</p>
        ) : (
          <div className="historyList">
            {items.map((it) => (
              <div key={it.id} className="historyItem">
                {it.posterUrl && (
                  <img
                    className="historyItemPoster"
                    src={it.posterUrl}
                    alt={it.name}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
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
                  <div className="historyRowActions" style={{ marginTop: 6 }}>
                    <button type="button" onClick={() => handleReplay(it)}>重播</button>
                    <button type="button" onClick={() => handleMarkUnplayed(it.id)}>标记未看</button>
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
