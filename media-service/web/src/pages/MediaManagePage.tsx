import { useEffect, useState, useMemo } from 'react';
import { libraryApi, taskApi, subLibraries as adminSubLibraries, ApiConflictError, adult as adultApi } from '../api/client';
import type { SubLibraryInfo } from '../api/client';
import { MediaLibraryManageRow } from '../components/MediaLibraryManageRow';
import type { MediaTask } from '../types';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import '../mediaManage.css';

export default function MediaManagePage() {
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState<string>('');
  const [items, setItems] = useState<ManagedMediaItem[]>([]);
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
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch subLibrary list
  useEffect(() => {
    libraryApi.getStatus().then((s) => {
      const enabled = s.subLibraries.filter((sl) => sl.enabled);
      setSubLibraries(enabled);
    }).catch(() => {});
  }, []);

  const activeSubLibrary = useMemo(
    () => subLibraries.find((sl) => sl.uuid === subLibraryId) || null,
    [subLibraries, subLibraryId],
  );
  const canScanAdultFolder = Boolean(activeSubLibrary?.source === 'folder' && activeSubLibrary?.mediaType === 'adult');

  // Fetch library data when subLibraryId changes
  useEffect(() => {
    let active = true;
    setLoading(true);
    libraryApi
      .getCache(subLibraryId || undefined)
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
    return () => { active = false; };
  }, [subLibraryId, refreshKey]);

  // Poll tasks
  useEffect(() => {
    const poll = () => {
      taskApi.getTasks().then(setTasks).catch(() => {});
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

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
    if (doubanFilter !== 'all') {
      if (doubanFilter === 'none') rows = rows.filter((it) => it.doubanStars == null);
      else rows = rows.filter((it) => it.doubanStars === Number(doubanFilter));
    }
    if (localRatingFilter !== 'all') {
      if (localRatingFilter === 'none') rows = rows.filter((it) => it.rating == null);
      else rows = rows.filter((it) => it.rating === Number(localRatingFilter));
    }
    if (taskFilter === 'active') {
      const activeIds = new Set(tasks.filter((t) => !['done', 'failed_hard'].includes(t.status)).map((t) => t.itemId));
      rows = rows.filter((it) => activeIds.has(it.id));
    } else if (taskFilter === 'none') {
      const activeIds = new Set(tasks.filter((t) => !['done', 'failed_hard'].includes(t.status)).map((t) => t.itemId));
      rows = rows.filter((it) => !activeIds.has(it.id));
    }
    if (scrapeFilter !== 'all') {
      rows = rows.filter((it) => {
        if (it.source !== 'adult_folder') return false;
        const status = typeof it.adultMetadata?.scrapeStatus === 'string' ? it.adultMetadata.scrapeStatus : '';
        if (scrapeFilter === 'done') return Boolean(it.scraped) || status === 'done';
        if (scrapeFilter === 'pending') return !it.scraped && (status === 'pending' || status === 'ambiguous' || !status);
        if (scrapeFilter === 'failed') return status === 'failed';
        return true;
      });
    }
    return rows;
  }, [items, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter, doubanFilter, localRatingFilter, taskFilter, scrapeFilter, tasks]);

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
            setActiveSubLibName(id ? subLibraries.find(sl => sl.uuid === id)?.name || '' : '全部');
            setSelectedIds(new Set());
            setScanMsg(null);
          }}
        >
          <option value="">全部（{subLibraries.length} 个库）</option>
          {subLibraries.map((sl) => (
            <option key={sl.uuid} value={sl.uuid}>{sl.name}</option>
          ))}
        </select>
        {canScanAdultFolder && activeSubLibrary && (
          <>
            <button
              type="button"
              className="sidebarScanBtn"
              onClick={async () => {
                setScanMsg('扫描中...');
                try {
                  const res = await adminSubLibraries.scan(activeSubLibrary.uuid);
                  setScanMsg(`扫描完成：${res.upserted} / ${res.scanned} 个文件`);
                  setRefreshKey((k) => k + 1);
                } catch (e) {
                  setScanMsg(`扫描失败：${(e as Error).message}`);
                }
              }}
            >
              扫描当前文件夹
            </button>
            {scanMsg && <p className="sidebarInfo">{scanMsg}</p>}
          </>
        )}

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
            <option value="transcode">码率压缩</option>
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
          <button type="button" onClick={() => setSelectedIds(new Set(filtered.map((it) => it.id)))}>
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
            for (const it of filtered) {
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
          已选 {selectedIds.size} / {filtered.length} 条
        </p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
          {error && <p className="error">{error}</p>}
          {filtered.length === 0 ? (
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
