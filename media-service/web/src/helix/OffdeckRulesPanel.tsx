import { useCallback, useEffect, useMemo, useState } from 'react';
import { helixAdminApi, type JsonValue, type OffdeckPolicy, type Shelf } from './api';
import { newOpaqueId } from './id';
import { Button, LoadingState } from './chrome';
import { isUnauthorized, useSession } from './session';

type RuleKind = 'rating_and_collection_age' | 'disliked_person' | 'unresolved_care' | 'retention_age';
type RuleDraft = {
  ruleId: string;
  shelfScope: 'all' | 'selected';
  shelfIds: string;
  kind: RuleKind;
  maxRating: number;
  minimumAgeDays: number;
  maximumPreferenceLevel: number;
  unknownCondition: JsonValue | null;
};

const ruleKindLabels: Record<RuleKind, string> = {
  rating_and_collection_age: '低评分且收藏较久',
  disliked_person: '不喜欢的人物',
  unresolved_care: '长期健康问题',
  retention_age: '收藏时间过长',
};
const addableRuleKinds: RuleKind[] = ['rating_and_collection_age', 'unresolved_care', 'retention_age'];

function emptyRule(kind: RuleKind): RuleDraft {
  return {
    ruleId: `rule-${newOpaqueId()}`,
    shelfScope: 'all',
    shelfIds: '',
    kind,
    maxRating: 2,
    minimumAgeDays: 365,
    maximumPreferenceLevel: -1,
    unknownCondition: null,
  };
}

function fromPolicyRule(rule: OffdeckPolicy['entryRules'][number]): RuleDraft {
  const condition = rule.condition as { kind?: string; parameters?: Record<string, number> } | null;
  const kind = (condition?.kind || '') as RuleKind;
  const parameters = condition?.parameters || {};
  if (kind === 'rating_and_collection_age' || kind === 'disliked_person' || kind === 'unresolved_care' || kind === 'retention_age') {
    return {
      ruleId: rule.ruleId,
      shelfScope: rule.shelfScope,
      shelfIds: rule.shelfIds.join(', '),
      kind,
      maxRating: Number(parameters.maxRating ?? 2),
      minimumAgeDays: Number(parameters.minimumAgeDays ?? 365),
      maximumPreferenceLevel: Number(parameters.maximumPreferenceLevel ?? -1),
      unknownCondition: null,
    };
  }
  return { ...emptyRule('rating_and_collection_age'), ruleId: rule.ruleId, shelfScope: rule.shelfScope, shelfIds: rule.shelfIds.join(', '), unknownCondition: rule.condition };
}

function toCondition(draft: RuleDraft): JsonValue {
  if (draft.unknownCondition) return draft.unknownCondition;
  if (draft.kind === 'rating_and_collection_age') return { kind: draft.kind, parameters: { maxRating: draft.maxRating, minimumAgeDays: draft.minimumAgeDays } };
  if (draft.kind === 'disliked_person') return { kind: draft.kind, parameters: { maximumPreferenceLevel: draft.maximumPreferenceLevel } };
  return { kind: draft.kind, parameters: { minimumAgeDays: draft.minimumAgeDays } };
}

