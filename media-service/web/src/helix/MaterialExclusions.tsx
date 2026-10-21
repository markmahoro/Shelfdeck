import { useEffect, useState } from 'react';
import { helixAdminApi, type MaterialField } from './api';
import { Button } from './chrome';
import { isUnauthorized, useSession } from './session';

type Snapshot = Awaited<ReturnType<typeof helixAdminApi.getMaterialExclusions>>;

export default function MaterialExclusions({ field, onChanged }: { field: MaterialField; onChanged: () => void }) {
  const { expire } = useSession();
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true); setError('');
    void helixAdminApi.getMaterialExclusions(field.fieldId).then(value => { if (live) setSnapshot(value); })
      .catch(cause => { if (!live) return; if (isUnauthorized(cause)) expire(); else setError('无法读取已排除文件，请重试。'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [open, field.fieldId, field.extractionPolicyRevision, expire, refresh]);
  async function revoke(materialKey: string) {
    if (!snapshot) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await helixAdminApi.revokeMaterialExclusion(field.fieldId, snapshot.extractionPolicy, materialKey);
      setSnapshot(await helixAdminApi.getMaterialExclusions(field.fieldId));
      setNotice('已撤销排除'); onChanged();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError('未能撤销排除，请刷新列表后重试。'); setSnapshot(await helixAdminApi.getMaterialExclusions(field.fieldId).catch(() => null)); }
    } finally { setBusy(false); }
  }
  return <section className="source-flow-panel" aria-label={`${field.name} 已排除文件`}>
    <Button type="button" aria-expanded={open} onClick={() => { setOpen(!open); setNotice(''); }}>
      已排除文件 {snapshot?.excludedMaterials.length ?? field.policy.policy.excludedMaterialKeys.length}
    </Button>
    {open && <div className="stack" aria-busy={busy}>
      {error && <><p role="alert" className="form-error">{error}</p><Button type="button" disabled={busy} onClick={()=>setRefresh(value=>value+1)}>刷新已排除文件</Button></>}
      {notice && <p role="status">{notice}</p>}
      {busy && !snapshot && <p role="status">正在读取…</p>}
      {!busy && snapshot?.excludedMaterials.length === 0 && <p>没有已排除的文件</p>}
      {snapshot?.excludedMaterials.map(item => <div key={item.materialKey} className="source-stop-confirm">
        <span>{item.location || '文件位置暂不可用'}</span>
        <Button type="button" disabled={busy} onClick={() => void revoke(item.materialKey)}>撤销排除</Button>
      </div>)}
    </div>}
  </section>;
}
