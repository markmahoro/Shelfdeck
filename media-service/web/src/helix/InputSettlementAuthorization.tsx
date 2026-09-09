import { useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type SetupReadinessProjection } from './api';
import { Button } from './chrome';
import { isUnauthorized, useSession } from './session';

type Authorization = SetupReadinessProjection['data']['standingInputSettlement'];
export default function InputSettlementAuthorization() {
  const { expire } = useSession();
  const [authorization, setAuthorization] = useState<Authorization>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const result = await helixAdminApi.getSetupReadiness();
      setAuthorization(result.data.standingInputSettlement); setLoaded(true);
    } catch (cause) {
      setLoaded(false);
      if (isUnauthorized(cause)) expire();
      else setError('无法读取旧输入清理授权，请重试。');
    } finally { setBusy(false); }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);
  async function change(enabled: boolean) {
    if (!loaded || busy) return;
    setBusy(true); setError('');
    try {
      await helixAdminApi.setInputSettlementAuthorization(enabled, authorization?.revision || 0);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '授权操作失败，请刷新后重试。');
    } finally { setBusy(false); }
  }
  const enabled = loaded && authorization?.enabled === true;
  return <details className="source-flow-help">
    <summary>旧输入自动清理 · {!loaded ? '状态待读取' : enabled ? '已授权' : '未授权'}</summary>
    <p>成品验证通过后，允许清理本次上架中已安全替代的原片、结构文件及独占关联文件。共享文件、未知文件和范围外文件会保留。此授权不包括退出收藏时销毁文件。</p>
    {enabled && <p>{authorization?.coversExclusiveRelatedInput ? '当前授权包含原片、结构文件和独占关联文件。' : '当前授权仅包含原片和结构文件，独占关联文件仍会保留。'}</p>}
    {loaded && !enabled && <p>尚未执行的旧输入清理会等待授权，原文件保留。</p>}
    {error && <p role="alert">{error}</p>}
    {error && loaded && <Button type="button" disabled={busy} onClick={() => void load()}>刷新授权状态</Button>}
    {!loaded ? <Button type="button" disabled={busy} onClick={() => void load()}>重新读取</Button> : <>
      {(!enabled || !authorization?.coversExclusiveRelatedInput) && <Button type="button" disabled={busy} onClick={() => void change(true)}>授权安全旧输入自动清理</Button>}
      {enabled && <Button type="button" disabled={busy} onClick={() => void change(false)}>撤销持续授权</Button>}
    </>}
  </details>;
}