export default function OffdeckRulesPanel() {
  const { expire } = useSession();
  const [policy, setPolicy] = useState<OffdeckPolicy | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [policyStatus, setPolicyStatus] = useState<'active' | 'disabled'>('disabled');
  const [duplicateScheduleEnabled, setDuplicateScheduleEnabled] = useState(false);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(cause instanceof Error ? cause.message : fallback);
  }, [expire]);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [policyResult, shelfResult] = await Promise.all([
        helixAdminApi.getOffdeckPolicy(),
        helixAdminApi.listShelves(),
      ]);
      setPolicy(policyResult);
      setPolicyStatus(policyResult.status);
      setDuplicateScheduleEnabled(policyResult.duplicateScheduleEnabled);
      setRuleDrafts(policyResult.entryRules.map(fromPolicyRule));
      setShelves(shelfResult.items.filter((item) => item.status === 'active'));
      setLoaded(true);
    } catch (cause) { fail(cause, '退出规则读取失败。'); }
    finally { setBusy(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);

  const shelfOptions = useMemo(() => shelves.map((shelf) => ({ id: shelf.shelfId, name: shelf.name })), [shelves]);

  async function action(run: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await run(); await load(); if (done) setNotice(done); }
    catch (cause) { fail(cause, '操作未完成。'); }
    finally { setBusy(false); }
  }
  async function savePolicy() {
    if (!policy) throw new Error('退出规则尚未加载。');
    const entryRules = ruleDrafts.map((draft) => ({
      ruleId: draft.ruleId,
      shelfScope: draft.shelfScope,
      shelfIds: draft.shelfScope === 'selected' ? draft.shelfIds.split(',').map((value) => value.trim()).filter(Boolean) : [],
      condition: toCondition(draft),
    }));
    await helixAdminApi.publishOffdeckPolicy({ expectedRevision: policy.revision, status: policyStatus, duplicateScheduleEnabled, entryRules, idempotencyKey: `offdeck-policy:${newOpaqueId()}` });
  }
  function updateRule(index: number, patch: Partial<RuleDraft>) {
    setRuleDrafts((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  if (!loaded && busy) return <LoadingState>正在读取退出规则…</LoadingState>;
  return <section className="settings-card" aria-labelledby="offdeck-rules-title">
    <header className="settings-card-head">
      <div>
        <h2 id="offdeck-rules-title">退出规则</h2>
      </div>
    </header>
    <div className="settings-card-body">
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      <div className="form-grid">
        <label><span>自动建议</span><select value={policyStatus} onChange={(event) => setPolicyStatus(event.target.value as 'active' | 'disabled')}><option value="disabled">关闭</option><option value="active">启用</option></select></label>
        <label><span>定期查重复</span><select value={duplicateScheduleEnabled ? 'on' : 'off'} onChange={(event) => setDuplicateScheduleEnabled(event.target.value === 'on')}><option value="off">关闭</option><option value="on">启用</option></select></label>
      </div>
      {ruleDrafts.map((draft, index) => <article className="source-row rule-form" key={draft.ruleId}>
        <div className="form-grid">
          <label><span>规则类型</span><select value={draft.kind} disabled={Boolean(draft.unknownCondition) || draft.kind === 'disliked_person'} onChange={(event) => updateRule(index, { kind: event.target.value as RuleKind })}>{(draft.kind === 'disliked_person' ? (Object.keys(ruleKindLabels) as RuleKind[]) : addableRuleKinds).map((kind) => <option key={kind} value={kind}>{ruleKindLabels[kind]}</option>)}</select></label>
          <label><span>适用范围</span><select value={draft.shelfScope} onChange={(event) => updateRule(index, { shelfScope: event.target.value as 'all' | 'selected' })}><option value="all">全部收藏架</option><option value="selected">指定收藏架</option></select></label>
          {draft.shelfScope === 'selected' && <label><span>收藏架</span><select value={draft.shelfIds} onChange={(event) => updateRule(index, { shelfIds: event.target.value })}><option value="">选择收藏架</option>{shelfOptions.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label>}
          {draft.kind === 'rating_and_collection_age' && !draft.unknownCondition && <>
            <label><span>最高评分</span><input type="number" min={1} max={5} value={draft.maxRating} onChange={(event) => updateRule(index, { maxRating: Number(event.target.value) })} /></label>
            <label><span>最少收藏天数</span><input type="number" min={1} value={draft.minimumAgeDays} onChange={(event) => updateRule(index, { minimumAgeDays: Number(event.target.value) })} /></label>
          </>}
          {draft.kind === 'disliked_person' && !draft.unknownCondition && <span className="ui-state">已有设置 · 只读</span>}
          {(draft.kind === 'unresolved_care' || draft.kind === 'retention_age') && !draft.unknownCondition && <label><span>最少天数</span><input type="number" min={1} value={draft.minimumAgeDays} onChange={(event) => updateRule(index, { minimumAgeDays: Number(event.target.value) })} /></label>}
        </div>
        {draft.unknownCondition && <details><summary>技术查看</summary><pre>{JSON.stringify(draft.unknownCondition, null, 2)}</pre></details>}
        <Button type="button" onClick={() => setRuleDrafts((items) => items.filter((_, i) => i !== index))}>去掉这条规则</Button>
      </article>)}
      <div className="button-row">
        {addableRuleKinds.map((kind) => <Button key={kind} type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule(kind)])}>{ruleKindLabels[kind]}</Button>)}
        <Button variant="primary" type="button" onClick={() => void action(savePolicy, '退出规则已保存。')} disabled={busy}>保存规则</Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.evaluateOffdeck(), '已按当前规则检查一次。')}>现在检查一次</Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.detectOffdeckDuplicates(), '已检查重复收藏。')}>查重复</Button>
      </div>
    </div>
  </section>;
}
