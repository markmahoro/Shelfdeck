/**
 * [UI] 海报墙页面。
 *
 * 展示未观看内容（海报 + 详情），支持评分、标记已看、PotPlayer 播放、一键入队。
 * 数据来源：POST /v1/library/queries/unplayed（service → Emby 实时查询）。
 */

import { useEffect, useState } from 'react';
import { apiClient, ApiConflictError } from '../api/client';
import type { UnplayedItem } from '../api/client';
import type { MediaTask } from '../models/task';
import type { MediaRating } from '../models/media';
import { hasActiveTaskForItem, taskStatusLabelZh } from '../models/task';

const STAR_OPTIONS = [1, 2, 3, 4, 5] as const;

export default function WallPage({ tasks, subLibraryId }: { tasks: MediaTask[]; subLibraryId: string }) {
  const [items, setItems] = useState<UnplayedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<string, MediaRating | null>>({});

  const fetchItems = () => {
    if (!subLibraryId) {
      setLoading(false);
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    apiClient
      .getUnplayedItems(subLibraryId)
      .then((data) => {
        setItems(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(`加载未观看内容失败：${e.message}`);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchItems();
  }, [subLibraryId]);

  const handleEnqueue = (item: UnplayedItem) => {
    if (item.isBluRayDisc) return;
    apiClient.createTaskByIntent({ itemId: item.id, actionType: 'transcode' }).catch((e) => {
      if (e instanceof ApiConflictError) setError(e.message);
      else setError(`创建任务失败：${e.message}`);
    });
  };

  const handleMarkPlayed = (itemId: string) => {
    apiClient.markPlayed(itemId, subLibraryId)
      .then(() => {
        setItems((prev) => prev.filter((it) => it.id !== itemId));
      })
      .catch((e) => {
        setError(`标记已看失败：${e.message}`);
      });
  };

  const handleRating = (itemId: string, rating: MediaRating | null) => {
    setRatings((prev) => ({ ...prev, [itemId]: rating }));
    apiClient.patchItemRatings(itemId, rating).catch((e) => {
      setRatings((prev) => ({ ...prev, [itemId]: prev[itemId] ?? null }));
      setError(`评分失败：${e.message}`);
    });
  };

  const handlePlay = async (item: UnplayedItem) => {
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

  if (loading) return <div className="page"><p>加载中...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  return (
    <div className="page">
      <div className="pageSidebar">
        <div className="sidebarMuted">当前子库</div>
        <p style={{ fontSize: 13 }}>{subLibraryId || '未选择'}</p>
        <div className="sidebarMuted" style={{ marginTop: 16 }}>统计</div>
        <p style={{ fontSize: 13 }}>{items.length} 部未观看</p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
          {!subLibraryId ? (
            <p>请先选择一个子库。</p>
          ) : items.length === 0 ? (
            <p>暂未获取到未观看内容。</p>
          ) : (
            <div className="grid">
              {items.map((item) => {
                const taskForItem = tasks.find(
                  (t) => t.itemId === item.id && !['done', 'failed_hard'].includes(t.status),
                );
                const currentRating = ratings[item.id] ?? null;
                return (
                  <div key={item.id} className="card">
                    {item.posterUrl ? (
                      <img
                        className="poster"
                        src={item.posterUrl}
                        alt={item.name}
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="poster" style={{ background: '#1f2937' }} />
                    )}
                    <div className="cardTitle">{item.name}</div>
                    <div className="hint" style={{ marginTop: 4 }}>
                      {item.resolution} · {item.codec?.toUpperCase()} · {item.sizeGb?.toFixed(1)} GB
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <select
                        className="selectLike"
                        style={{ fontSize: 11, padding: '4px 6px', flex: 1 }}
                        value={currentRating == null ? '' : String(currentRating)}
                        onChange={(e) => {
                          const v = e.target.value;
                          handleRating(item.id, v === '' ? null : (Number(v) as MediaRating));
                        }}
                      >
                        <option value="">未评分</option>
                        {STAR_OPTIONS.map((s) => (
                          <option key={s} value={s}>{'★'.repeat(s)}</option>
                        ))}
                      </select>
                    </div>
                    {taskForItem ? (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                        {taskStatusLabelZh(taskForItem.status)}
                      </div>
                    ) : (
                      <div className="actions" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                        <button type="button" style={{ fontSize: 12, padding: '5px 8px' }} onClick={() => handlePlay(item)}>
                          播放
                        </button>
                        <button type="button" style={{ fontSize: 12, padding: '5px 8px' }} onClick={() => handleEnqueue(item)}>
                          码率压缩
                        </button>
                        <button type="button" style={{ fontSize: 12, padding: '5px 8px' }} onClick={() => handleMarkPlayed(item.id)}>
                          已看
                        </button>
                      </div>
                    )}
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
