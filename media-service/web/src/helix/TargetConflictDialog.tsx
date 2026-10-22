import { useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/ui';
import { Button } from './chrome';
import { AdminApiError, helixAdminApi, type FormationSubject } from './api';
import { processFailureLabel } from './error-labels';

type Conflict = { target: string; name?: string | null };

export default function TargetConflictDialog({ item, onClose, onComplete }: {
  item: FormationSubject;
  onClose: () => void;
  onComplete: () => Promise<void>;
}) {
  const details = item.executorIssue?.details;
  const conflicts: Conflict[] = Array.isArray(details?.conflicts) ? details.conflicts : [];
  const fallback: Conflict[] = details?.sourceDirectory
    ? [{ target: details.sourceDirectory, name: details.unknownNames?.[0] || null }]
    : [];
  const rows = conflicts.length ? conflicts : fallback;
  const hiddenCount = Math.max(0, (details?.conflictCount || rows.length) - rows.length);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  async function submit() {
    if (!confirmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await helixAdminApi.retryAcceptance(item);
      await onComplete();
      onClose();
    } catch (cause) {
      setError(cause instanceof AdminApiError ? processFailureLabel(cause.code) : '重新检查未完成，请稍后再试。');
    } finally {
      setBusy(false);
    }
  }

  return <Dialog dialogRef={dialog} open title="处理目标位置冲突" onClose={() => { if (!busy) onClose(); }} actions={<>
    <Button type="button" variant="text" disabled={busy} onClick={onClose}>返回</Button>
    <Button type="button" disabled={busy || !confirmed} onClick={() => void submit()}>{busy ? '正在检查…' : '重新检查'}</Button>
  </>}>
    <div className="stack" aria-busy={busy}>
      <p><strong>{item.displayIdentity}</strong></p>
      <p>系统在以下目标位置发现与本次产品不同的文件，已停止写入。请先处理这些文件，再重新检查。</p>
      {rows.length ? <ul className="target-conflict-list">
        {rows.map((row) => <li key={row.target}><code>{row.target}</code>{row.name ? <small>{row.name}</small> : null}</li>)}
      </ul> : <p className="form-error" role="alert">本次失败没有返回可显示的冲突位置，请先在目标收藏架中检查。</p>}
      {hiddenCount > 0 && <p>还有 {hiddenCount} 个冲突未显示。</p>}
      {details?.truncated === true && <p>冲突位置较多，列表已截断；请按目标目录整体检查。</p>}
      <label><input type="checkbox" checked={confirmed} disabled={busy}
        onChange={(event) => setConfirmed(event.target.checked)} /> 我已处理上述目标位置</label>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}
