/**
 * [UI] 媒体库管理页面。
 *
 * 全量媒体库表格、筛选、批量操作。策略计算结果由 service 返回。
 */

import { useEffect, useState, useMemo } from 'react';
import { apiClient, ApiConflictError } from '../api/client';
import { MediaLibraryManageRow } from '../components/MediaLibraryManageRow';
import type { MediaTask } from '../models/task';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';

// 临时默认策略 — 仅用于按钮显示判断（item.recommendedAction 由 service 返回）
const NOOP_POLICY = { target1080p: { 2: 2, 3: 4, 4: 7, 5: 12 }, target4k: { 2: 5, 3: 10, 4: 16, 5: 25 } };

export default function MediaManagePage({ tasks, subLibraryId }: { tasks: MediaTask[]; subLibraryId: string }) {
  const [items, setItems] = useState<ManagedMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [resolutionFilter, setResolutionFilter] = useState<string>('all');
  const [codecFilter, setCodecFilter] = useState<string>('all');
  const [watchedFilter, setWatchedFilter] = useState<string>('all');
  const [bluRayFilter, setBluRayFilter] = useState<string>('all');
  const [deleteExplainOpen, setDeleteExplainOpen] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient
      .getLibraryCache(subLibraryId || undefined)
      .then((data) => {
        if (!active) return;
        const rows = (data.items as unknown[])
          .map(coerceManagedItem)
          .filter((x): x is ManagedMediaItem => x != null);
        setItems(rows);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(`加载媒体库失败：${e.message}`);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [subLibraryId]);

  // 筛选（actionFilter 按 service 返回的 recommendedAction 过滤，客户端不计算策略）
  const filtered = useMemo(() => {
    let rows = items;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter((it) => it.name.toLowerCase().includes(q));
    }
    if (actionFilter !== 'all') {
      rows = rows.filter((it) => (it.recommendedAction ?? 'keep') === actionFilter);
    }
    if (resolutionFilter !== 'all') {
      rows = rows.filter((it) => it.resolution === resolutionFilter);
    }
    if (codecFilter !== 'all') {
      rows = rows.filter((it) => it.codec === codecFilter);
    }
    if (watchedFilter !== 'all') {
      const w = watchedFilter === 'watched';
      rows = rows.filter((it) => it.watched === w);
    }
    if (bluRayFilter !== 'all') {
      const isDisc = bluRayFilter === 'disc';
      rows = rows.filter((it) => it.isBluRayDisc === isDisc);
    }
    return rows;
  }, [items, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter]);

  const enqueueManagedAction = (item: ManagedMediaItem, action: MediaAction) => {
    if (item.isBluRayDisc && (action === 'transcode' || action === 'upgrade')) return;
    apiClient.createTaskByIntent({ itemId: item.id, actionType: action }).catch((e) => {
      if (e instanceof ApiConflictError) setError(e.message);
      else setError(`创建任务失败：${e.message}`);
    });
  };

  if (loading) return <div className="page"><p>加载媒体库数据...</p></div>;
  if (error) return <div className="page"><p className="error">{error}</p></div>;

  return (
    <div className="page">
      <div className="pageSidebar">
        <div className="sidebarMuted">筛选</div>
        <input
          className="sidebarSearch"
          placeholder="搜索名称..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
          <option value="all">全部操作</option>
          <option value="transcode">码率压缩</option>
          <option value="upgrade">洗版</option>
          <option value="keep">已达标</option>
          <option value="delete">删除档</option>
        </select>
        <select value={resolutionFilter} onChange={(e) => setResolutionFilter(e.target.value)}>
          <option value="all">全部分辨率</option>
          <option value="1080p">1080p</option>
          <option value="4K">4K</option>
        </select>
        <select value={codecFilter} onChange={(e) => setCodecFilter(e.target.value)}>
          <option value="all">全部编码</option>
          <option value="h264">H.264</option>
          <option value="h265">H.265</option>
          <option value="av1">AV1</option>
        </select>
        <select value={watchedFilter} onChange={(e) => setWatchedFilter(e.target.value)}>
          <option value="all">全部观看</option>
          <option value="watched">已观看</option>
          <option value="unwatched">未观看</option>
        </select>
        <select value={bluRayFilter} onChange={(e) => setBluRayFilter(e.target.value)}>
          <option value="all">全部</option>
          <option value="disc">原盘</option>
          <option value="not_disc">非原盘</option>
        </select>

        <div className="sidebarMuted" style={{ marginTop: 16 }}>批量操作</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set(filtered.map((it) => it.id)))}
          >
            全选
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setSelectedIds(new Set())}
          >
            取消全选
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => {
              for (const it of filtered) {
                if (selectedIds.has(it.id)) {
                  const action = it.recommendedAction ?? 'keep';
                  if (action !== 'keep') enqueueManagedAction(it, action);
                }
              }
            }}
          >
            批量入队
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
          已选 {selectedIds.size} / {filtered.length} 条
        </p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
        {filtered.length === 0 ? (
          <p>暂未获取到媒体库数据。请先在管理端配置子库。</p>
        ) : (
          <div>
            {filtered.map((item) => {
              const rowTask = tasks.find(
                (t) => t.itemId === item.id && !['done', 'failed_hard'].includes(t.status),
              );
              return (
                <MediaLibraryManageRow
                  key={item.id}
                  item={item}
                  isSelected={selectedIds.has(item.id)}
                  isHighlighted={false}
                  mediaPolicy={NOOP_POLICY}
                  rowTask={rowTask}
                  onToggleSelect={(id) => {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onWatchChange={async (it, watched) => {
                    // Optimistic local update
                    setItems((prev) =>
                      prev.map((x) => (x.id === it.id ? { ...x, watched } : x)),
                    );
                    try {
                      if (watched) {
                        await apiClient.markPlayed(it.id, subLibraryId);
                      } else {
                        await apiClient.markUnplayed(it.id, subLibraryId);
                      }
                    } catch (e) {
                      // Rollback on failure
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, watched: !watched } : x)),
                      );
                      setError(`标记失败：${(e as Error).message}`);
                    }
                  }}
                  onRatingChange={async (it, rating) => {
                    await apiClient.patchItemRatings(it.id, rating);
                    setItems((prev) =>
                      prev.map((x) => (x.id === it.id ? { ...x, rating } : x)),
                    );
                  }}
                  onEnqueue={enqueueManagedAction}
                  onOpenDeleteExplain={() => setDeleteExplainOpen(true)}
                />
              );
            })}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function coerceManagedItem(x: unknown): ManagedMediaItem | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const id = typeof o.itemId === 'string' ? o.itemId : typeof o.itemId === 'number' ? String(o.itemId) : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const sectionId = typeof o.subLibraryId === 'string' ? o.subLibraryId : '';
  if (!id || !sectionId) return null;

  // 分辨率映射: service 返回 "1920x1036" 格式的像素尺寸
  const resRaw = typeof o.resolution === 'string' ? o.resolution : '';
  const resHeight = parseInt(resRaw.split('x')[1], 10) || 0;
  const resolution = resHeight >= 2160 ? '4K' : '1080p';

  // 体积: service 返回字节数
  const sizeBytes = typeof o.size === 'number' ? o.size : 0;
  const sizeGb = sizeBytes > 0 ? sizeBytes / (1024 * 1024 * 1024) : 1;

  // 时长: service 返回秒数
  const durationSec = typeof o.duration === 'number' && o.duration > 0 ? o.duration : 3600;

  return {
    id,
    name: name || id,
    sectionId,
    itemType: o.type === 'movie' ? 'Movie' : o.type === 'episode' ? 'Episode' : undefined,
    resolution,
    codec: (typeof o.codec === 'string' && ['h264', 'h265', 'av1'].includes(o.codec)) ? (o.codec as 'h264' | 'h265' | 'av1') : 'h265',
    durationSec,
    sizeGb,
    isBluRayDisc: Boolean(o.isDiscLike),
    rating: typeof o.userRating === 'number' ? (o.userRating as MediaRating) : null,
    doubanStars: typeof o.doubanRating === 'number' ? (o.doubanRating as MediaRating) : null,
    watched: Boolean(o.watched),
    recommendedAction: typeof o.action === 'string' ? (o.action as MediaAction) : undefined,
    equivalentBitrate: typeof o.bitrate === 'number' ? o.bitrate / 1_000_000 : undefined,
  };
}
