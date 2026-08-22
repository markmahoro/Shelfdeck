import { useCallback, useEffect, useMemo, useState } from 'react';
import { helixAdminApi, type JsonValue, type OffdeckCase, type OffdeckCandidate, type OffdeckDuplicateGroup, type OffdeckPolicy, type OffdeckReview, type Shelf } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { caseStateLabels, labelOf, reviewStateLabels } from './labels';
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

function emptyRule(kind: RuleKind): RuleDraft {
  return {
    ruleId: `rule-${crypto.randomUUID()}`,
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

export default function OffdeckPage() {
  const { expire } = useSession();
  const [policy, setPolicy] = useState<OffdeckPolicy | null>(null);
  const [candidates, setCandidates] = useState<OffdeckCandidate[]>([]);
  const [groups, setGroups] = useState<OffdeckDuplicateGroup[]>([]);
  const [groupSelection, setGroupSelection] = useState<Record<string, string[]>>({});
  const [cases, setCases] = useState<OffdeckCase[]>([]);
  const [review, setReview] = useState<OffdeckReview | null>(null);
  const [ruleDrafts, setRuleDrafts] = useState<RuleDraft[]>([]);
  const [policyStatus, setPolicyStatus] = useState<'active' | 'disabled'>('disabled');
  const [duplicateScheduleEnabled, setDuplicateScheduleEnabled] = useState(false);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fail = useCallback((cause: unknown, fallback: string) => {
    if (isUnauthorized(cause)) expire();
    else setError(cause instanceof Error ? cause.message : fallback);
  }, [expire]);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [policyResult, candidateResult, caseResult, collection, shelfResult] = await Promise.all([
        helixAdminApi.getOffdeckPolicy(),
        helixAdminApi.listOffdeckCandidates(),
        helixAdminApi.listOffdeckCases(),
        helixAdminApi.listCollection(),
        helixAdminApi.listShelves(),
      ]);
      setPolicy(policyResult);
      setPolicyStatus(policyResult.status);
      setDuplicateScheduleEnabled(policyResult.duplicateScheduleEnabled);
      setRuleDrafts(policyResult.entryRules.map(fromPolicyRule));
      setCandidates(candidateResult.candidates);
      setGroups(candidateResult.duplicateGroups);
      setCases(caseResult.items);
      setTitles(Object.fromEntries(collection.items.map((item) => [item.shelfEntryId, item.displayIdentity])));
      setShelves(shelfResult.items.filter((item) => item.status === 'active'));
      const id = new URLSearchParams(location.search).get('review');
      if (id) setReview(await helixAdminApi.getOffdeckReview(id));
      setLoaded(true);
    } catch (cause) { fail(cause, '退出收藏读取失败。'); }
    finally { setBusy(false); }
  }, [fail]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!review || review.state !== 'preparing') return;
    const timer = window.setInterval(() => {
      void helixAdminApi.getOffdeckReview(review.reviewId).then(setReview).catch((cause) => fail(cause, '退出范围准备失败。'));
    }, 1500);
    return () => window.clearInterval(timer);
  }, [fail, review]);

  async function action(run: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await run(); await load(); }
    catch (cause) { fail(cause, '操作未完成。'); }
    finally { setBusy(false); }
  }
  function toggleMember(groupId: string, shelfEntryId: string) {
    setGroupSelection((current) => {
      const selected = new Set(current[groupId] || []);
      selected.has(shelfEntryId) ? selected.delete(shelfEntryId) : selected.add(shelfEntryId);
      return { ...current, [groupId]: [...selected].sort() };
    });
  }
  function titleOf(id: string | null) {
    if (!id) return '未命名收藏';
    return titles[id] || '未命名收藏';
  }
  async function openCandidate(item: OffdeckCandidate) {
    let body: Record<string, unknown>;
    if (item.candidate_kind === 'entry') body = { originKind: 'candidate', originRef: item.candidate_id, idempotencyKey: `offdeck-candidate:${item.candidate_id}` };
    else {
      const selected = groupSelection[item.duplicate_group_id || ''] || [];
      if (selected.length === 0) throw new Error('请先选择重复组中需要退出的收藏。');
      body = { shelfEntryIds: selected, originKind: 'duplicate_group', originRef: item.duplicate_group_id, idempotencyKey: `offdeck-duplicate:${item.duplicate_group_id}:${selected.join(',')}` };
    }
    const value = await helixAdminApi.createOffdeckReview({ ...body, actorId: 'admin' });
    setReview(value);
    history.replaceState(null, '', `/offdeck?review=${encodeURIComponent(value.reviewId)}`);
  }
  async function savePolicy() {
    if (!policy) throw new Error('退出规则尚未加载。');
    const entryRules = ruleDrafts.map((draft) => ({
      ruleId: draft.ruleId,
      shelfScope: draft.shelfScope,
      shelfIds: draft.shelfScope === 'selected' ? draft.shelfIds.split(',').map((value) => value.trim()).filter(Boolean) : [],
      condition: toCondition(draft),
    }));
    await helixAdminApi.publishOffdeckPolicy({ expectedRevision: policy.revision, status: policyStatus, duplicateScheduleEnabled, entryRules, idempotencyKey: `offdeck-policy:${crypto.randomUUID()}` });
  }
  function updateRule(index: number, patch: Partial<RuleDraft>) {
    setRuleDrafts((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  const openCandidates = candidates.filter((item) => item.state === 'open');
  const shelfOptions = useMemo(() => shelves.map((shelf) => ({ id: shelf.shelfId, name: shelf.name })), [shelves]);

  if (!loaded && busy) return <LoadingState>正在读取退出收藏…</LoadingState>;
  return <section className="source-page">
    <PageHeader title="退出收藏" description="先审阅建议，确认后再授权删除。没有授权不会删除文件。" actions={<Button type="button" onClick={() => void load()} disabled={busy}>刷新</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="source-card">
      <div className="source-card-heading"><div><h2>{policy?.status === 'active' ? '自动建议已启用' : '自动建议默认关闭'}</h2></div><Button variant="primary" type="button" onClick={() => void action(savePolicy)} disabled={busy}>保存规则</Button></div>
      <p className="page-lede">规则按顺序评估。信息不完整时不会产生建议。手动检测重复始终可用。</p>
      <div className="form-grid">
        <label><span>自动建议</span><select value={policyStatus} onChange={(event) => setPolicyStatus(event.target.value as 'active' | 'disabled')}><option value="disabled">关闭</option><option value="active">启用</option></select></label>
        <label><span>定期检测重复</span><select value={duplicateScheduleEnabled ? 'on' : 'off'} onChange={(event) => setDuplicateScheduleEnabled(event.target.value === 'on')}><option value="off">关闭</option><option value="on">启用</option></select></label>
      </div>
      {ruleDrafts.map((draft, index) => <article className="source-row rule-form" key={draft.ruleId}>
        <div className="form-grid">
          <label><span>规则类型</span><select value={draft.kind} disabled={Boolean(draft.unknownCondition)} onChange={(event) => updateRule(index, { kind: event.target.value as RuleKind })}>{(Object.keys(ruleKindLabels) as RuleKind[]).map((kind) => <option key={kind} value={kind}>{ruleKindLabels[kind]}</option>)}</select></label>
          <label><span>适用范围</span><select value={draft.shelfScope} onChange={(event) => updateRule(index, { shelfScope: event.target.value as 'all' | 'selected' })}><option value="all">全部收藏架</option><option value="selected">指定收藏架</option></select></label>
          {draft.shelfScope === 'selected' && <label><span>收藏架</span><select value={draft.shelfIds} onChange={(event) => updateRule(index, { shelfIds: event.target.value })}><option value="">选择收藏架</option>{shelfOptions.map((shelf) => <option key={shelf.id} value={shelf.id}>{shelf.name}</option>)}</select></label>}
          {draft.kind === 'rating_and_collection_age' && !draft.unknownCondition && <>
            <label><span>最高评分</span><input type="number" min={1} max={5} value={draft.maxRating} onChange={(event) => updateRule(index, { maxRating: Number(event.target.value) })} /></label>
            <label><span>最少收藏天数</span><input type="number" min={1} value={draft.minimumAgeDays} onChange={(event) => updateRule(index, { minimumAgeDays: Number(event.target.value) })} /></label>
          </>}
          {draft.kind === 'disliked_person' && !draft.unknownCondition && <label><span>人物偏好上限</span><input type="number" value={draft.maximumPreferenceLevel} onChange={(event) => updateRule(index, { maximumPreferenceLevel: Number(event.target.value) })} /></label>}
          {(draft.kind === 'unresolved_care' || draft.kind === 'retention_age') && !draft.unknownCondition && <label><span>最少天数</span><input type="number" min={1} value={draft.minimumAgeDays} onChange={(event) => updateRule(index, { minimumAgeDays: Number(event.target.value) })} /></label>}
        </div>
        {draft.unknownCondition && <details><summary>无法用表单表达的规则，仅作技术查看</summary><pre>{JSON.stringify(draft.unknownCondition, null, 2)}</pre></details>}
        <Button type="button" onClick={() => setRuleDrafts((items) => items.filter((_, i) => i !== index))}>移除规则</Button>
      </article>)}
      <div className="button-row">
        <Button type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule('rating_and_collection_age')])}>低评分且收藏较久</Button>
        <Button type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule('disliked_person')])}>不喜欢的人物</Button>
        <Button type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule('unresolved_care')])}>长期健康问题</Button>
        <Button type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule('retention_age')])}>收藏时间过长</Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.evaluateOffdeck())}>立即评估</Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.detectOffdeckDuplicates())}>检测重复收藏</Button>
      </div>
    </section>
    <section className="source-card">
      <div className="source-card-heading"><div><h2>{openCandidates.length} 条待审阅</h2></div></div>
      {openCandidates.length === 0 ? <p>当前没有开放建议。</p> : openCandidates.map((item) => {
        const group = item.candidate_kind === 'duplicate_group' ? groups.find((value) => value.duplicate_group_id === item.duplicate_group_id) : null;
        return <article className="source-row" key={item.candidate_id}>
          <div>
            <strong>{item.candidate_kind === 'entry' ? titleOf(item.shelf_entry_id) : '重复收藏组'}</strong>
            <small>{item.candidate_kind === 'entry' ? '建议退出' : `${group?.members.length || 0} 个重复项，请选择要退出的收藏`}</small>
            {group && <fieldset><legend>选择需要退出的成员</legend>{group.members.map((member) => <label key={member.shelf_entry_id}><input type="checkbox" checked={(groupSelection[group.duplicate_group_id] || []).includes(member.shelf_entry_id)} onChange={() => toggleMember(group.duplicate_group_id, member.shelf_entry_id)} />{titleOf(member.shelf_entry_id)}</label>)}</fieldset>}
          </div>
          <div className="button-row">
            <Button variant="primary" type="button" onClick={() => void action(() => openCandidate(item))}>进入审阅</Button>
            <Button type="button" onClick={() => void action(() => item.candidate_kind === 'entry' ? helixAdminApi.suppressOffdeckCandidate(item.candidate_id) : helixAdminApi.whitelistOffdeckDuplicate(item.duplicate_group_id!))}>继续保留</Button>
          </div>
        </article>;
      })}
    </section>
    {review && <section className={`source-card ${review.state === 'awaiting_escalation' ? 'danger-stage' : ''}`}>
      <div className="source-card-heading"><div><h2>{labelOf(reviewStateLabels, review.state)}</h2></div></div>
      {review.state === 'awaiting_escalation' && <p role="alert">本次范围较大，请再次核对数量和空间后再确认。</p>}
      {review.scopes.map((scope) => <article key={scope.destructionScopeId}><strong>{titleOf(scope.shelfEntryId)} · {scope.memberCount} 个文件 · {(scope.totalBytes / 1024 / 1024 / 1024).toFixed(2)} GiB</strong>{scope.materials.map((material) => <p key={material.materialKey}>{material.role === 'primary' ? '主媒体' : '附属文件'} · {material.location}</p>)}</article>)}
      <div className="button-row">
        {review.state === 'open' && <Button variant="primary" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckSelection(review.reviewId, { actorId: 'admin' })))}>确认范围</Button>}
        {review.state === 'awaiting_escalation' && <Button variant="danger" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckHighVolume(review.reviewId, { actorId: 'admin' })))}>我已再次核对，确认退出</Button>}
        {review.state === 'selection_confirmed' && <Button variant="danger" type="button" onClick={() => void action(() => helixAdminApi.authorizeOffdeck(review.reviewId))}>授权并开始退出</Button>}
        {['preparing', 'open', 'selection_confirmed', 'awaiting_escalation'].includes(review.state) && <Button type="button" onClick={() => void action(() => helixAdminApi.cancelOffdeckReview(review.reviewId))}>取消审阅</Button>}
      </div>
    </section>}
    <section className="source-card">
      <div className="source-card-heading"><div><h2>{cases.length} 项退出进度</h2></div></div>
      {cases.length === 0 ? <p>尚无退出执行。</p> : cases.map((item) => <article className="source-row" key={item.offdeckCaseId}>
        <div>
          <strong>{titleOf(item.shelfEntryId)}</strong>
          <small>{labelOf(caseStateLabels, item.state)}</small>
          {item.blockedReason && <p>暂停原因：{item.blockedReason}{item.retryAtMs ? ` · ${new Date(item.retryAtMs).toLocaleString()} 后自动恢复` : ''}</p>}
        </div>
        {item.state === 'awaiting_reauthorization' && <Button variant="primary" type="button" onClick={() => void action(async () => {
          const value = await helixAdminApi.createOffdeckReview({ caseId: item.offdeckCaseId, originKind: 'reauthorization', originRef: item.offdeckCaseId, actorId: 'admin', idempotencyKey: `offdeck-reauthorize:${item.offdeckCaseId}:${item.recoveryRevision}` });
          setReview(value); history.replaceState(null, '', `/offdeck?review=${encodeURIComponent(value.reviewId)}`);
        })}>重新授权</Button>}
      </article>)}
    </section>
  </section>;
}
