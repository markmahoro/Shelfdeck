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
  onToggleSelect: (id: string) => void;
  onWatchChange: (item: ManagedMediaItem, watched: boolean) => void;
  onRatingChange: (item: ManagedMediaItem, rating: MediaRating | null) => void;
  onEnqueue: (item: ManagedMediaItem, action: MediaAction) => void;
};

const MAX_STARS = 5;
const ACTION_LABEL: Record<string, string> = { delete: '删除', transcode: '码率压缩', upgrade: '洗版' };

function MediaLibraryManageRowInner({
  item,
  isSelected,
  isHighlighted,
  rowTask,
  onToggleSelect,
  onWatchChange,
  onRatingChange,
  onEnqueue,
}: MediaLibraryManageRowProps) {
  const action = item.recommendedAction ?? 'keep';
  const eq = item.equivalentBitrate;
  const target = item.targetBitrate;
  const predictGb = item.predictedSizeGb;

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

  const actionDisabled = !!rowTask || (item.isBluRayDisc && action !== 'delete' && action !== 'keep');

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
      <div className="tabular-nums">{item.sizeGb.toFixed(1)} GB</div>
      <div>{formatLabel}</div>
      <div className="tabular-nums">{eq != null ? `${eq.toFixed(1)} Mbps` : '—'}</div>
      <div className="tabular-nums">{target != null ? `${target.toFixed(1)} Mbps` : '—'}</div>
      <div className="tabular-nums">{predictGb != null ? `${predictGb.toFixed(1)} GB` : '—'}</div>
      <div title={item.isBluRayDisc ? '原盘（ISO/BDMV）' : undefined}>
        {item.isBluRayDisc ? '是' : '否'}
      </div>
      <div title={item.doubanStars != null ? `豆瓣 ${item.doubanStars} 星` : item.rating != null ? `本地 ${item.rating} 星` : '未标注'}>
        <Stars count={item.rating ?? item.doubanStars} max={MAX_STARS} />
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
        {action === 'keep' || (action === 'delete' && item.isBluRayDisc) ? (
          <span className="hint">{action === 'delete' ? '原盘不删' : '已达标'}</span>
        ) : ACTION_LABEL[action] ? (
          <button
            type="button"
            disabled={actionDisabled}
            title={rowTask ? '该条目已有未结案任务' : item.isBluRayDisc ? '原盘不支持此操作' : undefined}
            onClick={() => onEnqueue(item, action)}
          >
            {ACTION_LABEL[action]}
          </button>
        ) : (
          <span className="hint">需评分</span>
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
    a.onToggleSelect === b.onToggleSelect &&
    a.onWatchChange === b.onWatchChange &&
    a.onRatingChange === b.onRatingChange &&
    a.onEnqueue === b.onEnqueue
  );
}

export const MediaLibraryManageRow = memo(MediaLibraryManageRowInner, rowPropsEqual);
