import { memo, useState } from 'react';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import { taskStatusLabelZh } from '../models/task';
import type { MediaTask } from '../types';

function Stars({ count, max }: { count: number | null; max: number }) {
  return (
    <span className="starsRow">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={count != null && i < count ? 'starFilled' : 'starEmpty'}>
          ★
        </span>
      ))}
    </span>
  );
}

function StarInput({ value, onChange }: { value: MediaRating | null; onChange: (r: MediaRating | null) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? value;
  return (
    <span className="starsRow starsClickable">
      {[1, 2, 3, 4, 5].map((s) => (
        <span
          key={s}
          className={active != null && s <= active ? 'starFilled' : 'starEmpty'}
          onClick={() => onChange(value === s ? null : (s as MediaRating))}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(null)}
        >
          ★
        </span>
      ))}
    </span>
  );
}

export type MediaLibraryManageRowProps = {
  item: ManagedMediaItem;
  isSelected: boolean;
  isHighlighted: boolean;
  rowTask: MediaTask | undefined;
  showAdultFields: boolean;
  onToggleSelect: (id: string) => void;
  onWatchChange: (item: ManagedMediaItem, watched: boolean) => void;
  onRatingChange: (item: ManagedMediaItem, rating: MediaRating | null) => void;
  onEnqueue: (item: ManagedMediaItem, action: MediaAction) => void;
  onRescrape?: (item: ManagedMediaItem) => void;
};

const MAX_STARS = 5;
const ACTION_LABEL: Record<string, string> = { delete: '删除', transcode: '转码压缩', upgrade: '洗版', scrape: '刮削', ingest: '入库' };
const OPTIMIZATION_LABEL: Record<string, string> = { transcoded: '已转码', upgraded: '已洗版', none: '未优化' };

function adultMetaString(item: ManagedMediaItem, key: string): string {
  const value = item.adultMetadata?.[key];
  return typeof value === 'string' ? value : '';
}

function adultScrapeStatus(item: ManagedMediaItem): { label: string; tone: 'done' | 'pending' | 'failed' | 'ambiguous'; title: string } | null {
  if (item.source !== 'adult_folder') return null;
  const status = adultMetaString(item, 'scrapeStatus');
  const adultId = adultMetaString(item, 'adultId');
  const idConfidence = adultMetaString(item, 'idConfidence');
  const nfoPath = adultMetaString(item, 'nfoPath');
  if (item.scraped || status === 'done') {
    return {
      label: '已刮削',
      tone: 'done',
      title: nfoPath ? `已读取 NFO：${nfoPath}` : '已刮削',
    };
  }
  if (status === 'failed') {
    return {
      label: '刮削失败',
      tone: 'failed',
      title: adultId ? `番号：${adultId}` : '刮削失败',
    };
  }
  if (status === 'ambiguous' || idConfidence === 'low') {
    return {
      label: '番号待确认',
      tone: 'ambiguous',
      title: adultId ? `疑似番号：${adultId}（点击重刮可修正）` : '未能识别番号',
    };
  }
  return {
    label: '待刮削',
    tone: 'pending',
    title: adultId ? `番号：${adultId}` : '等待识别番号并刮削',
  };
}

