import { useCallback, useEffect, useMemo, useState } from 'react';
import { helixAdminApi, type CollectionEntry, type JsonValue, type OffdeckCase, type OffdeckCandidate, type OffdeckDuplicateGroup, type OffdeckPolicy, type OffdeckReview, type Shelf } from './api';
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
const addableRuleKinds: RuleKind[] = ['rating_and_collection_age', 'unresolved_care', 'retention_age'];
function formatGiB(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

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
  const [collectionEntries, setCollectionEntries] = useState<CollectionEntry[]>([]);
  const [bulkSelection, setBulkSelection] = useState<string[]>([]);
  const [titles, setTitles] = useState<Record<string, { title: string; occupancyBytes: number | null }>>({});
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
      setCollectionEntries(collection.items);
      setBulkSelection((current) => {
        const activeIds = new Set(collection.items.map((item) => item.shelfEntryId));
        return current.filter((id) => activeIds.has(id));
      });
      setTitles(Object.fromEntries(collection.items.map((item) => [item.shelfEntryId, { title: item.displayIdentity, occupancyBytes: item.occupancyBytes ?? null }])));
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
    }, 3000);
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
  function toggleBulkEntry(shelfEntryId: string) {
    setBulkSelection((current) => {
      const selected = new Set(current);
      selected.has(shelfEntryId) ? selected.delete(shelfEntryId) : selected.add(shelfEntryId);
      return [...selected].sort();
    });
  }
  function titleOf(id: string | null) {
    if (!id) return '未命名收藏';
    return titles[id]?.title || '未命名收藏';
  }
  function sizeOf(id: string | null) {
    if (!id) return null;
    return titles[id]?.occupancyBytes ?? null;
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
  async function openBulkReview() {
    const shelfEntryIds = [...new Set(bulkSelection)].sort();
    if (shelfEntryIds.length === 0) throw new Error('请先选择需要退出的收藏。');
    const idempotencyKey = `offdeck-batch:${shelfEntryIds.join(',')}:${crypto.randomUUID()}`;
    const value = await helixAdminApi.createOffdeckReview({ shelfEntryIds, actorId: 'admin', idempotencyKey });
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
  const activeCases = cases.filter((item) => item.state !== 'completed');
  const shelfOptions = useMemo(() => shelves.map((shelf) => ({ id: shelf.shelfId, name: shelf.name })), [shelves]);
  const selectedBytes = bulkSelection.reduce((total, id) => total + Number(titles[id]?.occupancyBytes || 0), 0);

  if (!loaded && busy) return <LoadingState>正在读取退出收藏…</LoadingState>;
  const nextReviewAction = review?.state === 'open' ? '核对将删除的文件'
    : review?.state === 'awaiting_escalation' ? '再次确认大批量'
    : review?.state === 'selection_confirmed' ? '授权删除'
    : review?.state === 'preparing' ? '正在准备将删除的文件'
    : null;
  return <section className="source-page offdeck-page">
    <PageHeader title="退出收藏" description="先审阅建议，确认后再授权删除。没有授权不会删除文件。" actions={<Button type="button" onClick={() => void load()} disabled={busy}>刷新</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <details className="offdeck-task">
      <summary><strong>退出规则</strong><small>{policyStatus === 'active' ? '自动建议已启用' : '自动建议默认关闭'}</small></summary>
      <p className="page-lede">规则少见，默认关闭。信息不完整时不会产生建议。可从我的收藏直接退出。</p>
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
          {draft.kind === 'disliked_person' && !draft.unknownCondition && <p className="page-lede">人物偏好规则暂不可新增，这条仅保留已有设置。</p>}
          {(draft.kind === 'unresolved_care' || draft.kind === 'retention_age') && !draft.unknownCondition && <label><span>最少天数</span><input type="number" min={1} value={draft.minimumAgeDays} onChange={(event) => updateRule(index, { minimumAgeDays: Number(event.target.value) })} /></label>}
        </div>
        {draft.unknownCondition && <details><summary>技术查看</summary><pre>{JSON.stringify(draft.unknownCondition, null, 2)}</pre></details>}
        <Button type="button" onClick={() => setRuleDrafts((items) => items.filter((_, i) => i !== index))}>去掉这条规则</Button>
      </article>)}
      <div className="button-row">
        {addableRuleKinds.map((kind) => <Button key={kind} type="button" onClick={() => setRuleDrafts((items) => [...items, emptyRule(kind)])}>{ruleKindLabels[kind]}</Button>)}
        <Button variant="primary" type="button" onClick={() => void action(savePolicy)} disabled={busy}>保存规则</Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.evaluateOffdeck())}>现在检查一次<small>评估建议</small></Button>
        <Button type="button" onClick={() => void action(() => helixAdminApi.detectOffdeckDuplicates())}>查重复</Button>
      </div>
    </details>
    <section className="offdeck-task offdeck-bulk-task">
      <div className="source-card-heading"><div><h2>选择退出收藏</h2><p>从当前收藏中建立一次完整审阅；这里只选择范围，不会删除文件。</p></div><span>{bulkSelection.length} / {collectionEntries.length} 部</span></div>
      {collectionEntries.length === 0 ? <div className="source-empty"><strong>当前没有可退出的收藏</strong></div> : <>
        <div className="offdeck-bulk-toolbar">
          <div><strong>已选择 {bulkSelection.length} 部</strong><small>{bulkSelection.length ? ` · ${formatGiB(selectedBytes)}` : ' · 尚未选择'}</small></div>
          <div className="button-row">
            <Button type="button" onClick={() => setBulkSelection(collectionEntries.map((item) => item.shelfEntryId).sort())}>全选当前收藏</Button>
            <Button type="button" onClick={() => setBulkSelection([])} disabled={bulkSelection.length === 0}>清空选择</Button>
          </div>
        </div>
        <fieldset className="offdeck-bulk-list">
          <legend>本次审阅范围</legend>
          {collectionEntries.map((item) => <label key={item.shelfEntryId}>
            <input type="checkbox" checked={bulkSelection.includes(item.shelfEntryId)} onChange={() => toggleBulkEntry(item.shelfEntryId)} />
            <span><strong>{item.displayIdentity}</strong><small>{item.shelfName} · {formatGiB(item.occupancyBytes)}</small></span>
          </label>)}
        </fieldset>
        <div className="button-row offdeck-bulk-action">
          <Button variant="primary" type="button" onClick={() => void action(openBulkReview)} disabled={busy || bulkSelection.length === 0}>审阅已选 {bulkSelection.length} 部</Button>
          <small>大批量或大体积范围会在文件清单核对后要求第二次确认。</small>
        </div>
      </>}
    </section>
    <section className="offdeck-task">
      <div className="source-card-heading"><div><h2>建议退出</h2></div><span>{openCandidates.length} 部</span></div>
      {openCandidates.length === 0 ? <div className="source-empty"><strong>当前没有建议</strong><p>不会自动建议，可从我的收藏直接退出或先保存规则再检查。</p></div> : <div className="offdeck-suggest">{openCandidates.map((item) => {
        const group = item.candidate_kind === 'duplicate_group' ? groups.find((value) => value.duplicate_group_id === item.duplicate_group_id) : null;
        const size = sizeOf(item.shelf_entry_id);
        return <article key={item.candidate_id}>
          <strong>{item.candidate_kind === 'entry' ? titleOf(item.shelf_entry_id) : '重复收藏'}</strong>
          <small>{item.candidate_kind === 'entry' ? `规则建议退出${size ? ` · ${formatGiB(size)}` : ''}` : `${group?.members.length || 0} 个重复项，请选择要退出的收藏`}</small>
          {group && <fieldset><legend>选择需要退出的成员</legend>{group.members.map((member) => <label key={member.shelf_entry_id}><input type="checkbox" checked={(groupSelection[group.duplicate_group_id] || []).includes(member.shelf_entry_id)} onChange={() => toggleMember(group.duplicate_group_id, member.shelf_entry_id)} />{titleOf(member.shelf_entry_id)}</label>)}</fieldset>}
          <div className="button-row">
            <Button variant="primary" type="button" onClick={() => void action(() => openCandidate(item))}>审阅这部</Button>
            <Button type="button" onClick={() => void action(() => item.candidate_kind === 'entry' ? helixAdminApi.suppressOffdeckCandidate(item.candidate_id) : helixAdminApi.whitelistOffdeckDuplicate(item.duplicate_group_id!))}>先留着</Button>
          </div>
        </article>;
      })}</div>}
    </section>
    {review && <section className={`offdeck-task ${review.state === 'awaiting_escalation' ? 'danger-stage' : ''}`}>
      <div className="source-card-heading"><div><h2>当前审阅</h2></div><small>{labelOf(reviewStateLabels, review.state)}</small></div>
      {review.state === 'awaiting_escalation' && <p role="alert">这次数量或体积较大，请再次核对后再授权删除。</p>}
      {review.scopes.map((scope) => <article className="offdeck-scope" key={scope.destructionScopeId}>
        <strong>{titleOf(scope.shelfEntryId)}</strong>
        <small>{scope.memberCount} 个文件 · {formatGiB(scope.totalBytes)}</small>
        {scope.materials.map((material) => <p key={material.materialKey}>{material.role === 'primary' ? '主视频' : '附属文件'} · {material.location}</p>)}
      </article>)}
      <div className="button-row">
        {review.state === 'open' && <Button variant="primary" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckSelection(review.reviewId, { actorId: 'admin' })))}>核对将删除的文件</Button>}
        {review.state === 'awaiting_escalation' && <Button variant="danger" type="button" onClick={() => void action(async () => setReview(await helixAdminApi.confirmOffdeckHighVolume(review.reviewId, { actorId: 'admin' })))}>再次确认大批量</Button>}
        {review.state === 'selection_confirmed' && <Button variant="danger" type="button" onClick={() => void action(() => helixAdminApi.authorizeOffdeck(review.reviewId))}>授权删除</Button>}
        {['preparing', 'open', 'selection_confirmed', 'awaiting_escalation'].includes(review.state) && <Button type="button" onClick={() => void action(() => helixAdminApi.cancelOffdeckReview(review.reviewId))}>取消这次审阅</Button>}
      </div>
      {nextReviewAction && review.state === 'preparing' && <p className="page-lede">{nextReviewAction}</p>}
    </section>}
    <section className="offdeck-task">
      <div className="source-card-heading"><div><h2>正在退出</h2></div><span>{activeCases.length} 部</span></div>
      {activeCases.length === 0 ? <div className="source-empty"><strong>现在没有正在退出的收藏</strong></div> : activeCases.map((item) => <article className="source-row" key={item.offdeckCaseId}>
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
