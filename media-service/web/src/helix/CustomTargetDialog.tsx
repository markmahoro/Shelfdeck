import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/ui';
import { Button } from './chrome';
import {
  AdminApiError,
  helixAdminApi,
  type CustomTargetPreviewRecord,
  type CustomTargetRequirementChange,
  type FormationSubject,
} from './api';
import { newOpaqueId } from './id';
import { isUnauthorized } from './session';

type PendingCustomCommand = {
  item: FormationSubject;
  preview: CustomTargetPreviewRecord;
  selectedChangeDigests: string[];
  key: string;
  phase: 'unknown' | 'accepted';
};

// Retain in-flight command identity across dialog close/reopen so uncertain responses
// can replay the exact confirmed intent without creating a second target revision.
const pendingCustomCommands = new Map<string, PendingCustomCommand>();

const FIELD_LABELS: Record<string, string> = {
  plot: '剧情简介',
  genre: '类型',
  actor: '演员',
  director: '导演',
  release_date: '上映日期',
  year_or_release_date: '年份或上映日期',
};

const ARTIFACT_LABELS: Record<string, string> = {
  poster: '海报',
  fanart: '背景图',
};

export function customChangeLabel(change: CustomTargetRequirementChange): string {
  switch (change.requirementCode) {
    case 'minimum_raster_unmet':
      return '放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）';
    case 'primary_audio_unmet':
      return '放宽主音轨规格要求（保留当前可用主音轨）';
    case 'video_codec_unmet':
      return '放宽视频编码要求';
    case 'container_unmet':
      return '放宽封装容器要求';
    case 'file_extension_unmet':
      return '放宽文件扩展名要求';
    case 'max_size_exceeded':
      return '取消单部体积上限';
    case 'metadata_field_unmet':
      return `豁免缺失资料字段：${FIELD_LABELS[change.targetId] || change.targetId}`;
    case 'metadata_artifact_unmet':
      return `豁免缺失图片：${ARTIFACT_LABELS[change.targetId] || change.targetId}`;
    default:
      return `${change.requirementCode}: ${change.targetId}`;
  }
}

function retainedSummary(preview: CustomTargetPreviewRecord, selectedDigests: Set<string>): string {
  const media = preview.baseRequirements.mandatoryMedia || {};
  const space = preview.baseRequirements.space || {};
  const retained: string[] = [];
  const relaxedCodes = new Set(
    preview.proposals
      .filter((item) => selectedDigests.has(item.changeDigest))
      .map((item) => item.change.requirementCode),
  );
  if (media.videoCodec && media.videoCodec !== 'any' && !relaxedCodes.has('video_codec_unmet')) {
    retained.push(`${String(media.videoCodec).toUpperCase()} 编码`);
  }
  if (space.maxSizeGiB != null && !relaxedCodes.has('max_size_exceeded')) {
    retained.push(`单部不超过 ${space.maxSizeGiB} GiB`);
  }
  retained.push('文件完整性与播放安全检查');
  return `未放宽的要求与 ${retained.join('、')}将继续生效，并按确认后的新标准重新整理，不会记为带瑕疵入藏。`;
}

function rejectionLabel(code: string): string {
  const labels: Record<string, string> = {
    LIBRA_CUSTOM_TARGET_PREVIEW_STALE: '整理依据或评分标准已变化，请重新获取预览。',
    LIBRA_CUSTOM_TARGET_BASELINE_CHANGED: '收藏标准基线已变化，请重新获取预览。',
    LIBRA_CUSTOM_TARGET_BASELINE_INVALID: '当前基线状态不可用，请重新获取预览。',
    LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY: '该影片已由收藏架接纳，不能再修改本次整理标准。',
    LIBRA_CUSTOM_TARGET_SELECTION: '请至少选择一项可放宽的收藏标准。',
    P3_UOW_READ_FENCE_CHANGED: '整理依据在提交过程中发生变化，请重新获取预览。',
  };
  return labels[code] || '本次调整尚未完成，请重新获取预览后重试。';
}

function previewMatchesRun(item: FormationSubject, preview: CustomTargetPreviewRecord): boolean {
  const run = item.currentRun;
  return Boolean(
    run &&
      preview.basis.libraRunId === run.libraRunId &&
      preview.basis.runStateRevision === run.stateRevision &&
      preview.basis.runStateDigest === run.stateDigest &&
      preview.previewDigest,
  );
}

