/**
 * [UI] 悬浮任务按钮（任务卡 UI）。
 *
 * 红色角标显示待确认数，点击展开任务面板。
 * 确认任务：查看详情 → 展开对比/选种 → 底部确认按钮。
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../api/client';
import { createPoller } from '../api/polling';
import {
  taskStatusLabelZh,
  canUserPauseTask,
  canUserResumeTask,
  canUserDeleteTask,
  isTaskTerminal,
  formatSize,
  type MediaTask,
  type UpgradeCandidate,
  type TaskItemInfo,
} from '../models/task';

// ── helpers ──

const ACTION_LABEL: Record<string, string> = {
  ingest: '入库',
  scrape: '刮削',
  transcode: '压缩',
  delete: '删除',
  upgrade: '洗版',
};

const CONFIRM_LABEL: Record<string, string> = {
  delete_executing: '删除 — 确认删除文件列表',
  transcode_executing: 'Dolby Vision 警告 — 需要确认是否继续压缩',
  transcode_replace: '转码完成 — 确认是否替换原文件',
  upgrade_executing: '洗版 — 选择下载种子',
  upgrade_replace: '洗版完成 — 确认是否替换原文件',
};

const APPROVAL_GATE_LABEL: Record<string, string> = {
  'delete.beforeExecute': '删除 — 确认删除文件列表',
  'transcode.dolbyVisionTonemap': 'Dolby Vision 警告 — 需要确认是否继续压缩',
  'transcode.beforeReplace': '转码完成 — 确认是否替换原文件',
  'upgrade.candidateSelect': '洗版 — 选择下载种子',
  'upgrade.identityMismatch': '洗版身份异常 — 需要确认',
  'upgrade.beforeReplace': '洗版完成 — 确认是否替换原文件',
  'scrape.beforeWriteMetadata': '刮削 — 确认写入元数据',
  'scrape.beforeOrganize': '刮削 — 确认整理目录',
  'scrape.reviewResult': '刮削 — 复核结果',
};

function gb(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2);
}

function formatItemName(itemInfo?: TaskItemInfo): string {
  if (!itemInfo) return '';
  if (itemInfo.type === 'season' && itemInfo.seriesName && itemInfo.seasonNumber != null) {
    return `${itemInfo.seriesName} 第${itemInfo.seasonNumber}季`;
  }
  return itemInfo.name || '';
}

function approvalLabel(task: MediaTask): string {
  const gateId = task.approval?.gateId;
  if (gateId && APPROVAL_GATE_LABEL[gateId]) return APPROVAL_GATE_LABEL[gateId];
  if (task.resumePoint && CONFIRM_LABEL[task.resumePoint]) return CONFIRM_LABEL[task.resumePoint];
  return task.approval?.title || '需要确认';
}

function approvalMatches(task: MediaTask, gateId: string, legacyResumePoint: string): boolean {
  return task.approval?.gateId === gateId || task.resumePoint === legacyResumePoint;
}

// ── Styles ──

const BTN: React.CSSProperties = {
  position: 'fixed', bottom: 24, right: 24,
  width: 48, height: 48, borderRadius: '50%',
  border: 'none', cursor: 'pointer',
  fontSize: 16, fontWeight: 700,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  boxShadow: '0 2px 12px rgba(0,0,0,0.15)', zIndex: 9999,
};

const PANEL: React.CSSProperties = {
  position: 'fixed', bottom: 80, right: 24,
  width: 460, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
  background: '#0f172a', borderRadius: 12,
  boxShadow: '0 4px 24px rgba(0,0,0,0.3)', padding: 16,
  zIndex: 9999, border: '1px solid #1f2937',
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8,
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

const TASK_ROW: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  border: '1px solid #1f2937', borderRadius: 8, padding: 10,
  marginBottom: 6, background: '#0b1220', fontSize: 13,
};

const TASK_ROW_HEADER: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
};

const ACTION_BTN: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, borderRadius: 6, cursor: 'pointer',
};

const ERROR_BANNER: React.CSSProperties = {
  background: '#450a0a', border: '1px solid #7f1d1d', color: '#fecaca',
  fontSize: 12, padding: '8px 12px', borderRadius: 8, marginBottom: 10,
};

// ── Component ──

export default function FloatingTaskButton({ baseUrl }: { baseUrl: string }) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<MediaTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<MediaTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  useEffect(() => {
    const poller = createPoller(
      () => apiClient.getTasks(),
      (data) => setTasks(data),
      400,
    );
    poller.start();
    return () => poller.stop();
  }, []);

  const clearError = () => setError(null);

  const loadDetail = useCallback(async (taskId: string) => {
    if (expandedId === taskId) { setExpandedId(null); setDetailTask(null); return; }
    setExpandedId(taskId);
    setDetailLoading(true);
    try { setDetailTask(await apiClient.getTask(taskId)); }
    catch { setDetailTask(null); }
    finally { setDetailLoading(false); }
  }, [expandedId]);

  const doPause = async (taskId: string) => {
    clearError();
    try { await apiClient.pauseTask(taskId); } catch (e) { setError(`暂停失败：${(e as Error).message}`); }
  };

  const doResume = async (taskId: string) => {
    clearError();
    try { await apiClient.executeTask(taskId); } catch (e) { setError(`执行失败：${(e as Error).message}`); }
  };

  const doConfirm = async (taskId: string, confirmData?: Record<string, unknown>) => {
    clearError();
    setConfirmingId(taskId);
    try {
      const body: Record<string, unknown> = { confirmed: true };
      if (confirmData) body.confirmData = confirmData;
      await apiClient.updateTask(taskId, body);
      setExpandedId(null);
    } catch (e) {
      setError(`确认失败：${(e as Error).message}`);
    } finally {
      setConfirmingId(null);
    }
  };

  const doDelete = async (taskId: string) => {
    clearError();
    try { await apiClient.deleteTask(taskId); } catch (e) { setError(`删除失败：${(e as Error).message}`); }
  };

  // ── Grouping ──

  const confirmNeeded = tasks.filter((t) => t.status === 'awaiting_user_confirm');
  const otherActive = tasks.filter((t) => !isTaskTerminal(t) && t.status !== 'awaiting_user_confirm');
  const recentDone = tasks
    .filter((t) => t.status === 'done')
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
    .slice(0, 3);

  const totalActive = confirmNeeded.length + otherActive.length;
  if (totalActive === 0 && recentDone.length === 0) return null;

  return (
    <>
      <button
        style={{ ...BTN, background: confirmNeeded.length > 0 ? '#dc2626' : '#4a90d9' }}
        onClick={() => { setOpen(!open); clearError(); }}
      >
        {confirmNeeded.length > 0 ? confirmNeeded.length : totalActive || ''}
      </button>

      {open && (
        <div style={PANEL}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>任务</span>
            <button onClick={() => { setOpen(false); setExpandedId(null); clearError(); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#94a3b8', padding: 0, lineHeight: 1 }}>×</button>
          </div>

          {error && (
            <div style={ERROR_BANNER}>
              {error}
              <button onClick={clearError} style={{ ...ACTION_BTN, marginLeft: 10, background: 'transparent', border: '1px solid #7f1d1d', color: '#fecaca' }}>关闭</button>
            </div>
          )}

          {/* ── 待确认 ── */}
          {confirmNeeded.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ ...SECTION_TITLE, color: '#fca5a5' }}>待确认 ({confirmNeeded.length})</div>
              {confirmNeeded.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  baseUrl={baseUrl}
                  isExpanded={expandedId === t.id}
                  detailTask={expandedId === t.id ? detailTask : null}
                  detailLoading={expandedId === t.id && detailLoading}
                  confirming={confirmingId === t.id}
                  onToggleDetail={() => loadDetail(t.id)}
                  onPause={() => doPause(t.id)}
                  onResume={() => doResume(t.id)}
                  onConfirm={(data) => doConfirm(t.id, data)}
                  onDelete={() => doDelete(t.id)}
                />
              ))}
            </div>
          )}

          {/* ── 进行中 ── */}
          {otherActive.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={SECTION_TITLE}>进行中 ({otherActive.length})</div>
              {otherActive.slice(0, 8).map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  baseUrl={baseUrl}
                  isExpanded={expandedId === t.id}
                  detailTask={expandedId === t.id ? detailTask : null}
                  detailLoading={expandedId === t.id && detailLoading}
                  confirming={false}
                  onToggleDetail={() => loadDetail(t.id)}
                  onPause={() => doPause(t.id)}
                  onResume={() => doResume(t.id)}
                  onConfirm={(data) => doConfirm(t.id, data)}
                  onDelete={() => doDelete(t.id)}
                />
              ))}
              {otherActive.length > 8 && (
                <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>还有 {otherActive.length - 8} 个任务...</p>
              )}
            </div>
          )}

          {/* ── 最近完成 ── */}
          {recentDone.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={SECTION_TITLE}>最近完成</div>
              {recentDone.map((t) => (
                <div key={t.id} style={TASK_ROW}>
                  <div style={TASK_ROW_HEADER}>
                    <span>{formatItemName(t.itemInfo) || t.itemName || t.itemId}</span>
                    <span style={{ color: '#86efac', fontSize: 12 }}>
                      {ACTION_LABEL[t.actionType] ?? t.actionType} · {taskStatusLabelZh(t.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <a href={`${baseUrl}/admin`} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: '#4a90d9', textDecoration: 'none' }}>
            在浏览器中查看完整任务中心 →
          </a>
        </div>
      )}
    </>
  );
}

