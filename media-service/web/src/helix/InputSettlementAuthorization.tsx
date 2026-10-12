import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { helixAdminApi, type SetupReadinessProjection } from './api';
import { Button } from './chrome';
import { isUnauthorized, useSession } from './session';

type Authorization = SetupReadinessProjection['data']['standingInputSettlement'];
export default function InputSettlementAuthorization({openRequested=false}:{openRequested?:boolean}={}) {
  const { expire } = useSession();
  const [authorization, setAuthorization] = useState<Authorization>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(openRequested);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  useEffect(() => { if (openRequested) setOpen(true); }, [openRequested]);
  useEffect(() => {
    if (!open) return;
    const current = dialog.current;
    if (!trigger.current) trigger.current=document.getElementById(titleId+'-trigger') as HTMLButtonElement|null;
    current?.showModal();
    return () => {
      current?.close();
      trigger.current?.focus();
    };
  }, [open]);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await helixAdminApi.getSetupReadiness();
      setAuthorization(result.data.standingInputSettlement); setLoaded(true);
      return true;
    } catch (cause) {
      setLoaded(false);
      if (isUnauthorized(cause)) expire();
      else setError('无法读取自动清理授权，请重试。');
      return false;
    } finally { setBusy(false); }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);
  async function change(enabled: boolean) {
    if (!loaded || busy) return;
    setBusy(true); setError('');
    try {
      await helixAdminApi.setInputSettlementAuthorization(enabled, authorization?.revision || 0);
      if (await load()) setOpen(false);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '授权操作失败，请刷新后重试。');
    } finally { setBusy(false); }
  }
  const enabled = loaded && authorization?.enabled === true;
  const partial = enabled && !authorization?.coversExclusiveRelatedInput;
  const status = !loaded ? (busy ? '读取中…' : '读取失败') : enabled ? (partial ? '部分授权' : '已授权') : '未授权';
  return <>
    <Button id={titleId+'-trigger'} type="button" aria-haspopup="dialog" onClick={(event) => { trigger.current = event.currentTarget; setOpen(true); }}>
      自动清理残留文件 <span className="ui-state" data-state={enabled ? 'complete' : 'unknown'}>{status}</span>
    </Button>
    {open && <dialog ref={dialog} className="dialog input-settlement-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); if (!busy) setOpen(false); }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="dialog-head"><h2 id={titleId}>自动清理残留文件</h2></div>
      <div className="dialog-body">
        {loaded && <>
          <p>成品验证通过后，自动清理本次上架中已被安全替代的文件。</p>
          <dl className="input-settlement-scope">
            <div><dt>清理范围</dt><dd>原片、结构文件、独占关联文件</dd></div>
            <div><dt>保留文件</dt><dd>共享、未知及范围外文件</dd></div>
          </dl>
          <p>此授权不包含退出收藏时销毁文件。</p>
          {partial && <p>当前仅授权原片和结构文件，独占关联文件仍保留。</p>}
          {enabled && <p>撤销后，尚未执行的清理将等待授权；已清理的文件不会恢复。</p>}
        </>}
        {busy && <p role="status">正在更新授权状态…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="dialog-actions">
        <Button type="button" disabled={busy} onClick={() => setOpen(false)}>取消</Button>
        {error && <Button type="button" disabled={busy} onClick={() => void load()}>重新读取授权</Button>}
        {loaded && <>
          {enabled && <Button type="button" disabled={busy} onClick={() => void change(false)}>撤销授权</Button>}
          {(!enabled || partial) && <Button variant="primary" type="button" disabled={busy} onClick={() => void change(true)}>{partial ? '授权全部清理范围' : '授权自动清理'}</Button>}
        </>}
      </div>
    </dialog>}
  </>;
}
