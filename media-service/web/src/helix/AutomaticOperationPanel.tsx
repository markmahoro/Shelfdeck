import { useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type SetupReadinessProjection } from './api';
import { Button } from './chrome';
import { isUnauthorized, useSession } from './session';

function expectedRevisionOf(projection: SetupReadinessProjection | null) {
  return projection?.data.standingInputSettlement?.revision
    ?? projection?.availableActions.find((item) => item.actionCode === 'enable_full_automatic_operation')?.expectedRevision
    ?? 0;
}

export default function AutomaticOperationPanel({ heading = '自动运营' }: { heading?: string }) {
  const { expire } = useSession();
  const [projection, setProjection] = useState<SetupReadinessProjection | null>(null);
  const [ownerResults, setOwnerResults] = useState<Array<{ owner: string; topic: string; result: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setProjection(await helixAdminApi.getAutomaticOperation());
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '自动运营读取失败。');
    } finally { setLoading(false); }
  }, [expire]);

  useEffect(() => { void load(); }, [load]);

  async function enableFull() {
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await helixAdminApi.enableFullAutomaticOperation(expectedRevisionOf(projection));
      setOwnerResults(result.ownerResults);
      setProjection(result.readiness || await helixAdminApi.getAutomaticOperation());
      setNotice(result.readiness?.data.fullAutoReady ? '已启用全自动。' : '已启用全自动授权。未就绪项仍按各 Owner 列出，不会假装整体成功。');
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '启用全自动失败。');
    } finally { setLoading(false); }
  }

  async function requireConfirmation() {
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await helixAdminApi.requireSettlementConfirmation(expectedRevisionOf(projection));
      setOwnerResults(result.ownerResults);
      setProjection(result.readiness || await helixAdminApi.getAutomaticOperation());
      setNotice('已改为关键步骤确认。已建立的责任不会暂停，已完成的旧输入处理不会回滚。');
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '切换到关键步骤确认失败。');
    } finally { setLoading(false); }
  }

  const choice = projection?.data.productChoice || 'key_step_confirmation';
  return <section className="settings-card automatic-operation" aria-labelledby="automatic-operation-title">
    <header className="settings-card-head">
      <div>
        <h2 id="automatic-operation-title">{heading}</h2>
        <p>全自动只是各 Owner 可消费的预设，不是第六个引擎。退出收藏的物理销毁保持独立关闭。</p>
      </div>
      <span className={`integration-state ${choice === 'full_auto' ? 'active' : ''}`}>
        {projection?.data.productChoiceLabel || '关键步骤确认'}
      </span>
    </header>
    <div className="settings-card-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="choice-grid" role="group" aria-label="自动运营产品选择">
        <button type="button" className="choice-card" aria-pressed={choice === 'full_auto'} disabled={loading || choice === 'full_auto'} onClick={() => void enableFull()}>
          <strong>全自动（推荐）</strong>
          <small>启用上架旧输入自动处理授权。其余 Owner 按已确认自动化继续推进。</small>
        </button>
        <button type="button" className="choice-card" aria-pressed={choice === 'key_step_confirmation'} disabled={loading || choice === 'key_step_confirmation'} onClick={() => void requireConfirmation()}>
          <strong>关键步骤确认</strong>
          <small>其余自动化不变，但每次上架处理旧输入前等待当前范围确认。</small>
        </button>
      </div>
      {projection && <>
        <div>
          <strong>{projection.data.fullAutoReadyLabel}</strong>
          {choice === 'full_auto' && !projection.data.fullAutoReady && <small> 未就绪项按 Owner 列出，不会伪造整体成功。</small>}
        </div>
        <ul className="readiness-list">
          {projection.data.items.map((item) => <li key={item.key} data-ready={item.ready ? 'true' : 'false'}>{item.ready ? '已就绪' : '未就绪'} · {item.label}</li>)}
          <li data-ready="true">{projection.data.offdeckDestruction.label}</li>
        </ul>
        <div>
          <strong>按 Owner 的后果</strong>
          <ul className="consequence-list">
            {projection.data.consequences.map((item) => <li key={`${item.owner}:${item.topic}`}>{item.text}</li>)}
          </ul>
        </div>
      </>}
      {ownerResults.length > 0 && <div>
        <strong>本次按 Owner 设置结果</strong>
        <ul className="consequence-list">
          {ownerResults.map((item) => <li key={`${item.owner}:${item.topic}`}>{item.label}</li>)}
        </ul>
      </div>}
      <div className="settings-card-actions">
        <Button type="button" onClick={() => void load()} disabled={loading}>刷新</Button>
        <Button variant="primary" type="button" onClick={() => void enableFull()} disabled={loading || choice === 'full_auto'}>启用全自动</Button>
      </div>
    </div>
  </section>;
}