function MediaLibraryManageRowInner({
  item,
  isSelected,
  isHighlighted,
  rowTask,
  showAdultFields,
  onToggleSelect,
  onWatchChange,
  onRatingChange,
  onEnqueue,
  onRescrape,
}: MediaLibraryManageRowProps) {
  const action = item.recommendedAction ?? 'keep';
  const eq = item.equivalentBitrate;
  const target = item.targetBitrate;
  const predictGb = item.predictedSizeGb;
  const optimizationTitle = item.optimizationDoneAt
    ? `${OPTIMIZATION_LABEL[item.optimizationStatus]}：${new Date(item.optimizationDoneAt).toLocaleString()}`
    : OPTIMIZATION_LABEL[item.optimizationStatus];
  const scrapeStatus = adultScrapeStatus(item);
  const adultId = adultMetaString(item, 'adultId');
  const studio = adultMetaString(item, 'studio');
  const director = adultMetaString(item, 'director');
  const premiered = adultMetaString(item, 'premiered');
  const adultSummary = [adultId, studio].filter(Boolean).join(' · ');
  const adultTitle = [
    adultId ? `番号：${adultId}` : '',
    studio ? `制作商：${studio}` : '',
    director ? `导演：${director}` : '',
    premiered ? `发行：${premiered}` : '',
  ].filter(Boolean).join('\n');

  const taskCell = rowTask ? (
    <span title={rowTask.id}>
      {taskStatusLabelZh(rowTask.status)}（
      {ACTION_LABEL[rowTask.actionType] || rowTask.actionType}
      ）
    </span>
  ) : (
    '—'
  );

  const actionDisabled = !!rowTask || (item.isBluRayDisc && action === 'upgrade');

  return (
    <div
      data-manage-item-id={item.id}
      className={`mediaManageGrid ${showAdultFields ? 'mediaManageGridAdult' : 'mediaManageGridStandard'} mediaManageRow${isHighlighted ? ' mediaManageRowHighlight' : ''}`}
    >
      <div className="mediaManageTitleCell">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          title="勾选后可参与左侧批量操作"
        />
        <span className="mediaManageTitleWrap">
          <span className="mediaManageTitle">{item.name}</span>
        </span>
      </div>
      {showAdultFields && (
        <div className="adultScrapeCell">
          {scrapeStatus ? (
            <>
              <span className={`adultScrapeBadge adultScrapeBadge-${scrapeStatus.tone}`} title={scrapeStatus.title}>
                {scrapeStatus.label}
              </span>
              {adultSummary ? (
                <span className="adultScrapeSummary" title={adultTitle || scrapeStatus.title}>
                  {adultSummary}
                </span>
              ) : (
                <span className="adultScrapeSummary">—</span>
              )}
              {onRescrape && !rowTask && (
                <button
                  type="button"
                  className="adultRescrapeBtn"
                  title="重新刮削该条目"
                  onClick={() => onRescrape(item)}
                >
                  重刮
                </button>
              )}
            </>
          ) : (
            <span className="hint">—</span>
          )}
        </div>
      )}
      <div>{item.seriesName || '—'}</div>
      <div className="tabular-nums">{item.seasonNumber != null ? `S${String(item.seasonNumber).padStart(2, '0')}` : '—'}</div>
      <div className="tabular-nums">{item.sizeGb.toFixed(1)} GB</div>
      <div>{item.resolution}</div>
      <div>{item.codec.toUpperCase()}</div>
      <div className="tabular-nums">{eq != null ? `${eq.toFixed(1)} Mbps` : '—'}</div>
      <div className="tabular-nums">{target != null ? `${target.toFixed(1)} Mbps` : '—'}</div>
      <div className="tabular-nums">{predictGb != null ? `${predictGb.toFixed(1)} GB` : '—'}</div>
      <div>
        <span className={`optimizationBadge optimizationBadge-${item.optimizationStatus}`} title={optimizationTitle}>
          {OPTIMIZATION_LABEL[item.optimizationStatus]}
        </span>
      </div>
      <div title={item.isBluRayDisc ? '原盘（ISO/BDMV）' : undefined}>
        {item.isBluRayDisc ? '是' : '否'}
      </div>
      <div title={item.doubanStars != null ? `豆瓣 ${item.doubanStars} 星` : '未抓取到'}>
        <Stars count={item.doubanStars} max={MAX_STARS} />
      </div>
      <div>
        <StarInput value={item.rating} onChange={(r) => onRatingChange(item, r)} />
      </div>
      <div className="mediaManageWatchedCell">
        <button type="button" disabled={item.watched} onClick={() => onWatchChange(item, true)}>
          已看
        </button>
        <button type="button" disabled={!item.watched} onClick={() => onWatchChange(item, false)}>
          未看
        </button>
      </div>
      <div>
        {action === 'keep' ? (
          <span className="hint" title={item.reason}>{item.reason || '已达标'}</span>
        ) : (
          <button
            type="button"
            disabled={actionDisabled}
            title={rowTask ? '该条目已有未结案任务' : item.isBluRayDisc && action === 'upgrade' ? '原盘暂不支持洗版' : undefined}
            onClick={() => onEnqueue(item, action)}
          >
            {ACTION_LABEL[action]}
          </button>
        )}
      </div>
      <div className="tabular-nums" style={{ fontSize: 12 }}>
        {taskCell}
      </div>
    </div>
  );
}

function rowPropsEqual(a: MediaLibraryManageRowProps, b: MediaLibraryManageRowProps): boolean {
  return (
    a.item === b.item &&
    a.isSelected === b.isSelected &&
    a.isHighlighted === b.isHighlighted &&
    a.rowTask === b.rowTask &&
    a.showAdultFields === b.showAdultFields &&
    a.onToggleSelect === b.onToggleSelect &&
    a.onWatchChange === b.onWatchChange &&
    a.onRatingChange === b.onRatingChange &&
    a.onEnqueue === b.onEnqueue &&
    a.onRescrape === b.onRescrape
  );
}

export const MediaLibraryManageRow = memo(MediaLibraryManageRowInner, rowPropsEqual);
