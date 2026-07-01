import { memo, useState } from 'react';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import { blockedReasonText, preferredTaskAction } from '../models/mediaActionPolicy';
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
  selectionDisabled?: boolean;
  selectionTitle?: string;
  isHighlighted: boolean;
  rowTask: MediaTask | undefined;
  isCreatingTask?: boolean;
  showAdultFields: boolean;
  showStandardFields: boolean;
  gridClassName: string;
  subLibraryName?: string;
  subLibraryTypeLabel?: string;
  onToggleSelect: (id: string) => void;
  onWatchChange: (item: ManagedMediaItem, watched: boolean) => void;
  onRatingChange: (item: ManagedMediaItem, rating: MediaRating | null) => void;
  onEnqueue: (item: ManagedMediaItem, action: MediaAction) => void;
  onRescrape?: (item: ManagedMediaItem) => void;
};

const MAX_STARS = 5;
const ACTION_LABEL: Record<string, string> = { delete: '删除', transcode: '转码压缩', upgrade: '洗版', scrape: '补元数据', ingest: '入库' };
const OPTIMIZATION_LABEL: Record<string, string> = { transcoded: '已转码', upgraded: '已洗版', none: '未优化' };
const LIFECYCLE_LABEL: Record<string, string> = { discovered: '已发现', ingested: '已入库', metadata_ready: '元数据就绪', optimized: '已优化', archived: '已归档' };
const METADATA_LABEL: Record<string, string> = { complete: '完整', done: '完整', missing: '缺失', pending: '待补齐', failed: '失败', ambiguous: '待确认' };
const ARCHIVE_LABEL: Record<string, string> = { archived_like: '已归档', not_ready: '未就绪', failed: '归档失败', pending: '待归档' };
const NEXT_TASK_LABEL: Record<string, string> = { metadata: '补元数据', optimize: '优化', archive: '归档' };
const GATE_LABEL: Record<string, string> = { metadata: '补元数据', optimize: '优化', archive: '归档' };

function adultMetaString(item: ManagedMediaItem, key: string): string {
  const value = item.adultMetadata?.[key];
  return typeof value === 'string' ? value : '';
}

