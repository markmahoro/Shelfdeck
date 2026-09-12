import { useCallback, useEffect, useRef, useState } from 'react';
import { helixAdminApi, type DefectAuthorization as Authorization } from './api';
import { Button } from './chrome';
import { newOpaqueId } from './id';
import { isUnauthorized, useSession } from './session';

export default function DefectAuthorization() {
  const { expire } = useSession();
  const [authorization, setAuthorization] = useState<Authorization|null>(null);
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const command = useRef<string|null>(null);
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const result = await helixAdminApi.getDefectAuthorization();
      setAuthorization(result.authorization); setStatus('ready');
      return true;
    } catch (cause) {
      setStatus('error');
      if (isUnauthorized(cause)) expire();
      return false;
    }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); trigger.current?.querySelector('button')?.focus(); };
  }, [open]);
  const enabled = status === 'ready' && authorization?.state === 'enabled';
  const label = status === 'loading' ? '读取中' : status === 'error' ? '读取失败' : enabled ? '已授权' : '未授权';
  async function change() {
    if (busy || status !== 'ready') return;
    setBusy(true); setError('');
    command.current ||= 'defect-authorization:' + newOpaqueId();
    try {
      await helixAdminApi.setDefectAuthorization(!enabled, authorization?.revision || 0, command.current);
      command.current = null;
      if (await load()) setOpen(false);
      else setError('操作已提交，暂时无法读取最新状态，请重新读取。');
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError('授权操作未完成，请重新读取状态后重试。');
    } finally { setBusy(false); }
  }
  function close() { if (!busy) setOpen(false); }
  return <span ref={trigger}>
    <Button type="button" aria-haspopup="dialog" onClick={() => { setError(''); command.current=null; setOpen(true); }}>
      自动授权瑕疵上架 · <span className="ui-state" data-state={enabled ? 'complete' : 'unknown'}>{label}</span>
    </Button>
    {open && <dialog ref={dialog} className="shelf-deregister-dialog" aria-labelledby="defect-authorization-title"
      onCancel={event => { event.preventDefault(); close(); }}>
      <div className="dialog">
        <div className="dialog-head"><h2 id="defect-authorization-title">自动授权瑕疵上架</h2></div>
        <div className="dialog-body">
          <p>授权后，当前及后续首次整理的电影，只要符合瑕疵上架条件，就会自动接受本次确认的具体差距并继续上架。</p>
          <p>可能包括演员、海报等资料缺失，或编码、分辨率、音轨、体积等与收藏架要求的差距。文件必须真实可读、可播放，身份、完整性、文件权限、收藏架和空间检查仍须通过。</p>
          <p>上架后保留已接受瑕疵标记；修复这些瑕疵由你手动发起。</p>
          {enabled && <p>撤销后停止发放新的单条授权；已经发放的授权仍须通过当前证据和安全检查才能继续。已上架收藏保持原状。</p>}
          {status !== 'ready' && <p role="status">{status === 'loading' ? '正在读取授权状态…' : '无法读取授权状态，请重试。'}</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <Button type="button" disabled={busy} onClick={close}>取消</Button>
          {(status === 'error' || error) && <Button type="button" disabled={busy} onClick={() => {command.current=null; setError(''); void load();}}>重新读取</Button>}
          {status === 'ready' && <Button type="button" variant="primary" disabled={busy || Boolean(error)} onClick={() => void change()}>
            {busy ? '正在提交…' : enabled ? '撤销授权' : '授权自动瑕疵上架'}
          </Button>}
        </div>
      </div>
    </dialog>}
  </span>;
}
