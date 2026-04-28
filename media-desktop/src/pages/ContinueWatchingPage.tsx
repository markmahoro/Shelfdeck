/**
 * [UI] "继续看"页面 — 海报墙 + 播放记录合并。
 *
 * 上半区：未观看海报墙，点击播放 → 启动播放器 + 写入播放记录（聚合）
 * 下半区：播放记录列表（评分弹窗、标记已看、标记未看）
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../api/client';
import type { UnplayedItem, PlaybackLogEntry } from '../api/client';
import StarRatingModal from '../components/StarRatingModal';

export default function ContinueWatchingPage({ subLibraryId }: { tasks: unknown[]; subLibraryId: string }) {
  const [unplayedItems, setUnplayedItems] = useState<UnplayedItem[]>([]);
  const [unplayedLoading, setUnplayedLoading] = useState(true);
  const [logEntries, setLogEntries] = useState<PlaybackLogEntry[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratingTarget, setRatingTarget] = useState<{ itemId: string; itemName: string } | null>(null);

  const fetchUnplayed = useCallback((silent = false) => {
    if (!subLibraryId) { setUnplayedItems([]); setUnplayedLoading(false); return; }
    if (!silent) setUnplayedLoading(true);
    apiClient.getUnplayedItems(subLibraryId)
      .then((data) => { setUnplayedItems(data); setUnplayedLoading(false); })
      .catch((e) => { setError(`加载未观看内容失败：${e.message}`); setUnplayedLoading(false); });
  }, [subLibraryId]);

  const fetchLog = useCallback((silent = false) => {
    if (!silent) setLogLoading(true);
    apiClient.getPlaybackLog(subLibraryId || undefined)
      .then((data) => { setLogEntries(data); setLogLoading(false); })
      .catch((e) => { setError(`加载播放记录失败：${e.message}`); setLogLoading(false); });
  }, [subLibraryId]);

  useEffect(() => { fetchUnplayed(); }, [fetchUnplayed]);
  useEffect(() => { fetchLog(); }, [fetchLog]);

  const handlePlay = async (item: UnplayedItem) => {
    // Record to playback log (aggregate by itemId)
    apiClient.recordPlay({
      itemId: item.id,
      subLibraryId: subLibraryId,
      itemName: item.name,
      type: item.itemType,
      posterUrl: item.posterUrl,
      path: item.path,
      embyWebUrl: item.embyWebUrl,
    }).then(() => fetchLog(true)).catch(() => {});

    // Launch external player
    if (!item.path) { if (item.embyWebUrl) window.open(item.embyWebUrl, '_blank'); return; }
    const filePath = item.path;
    try {
      const raw = await window.embyApi?.getSettings();
      // Per-subLibrary path mapping: match by subLibraryId first, then by path prefix
      const maps = raw?.subLibraryPathMaps || {};
      let pathMapFrom = '';
      let pathMapTo = '';
      if (subLibraryId && maps[subLibraryId]) {
        pathMapFrom = maps[subLibraryId].from || '';
        pathMapTo = maps[subLibraryId].to || '';
      } else {
        // Fallback: match by path prefix across all subLibrary mappings
        const match = Object.values(maps).find((m) => m.from && filePath.startsWith(m.from));
        if (match) { pathMapFrom = match.from; pathMapTo = match.to || ''; }
      }
      await window.embyApi?.launchPath({
        path: filePath,
        config: { playerExePath: raw?.playerExePath || '', pathMapFrom, pathMapTo },
      });
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg.includes('未配置播放器') ? '请先在设置（⚙）中配置 PotPlayer 播放器路径' : `播放失败：${msg}`);
    }
  };

  const handleMarkPlayed = (entry: PlaybackLogEntry) => {
    apiClient.markPlayed(entry.itemId, entry.subLibraryId)
      .then(() => fetchUnplayed(true))
      .catch((e) => { setError(`操作失败：${e.message}`); });
  };

  const handleMarkUnplayed = (entry: PlaybackLogEntry) => {
    apiClient.markUnplayed(entry.itemId, entry.subLibraryId)
      .then(() => fetchUnplayed(true))
      .catch((e) => { setError(`操作失败：${e.message}`); });
  };

  const handleRatingConfirm = (rating: number) => {
    if (!ratingTarget) return;
    apiClient.patchItemRatings(ratingTarget.itemId, rating)
      .then(() => setRatingTarget(null))
      .catch((e) => { setError(`评分失败：${e.message}`); setRatingTarget(null); });
  };

  const handleRatingClear = () => {
    if (!ratingTarget) return;
    apiClient.patchItemRatings(ratingTarget.itemId, null)
      .then(() => setRatingTarget(null))
      .catch((e) => { setError(`清除评分失败：${e.message}`); setRatingTarget(null); });
  };

  const typeLabel = (type: string) => ({ movie: '电影', episode: '剧集' }[(type || '').toLowerCase()] || '其他');

  return (
    <div className="page">
      <div className="pageMain" style={{ padding: '16px 24px', overflowY: 'auto' }}>
        {error && (
          <div className="errorBanner">
            {error}
            <button onClick={() => setError(null)} className="errorBannerClose">关闭</button>
          </div>
        )}

        {/* ── 上半区：未观看海报墙 ── */}
        <div className="sectionHeader">
          未观看
          {!unplayedLoading && <span className="sectionCount">{unplayedItems.length} 部</span>}
        </div>

        {!subLibraryId ? (
          <p className="muted">请先选择一个子库。</p>
        ) : unplayedLoading ? (
          <p>加载中...</p>
        ) : unplayedItems.length === 0 ? (
          <p className="muted">暂未获取到未观看内容。</p>
        ) : (
          <div className="grid gridCompact">
            {unplayedItems.map((item) => (
              <div key={item.id} className="card">
                {item.posterUrl ? (
                  <img className="poster" src={item.posterUrl} alt={item.name} loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                ) : (
                  <div className="poster" style={{ background: '#1f2937' }} />
                )}
                <div className="cardTitle">{item.name}</div>
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="playBtn" onClick={() => handlePlay(item)}>
                    <span className="playIcon">▶</span> 播放
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── 下半区：播放记录列表 ── */}
        <div className="sectionDivider" />
        <div className="sectionHeader">
          播放记录
          {!logLoading && <span className="sectionCount">{logEntries.length} 条</span>}
        </div>

        {logLoading ? (
          <p>加载中...</p>
        ) : logEntries.length === 0 ? (
          <p className="muted">暂无播放记录，点击海报的"播放"按钮开始。</p>
        ) : (
          <div className="historyList">
            {logEntries.map((entry) => (
              <div key={entry.itemId} className="historyItem">
                {entry.posterUrl && (
                  <img className="historyPoster" src={entry.posterUrl} alt={entry.itemName} loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <div className="historyItemBody">
                  <div className="historyItemTitle">{entry.itemName}</div>
                  <div className="historyItemMeta">
                    <span>{typeLabel(entry.type)}</span>
                    {entry.sectionName && (<><span className="historyMetaSep">·</span><span>{entry.sectionName}</span></>)}
                    <span className="historyMetaSep">·</span>
                    <span>{new Date(entry.playedAt).toLocaleDateString('zh-CN')}</span>
                    {entry.playCount > 1 && (<><span className="historyMetaSep">·</span><span>播放 {entry.playCount} 次</span></>)}
                  </div>
                </div>
                <div className="historyRowActions">
                  <button type="button" className="actionBtnPrimary" onClick={() => setRatingTarget({ itemId: entry.itemId, itemName: entry.itemName })}>
                    评分
                  </button>
                  <button type="button" onClick={() => handleMarkPlayed(entry)}>标记已看</button>
                  <button type="button" className="actionBtnDanger" onClick={() => handleMarkUnplayed(entry)}>标记未看</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {ratingTarget && (
        <StarRatingModal
          itemName={ratingTarget.itemName}
          currentRating={null}
          onConfirm={handleRatingConfirm}
          onClear={handleRatingClear}
          onClose={() => setRatingTarget(null)}
        />
      )}
    </div>
  );
}