function adultMetadataFlowStatus(item: ManagedMediaItem): { label: string; tone: 'done' | 'pending' | 'failed' | 'ambiguous'; title: string } | null {
  if (item.source !== 'adult_folder') return null;
  const status = adultMetaString(item, 'scrapeStatus');
  const adultId = adultMetaString(item, 'adultId');
  const idConfidence = adultMetaString(item, 'idConfidence');
  const nfoPath = adultMetaString(item, 'nfoPath');
  if (item.scraped || status === 'done') {
    return {
      label: '元数据完整',
      tone: 'done',
      title: nfoPath ? `已读取 NFO：${nfoPath}` : '元数据完整',
    };
  }
  if (status === 'failed') {
    return {
      label: '元数据失败',
      tone: 'failed',
      title: adultId ? `番号：${adultId}` : '元数据补齐失败',
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
    label: '待补齐',
    tone: 'pending',
    title: adultId ? `番号：${adultId}` : '等待补齐元数据',
  };
}

function MediaLibraryManageRowInner({
  item,
  isSelected,
  selectionDisabled,
  selectionTitle,
  isHighlighted,
  rowTask,
  isCreatingTask,
  showAdultFields,
  showStandardFields,
  gridClassName,
  subLibraryName,
  subLibraryTypeLabel,
  onToggleSelect,
  onWatchChange,
  onRatingChange,
  onEnqueue,
  onRescrape,
}: MediaLibraryManageRowProps) {
  const policyAction = preferredTaskAction(item);
  const recommendedOperation = item.businessFlowDecision?.recommendedOperation || item.recommendedAction || 'keep';
  const action = policyAction ?? 'keep';
  const eq = item.equivalentBitrate;
  const target = item.targetBitrate;
  const predictGb = item.predictedSizeGb;
  const optimizationTitle = item.optimizationDoneAt
    ? `${OPTIMIZATION_LABEL[item.optimizationStatus]}：${new Date(item.optimizationDoneAt).toLocaleString()}`
    : OPTIMIZATION_LABEL[item.optimizationStatus];
  const lifecycleLabel = LIFECYCLE_LABEL[item.lifecycleStage || ''] || item.lifecycleStage || '生命周期未知';
  const metadataLabel = item.metadataComplete
    ? '完整'
    : (METADATA_LABEL[item.metadataStatus || ''] || item.metadataStatus || '未知');
  const archiveLabel = item.lifecycleDone
    ? '已归档'
    : (ARCHIVE_LABEL[item.archiveStatus || ''] || item.archiveStatus || '未就绪');
  const lifecycleTitle = [
    item.lifecycleReason ? `原因：${item.lifecycleReason}` : '',
    item.metadataStatus ? `元数据：${item.metadataStatus}` : '',
    item.archiveStatus ? `归档：${item.archiveStatus}` : '',
    item.businessFlowDecision?.nextBridge ? `下一步目标：${GATE_LABEL[item.businessFlowDecision.nextBridge] || item.businessFlowDecision.nextBridge}` : '',
  ].filter(Boolean).join('\n');
  const metadataTitle = [
    item.metadataKind ? `类型：${item.metadataKind}` : '',
    item.metadataMissingReasons?.length ? `缺失：${item.metadataMissingReasons.join('、')}` : '',
  ].filter(Boolean).join('\n');
  const adultMetadataStatus = adultMetadataFlowStatus(item);
  const adultId = adultMetaString(item, 'adultId');
  const studio = adultMetaString(item, 'studio');
  const director = adultMetaString(item, 'director');
  const premiered = adultMetaString(item, 'premiered');
  const protagonist = (() => {
    const value = item.adultMetadata?.protagonist;
    if (!value || typeof value !== 'object') return '';
    const name = (value as Record<string, unknown>).name;
    return typeof name === 'string' ? name : '';
  })();
  const adultSummary = [adultId, studio || protagonist].filter(Boolean).join(' · ');
  const adultTitle = [
    adultId ? `番号：${adultId}` : '',
    studio ? `制作商：${studio}` : '',
    director ? `导演：${director}` : '',
    premiered ? `发行：${premiered}` : '',
    protagonist ? `主角：${protagonist}` : '',
  ].filter(Boolean).join('\n');
  const typeLabel = subLibraryTypeLabel || (item.source === 'adult_folder' ? '成人' : item.itemType === 'Season' ? '剧集' : '电影');
  const libraryTitle = [subLibraryName ? `子库：${subLibraryName}` : '', `类型：${typeLabel}`].filter(Boolean).join('\n');
  const mediaFactTitle = [
    libraryTitle,
    item.seriesName ? `剧名：${item.seriesName}` : '',
    item.seasonNumber != null ? `季：S${String(item.seasonNumber).padStart(2, '0')}` : '',
    item.isBluRayDisc ? '原盘：是' : '',
    eq != null ? `当前码率：${eq.toFixed(1)} Mbps` : '',
    target != null ? `目标码率：${target.toFixed(1)} Mbps` : '',
    predictGb != null ? `预测体积：${predictGb.toFixed(1)} GB` : '',
    adultTitle,
  ].filter(Boolean).join('\n');
  const mediaFactLines = [
    `${item.sizeGb.toFixed(1)} GB · ${item.resolution} · ${item.codec.toUpperCase()}`,
    eq != null || target != null
      ? `码率 ${eq != null ? `${eq.toFixed(1)} Mbps` : '—'} → ${target != null ? `${target.toFixed(1)} Mbps` : '—'}`
      : '',
    predictGb != null ? `预测 ${predictGb.toFixed(1)} GB` : '',
    showStandardFields && item.seriesName
      ? `${item.seriesName}${item.seasonNumber != null ? ` S${String(item.seasonNumber).padStart(2, '0')}` : ''}`
      : '',
    showStandardFields && item.isBluRayDisc ? '原盘' : '',
    showAdultFields && adultSummary ? adultSummary : '',
  ].filter(Boolean);
  const nextBridgeLabel = item.businessFlowDecision?.nextBridge
    ? (GATE_LABEL[item.businessFlowDecision.nextBridge] || item.businessFlowDecision.nextBridge)
    : (NEXT_TASK_LABEL[item.lifecycleNextTask || ''] || '');
  const recommendedBlockedReason = typeof recommendedOperation === 'string'
    ? blockedReasonText(item, recommendedOperation)
    : '';
  const lifecycleDetails = [
    item.lifecycleDone ? '闭环：已归档' : (archiveLabel ? `闭环：${archiveLabel}` : ''),
    nextBridgeLabel ? `下一目标：${nextBridgeLabel}` : '',
  ].filter(Boolean);
  const operationDetails = [
    `优化：${OPTIMIZATION_LABEL[item.optimizationStatus]}`,
    recommendedOperation && recommendedOperation !== 'keep' ? `建议：${ACTION_LABEL[recommendedOperation] || recommendedOperation}` : '',
    recommendedBlockedReason ? `阻止：${recommendedBlockedReason}` : '',
  ].filter(Boolean);

  const taskBridge = rowTask?.taskBridge?.kind || item.businessFlowDecision?.activeTaskBridge || '';
  const taskOperation = rowTask?.flowPlan?.operationKind || item.businessFlowDecision?.activeFlowOperation || rowTask?.operationKind || '';
  const taskCell = rowTask ? (
    <span title={rowTask.id}>
      {taskStatusLabelZh(rowTask.status)}（
      {GATE_LABEL[taskBridge] || taskBridge || '任务'}
      {' / '}
      {ACTION_LABEL[taskOperation] || taskOperation}
      ）
    </span>
  ) : (
    '—'
  );

  const actionDisabled = !!rowTask || !!isCreatingTask;

  return (
    <div
      data-manage-item-id={item.id}
      className={`mediaManageGrid ${gridClassName} mediaManageRow${isHighlighted ? ' mediaManageRowHighlight' : ''}`}
    >
      <div className="mediaManageTitleCell">
        <input
          type="checkbox"
          checked={isSelected}
          disabled={selectionDisabled}
          onChange={() => onToggleSelect(item.id)}
          title={selectionTitle || '勾选后可参与左侧批量操作'}
        />
        <span className="mediaManageTitleWrap">
          <span className="mediaManageTitle">{item.name}</span>
          <span className="mediaManageSubline" title={libraryTitle}>
            {typeLabel}{subLibraryName ? ` · ${subLibraryName}` : ''}
          </span>
        </span>
      </div>
      <div className="mediaManageStackCell">
        <span className={`lifecycleBadge lifecycleBadge-${item.lifecycleDone ? 'done' : 'open'}`} title={lifecycleTitle || lifecycleLabel}>
          {lifecycleLabel}
        </span>
        {lifecycleDetails.map((line) => (
          <span key={line} className="mediaManageSubline">{line}</span>
        ))}
      </div>
      <div className="mediaManageStackCell">
        <span className={`metadataBadge metadataBadge-${item.metadataComplete ? 'done' : 'open'}`} title={metadataTitle || metadataLabel}>
          {metadataLabel}
        </span>
        {adultMetadataStatus && (
          <span className={`adultScrapeBadge adultScrapeBadge-${adultMetadataStatus.tone}`} title={adultMetadataStatus.title}>
            {adultMetadataStatus.label}
          </span>
        )}
        {item.metadataMissingReasons?.length ? (
          <span className="mediaManageSubline" title={item.metadataMissingReasons.join('、')}>
            缺失 {item.metadataMissingReasons.length} 项
          </span>
        ) : null}
      </div>
      <div className="mediaManageStackCell tabular-nums" title={mediaFactTitle}>
        {mediaFactLines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
      <div className="mediaManageStackCell">
        {showStandardFields && (
          <span title={item.doubanStars != null ? `豆瓣 ${item.doubanStars} 星` : '未抓取到'}>
            豆瓣 <Stars count={item.doubanStars} max={MAX_STARS} />
          </span>
        )}
        <span>
          本地 <StarInput value={item.rating} onChange={(r) => onRatingChange(item, r)} />
        </span>
        {showStandardFields && (
          <span className="mediaManageWatchedCell">
            <button type="button" disabled={item.watched} onClick={() => onWatchChange(item, true)}>
              已看
            </button>
            <button type="button" disabled={!item.watched} onClick={() => onWatchChange(item, false)}>
              未看
            </button>
          </span>
        )}
        {showAdultFields && item.source === 'adult_folder' && adultSummary && (
          <span className="mediaManageSubline" title={adultTitle}>
            {adultSummary}
          </span>
        )}
      </div>
      <div className="mediaManageStackCell">
        <span className={`optimizationBadge optimizationBadge-${item.optimizationStatus}`} title={optimizationTitle}>
          {OPTIMIZATION_LABEL[item.optimizationStatus]}
        </span>
        {operationDetails.slice(1).map((line) => (
          <span key={line} className="mediaManageSubline">{line}</span>
        ))}
        {onRescrape && showAdultFields && item.source === 'adult_folder' && !rowTask && (
          <button
            type="button"
            className="adultRescrapeBtn"
            title="重新创建 metadata gate 的补元数据 flow"
            onClick={() => onRescrape(item)}
          >
            重补元数据
          </button>
        )}
        {action === 'keep' ? (
          <span className="hint" title={recommendedBlockedReason || item.archiveReason || item.reason}>
            {item.lifecycleDone
              ? '已闭环'
              : (recommendedBlockedReason || nextBridgeLabel || item.reason || '暂无可执行操作')}
          </span>
        ) : (
          <button
            type="button"
            disabled={actionDisabled}
            title={rowTask ? '该条目已有未结案任务' : isCreatingTask ? '正在创建任务' : item.businessFlowDecision?.nextBridge ? `下一步目标：${nextBridgeLabel}` : undefined}
            onClick={() => onEnqueue(item, action)}
          >
            {isCreatingTask ? '创建中...' : ACTION_LABEL[action]}
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
    a.selectionDisabled === b.selectionDisabled &&
    a.selectionTitle === b.selectionTitle &&
    a.isHighlighted === b.isHighlighted &&
    a.rowTask === b.rowTask &&
    a.isCreatingTask === b.isCreatingTask &&
    a.showAdultFields === b.showAdultFields &&
    a.showStandardFields === b.showStandardFields &&
    a.gridClassName === b.gridClassName &&
    a.subLibraryName === b.subLibraryName &&
    a.subLibraryTypeLabel === b.subLibraryTypeLabel &&
    a.onToggleSelect === b.onToggleSelect &&
    a.onWatchChange === b.onWatchChange &&
    a.onRatingChange === b.onRatingChange &&
    a.onEnqueue === b.onEnqueue &&
    a.onRescrape === b.onRescrape
  );
}

export const MediaLibraryManageRow = memo(MediaLibraryManageRowInner, rowPropsEqual);
