import { FormEvent, useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type MaintenanceConfiguration, type MaintenanceWindowSettings } from './api';
import { Button, LoadingState } from './chrome';
import { newOpaqueId } from './id';
import { isUnauthorized, useSession } from './session';

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const schedule = (value: MaintenanceWindowSettings) => `每${weekdays[value.weekday]} ${value.startTime}–${value.endTime <= value.startTime ? '次日 ' : ''}${value.endTime}`;

export default function MaintenanceSettings() {
  const { expire } = useSession();
  const [current, setCurrent] = useState<MaintenanceConfiguration | null>(null);
  const [draft, setDraft] = useState<MaintenanceWindowSettings | null>(null);
  const [busy, setBusy] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const fail = useCallback((cause: unknown, message: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(cause instanceof Error ? cause.message : message);
  }, [expire]);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const value = await helixAdminApi.getMaintenanceConfiguration();
      setCurrent(value); setDraft(value.pendingSettings?.settings || value.settings);
    } catch (cause) { fail(cause, '维护窗口读取失败，请重试。'); }
    finally { setBusy(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);
  const saved = current?.pendingSettings?.settings || current?.settings;
  const changed = Boolean(draft && saved && JSON.stringify(draft) !== JSON.stringify(saved));
  const invalid = Boolean(draft && (!draft.startTime || !draft.endTime || draft.startTime === draft.endTime));
  const update = (patch: Partial<MaintenanceWindowSettings>) => {
    setDraft(value => value ? { ...value, ...patch } : value); setNotice('');
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!current || !draft || invalid || !changed) return;
    setBusy(true); setSaving(true); setError(''); setNotice('');
    try {
      const value = await helixAdminApi.patchMaintenanceConfiguration(current.revision, newOpaqueId(), draft);
      setCurrent(value); setDraft(value.pendingSettings?.settings || value.settings); setNotice('维护窗口已保存，下次维护生效。');
    } catch (cause) { fail(cause, '维护窗口保存失败，请重新读取后重试。'); }
    finally { setBusy(false); setSaving(false); }
  }
  return <section className="settings-card" aria-labelledby="maintenance-window-title">
    <header className="settings-card-head"><h2 id="maintenance-window-title">维护窗口</h2><span>北京时间</span></header>
    <div className="settings-card-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {current && draft ? <form className="source-form" onSubmit={save} aria-busy={busy}>
        {(changed || current.pendingSettings) && <p className="ui-state">当前：{schedule(current.settings)}</p>}
        <div className="source-form-grid">
          <label><span>维护星期</span><select disabled={busy} value={draft.weekday} onChange={event => update({ weekday: Number(event.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 0].map(day => <option key={day} value={day}>{weekdays[day]}</option>)}
          </select></label>
          <label><span>开始时间</span><input type="time" required disabled={busy} value={draft.startTime} onChange={event => update({ startTime: event.target.value })} /></label>
          <label><span>结束时间</span><input type="time" required disabled={busy} value={draft.endTime} aria-invalid={invalid}
            aria-describedby={invalid ? 'maintenance-time-error' : undefined} onChange={event => update({ endTime: event.target.value })} /></label>
        </div>
        {invalid && <p className="form-error" id="maintenance-time-error">请选择不同的开始和结束时间。</p>}
        {current.pendingSettings && !notice && !changed && <p className="ui-state">下次维护生效</p>}
        <div className="settings-card-actions">
          <Button variant="primary" disabled={busy || invalid || !changed}>{saving ? '正在保存…' : '保存维护窗口'}</Button>
          {changed && <Button type="button" disabled={busy} onClick={() => { setDraft(saved || null); setError(''); setNotice(''); }}>取消修改</Button>}
          {error && <Button type="button" disabled={busy} onClick={() => void load()}>重新读取</Button>}
        </div>
      </form> : busy ? <LoadingState>正在读取维护窗口…</LoadingState> : <Button type="button" onClick={() => void load()}>重新读取维护窗口</Button>}
    </div>
  </section>;
}
