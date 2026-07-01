import { useCallback, useEffect, useState, useMemo } from 'react';
import { libraryApi, taskApi, ApiConflictError, adult as adultApi, systemConfig } from '../api/client';
import type { SubLibraryInfo } from '../api/client';
import { MediaLibraryManageRow } from '../components/MediaLibraryManageRow';
import type { MediaTask } from '../types';
import type { BusinessFlowDecision, ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import { allowedOperationForItem, blockedReasonText, preferredTaskAction } from '../models/mediaActionPolicy';
import '../mediaManage.css';

const ACTION_LABELS: Record<string, string> = {
  delete: '删除',
  transcode: '转码压缩',
  upgrade: '洗版',
  scrape: '补元数据',
  ingest: '入库',
};
const ACTIVE_ROW_TASK_STATUSES = new Set(['created', 'pending_manual', 'queued', 'executing', 'pausing', 'awaiting_user_confirm', 'paused', 'interrupted', 'waiting_media_source']);
const MEDIA_MANAGE_SUB_LIBRARY_KEY = 'media_manage_sub_library_id';
const MEDIA_MANAGE_PAGE_SIZE_KEY = 'media_manage_page_size';
const DEFAULT_MEDIA_MANAGE_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function MediaManagePage() {
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState<string>('');
  const [items, setItems] = useState<ManagedMediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTarget, setLoadingTarget] = useState('/v1/library?projection=manage');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [creatingTaskIds, setCreatingTaskIds] = useState<Set<string>>(() => new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [resolutionFilter, setResolutionFilter] = useState<string>('all');
  const [codecFilter, setCodecFilter] = useState<string>('all');
  const [watchedFilter, setWatchedFilter] = useState<string>('all');
  const [bluRayFilter, setBluRayFilter] = useState<string>('all');
  const [doubanFilter, setDoubanFilter] = useState<string>('all');
  const [localRatingFilter, setLocalRatingFilter] = useState<string>('all');
  const [taskFilter, setTaskFilter] = useState<string>('all');
  const [metadataFilter, setMetadataFilter] = useState<string>('all');
  const [lifecycleFilter, setLifecycleFilter] = useState<string>('all');
  const [pageSize, setPageSize] = useState<number>(() => {
    const saved = Number(localStorage.getItem(MEDIA_MANAGE_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_MEDIA_MANAGE_PAGE_SIZE;
  });
  const [, setActiveSubLibName] = useState<string>('全部');
  const [strategyMsg, setStrategyMsg] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [smartTaskActions, setSmartTaskActions] = useState<string[] | null>(null);

  // Fetch subLibrary list
  useEffect(() => {
    libraryApi.getStatus().then((s) => {
      const enabled = s.subLibraries.filter((sl) => sl.enabled && sl.mediaType !== 'adult');
      setSubLibraries(enabled);
      setSubLibraryId((current) => {
        if (current && enabled.some((sl) => sl.uuid === current)) return current;
        const saved = localStorage.getItem(MEDIA_MANAGE_SUB_LIBRARY_KEY);
        if (saved !== null && (saved === '' || enabled.some((sl) => sl.uuid === saved))) return saved;
        if (saved && !enabled.some((sl) => sl.uuid === saved)) {
          localStorage.setItem(MEDIA_MANAGE_SUB_LIBRARY_KEY, '');
        }
        return '';
      });
    }).catch(() => {});
    systemConfig.get().then((cfg) => {
      setSmartTaskActions(Array.isArray(cfg.smartTaskEnabledActions) ? cfg.smartTaskEnabledActions : []);
    }).catch(() => {});
  }, []);

  const selectedSubLibrary = useMemo(
    () => subLibraries.find((sl) => sl.uuid === subLibraryId) || null,
    [subLibraries, subLibraryId],
  );
  const subLibraryDisplayById = useMemo(
    () => new Map(subLibraries.map((sl) => [sl.uuid, { name: sl.name, typeLabel: formatSubLibraryType(sl) }])),
    [subLibraries],
  );
  const showAdultFields = selectedSubLibrary?.mediaType === 'adult';
  const showStandardFields = !selectedSubLibrary || selectedSubLibrary.mediaType !== 'adult';
  const mediaGridClass = showAdultFields && showStandardFields
    ? 'mediaManageGridMixed'
    : showAdultFields
      ? 'mediaManageGridAdult'
      : 'mediaManageGridStandard';

  useEffect(() => {
    if (!showStandardFields) {
      if (watchedFilter !== 'all') setWatchedFilter('all');
      if (bluRayFilter !== 'all') setBluRayFilter('all');
      if (doubanFilter !== 'all') setDoubanFilter('all');
      if (actionFilter === 'upgrade') setActionFilter('all');
    }
  }, [showStandardFields, watchedFilter, bluRayFilter, doubanFilter, actionFilter]);

  useEffect(() => {
    setPage(0);
    setSelectedIds(new Set());
  }, [subLibraryId, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter, doubanFilter, localRatingFilter, taskFilter, metadataFilter, lifecycleFilter, pageSize]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [page]);

  // Fetch library data when subLibraryId changes
  useEffect(() => {
    let active = true;
    const target = `/v1/library?projection=manage&pageSize=${pageSize}&page=${page + 1}`;
    setLoading(true);
    setLoadingTarget(target);
    setError(null);
    libraryApi
      .getCache({
        subLibraryId: subLibraryId || undefined,
        limit: pageSize,
        offset: page * pageSize,
        projection: 'manage',
        search: searchQuery.trim() || undefined,
        action: actionFilter,
        resolution: resolutionFilter,
        codec: codecFilter,
        watched: showStandardFields ? watchedFilter : 'all',
        bluRay: showStandardFields ? bluRayFilter : 'all',
        douban: showStandardFields ? doubanFilter : 'all',
        userRating: localRatingFilter,
        task: taskFilter,
        metadata: metadataFilter,
        lifecycle: lifecycleFilter,
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
  }, [subLibraryId, page, pageSize, refreshKey, searchQuery, actionFilter, resolutionFilter, codecFilter, watchedFilter, bluRayFilter, doubanFilter, localRatingFilter, taskFilter, metadataFilter, lifecycleFilter, showStandardFields]);

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
      const action = preferredTaskAction(it) || it.businessFlowDecision?.recommendedOperation || it.recommendedAction || 'keep';
      if (action === 'keep') continue;
      if (!smartTaskActions.includes(action)) {
        disabledCounts[action] = (disabledCounts[action] || 0) + 1;
      }
    }
    const parts = Object.entries(disabledCounts)
      .filter(([, count]) => count > 0)
      .map(([action, count]) => `${ACTION_LABELS[action] || action} ${count} 条`);
    if (parts.length === 0) return null;
    return `当前列表有 ${parts.join('、')}推荐方向未启用后台自动入队。这些条目只会显示下一步建议，不会自动创建任务；可以手动点击每行的操作按钮，或到「任务调度」启用对应自动推进范围。`;
  }, [items, smartTaskActions]);

  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize + items.length);
  const activeTaskByItemId = useMemo(() => {
    const map = new Map<string, MediaTask>();
    for (const task of tasks) {
      if (ACTIVE_ROW_TASK_STATUSES.has(task.status)) map.set(task.itemId, task);
    }
    return map;
  }, [tasks]);
  const batchableItems = useMemo(
    () => items.filter((it) => !activeTaskByItemId.has(it.id) && preferredTaskAction(it)),
    [activeTaskByItemId, items],
  );
  const selectedBatchableCount = useMemo(
    () => batchableItems.filter((it) => selectedIds.has(it.id)).length,
    [batchableItems, selectedIds],
  );

  const upsertActiveTask = useCallback((task: MediaTask) => {
    setTasks((prev) => {
      const next = prev.filter((t) => t.id !== task.id);
      return [task, ...next];
    });
  }, []);

  const enqueueManagedAction = useCallback(async (item: ManagedMediaItem, action: MediaAction): Promise<MediaTask | null> => {
    const allowedOperation = allowedOperationForItem(item, action);
    if (!allowedOperation) {
      setNotice(null);
      setError(`创建任务被策略阻止：${item.name}，${blockedReasonText(item, action, '当前操作不可用')}`);
      return null;
    }
    setCreatingTaskIds((prev) => new Set(prev).add(item.id));
    try {
      const task = await taskApi.createByIntent({
        itemId: item.id,
        bridgeKind: allowedOperation.bridgeKind,
        preferredOperation: allowedOperation.flowOperation || allowedOperation.operation,
      });
      upsertActiveTask(task);
      setError(null);
      const statusHint = task.status === 'pending_manual'
        ? '当前状态为待手动启动，可在任务中心点击“启动”。'
        : '已进入任务调度，可在任务中心查看进度。';
      setNotice(`已创建「${ACTION_LABELS[action] || action}」任务：${item.name}。${statusHint}`);
      return task;
    } catch (e) {
      setNotice(null);
      if (e instanceof ApiConflictError) setError(e.message);
      else setError(`创建任务失败：${(e as Error).message}`);
      return null;
    } finally {
      setCreatingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [upsertActiveTask]);

  const runBatchSelection = useCallback(async () => {
    const selected = items.filter((it) => selectedIds.has(it.id));
    let skipped = 0;
    let created = 0;
    let failed = 0;
    for (const it of selected) {
      if (activeTaskByItemId.has(it.id)) {
        skipped += 1;
        continue;
      }
      const action = preferredTaskAction(it);
      if (!action) {
        skipped += 1;
        continue;
      }
      const task = await enqueueManagedAction(it, action);
      if (task) created += 1;
      else failed += 1;
    }
    setNotice(`批量创建完成：成功 ${created} 条，跳过 ${skipped} 条，失败 ${failed} 条。`);
    if (created > 0) setSelectedIds(new Set());
  }, [activeTaskByItemId, enqueueManagedAction, items, selectedIds]);

  const rescrapeAdultItem = useCallback(async (item: ManagedMediaItem) => {
    try {
      await adultApi.rescrapeItem(item.id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setError(`重新刮削失败：${(e as Error).message}`);
    }
  }, []);

  const toggleSelectedItem = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleWatchChange = useCallback(async (it: ManagedMediaItem, watched: boolean) => {
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
  }, [subLibraryId]);

  const handleRatingChange = useCallback(async (it: ManagedMediaItem, rating: MediaRating | null) => {
    await libraryApi.patchRatings(it.id, rating);
    setItems((prev) =>
      prev.map((x) => (x.id === it.id ? { ...x, rating } : x)),
    );
  }, []);

  if (loading) {
    return (
      <div className="page">
        <p>加载媒体库数据...</p>
        <p className="muted">正在请求 {loadingTarget}</p>
      </div>
    );
  }

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
          <option value="">全部普通库（{subLibraries.length} 个）</option>
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
          <span className="filterLabel">操作</span>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="transcode">转码压缩</option>
            {showStandardFields && <option value="upgrade">洗版</option>}
            <option value="keep">无需优化</option>
            <option value="delete">删除</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">元数据</span>
          <select value={metadataFilter} onChange={(e) => setMetadataFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="done">完整</option>
            <option value="pending">待补齐</option>
            <option value="failed">失败</option>
          </select>
        </div>
        <div className="filterRow">
          <span className="filterLabel">生命周期</span>
          <select value={lifecycleFilter} onChange={(e) => setLifecycleFilter(e.target.value)}>
            <option value="all">全部</option>
            <option value="open">未收口</option>
            <option value="ingested">已入库</option>
            <option value="metadata_ready">元数据就绪</option>
            <option value="optimize">待优化</option>
            <option value="archive_ready">可归档</option>
            <option value="done">已归档</option>
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
        {showStandardFields && (
          <>
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
          </>
        )}
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
        <button
          className="sidebarFilterReset"
          type="button"
          onClick={() => {
            setSearchQuery('');
            setActionFilter('all');
            setResolutionFilter('all');
            setCodecFilter('all');
            if (showStandardFields) {
              setWatchedFilter('all');
              setBluRayFilter('all');
              setDoubanFilter('all');
            }
            setLocalRatingFilter('all');
            setTaskFilter('all');
            setMetadataFilter('all');
            setLifecycleFilter('all');
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
          <button type="button" onClick={() => setSelectedIds(new Set(batchableItems.map((it) => it.id)))} disabled={batchableItems.length === 0}>
            选择可创建
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
          disabled={selectedBatchableCount === 0 || creatingTaskIds.size > 0}
          onClick={runBatchSelection}
        >
          {creatingTaskIds.size > 0 ? '创建任务中...' : '批量创建任务'}
        </button>
        <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
          已选 {selectedIds.size} 条，其中可创建 {selectedBatchableCount} 条；当前页可创建 {batchableItems.length} / {items.length} 条
        </p>
      </div>
      <div className="pageMain">
        <div className="pageMainInner">
          {error && <p className="error">{error}</p>}
          {notice && <div className="mediaNotice mediaNoticeSuccess">{notice}</div>}
          {autoEntryNotice && <div className="mediaNotice">{autoEntryNotice}</div>}
          <div className="mediaPager">
            <span>第 {page + 1} / {maxPage + 1} 页，显示 {rangeStart}-{rangeEnd}，共 {total} 条</span>
            <div className="mediaPagerControls">
              <label>
                每页
                <select
                  value={pageSize}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (PAGE_SIZE_OPTIONS.includes(next)) {
                      setPageSize(next);
                      localStorage.setItem(MEDIA_MANAGE_PAGE_SIZE_KEY, String(next));
                    }
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>上一页</button>
              <button type="button" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>下一页</button>
            </div>
          </div>
          {items.length === 0 ? (
            <p>{subLibraries.length === 0 ? '暂未配置普通媒体库。' : '当前筛选条件下没有媒体。'}</p>
          ) : (
            <div>
              <div className={`mediaManageGrid ${mediaGridClass} mediaManageHead`}>
                <div className="mediaManageTitleCell">名称</div>
                <div>生命周期状态</div>
                <div>元数据</div>
                <div>媒体事实</div>
                <div>用户信号</div>
                <div>操作</div>
                <div>任务</div>
              </div>
              {items.map((item) => {
                const rowTask = activeTaskByItemId.get(item.id);
                const subLibraryDisplay = subLibraryDisplayById.get(item.sectionId);
                return (
                  <MediaLibraryManageRow
                    key={item.id}
                    item={item}
                    isSelected={selectedIds.has(item.id)}
                    selectionDisabled={!!rowTask || !preferredTaskAction(item)}
                    selectionTitle={rowTask ? '该条目已有未结案任务，不能参与批量创建' : preferredTaskAction(item) ? '勾选后可参与左侧批量操作' : blockedReasonText(item, item.businessFlowDecision?.recommendedOperation || item.recommendedAction, '当前操作不可用')}
                    isHighlighted={false}
                    rowTask={rowTask}
                    isCreatingTask={creatingTaskIds.has(item.id)}
                    showAdultFields={showAdultFields}
                    showStandardFields={showStandardFields}
                    gridClassName={mediaGridClass}
                    subLibraryName={subLibraryDisplay?.name || ''}
                    subLibraryTypeLabel={subLibraryDisplay?.typeLabel || '子库未知'}
                    onToggleSelect={toggleSelectedItem}
                    onWatchChange={handleWatchChange}
                    onRatingChange={handleRatingChange}
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
    lifecycleStage: typeof o.lifecycleStage === 'string' ? o.lifecycleStage : undefined,
    lifecycleDone: typeof o.lifecycleDone === 'boolean' ? o.lifecycleDone : undefined,
    lifecycleNextTask: typeof o.lifecycleNextTask === 'string' ? o.lifecycleNextTask : null,
    lifecycleReason: typeof o.lifecycleReason === 'string' ? o.lifecycleReason : undefined,
    metadataStatus: typeof o.metadataStatus === 'string' ? o.metadataStatus : undefined,
    metadataKind: typeof o.metadataKind === 'string' ? o.metadataKind : undefined,
    metadataComplete: typeof o.metadataComplete === 'boolean' ? o.metadataComplete : undefined,
    metadataMissingReasons: Array.isArray(o.metadataMissingReasons) ? o.metadataMissingReasons.filter((x): x is string => typeof x === 'string') : undefined,
    archiveStatus: typeof o.archiveStatus === 'string' ? o.archiveStatus : undefined,
    archiveReason: typeof o.archiveReason === 'string' ? o.archiveReason : undefined,
    archiveDoneAt: typeof o.archiveDoneAt === 'string' ? o.archiveDoneAt : null,
    scraped: Boolean(o.scraped),
    adultMetadata: o.adultMetadata && typeof o.adultMetadata === 'object' ? (o.adultMetadata as Record<string, unknown>) : undefined,
    businessFlowDecision: coerceBusinessFlowDecision(o.businessFlowDecision),
  };
}

function formatSubLibraryType(subLibrary: SubLibraryInfo | null): string {
  if (!subLibrary) return '子库未知';
  if (subLibrary.mediaType === 'adult') {
    if (subLibrary.adultRegion === 'western_adult') return '成人/欧美';
    if (subLibrary.adultRegion === 'japanese_jav' || subLibrary.scraperType === 'shelfdeck_japanese_jav') return '成人/JAV';
    return '成人';
  }
  if (subLibrary.mediaType === 'tv') return '剧集';
  if (subLibrary.mediaType === 'movie' || subLibrary.source === 'emby') return '电影';
  return subLibrary.mediaType || subLibrary.source || '媒体';
}

function coerceBusinessFlowDecision(value: unknown): BusinessFlowDecision | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const o = value as Record<string, unknown>;
  const allowedOperations = Array.isArray(o.allowedOperations)
    ? o.allowedOperations
      .filter((op): op is Record<string, unknown> => !!op && typeof op === 'object' && typeof op.operation === 'string')
      .map((op) => ({
        operation: op.operation as string,
        bridgeKind: typeof op.bridgeKind === 'string' ? op.bridgeKind : undefined,
        flowOperation: typeof op.flowOperation === 'string' ? op.flowOperation : undefined,
      }))
    : undefined;
  const blockedOperations = Array.isArray(o.blockedOperations)
    ? o.blockedOperations
      .filter((op): op is Record<string, unknown> => !!op && typeof op === 'object' && typeof op.operation === 'string')
      .map((op) => ({
        operation: op.operation as string,
        reason: typeof op.reason === 'string' ? op.reason : '',
        metadataMissingReasons: Array.isArray(op.metadataMissingReasons)
          ? op.metadataMissingReasons.filter((x): x is string => typeof x === 'string')
          : undefined,
        supportedEntry: typeof op.supportedEntry === 'string' ? op.supportedEntry : undefined,
        activeTaskId: typeof op.activeTaskId === 'string' ? op.activeTaskId : undefined,
      }))
    : undefined;
  const blockedReasons = o.blockedReasons && typeof o.blockedReasons === 'object'
    ? Object.fromEntries(
      Object.entries(o.blockedReasons as Record<string, unknown>)
        .filter(([, reason]) => typeof reason === 'string'),
    ) as Record<string, string>
    : undefined;
  return {
    lifecycleStage: typeof o.lifecycleStage === 'string' ? o.lifecycleStage : undefined,
    lifecycleDone: typeof o.lifecycleDone === 'boolean' ? o.lifecycleDone : undefined,
    metadataStatus: typeof o.metadataStatus === 'string' ? o.metadataStatus : undefined,
    optimizationStatus: typeof o.optimizationStatus === 'string' ? o.optimizationStatus : undefined,
    archiveStatus: typeof o.archiveStatus === 'string' ? o.archiveStatus : undefined,
    nextBridge: typeof o.nextBridge === 'string' ? o.nextBridge : null,
    recommendedOperation: typeof o.recommendedOperation === 'string' ? o.recommendedOperation : null,
    allowedOperations,
    blockedOperations,
    blockedReasons,
    activeTaskBridge: typeof o.activeTaskBridge === 'string' ? o.activeTaskBridge : null,
    activeFlowOperation: typeof o.activeFlowOperation === 'string' ? o.activeFlowOperation : null,
    latestEventSummary: o.latestEventSummary && typeof o.latestEventSummary === 'object' ? (o.latestEventSummary as Record<string, unknown>) : null,
    diagnosticSummary: o.diagnosticSummary && typeof o.diagnosticSummary === 'object' ? (o.diagnosticSummary as Record<string, unknown>) : null,
  };
}
