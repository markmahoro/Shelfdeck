import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiConflictError, libraryApi, taskApi } from '../api/client';
import type { SubLibraryInfo } from '../api/client';
import type { MediaTask } from '../types';
import type { KairoxMediaProjection, KairoxTargetGate } from '../kairox';
import {
  isKairoxActiveTask,
  mediaDisplayFacts,
  targetGateLabel,
  taskItemId,
  toKairoxMediaProjection,
} from '../kairox';
import '../mediaManage.css';

const MEDIA_MANAGE_SUB_LIBRARY_KEY = 'media_manage_sub_library_id';
const MEDIA_MANAGE_PAGE_SIZE_KEY = 'media_manage_page_size';
const DEFAULT_MEDIA_MANAGE_PAGE_SIZE = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function MediaManagePage() {
  const [subLibraries, setSubLibraries] = useState<SubLibraryInfo[]>([]);
  const [subLibraryId, setSubLibraryId] = useState('');
  const [rawItems, setRawItems] = useState<unknown[]>([]);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const saved = Number(localStorage.getItem(MEDIA_MANAGE_PAGE_SIZE_KEY));
    return PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_MEDIA_MANAGE_PAGE_SIZE;
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [metadataFilter, setMetadataFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [ratingFilter, setRatingFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creatingTaskIds, setCreatingTaskIds] = useState<Set<string>>(() => new Set());
  const [detailItem, setDetailItem] = useState<KairoxMediaProjection | null>(null);

  useEffect(() => {
    libraryApi.getStatus()
      .then((status) => {
        const enabled = status.subLibraries.filter((sl) => sl.enabled);
        setSubLibraries(enabled);
        setSubLibraryId((current) => {
          if (current && enabled.some((sl) => sl.uuid === current)) return current;
          const saved = localStorage.getItem(MEDIA_MANAGE_SUB_LIBRARY_KEY);
          if (saved !== null && (saved === '' || enabled.some((sl) => sl.uuid === saved))) return saved;
          return '';
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem(MEDIA_MANAGE_SUB_LIBRARY_KEY, subLibraryId);
    setPage(0);
  }, [subLibraryId, searchQuery, metadataFilter, lifecycleFilter, ratingFilter, pageSize]);

  useEffect(() => {
    localStorage.setItem(MEDIA_MANAGE_PAGE_SIZE_KEY, String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    libraryApi.getCache({
      subLibraryId: subLibraryId || undefined,
      limit: pageSize,
      offset: page * pageSize,
      projection: 'manage',
      search: searchQuery.trim() || undefined,
      metadata: metadataFilter,
      lifecycle: lifecycleFilter,
      userRating: ratingFilter,
    })
      .then((data) => {
        if (!active) return;
        setRawItems(Array.isArray(data.items) ? data.items : []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(`加载媒体库失败：${e.message}`);
        setLoading(false);
      });
    return () => { active = false; };
  }, [subLibraryId, page, pageSize, searchQuery, metadataFilter, lifecycleFilter, ratingFilter, refreshKey]);

  useEffect(() => {
    const poll = () => taskApi.getTasks({ activeOnly: true }).then(setTasks).catch(() => {});
    poll();
    const id = window.setInterval(poll, 3000);
    return () => window.clearInterval(id);
  }, []);

  const activeTaskByItemId = useMemo(() => {
    const map = new Map<string, MediaTask>();
    for (const task of tasks) {
      const itemId = taskItemId(task);
      if (itemId && isKairoxActiveTask(task)) map.set(itemId, task);
    }
    return map;
  }, [tasks]);

  const projections = useMemo(() => rawItems
    .map((raw) => {
      const itemId = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? String((raw as Record<string, unknown>).id || (raw as Record<string, unknown>).itemId || '')
        : '';
      return toKairoxMediaProjection(raw, activeTaskByItemId.get(itemId) || null);
    })
    .filter((item): item is KairoxMediaProjection => item != null), [activeTaskByItemId, rawItems]);

  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, page * pageSize + projections.length);
  const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);

  const createTargetGateTask = useCallback(async (item: KairoxMediaProjection, targetGate: KairoxTargetGate) => {
    setCreatingTaskIds((prev) => new Set(prev).add(item.id));
    try {
      const task = await taskApi.createByIntent({
        itemId: item.id,
        targetGate,
        gateObjective: item.objective || undefined,
      });
      setTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)]);
      setNotice(`已创建「${targetGateLabel(targetGate)}」任务：${item.title}`);
      setError(null);
      setRefreshKey((v) => v + 1);
    } catch (e) {
      setNotice(null);
      setError(e instanceof ApiConflictError ? e.message : `创建任务失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreatingTaskIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, []);

  const updateRating = useCallback(async (item: KairoxMediaProjection, value: number | null) => {
    await libraryApi.patchRatings(item.id, value);
    setRefreshKey((v) => v + 1);
  }, []);

  const updateWatched = useCallback(async (item: KairoxMediaProjection, watched: boolean) => {
    if (watched) await libraryApi.markPlayed(item.id, item.subLibraryId || undefined);
    else await libraryApi.markUnplayed(item.id, item.subLibraryId || undefined);
    setRefreshKey((v) => v + 1);
  }, []);

  return (
    <div className="page kairoxMediaPage">
      <aside className="pageSidebar">
        <div className="sidebarMuted">媒体库</div>
        <select value={subLibraryId} onChange={(e) => setSubLibraryId(e.target.value)}>
          <option value="">全部媒体库</option>
          {subLibraries.map((sl) => (
            <option key={sl.uuid} value={sl.uuid}>{sl.name}</option>
          ))}
        </select>

        <div className="sidebarMuted">搜索</div>
        <div className="sidebarSearchWrap">
          <input
            className="sidebarSearch"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="标题、文件名、条目 ID"
          />
          {searchQuery && (
            <button className="sidebarSearchClear" onClick={() => setSearchQuery('')} aria-label="清空搜索">×</button>
          )}
        </div>

        <FilterSelect label="元数据" value={metadataFilter} onChange={setMetadataFilter} options={[
          ['all', '全部'],
          ['complete', '完整'],
          ['missing', '缺失'],
        ]} />
        <FilterSelect label="阶段" value={lifecycleFilter} onChange={setLifecycleFilter} options={[
          ['all', '全部'],
          ['metadata', '元数据'],
          ['optimize', '优化'],
          ['archive', '归档'],
          ['delete', '处置'],
        ]} />
        <FilterSelect label="评分" value={ratingFilter} onChange={setRatingFilter} options={[
          ['all', '全部'],
          ['missing', '未评分'],
          ['1', '1★'],
          ['2', '2★'],
          ['3', '3★'],
          ['4', '4★'],
          ['5', '5★'],
        ]} />
        <button className="sidebarFilterReset" onClick={() => {
          setSearchQuery('');
          setMetadataFilter('all');
          setLifecycleFilter('all');
          setRatingFilter('all');
        }}>重置筛选</button>
      </aside>

      <main className="pageMain">
        <div className="pageMainInner">
          <div className="kairoxMediaHeader">
            <div>
              <h1>媒体库</h1>
              <p>查看媒体的当前事实、用户感知、生命周期位置和下一步目标。</p>
            </div>
            <button onClick={() => setRefreshKey((v) => v + 1)}>刷新</button>
          </div>

          {notice && <div className="mediaNotice mediaNoticeSuccess">{notice}</div>}
          {error && <div className="mediaNotice">{error}</div>}

          <div className="mediaPager">
            <span>显示 {rangeStart}-{rangeEnd} / {total}</span>
            <div className="mediaPagerControls">
              <label>
                每页
                <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                  {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
                </select>
              </label>
              <button disabled={page <= 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>上一页</button>
              <button disabled={page >= maxPage} onClick={() => setPage((v) => Math.min(maxPage, v + 1))}>下一页</button>
            </div>
          </div>

          {loading ? (
            <div className="kairoxMediaEmpty">正在读取媒体事实...</div>
          ) : projections.length === 0 ? (
            <div className="kairoxMediaEmpty">当前筛选下没有媒体。</div>
          ) : (
            <div className="kairoxMediaList">
              {projections.map((item) => (
                <MediaProjectionRow
                  key={item.id}
                  item={item}
                  creating={creatingTaskIds.has(item.id)}
                  onCreateTask={createTargetGateTask}
                  onOpenDetail={setDetailItem}
                  onRating={updateRating}
                  onWatched={updateWatched}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {detailItem && <MediaDetailDrawer item={detailItem} onClose={() => setDetailItem(null)} />}
    </div>
  );
}

function MediaProjectionRow({
  item,
  creating,
  onCreateTask,
  onOpenDetail,
  onRating,
  onWatched,
}: {
  item: KairoxMediaProjection;
  creating: boolean;
  onCreateTask: (item: KairoxMediaProjection, targetGate: KairoxTargetGate) => void;
  onOpenDetail: (item: KairoxMediaProjection) => void;
  onRating: (item: KairoxMediaProjection, value: number | null) => void;
  onWatched: (item: KairoxMediaProjection, watched: boolean) => void;
}) {
  const nextGate = item.nextAction?.targetGate || item.lifecycle.nextTargetGate || null;
  const canCreateTask = item.nextAction?.kind === 'create_task' && nextGate;
  return (
    <article className="kairoxMediaRow">
      <div className="kairoxMediaTitleCell">
        <button className="kairoxLinkButton" onClick={() => onOpenDetail(item)}>{item.title}</button>
        <div className="hint">{item.sourceFacts.sectionName as string || item.subLibraryId || '未知媒体库'} · {item.id}</div>
      </div>

      <div className="kairoxFactStrip">
        {mediaDisplayFacts(item).map((fact) => (
          <span key={fact.label}><strong>{fact.label}</strong>{fact.value}</span>
        ))}
      </div>

      <div className="kairoxLifecycleCell">
        <span className="kairoxGateBadge">{targetGateLabel(item.lifecycle.nextTargetGate) || '无'}</span>
        <span>{item.lifecycle.reason || item.lifecycle.stage || '当前无待推进目标'}</span>
      </div>

      <div className="kairoxObjectiveCell">
        {item.objective ? (
          <code>{compactJson(item.objective)}</code>
        ) : (
          <span className="hint">未计算优化目标</span>
        )}
      </div>

      <div className="kairoxPerceptionCell">
        <select
          value={typeof item.userPerceptionFacts.rating === 'number' ? String(item.userPerceptionFacts.rating) : ''}
          onChange={(e) => onRating(item, e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">未评分</option>
          {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}★</option>)}
        </select>
        <label>
          <input
            type="checkbox"
            checked={item.userPerceptionFacts.watched === true}
            onChange={(e) => onWatched(item, e.target.checked)}
          />
          已看
        </label>
      </div>

      <div className="kairoxActionCell">
        {item.activeTask ? (
          <button onClick={() => onOpenDetail(item)}>查看任务</button>
        ) : canCreateTask ? (
          <button disabled={creating} onClick={() => onCreateTask(item, nextGate)}>
            {creating ? '创建中...' : item.nextAction?.label}
          </button>
        ) : item.nextAction?.kind === 'review_delete_candidate' ? (
          <button onClick={() => onOpenDetail(item)}>查看处置</button>
        ) : (
          <span className="hint">{item.nextAction?.label || '无需处理'}</span>
        )}
      </div>
    </article>
  );
}

function MediaDetailDrawer({ item, onClose }: { item: KairoxMediaProjection; onClose: () => void }) {
  return (
    <div className="kairoxDrawerBackdrop" role="presentation" onClick={onClose}>
      <aside className="kairoxDrawer" role="dialog" aria-modal="true" aria-label="媒体详情" onClick={(e) => e.stopPropagation()}>
        <div className="kairoxDrawerHeader">
          <div>
            <h2>{item.title}</h2>
            <p>{item.id}</p>
          </div>
          <button onClick={onClose}>关闭</button>
        </div>
        <FactSection title="来源事实" facts={item.sourceFacts} />
        <FactSection title="媒体事实" facts={item.mediaFacts} />
        <FactSection title="元数据事实" facts={item.metadataFacts} />
        <FactSection title="用户感知" facts={item.userPerceptionFacts} />
        <FactSection title="Gate facts" facts={item.gateFacts} />
        <FactSection title="媒体优化目标" facts={item.objective || {}} empty="暂无目标" />
        {item.activeTask && <FactSection title="进行中的任务" facts={item.activeTask as unknown as Record<string, unknown>} />}
      </aside>
    </div>
  );
}

function FactSection({ title, facts, empty = '暂无事实' }: { title: string; facts: Record<string, unknown>; empty?: string }) {
  const entries = Object.entries(facts).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return (
    <section className="kairoxFactSection">
      <h3>{title}</h3>
      {entries.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <dl>
          {entries.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{formatValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <div className="filterRow">
      <span className="filterLabel">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </div>
  );
}

function compactJson(value: Record<string, unknown>): string {
  const entries = Object.entries(value).slice(0, 3);
  if (entries.length === 0) return '{}';
  return entries.map(([key, val]) => `${key}: ${formatValue(val)}`).join(', ');
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value == null ? '-' : String(value);
}