// ── TaskCard ──

function TaskCard({
  task, baseUrl, isExpanded, detailTask, detailLoading, confirming,
  onToggleDetail, onPause, onResume, onConfirm, onDelete,
}: {
  task: MediaTask;
  baseUrl: string;
  isExpanded: boolean;
  detailTask: MediaTask | null;
  detailLoading: boolean;
  confirming: boolean;
  onToggleDetail: () => void;
  onPause: () => void;
  onResume: () => void;
  onConfirm: (confirmData?: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const needsConfirm = task.status === 'awaiting_user_confirm';
  const progress = task.progress ?? 0;
  const showProgress = progress > 0 && !isTaskTerminal(task);
  const displayTask = detailTask || task;

  return (
    <div style={TASK_ROW}>
      {/* Header */}
      <div style={TASK_ROW_HEADER}>
        <div style={{ flex: 1, minWidth: 0, cursor: needsConfirm ? 'default' : 'pointer' }}
          onClick={() => !needsConfirm && onToggleDetail()}>
          <div style={{ fontWeight: 600, lineHeight: 1.35, wordBreak: 'break-word' }}>
            {formatItemName(task.itemInfo) || task.itemName || task.itemId}
          </div>
          <div style={{ fontSize: 11, marginTop: 2, color: needsConfirm ? '#fca5a5' : '#94a3b8' }}>
            {ACTION_LABEL[task.actionType] ?? task.actionType} · {taskStatusLabelZh(task.status)}
            {needsConfirm && (
              <> — {approvalLabel(task)}{task.approval?.mode === 'forceConfirm' ? '（强制确认）' : ''}</>
            )}
            {showProgress && ` · ${Math.round(progress)}%`}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {needsConfirm ? (
            <button style={{ ...ACTION_BTN, background: '#1e3a8a', border: '1px solid #2563eb', color: '#bfdbfe' }}
              onClick={onToggleDetail}>
              {isExpanded ? '收起' : '查看详情'}
            </button>
          ) : (
            <>
              {canUserPauseTask(task) && (
                <button style={{ ...ACTION_BTN, background: '#1e293b', border: '1px solid #475569', color: '#fdba74' }} onClick={onPause}>⏸ 暂停</button>
              )}
              {canUserResumeTask(task) && (
                <button style={{ ...ACTION_BTN, background: '#1e293b', border: '1px solid #475569', color: '#93c5fd' }} onClick={onResume}>▶ 执行</button>
              )}
              {canUserDeleteTask(task) && (
                <button style={{ ...ACTION_BTN, background: 'transparent', border: '1px solid #7f1d1d', color: '#fca5a5' }} onClick={onDelete}>✕</button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div style={{ marginTop: 8, height: 4, background: '#1f2937', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.round(Math.min(100, progress))}%`, background: '#4a90d9', borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      )}

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ marginTop: 10, borderTop: '1px solid #1f2937', paddingTop: 10 }}>
          {detailLoading ? (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>加载中...</p>
          ) : displayTask ? (
            <ConfirmDetail task={displayTask} baseUrl={baseUrl} confirming={confirming} onConfirm={onConfirm} />
          ) : (
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>无法加载任务详情</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── ConfirmDetail — renders context-specific confirmation content ──

function ConfirmDetail({
  task, baseUrl, confirming, onConfirm,
}: {
  task: MediaTask;
  baseUrl: string;
  confirming: boolean;
  onConfirm: (confirmData?: Record<string, unknown>) => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  // ── Seed selection (upgrade_executing) ──
  if (approvalMatches(task, 'upgrade.candidateSelect', 'upgrade_executing')) {
    const candidates = task.itemInfo?.searchCandidatesSimplified;
    if (!candidates || candidates.length === 0) {
      return <ConfirmFooter label="确认执行" hint="" confirming={confirming} onConfirm={() => onConfirm()} />;
    }
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>选择洗版种子</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>
          共 {candidates.length} 个候选，请选择一个下载。
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto', marginBottom: 12 }}>
          {candidates.map((c) => (
            <SeedRow key={c.index} c={c} selected={c.index === selectedIdx} onSelect={() => setSelectedIdx(c.index)} />
          ))}
        </div>
        <ConfirmFooter label="确认下载选中版本" confirming={confirming} onConfirm={() => onConfirm({ selectedIndex: selectedIdx })} />
      </div>
    );
  }

  // ── Transcode replace ──
  if (approvalMatches(task, 'transcode.beforeReplace', 'transcode_replace') && task.verifyResult) {
    const vr = task.verifyResult;
    const orig = task.itemInfo;
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>转码结果对比</div>
        <CompareTable
          rows={[
            ['文件大小', orig?.originalSizeBytes ? `${gb(orig.originalSizeBytes)} GB` : '—', `${gb(vr.sizeBytes)} GB`,
              orig?.originalSizeBytes ? `${vr.sizeBytes < orig.originalSizeBytes ? '-' : '+'}${Math.abs((vr.sizeBytes - orig.originalSizeBytes) / orig.originalSizeBytes * 100).toFixed(1)}%` : ''],
            ['视频编码', orig?.originalVideoCodec || '—', vr.videoCodec || '—', ''],
            ['分辨率', orig ? `${orig.originalWidth || '?'} × ${orig.originalHeight || '?'}` : '—', `${vr.width} × ${vr.height}`, ''],
            ['视频码率', orig?.originalBitrate ? `${orig.originalBitrate} kbps` : '—', `${vr.bitrate} kbps`,
              orig?.originalBitrate ? `${vr.bitrate < orig.originalBitrate ? '-' : '+'}${Math.abs((vr.bitrate - orig.originalBitrate) / orig.originalBitrate * 100).toFixed(1)}%` : ''],
          ]}
        />
        {vr.previewPath && <PreviewVideo taskId={task.id} baseUrl={baseUrl} />}
        <ConfirmFooter label="确认替换" hint="确认后将用新文件替换原文件，操作不可撤销" confirming={confirming} onConfirm={() => onConfirm()} />
      </div>
    );
  }

  // ── Upgrade replace ──
  if (approvalMatches(task, 'upgrade.beforeReplace', 'upgrade_replace') && task.verifyResult) {
    const vr = task.verifyResult;
    const up = task.upgradePreview;
    const oldSize = up?.oldFile?.size || task.itemInfo?.originalSizeBytes || 0;
    const oldBitrate = up?.oldFile?.bitrate || task.itemInfo?.originalBitrate || 0;
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 10 }}>洗版结果对比</div>
        <CompareTable
          rows={[
            ['文件大小', oldSize > 0 ? `${gb(oldSize)} GB` : '—', `${gb(vr.sizeBytes)} GB`,
              oldSize > 0 ? `${vr.sizeBytes < oldSize ? '-' : '+'}${Math.abs((vr.sizeBytes - oldSize) / oldSize * 100).toFixed(1)}%` : ''],
            ['视频编码', task.itemInfo?.originalVideoCodec || up?.oldFile?.resolution || '—', vr.videoCodec || '—', ''],
            ['分辨率', `${task.itemInfo?.originalWidth || '?'} × ${task.itemInfo?.originalHeight || '?'}`, `${vr.width} × ${vr.height}`, ''],
            ['视频码率', oldBitrate > 0 ? `${oldBitrate} kbps` : '—', `${vr.bitrate} kbps`,
              oldBitrate > 0 ? `${vr.bitrate < oldBitrate ? '-' : '+'}${Math.abs((vr.bitrate - oldBitrate) / oldBitrate * 100).toFixed(1)}%` : ''],
            ['TMDB 校验', '—', up?.tmdbVerified ? '✓ 通过' : '⚠ 未校验', ''],
          ]}
        />
        {vr.previewPath && <PreviewVideo taskId={task.id} baseUrl={baseUrl} />}
        <ConfirmFooter label="确认替换" hint="确认后将用新文件替换原文件，操作不可撤销" confirming={confirming} onConfirm={() => onConfirm()} />
      </div>
    );
  }

  // ── Delete confirm ──
  if (approvalMatches(task, 'delete.beforeExecute', 'delete_executing')) {
    const lines = task.deleteConfirmLines;
    return (
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>确认删除</div>
        {lines && lines.length > 0 && (
          <div style={{ maxHeight: 160, overflow: 'auto', marginBottom: 12, background: '#020617', borderRadius: 6, padding: '8px 10px', fontSize: 11, fontFamily: 'monospace', color: '#cbd5e1', lineHeight: 1.5 }}>
            {lines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
        <ConfirmFooter label="确认删除" hint="删除操作不可撤销，文件将被永久删除" confirming={confirming} onConfirm={() => onConfirm()} />
      </div>
    );
  }

  // ── DV / generic confirm ──
  return (
    <div>
      <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 6 }}>
        {approvalLabel(task)}
      </div>
      {task.approval?.message && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>{task.approval.message}</div>
      )}
      <ConfirmFooter label="确认执行" confirming={confirming} onConfirm={() => onConfirm()} />
    </div>
  );
}

// ── CompareTable ──

function CompareTable({ rows }: { rows: string[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
      <thead>
        <tr style={{ background: '#1e293b' }}>
          <th style={th}>指标</th><th style={th}>原文件</th><th style={th}>新文件</th><th style={th}>变化</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
            {r.map((cell, j) => (
              <td key={j} style={{ ...td, fontWeight: j === 0 ? 600 : 400,
                color: j === 3 && cell ? (cell.startsWith('-') ? '#4ade80' : cell.startsWith('+') ? '#fbbf24' : '#94a3b8') : '#cbd5e1' }}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { padding: '5px 8px', textAlign: 'left', fontSize: 11, color: '#94a3b8', fontWeight: 600 };
const td: React.CSSProperties = { padding: '5px 8px', fontSize: 11 };

// ── PreviewVideo ──

function PreviewVideo({ taskId, baseUrl }: { taskId: string; baseUrl: string }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>试看预览（30秒片段）</div>
      <video controls width="100%" style={{ borderRadius: 6, background: '#000', maxHeight: 200 }}>
        <source src={`${baseUrl.replace(/\/$/, '')}/v1/tasks/${taskId}/preview`} type="video/mp4" />
      </video>
    </div>
  );
}

// ── SeedRow ──

function SeedRow({ c, selected, onSelect }: { c: UpgradeCandidate; selected: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} style={{
      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
      border: selected ? '1px solid #2563eb' : '1px solid #1f2937',
      background: selected ? '#0f1d36' : '#020617', marginBottom: 4, fontSize: 12,
    }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        border: selected ? '2px solid #2563eb' : '2px solid #475569',
        background: selected ? '#2563eb' : 'transparent', fontSize: 10, color: '#fff',
      }}>
        {selected ? '●' : ''}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, lineHeight: 1.35, wordBreak: 'break-word', color: '#e2e8f0', marginBottom: 3 }}>
          {c.title || '(无标题)'}
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
          {c.site && <span>{c.site}</span>}
          {c.size > 0 && <span>{formatSize(c.size)}</span>}
          <span style={{ color: c.seeders > 0 ? '#86efac' : '#fca5a5' }}>{c.seeders} 做种</span>
          {c.resolution && <span>{c.resolution}</span>}
          {c.codec && <span>{c.codec}</span>}
          {c.edition && <span style={{ color: '#64748b' }}>{c.edition}</span>}
        </div>
      </div>
    </div>
  );
}

// ── ConfirmFooter ──

function ConfirmFooter({ label, hint, confirming, onConfirm }: {
  label: string; hint?: string; confirming: boolean; onConfirm: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
      <button onClick={onConfirm} disabled={confirming} style={{
        background: '#2563eb', color: '#fff', border: 'none', padding: '8px 22px',
        borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
      }}>
        {confirming ? '确认中...' : label}
      </button>
      {hint && <span style={{ fontSize: 11, color: '#64748b' }}>{hint}</span>}
    </div>
  );
}
