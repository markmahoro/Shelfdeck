import { FormEvent, useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type SecondaryWorkshop } from './api';
import { Button, LoadingState } from './chrome';
import { isUnauthorized, useSession } from './session';

export default function SecondaryWorkshopSettings() {
  const { expire } = useSession();
  const [policy, setPolicy] = useState<SecondaryWorkshop | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const seats = draft.trim() === '' ? NaN : Number(draft);
  const valid = Number.isSafeInteger(seats) && seats >= 0 && seats <= 32;
  const fail = useCallback((cause: unknown, message: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(message);
  }, [expire]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const value = await helixAdminApi.getSecondaryWorkshop();
      setPolicy(value); setDraft(String(value.secondarySeats));
    } catch (cause) { fail(cause, '暂存容量读取失败，请重试。'); }
    finally { setLoading(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || !policy) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const value = await helixAdminApi.patchSecondaryWorkshop(seats);
      setPolicy(value); setDraft(String(value.secondarySeats)); setNotice('暂存容量已保存');
    } catch (cause) { fail(cause, '暂存容量保存失败，请重试。'); }
    finally { setLoading(false); }
  }
  return <section className="settings-card" aria-labelledby="secondary-workshop-title">
    <header className="settings-card-head">
      <h2 id="secondary-workshop-title">二号暂存车间</h2>
      {policy && <span className="integration-state" data-state={policy.secondarySeats === 0 ? 'unknown' : 'active'}>
        {policy.secondarySeats === 0 ? '停止新增转入' : `已占用 ${policy.held} / ${policy.secondarySeats}`}
      </span>}
    </header>
    <div className="settings-card-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {policy ? <form className="source-form" onSubmit={save}>
        <label className="settings-inline-field"><span>共享暂存容量（0–32）</span>
          <input type="number" min="0" max="32" step="1" value={draft} disabled={loading}
            aria-invalid={!valid} aria-describedby={!valid ? 'secondary-workshop-error' : undefined}
            onChange={event => { setDraft(event.target.value); setNotice(''); }} />
        </label>
        {!valid && <p id="secondary-workshop-error" className="form-error">请输入 0–32 的整数。</p>}
        {valid && seats !== policy.secondarySeats && seats < policy.held && <p className="ui-state">已有 {policy.held} 项继续保留</p>}
        {policy.secondarySeats === 0 && <p className="ui-state">已占用 {policy.held} 项</p>}
        <div className="settings-card-actions"><Button variant="primary"
          disabled={loading || !valid || seats === policy.secondarySeats}>保存暂存容量</Button></div>
      </form> : loading ? <LoadingState>正在读取暂存容量…</LoadingState>
        : <Button type="button" onClick={() => void load()}>重新读取暂存容量</Button>}
    </div>
  </section>;
}
