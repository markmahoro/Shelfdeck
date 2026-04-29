import { memo } from 'react';
import type { ManagedMediaItem, MediaAction, MediaRating } from '../models/media';
import { taskStatusLabelZh } from '../models/task';
import type { MediaTask } from '../types';

function formatStarStatus(item: ManagedMediaItem) {
  if (item.doubanStars != null) return `${item.doubanStars} 星（豆瓣）`;
  if (item.rating != null) return `${item.rating} 星（本地）`;
  return '未标注';
}

function formatDoubanDisplay(doubanStars: MediaRating | null) {
  if (doubanStars == null) return '未抓取到';
  return `${doubanStars} 星`;
}

export type MediaLibraryManageRowProps = {
  item: ManagedMediaItem;
  isSelected: boolean;
  isHighlighted: boolean;
  rowTask: MediaTask | undefined;
  onToggleSelect: (id: string) => void;
  onWatchChange: (item: ManagedMediaItem, watched: boolean) => void;
  onRatingChange: (item: ManagedMediaItem, rating: MediaRating | null) => void;
  onEnqueue: (item: ManagedMediaItem, action: MediaAction) => void;
  onOpenDeleteExplain: () => void;
};

const STAR_OPTIONS = [1, 2, 3, 4, 5] as const;

function MediaLibraryManageRowInner({
  item,
  isSelected,
  isHighlighted,
  rowTask,
  onToggleSelect,
  onWatchChange,
  onRatingChange,
  onEnqueue,
  onOpenDeleteExplain,
}: MediaLibraryManageRowProps) {
  const action = item.recommendedAction ?? 'keep';
  const eq = item.equivalentBitrate;
  const target = item.targetBitrate;
  const predictGb = item.predictedSizeGb;

  const targetHint = action === 'delete' ? '删除档' : target != null ? `${target.toFixed(1)} Mbps` : '—';
  const formatLabel = `${item.resolution} · ${item.codec.toUpperCase()}`;
  const taskCell = rowTask ? (
    <span title={rowTask.id}>
      {taskStatusLabelZh(rowTask.status)}（
      {rowTask.actionType === 'transcode' ? '压缩' : rowTask.actionType === 'upgrade' ? '洗版' : '删除'}
      ）
    </span>
  ) : (
    '—'
  );

  return (
    <div
      data-manage-item-id={item.id}
      className={`mediaManageGrid mediaManageRow${isHighlighted ? ' mediaManageRowHighlight' : ''}`}
    >
      <div className="mediaManageTitleCell">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggleSelect(item.id)}
          title="勾选后可参与左侧批量操作"
        />
        <span className="mediaManageTitle">{item.name}</span>
      </div>
      <div className="tabular-nums" title="来自媒体库条目体积（GB）">
        {item.sizeGb.toFixed(1)} GB
      </div>
      <div title={item.isBluRayDisc ? '路径为 .iso 或含 BDMV 目录（或库标记为原盘）' : undefined}>
        {item.isBluRayDisc ? '是' : '否'}
      </div>
      <div className="tabular-nums">{eq != null ? `${eq.toFixed(1)} Mbps` : '—'}</div>
      <div className="tabular-nums">{targetHint}</div>
      <div className="tabular-nums" title="基于策略目标码率的预测转码后体积">
        {predictGb != null ? `${predictGb.toFixed(1)} GB` : '—'}
      </div>
      <div>{formatLabel}</div>
      <div className="mediaManageStarStatusCell" title={formatStarStatus(item)}>
        {formatStarStatus(item)}
      </div>
      <div className="mediaManageDoubanCell" title={`豆瓣「看过」个人评分 — ${formatDoubanDisplay(item.doubanStars)}`}>
        {formatDoubanDisplay(item.doubanStars)}
      </div>
      <div>{item.watched ? '已观看' : '未观看'}</div>
      <div className="tabular-nums" style={{ fontSize: 12 }}>
        {taskCell}
      </div>
      <div className="mediaManageRowActions">
        <div className="mediaManageActionGroup">
          <span className="mediaManageActionLabel">观看</span>
          <div className="mediaManageActionBtns">
            {item.embyWebUrl && (
              <button type="button" onClick={() => window.open(item.embyWebUrl, '_blank')}>
                播放
              </button>
            )}
            <button type="button" disabled={item.watched} onClick={() => void onWatchChange(item, true)}>
              已看
            </button>
            <button type="button" disabled={!item.watched} onClick={() => void onWatchChange(item, false)}>
              未看
            </button>
          </div>
        </div>
        <div className="mediaManageActionGroup">
          <span className="mediaManageActionLabel">星级</span>
          <select
            className="selectLike mediaManageSelect"
            value={item.rating == null ? '' : String(item.rating)}
            onChange={(e) => {
              const v = e.target.value;
              onRatingChange(item, v === '' ? null : (Number(v) as MediaRating));
            }}
          >
            <option value="">未标注</option>
            {STAR_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s} 星
              </option>
            ))}
          </select>
        </div>
        <div className="mediaManageActionGroup">
          <span className="mediaManageActionLabel">码率优化</span>
          {item.recommendedAction == null ? (
            <span className="hint">需豆瓣或本地星级</span>
          ) : action === 'keep' && item.doubanStars == null && item.rating == null ? (
            <span className="hint">无建议策略</span>
          ) : action === 'delete' ? (
            <div className="mediaManageActionBtns" style={{ flexWrap: 'wrap', gap: 6 }}>
              <span className="hint">策略：待删除</span>
              <button
                type="button"
                disabled={!!rowTask}
                title={rowTask ? '该条目已有未结案任务（同视频互斥）' : undefined}
                onClick={() => onEnqueue(item, 'delete')}
              >
                加入删除任务
              </button>
              <button type="button" onClick={onOpenDeleteExplain}>
                说明
              </button>
            </div>
          ) : action === 'keep' ? (
            <span className="hint">已达标</span>
          ) : action === 'transcode' ? (
            <button
              type="button"
              disabled={!!rowTask || item.isBluRayDisc}
              title={
                item.isBluRayDisc
                  ? '蓝光/原盘（.iso 或 BDMV）不支持码率优化入队'
                  : rowTask
                    ? '该条目已有未结案任务（同视频互斥）'
                    : undefined
              }
              onClick={() => onEnqueue(item, action)}
            >
              码率压缩
            </button>
          ) : (
            <button
              type="button"
              disabled={!!rowTask || item.isBluRayDisc}
              title={
                item.isBluRayDisc
                  ? '蓝光/原盘（.iso 或 BDMV）不支持洗版入队'
                  : rowTask
                    ? '该条目已有未结案任务（同视频互斥）'
                    : undefined
              }
              onClick={() => onEnqueue(item, action)}
            >
              洗版
            </button>
          )}
        </div>
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
    a.onToggleSelect === b.onToggleSelect &&
    a.onWatchChange === b.onWatchChange &&
    a.onRatingChange === b.onRatingChange &&
    a.onEnqueue === b.onEnqueue &&
    a.onOpenDeleteExplain === b.onOpenDeleteExplain
  );
}

export const MediaLibraryManageRow = memo(MediaLibraryManageRowInner, rowPropsEqual);
