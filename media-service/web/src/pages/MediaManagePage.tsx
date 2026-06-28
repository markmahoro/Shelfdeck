import { useEffect, useState, useMemo } from 'react';
import { libraryApi, taskApi, ApiConflictError, adult as adultApi, systemConfig } from '../api/client';
import type { SubLibraryInfo } from '../api/client';
import { MediaLibraryManageRow } from '../components/MediaLibraryManageRow';
import type { MediaTask } from '../types';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import '../mediaManage.css';

const ACTION_LABELS: Record<string, string> = {
  delete: '删除',
  transcode: '转码压缩',
  upgrade: '洗版',
  scrape: '刮削',
  ingest: '入库',
};
const MEDIA_MANAGE_SUB_LIBRARY_KEY = 'media_manage_sub_library_id';
const MEDIA_MANAGE_PAGE_SIZE = 100;

export default function MediaManagePage() {
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState<string>('');
  const [items, setItems] = useState<ManagedMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [resolutionFilter, setResolutionFilter] = useState<string>('all');
  const [codecFilter, setCodecFilter] = useState<string>('all');
  const [watchedFilter, setWatchedFilter] = useState<string>('all');
  const [bluRayFilter, setBluRayFilter] = useState<string>('all');
  const [doubanFilter, setDoubanFilter] = useState<string>('all');
  const [localRatingFilter, setLocalRatingFilter] = useState<string>('all');
  const [taskFilter, setTaskFilter] = useState<string>('all');
  const [scrapeFilter, setScrapeFilter] = useState<string>('all');
  const [, setActiveSubLibName] = useState<string>('全部');
  const [strategyMsg, setStrategyMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [smartTaskActions, setSmartTaskActions] = useState<string[] | null>(null);

  // Fetch subLibrary list
  useEffect(() => {
    libraryApi.getStatus().then((s) => {
      const enabled = s.subLibraries.filter((sl) => sl.enabled);
      setSubLibraries(enabled);
      setSubLibraryId((current) => {
        if (current) return current;
        const saved = localStorage.getItem(MEDIA_MANAGE_SUB_LIBRARY_KEY);
        if (saved !== null && (saved === '' || enabled.some((sl) => sl.uuid === saved))) return saved;
        return enabled[0]?.uuid || '';
      });
    }).catch(() => {});
    systemConfig.get().then((cfg) => {
      setSmartTaskActions(Array.isArray(cfg.smartTaskEnabledActions) ? cfg.smartTaskEnabledActions : []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [subLibraryId, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter, doubanFilter, localRatingFilter, taskFilter, scrapeFilter]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  // Fetch library data when subLibraryId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    libraryApi
      .getCache({
        subLibraryId: subLibraryId || undefined,
        limit: MEDIA_MANAGE_PAGE_SIZE,
        offset: page * MEDIA_MANAGE_PAGE_SIZE,
        search: searchQuery.trim() || undefined,
        action: actionFilter,
        resolution: resolutionFilter,
        codec: codecFilter,
        watched: watchedFilter,
        bluRay: bluRayFilter,
        douban: doubanFilter,
        userRating: localRatingFilter,
        task: taskFilter,
        scrape: scrapeFilter,
      })
      .then((data) => {
        if (!active) return;
        const rows = (data.items as unknown[])
          .map(coerceManagedItem)
          .filter((x): x is ManagedMediaItem => x != null);
        setItems(rows);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(`加载媒体库失败：${e.message}`);
        setLoading(false);
      });
    return () => { active = false; };
  }, [subLibraryId, page, refreshKey, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter, doubanFilter, localRatingFilter, taskFilter, scrapeFilter]);

  // Poll tasks
  useEffect(() => {
    const poll = () => {
      taskApi.getTasks({ activeOnly: true }).then(setTasks).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  const autoEntryNotice = useMemo(() => {
    const disabledCounts: Record<string, number> = {};
    if (!smartTaskActions) return null;
    for (const it of items) {
      const action = it.recommendedAction || 'keep';
      if (action === 'keep') continue;
      if (!smartTaskActions.includes(action)) {
        disabledCounts[action] = (disabledCounts[action] || 0) + 1;
      }
    }
    const parts = Object.entries(disabledCounts)
      .filter(([, count]) => count > 0)
      .map(([action, count]) => `${ACTION_LABELS[action] || action} ${count} 条`);
    if (parts.length === 0) return null;
    return `当前列表有 ${parts.join('、')}推荐策略未启用后台自动入队。这些条目只会显示建议，不会自动出现在任务中心；可以手动点击每行的策略按钮，或到「任务调度」启用对应任务类型。`;
  }, [items, smartTaskActions]);

  const maxPage = Math.max(0, Math.ceil(total / MEDIA_MANAGE_PAGE_SIZE) - 1);
  const rangeStart = total === 0 ? 0 : page * MEDIA_MANAGE_PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * MEDIA_MANAGE_PAGE_SIZE + items.length);

  const enqueueManagedAction = (item: ManagedMediaItem, action: MediaAction) => {
    if (item.isBluRayDisc && action === 'upgrade') return;
    taskApi.createByIntent({ itemId: item.id, actionType: action }).catch((e) => {
      if (e instanceof ApiConflictError) setError(e.message);
      else setError(`创建任务失败：${e.message}`);
    });
  };

  const rescrapeAdultItem = async (item: ManagedMediaItem) => {
    try {
      await adultApi.rescrapeItem(item.id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(`重新刮削失败：${(e as Error).message}`);
    }
  };

  if (loading) return <div className="page"><p>加载媒体库数据...</p></div>;

  return (
    <div className="page">
      <div className="pageSidebar">
        {/* SubLibrary selector */}
        <div className="sidebarMuted">媒体库</div>
        <select
          value={subLibraryId}
          onChange={(e) => {
            const id = e.target.value;
            setSubLibraryId(id);
            localStorage.setItem(MEDIA_MANAGE_SUB_LIBRARY_KEY, id);
            setActiveSubLibName(id ? subLibraries.find(sl => sl.uuid === id)?.name || '' : '全部');
            setSelectedIds(new Set());
          }}
        >
          <option value="">全部（{subLibraries.length} 个库）</option>
        {subLibraries.map((sl) => (
            <option key={sl.uuid} value={sl.uuid}>{sl.name}</option>
          ))}
        </select>

        <div className="sidebarMuted" style={{ marginTop: 16 }}>筛选</div>
        <div className="sidebarSearchWrap">
          <input
            className="sidebarSearch"
            placeholder="搜索名称..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="sidebarSearchClear"
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="清除搜索"
            >
              ×
            </button>
          )}
        </div>
        <div className="filterRow">
          <span className="filterLabel">建议策略</span>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="transcode">转码压缩</option>
            <option value="upgrade">洗版</option>
            <option value="keep">无建议策略</option>
            <option value="delete">删除档</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">分辨率</span>
          <select value={resolutionFilter} onChange={(e) => setResolutionFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="1080p">1080p</option>
            <option value="4K">4K</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">编码</span>
          <select value={codecFilter} onChange={(e) => setCodecFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="h264">H.264</option>
            <option value="h265">H.265</option>
            <option value="av1">AV1</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">标记已看</span>
          <select value={watchedFilter} onChange={(e) => setWatchedFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="watched">已观看</option>
            <option value="unwatched">未观看</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">原盘</span>
          <select value={bluRayFilter} onChange={(e) => setBluRayFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="disc">原盘</option>
            <option value="not_disc">非原盘</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">豆瓣评分</span>
          <select value={doubanFilter} onChange={(e) => setDoubanFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="5">5 星</option>
            <option value="4">4 星</option>
            <option value="3">3 星</option>
            <option value="2">2 星</option>
            <option value="1">1 星</option>
            <option value="none">未抓取</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">本地评分</span>
          <select value={localRatingFilter} onChange={(e) => setLocalRatingFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="5">5 星</option>
            <option value="4">4 星</option>
            <option value="3">3 星</option>
            <option value="2">2 星</option>
            <option value="1">1 星</option>
            <option value="none">未标注</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">任务</span>
          <select value={taskFilter} onChange={(e) => setTaskFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="active">进行中</option>
            <option value="none">无任务</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">刮削</span>
          <select value={scrapeFilter} onChange={(e) => setScrapeFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="done">已刮削</option>
            <option value="pending">待刮削</option>
            <option value="failed">刮削失败</option>
          </select>
        </div>

        <button
          className="sidebarFilterReset"
          type="button"
          onClick={() => {
            setSearchQuery('');
            setActionFilter('all');
            setResolutionFilter('all');
            setCodecFilter('all');
            setWatchedFilter('all');
            setBluRayFilter('all');
            setDoubanFilter('all');
            setLocalRatingFilter('all');
            setTaskFilter('all');
            setScrapeFilter('all');
          }}
        >
          清除筛选
        </button>

        <button
          type="button"
          style={{ background: '#f0f0f0', border: '1px solid #d0d0d0', padding: '6px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 13, marginTop: 12 }}
          onClick={async () => {
            setStrategyMsg('重算中...');
            try {
              const res = await libraryApi.recomputeStrategy();
              setStrategyMsg(`策略重算完成：${res.changed} 条变更`);
              setRefreshKey(k => k + 1);
            } catch (e: any) {
              setStrategyMsg(`重算失败：${e.message}`);
            }
          }}
        >
          刷新媒体库管理策略
        </button>
        {strategyMsg && <span style={{ fontSize: 12, color: '#666', marginLeft: 8 }}>{strategyMsg}</span>}

        <div className="sidebarMuted" style={{ marginTop: 16 }}>批量操作</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" onClick={() => setSelectedIds(new Set(items.map((it) => it.id)))}>
            全选
          </button>
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setSelectedIds(new Set())}
          >
            取消全选
          </button>
        </div>
        <button
          type="button"
          className="batchRunBtn"
          disabled={selectedIds.size === 0}
          onClick={() => {
            for (const it of items) {
              if (selectedIds.has(it.id)) {
                const action = it.recommendedAction ?? 'keep';
                if (action !== 'keep') enqueueManagedAction(it, action);
              }
            }
          }}
        >
          批量执行策略
        </button>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          已选 {selectedIds.size} / {items.length} 条
        </p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
          {error && <p className="error">{error}</p>}
          {autoEntryNotice && <div className="mediaNotice">{autoEntryNotice}</div>}
          <div className="mediaPager">
            <span>第 {page + 1} / {maxPage + 1} 页，显示 {rangeStart}-{rangeEnd}，共 {total} 条</span>
            <div>
              <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</button>
              <button type="button" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>下一页</button>
            </div>
          </div>
          {items.length === 0 ? (
            <p>暂未获取到媒体库数据。请先在管理端配置媒体库。</p>
          ) : (
            <div>
              <div className="mediaManageGrid mediaManageHead">
                <div className="mediaManageTitleCell">名称</div>
                <div>刮削</div>
                <div>剧名</div>
                <div>季</div>
                <div>体积</div>
                <div>分辨率</div>
                <div>编码</div>
                <div>当前码率</div>
                <div>目标码率</div>
                <div>预测体积</div>
                <div>媒体优化</div>
                <div>原盘</div>
                <div>豆瓣评分</div>
                <div>本地评分</div>
                <div>标记已看</div>
                <div>建议策略</div>
                <div>任务</div>
              </div>
              {items.map((item) => {
                const rowTask = tasks.find(
                  (t) => t.itemId === item.id && !['done', 'failed_hard'].includes(t.status),
                );
                return (
                  <MediaLibraryManageRow
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    isHighlighted={false}
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
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, watched } : x)),
                      );
                      try {
                        if (watched) {
                          await libraryApi.markPlayed(it.id, subLibraryId);
                        } else {
                          await libraryApi.markUnplayed(it.id, subLibraryId);
                        }
                      } catch (e) {
                        setItems((prev) =>
                          prev.map((x) => (x.id === it.id ? { ...x, watched: !watched } : x)),
                        );
                        setError(`标记失败：${(e as Error).message}`);
                      }
                    }}
                    onRatingChange={async (it, rating) => {
                      await libraryApi.patchRatings(it.id, rating);
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, rating } : x)),
                      );
                    }}
                    onEnqueue={enqueueManagedAction}
                    onRescrape={rescrapeAdultItem}
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
  const itemType = typeof o.type === 'string' ? o.type : '';

  // Skip series items (transparent containers, no media)
  if (itemType === 'series') return null;

  const id = typeof o.itemId === 'string' ? o.itemId : typeof o.itemId === 'number' ? String(o.itemId) : '';
  const rawName = typeof o.name === 'string' ? o.name.trim() : '';
  const sectionId = typeof o.subLibraryId === 'string' ? o.subLibraryId : '';
  if (!id || !sectionId) return null;

  const seriesName = typeof o.seriesName === 'string' ? o.seriesName : undefined;
  const seasonNumber = typeof o.seasonNumber === 'number' ? o.seasonNumber : undefined;
  // For seasons, use seriesName S{seasonNum} as display name; fall back to raw name
  const name = (itemType === 'season' && seriesName && seasonNumber != null)
    ? `${seriesName} S${String(seasonNumber).padStart(2, '0')}`
    : (rawName || id);

  const resRaw = typeof o.resolution === 'string' ? o.resolution : '';
  const resHeight = parseInt(resRaw.split('x')[1], 10) || 0;
  const resolution = resHeight >= 2160 ? '4K' : '1080p';

  const sizeBytes = typeof o.size === 'number' ? o.size : 0;
  const sizeGb = sizeBytes > 0 ? sizeBytes / (1024 * 1024 * 1024) : 1;

  const durationSec = typeof o.duration === 'number' && o.duration > 0 ? o.duration : 3600;

  return {
    id,
    name,
    sectionId,
    source: typeof o.source === 'string' ? o.source : undefined,
    itemType: itemType === 'movie' ? 'Movie' : itemType === 'season' ? 'Season' : undefined,
    seriesName,
    seasonNumber,
    resolution,
    codec: (typeof o.codec === 'string' && ['h264', 'h265', 'av1'].includes(o.codec)) ? (o.codec as 'h264' | 'h265' | 'av1') : 'h265',
    durationSec,
    sizeGb,
    isBluRayDisc: Boolean(o.isDiscLike),
    rating: typeof o.userRating === 'number' ? (o.userRating as MediaRating) : null,
    doubanStars: typeof o.doubanRating === 'number' ? (o.doubanRating as MediaRating) : null,
    watched: Boolean(o.watched),
    reason: typeof o.reason === 'string' ? o.reason : undefined,
    recommendedAction: typeof o.action === 'string' ? (o.action as MediaAction) : undefined,
    equivalentBitrate: typeof o.equivalentBitrate === 'number' ? o.equivalentBitrate : undefined,
    targetBitrate: typeof o.targetBitrate === 'number' ? o.targetBitrate : undefined,
    predictedSizeGb: typeof o.predictedSizeGb === 'number' ? o.predictedSizeGb : undefined,
    optimizationStatus: o.optimizationStatus === 'transcoded' || o.optimizationStatus === 'upgraded' ? o.optimizationStatus : 'none',
    optimizationAction: o.optimizationAction === 'transcode' || o.optimizationAction === 'upgrade' ? o.optimizationAction : null,
    optimizationDoneAt: typeof o.optimizationDoneAt === 'string' ? o.optimizationDoneAt : null,
    optimizationTaskId: typeof o.optimizationTaskId === 'string' ? o.optimizationTaskId : null,
    scraped: Boolean(o.scraped),
    adultMetadata: o.adultMetadata && typeof o.adultMetadata === 'object' ? (o.adultMetadata as Record<string, unknown>) : undefined,
  };
}