export default function CustomTargetDialog({
  item,
  preview: initialPreview,
  onClose,
  onComplete,
  onUnauthorized,
  returnFocus,
  returnFocusFallback,
}: {
  item: FormationSubject;
  preview: CustomTargetPreviewRecord;
  onClose: () => void;
  onComplete: () => Promise<void>;
  onUnauthorized: () => void;
  returnFocus?: HTMLElement | null;
  returnFocusFallback?: () => HTMLElement | null;
}) {
  const targetRunId = item.currentRun?.libraRunId || '';
  const saved = pendingCustomCommands.get(targetRunId);
  const valid = previewMatchesRun(item, initialPreview);
  const [current, setCurrent] = useState<FormationSubject>(saved?.item || item);
  const [preview, setPreview] = useState<CustomTargetPreviewRecord | null>(
    saved?.preview || (valid ? initialPreview : null),
  );
  const [selectedDigests, setSelectedDigests] = useState<string[]>(
    saved?.selectedChangeDigests ||
      (valid ? initialPreview.proposals.map((proposal) => proposal.changeDigest) : []),
  );
  const [phase, setPhase] = useState<'editing' | 'stale' | 'unknown' | 'accepted'>(
    saved?.phase || (valid ? 'editing' : 'stale'),
  );
  const [error, setError] = useState<string>(
    saved?.phase === 'unknown'
      ? '提交结果尚未确认，可点击“确认提交结果”核对。'
      : saved?.phase === 'accepted'
        ? '自定义收藏标准已确认，状态读取失败。'
        : valid
          ? ''
          : '整理状态已变化，请重新获取预览。',
  );
  const [busy, setBusy] = useState(false);

  const busyRef = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  const originRef = useRef<HTMLElement | null>(
    returnFocus || (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  );
  const closeRef = useRef(onClose);
  const fallbackRef = useRef(returnFocusFallback);
  closeRef.current = onClose;
  fallbackRef.current = returnFocusFallback;

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    document.body.classList.add('modal-open');
    node.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(
        node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'),
      );
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first) {
        event.preventDefault();
        node.focus();
        return;
      }
      if (!node.contains(document.activeElement) || document.activeElement === node) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.classList.remove('modal-open');
      requestAnimationFrame(() => {
        if (node.isConnected || document.activeElement !== document.body) return;
        const previous = originRef.current;
        if (previous?.isConnected) previous.focus({ preventScroll: true });
        if (document.activeElement !== previous) fallbackRef.current?.()?.focus({ preventScroll: true });
      });
    };
  }, []);

  function beginBusy() {
    busyRef.current = true;
    dialogRef.current?.focus({ preventScroll: true });
    setBusy(true);
    setError('');
  }

  async function refreshAccepted() {
    try {
      await onComplete();
      pendingCustomCommands.delete(targetRunId);
      onClose();
    } catch (cause) {
      if (isUnauthorized(cause)) onUnauthorized();
      else setError('自定义收藏标准已确认，状态读取失败。');
    }
  }

  async function recheck() {
    if (busyRef.current || phase !== 'stale') return;
    beginBusy();
    try {
      const latest = await helixAdminApi.getFormation(current.formationViewId);
      if (latest.currentRun?.libraRunId !== targetRunId || latest.customTarget?.canCustomize === false) {
        setPreview(null);
        setSelectedDigests([]);
        setError('整理任务状态已变化，请关闭后刷新列表。');
        return;
      }
      const next = await helixAdminApi.prepareCustomTargetPreview(latest);
      setCurrent(latest);
      if (next.kind === 'evidence_pending') {
        setPreview(null);
        setSelectedDigests([]);
        setError('源媒体或寻源证据尚不完整，请稍后再试。');
        return;
      }
      if (next.kind === 'ineligible') {
        setPreview(null);
        setSelectedDigests([]);
        setError('当前任务没有可放宽的收藏标准项。');
        return;
      }
      if (!previewMatchesRun(latest, next.record)) {
        setPreview(null);
        setSelectedDigests([]);
        setError('整理状态已变化，请重新获取预览。');
        return;
      }
      setPreview(next.record);
      setSelectedDigests(next.record.proposals.map((proposal) => proposal.changeDigest));
      setPhase('editing');
    } catch (cause) {
      if (isUnauthorized(cause)) onUnauthorized();
      else setError('重新获取预览失败，请稍后重试。');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function submit() {
    if (busyRef.current || phase === 'stale') return;
    beginBusy();
    try {
      if (phase === 'accepted') {
        await refreshAccepted();
        return;
      }
      let command = pendingCustomCommands.get(targetRunId);
      const wasUnknown = Boolean(command);
      if (!command) {
        if (!preview || !previewMatchesRun(current, preview) || selectedDigests.length === 0) return;
        command = {
          item: current,
          preview,
          selectedChangeDigests: [...selectedDigests],
          key: `confirm-custom:${targetRunId}:${current.currentRun!.stateRevision}:${newOpaqueId()}`,
          phase: 'unknown',
        };
        pendingCustomCommands.set(targetRunId, command);
      }
      setPhase('unknown');
      try {
        const result = await helixAdminApi.confirmCustomTarget(targetRunId, {
          previewDigest: command.preview.previewDigest,
          selectedChangeDigests: command.selectedChangeDigests,
          acknowledged: true,
          idempotencyKey: command.key,
        });
        if (result.kind === 'evidence_pending') {
          pendingCustomCommands.delete(targetRunId);
          setPhase('stale');
          setError('所需证据尚不完整，请重新获取预览。');
          return;
        }
        if (result.kind !== 'confirmed' || result.record.libraRunId !== targetRunId) {
          throw new Error('Unverified custom target confirm response');
        }
      } catch (cause) {
        if (isUnauthorized(cause)) {
          onUnauthorized();
          return;
        }
        if (
          !wasUnknown &&
          cause instanceof AdminApiError &&
          cause.status >= 400 &&
          cause.status < 500 &&
          ![408, 425, 429].includes(cause.status)
        ) {
          pendingCustomCommands.delete(targetRunId);
          setPreview(null);
          setSelectedDigests([]);
          setPhase('stale');
          setError(rejectionLabel(cause.code));
        } else {
          setError('提交结果尚未确认，可点击“确认提交结果”核对。');
        }
        return;
      }
      command.phase = 'accepted';
      setPhase('accepted');
      await refreshAccepted();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function toggleDigest(changeDigest: string, checked: boolean) {
    setSelectedDigests((prev) =>
      checked ? (prev.includes(changeDigest) ? prev : [...prev, changeDigest]) : prev.filter((itemDigest) => itemDigest !== changeDigest),
    );
  }

  const selectedSet = new Set(selectedDigests);

  return (
    <Dialog
      dialogRef={dialogRef}
      closeDisabled={busy}
      open
      title="调整收藏标准"
      onClose={() => {
        if (!busyRef.current) onClose();
      }}
      actions={
        <>
          <Button type="button" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {phase === 'stale' && (
            <Button type="button" disabled={busy} onClick={() => void recheck()}>
              重新获取预览
            </Button>
          )}
          {phase === 'unknown' && (
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              确认提交结果
            </Button>
          )}
          {phase === 'accepted' && (
            <Button type="button" disabled={busy} onClick={() => void submit()}>
              刷新状态
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            disabled={busy || phase !== 'editing' || !preview || selectedDigests.length === 0}
            onClick={() => void submit()}
          >
            确认按新标准重新整理
          </Button>
        </>
      }
    >
      <div className="stack" aria-busy={busy}>
        <p>{current.displayIdentity}</p>
        <p>已核对本次有界媒体探测与寻源结果，可将以下未达到原收藏标准的项调整为自定义标准：</p>
        {preview && (
          <>
            <fieldset disabled={busy || phase !== 'editing'}>
              <legend>选择要调整的要求</legend>
              <div className="stack">
                {preview.proposals.map((proposal) => (
                  <label key={proposal.changeDigest} className="task-cancellation-exclusion">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(proposal.changeDigest)}
                      disabled={busy || phase !== 'editing'}
                      onChange={(event) => toggleDigest(proposal.changeDigest, event.target.checked)}
                    />
                    <span>{customChangeLabel(proposal.change)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p>{retainedSummary(preview, selectedSet)}</p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {busy && <p role="status">正在处理，请稍候。</p>}
    </Dialog>
  );
}
