import { useEffect, useMemo, useState } from 'react';
import { canonicalDigest, helixAdminApi, type JsonValue, type MaterialField, type RoutingExpression, type RoutingPolicy, type Shelf } from './api';
import { newOpaqueId } from './id';

type DraftTarget = { shelfId: string; rank: number; matchExpression: RoutingExpression };
type FactKind = 'content_profile' | 'structure_kind' | 'material_field' | 'release_year' | 'region' | 'genre' | 'resolved_provider_identity';
type Operator = 'eq' | 'one_of' | 'gte' | 'lte' | 'exists';

const FACTS: { value: FactKind; label: string }[] = [
  { value: 'release_year', label: '上映年份' }, { value: 'region', label: '地区' }, { value: 'genre', label: '类型' },
  { value: 'resolved_provider_identity', label: 'TMDB身份' }, { value: 'content_profile', label: '媒体Profile' },
  { value: 'structure_kind', label: '结构类型' }, { value: 'material_field', label: '文件来源' },
];

function operators(factKind: FactKind): Operator[] {
  return factKind === 'release_year' ? ['eq', 'one_of', 'gte', 'lte', 'exists'] : ['eq', 'one_of', 'exists'];
}
function defaultValue(factKind: FactKind, operator: Operator): JsonValue {
  if (operator === 'exists') return true;
  if (factKind === 'release_year') return operator === 'one_of' ? [2000] : 2000;
  if (factKind === 'region' || factKind === 'genre') return [''];
  if (factKind === 'resolved_provider_identity') {
    const identity = { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: '', identityRevision: 1, identityDigest: '' };
    return operator === 'one_of' ? [identity] : identity;
  }
  return operator === 'one_of' ? [''] : '';
}
function predicate(factKind: FactKind = 'release_year', operator: Operator = 'lte'): RoutingExpression {
  return { nodeKind: 'predicate', factKind, operator, expectedValue: defaultValue(factKind, operator) };
}
function expressionFor(kind: RoutingExpression['nodeKind']): RoutingExpression {
  if (kind === 'always') return { nodeKind: 'always' };
  if (kind === 'predicate') return predicate();
  if (kind === 'not') return { nodeKind: 'not', child: predicate() };
  return { nodeKind: kind, children: [predicate()] };
}
function defaultSorting(shelves: Shelf[]): DraftTarget[] {
  const active = shelves.filter((item) => item.status === 'active');
  return [
    active[0] && { shelfId: active[0].shelfId, rank: 1, matchExpression: predicate('release_year', 'lte') },
    active[1] && { shelfId: active[1].shelfId, rank: 2, matchExpression: { ...predicate('release_year', 'gte'), expectedValue: 2020 } },
    active[2] && { shelfId: active[2].shelfId, rank: 3, matchExpression: { nodeKind: 'always' } },
  ].filter(Boolean) as DraftTarget[];
}
function csv(value: JsonValue): string {
  if (!Array.isArray(value)) return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return value.map((item) => typeof item === 'object' && item !== null && !Array.isArray(item) ? String(item.providerKey || '') : String(item)).join(', ');
}
function providerIdentity(providerKey: string): Record<string, JsonValue> {
  return { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: providerKey.trim(), identityRevision: 1, identityDigest: '' };
}

async function normalizeExpression(expression: RoutingExpression): Promise<RoutingExpression> {
  if (expression.nodeKind === 'always') return expression;
  if (expression.nodeKind === 'not') return { nodeKind: 'not', child: await normalizeExpression(expression.child) };
  if (expression.nodeKind === 'all' || expression.nodeKind === 'any') {
    const children = await Promise.all(expression.children.map(normalizeExpression));
    const ranked = await Promise.all(children.map(async (child) => ({ child, digest: await canonicalDigest(child as JsonValue) })));
    ranked.sort((left, right) => left.digest.localeCompare(right.digest));
    return { nodeKind: expression.nodeKind, children: ranked.map((item) => item.child) };
  }
  const predicateExpression = expression as Extract<RoutingExpression, { nodeKind: 'predicate' }>;
  if (predicateExpression.factKind !== 'resolved_provider_identity' || predicateExpression.operator === 'exists') return predicateExpression;
  const values = predicateExpression.operator === 'one_of' ? predicateExpression.expectedValue as Record<string, JsonValue>[] : [predicateExpression.expectedValue as Record<string, JsonValue>];
  const normalized = await Promise.all(values.map(async (value) => {
    const body = { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: String(value.providerKey || '').trim(), identityRevision: 1 };
    return { ...body, identityDigest: await canonicalDigest(body) };
  }));
  return { ...predicateExpression, expectedValue: predicateExpression.operator === 'one_of' ? normalized : normalized[0] };
}

function ExpectedValue({ expression, onChange }: { expression: Extract<RoutingExpression, { nodeKind: 'predicate' }>; onChange: (value: JsonValue) => void }) {
  const factKind = expression.factKind as FactKind;
  if (expression.operator === 'exists') return <select aria-label="是否存在" value={String(expression.expectedValue)} onChange={(event) => onChange(event.target.value === 'true')}><option value="true">存在</option><option value="false">不存在</option></select>;
  if (factKind === 'release_year' && expression.operator !== 'one_of') return <input aria-label="年份" type="number" min={1870} max={3000} value={Number(expression.expectedValue)} onChange={(event) => onChange(Number(event.target.value))} />;
  if (factKind === 'resolved_provider_identity') return <input aria-label="TMDB ID" value={csv(expression.expectedValue)} placeholder={expression.operator === 'one_of' ? '多个TMDB ID，用逗号分隔' : 'TMDB ID'} onChange={(event) => {
    const values = event.target.value.split(',').map((item) => item.trim()).filter(Boolean).map(providerIdentity);
    onChange(expression.operator === 'one_of' ? values : (values[0] || providerIdentity('')));
  }} />;
  return <input aria-label="匹配值" value={csv(expression.expectedValue)} placeholder={expression.operator === 'one_of' || factKind === 'region' || factKind === 'genre' ? '多个值，用逗号分隔' : '匹配值'} onChange={(event) => {
    const values = event.target.value.split(',').map((item) => item.trim());
    if (factKind === 'release_year') onChange(values.filter(Boolean).map(Number));
    else if (expression.operator === 'one_of' || factKind === 'region' || factKind === 'genre') onChange(values.filter(Boolean));
    else onChange(event.target.value);
  }} />;
}

function ExpressionEditor({ expression, depth, onChange }: { expression: RoutingExpression; depth: number; onChange: (value: RoutingExpression) => void }) {
  const kinds: RoutingExpression['nodeKind'][] = depth >= 4 ? ['always', 'predicate'] : ['always', 'predicate', 'all', 'any', 'not'];
  return <div className={`routing-expression depth-${depth}`}>
    <select aria-label="规则类型" value={expression.nodeKind} onChange={(event) => onChange(expressionFor(event.target.value as RoutingExpression['nodeKind']))}>
      {kinds.map((kind) => <option key={kind} value={kind}>{({ always: '始终匹配', predicate: '条件', all: '全部满足', any: '任一满足', not: '不满足' })[kind]}</option>)}
    </select>
    {expression.nodeKind === 'predicate' && <>
      <select aria-label="事实类型" value={expression.factKind} onChange={(event) => {
        const factKind = event.target.value as FactKind; const operator = operators(factKind)[0]; onChange(predicate(factKind, operator));
      }}>{FACTS.map((fact) => <option key={fact.value} value={fact.value}>{fact.label}</option>)}</select>
      <select aria-label="比较方式" value={expression.operator} onChange={(event) => {
        const operator = event.target.value as Operator; onChange({ ...expression, operator, expectedValue: defaultValue(expression.factKind as FactKind, operator) });
      }}>{operators(expression.factKind as FactKind).map((operator) => <option key={operator} value={operator}>{({ eq: '等于', one_of: '属于任一', gte: '大于等于', lte: '小于等于', exists: '是否存在' })[operator]}</option>)}</select>
      <ExpectedValue expression={expression} onChange={(expectedValue) => onChange({ ...expression, expectedValue })} />
    </>}
    {expression.nodeKind === 'not' && <ExpressionEditor expression={expression.child} depth={depth + 1} onChange={(child) => onChange({ nodeKind: 'not', child })} />}
    {(expression.nodeKind === 'all' || expression.nodeKind === 'any') && <div className="routing-expression-children">
      {expression.children.map((child, index) => <div className="routing-expression-child" key={index}>
        <ExpressionEditor expression={child} depth={depth + 1} onChange={(value) => onChange({ ...expression, children: expression.children.map((item, ordinal) => ordinal === index ? value : item) })} />
        {expression.children.length > 1 && <button type="button" className="btn btn-text danger" onClick={() => onChange({ ...expression, children: expression.children.filter((_item, ordinal) => ordinal !== index) })}>移除条件</button>}
      </div>)}
      <button type="button" className="btn btn-text" onClick={() => onChange({ ...expression, children: [...expression.children, predicate()] })}>添加条件</button>
    </div>}
  </div>;
}

export default function RoutingPolicyPanel({ field, shelves }: { field: MaterialField; shelves: Shelf[] }) {
  const activeShelves = useMemo(() => shelves.filter((item) => item.status === 'active'), [shelves]);
  const [current, setCurrent] = useState<RoutingPolicy | null>(null);
  const [mode, setMode] = useState<'direct' | 'sorting'>('direct');
  const [directShelfId, setDirectShelfId] = useState('');
  const [sortingTargets, setSortingTargets] = useState<DraftTarget[]>([]);
  const [factsJson, setFactsJson] = useState('[{"factKind":"release_year","year":2014}]');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void helixAdminApi.getRoutingPolicy(field.fieldId).then(({ policy }) => {
      setCurrent(policy); setMode(policy?.mode || 'direct');
      if (policy?.mode === 'direct') setDirectShelfId(policy.targets[0]?.shelfId || activeShelves[0]?.shelfId || '');
      else if (policy) setSortingTargets(policy.targets.map(({ shelfId, rank, matchExpression }) => ({ shelfId, rank, matchExpression })));
      else { setDirectShelfId(activeShelves[0]?.shelfId || ''); setSortingTargets(defaultSorting(activeShelves)); }
    }).catch((cause) => setError(cause instanceof Error ? cause.message : '分拣策略读取失败。'));
  }, [activeShelves, field.fieldId]);

  async function draft() {
    const targets = mode === 'direct'
      ? [{ shelfId: directShelfId, rank: 1, matchExpression: { nodeKind: 'always' } as RoutingExpression }]
      : await Promise.all(sortingTargets.map(async (target, index) => ({ shelfId: target.shelfId, rank: index + 1, matchExpression: await normalizeExpression(target.matchExpression) })));
    return { routingPolicyId: current?.routingPolicyId || `movie-routing-${field.fieldId}`, mode, targets };
  }
  function replaceTarget(index: number, value: DraftTarget) { setSortingTargets((items) => items.map((item, ordinal) => ordinal === index ? value : item)); }
  function moveTarget(index: number, delta: number) {
    setSortingTargets((items) => { const next = [...items]; const destination = index + delta; if (destination < 0 || destination >= next.length) return items;
      [next[index], next[destination]] = [next[destination], next[index]]; return next.map((item, ordinal) => ({ ...item, rank: ordinal + 1 })); });
  }
  async function preview() {
    setError(''); setMessage('');
    try {
      const result = await helixAdminApi.previewRoutingPolicy(field.fieldId, { idempotencyKey: newOpaqueId(), fieldId: field.fieldId,
        policy: await draft(), facts: JSON.parse(factsJson) as JsonValue });
      setMessage(result.result === 'resolved' ? `预览：将进入 ${activeShelves.find((item) => item.shelfId === result.targetShelfId)?.name || '选定收藏架'}` : '预览：条件未能匹配到收藏架');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分拣预览失败。'); }
  }
  async function publish() {
    setError(''); setMessage('');
    try {
      const result = await helixAdminApi.publishRoutingPolicy(field.fieldId, { idempotencyKey: newOpaqueId(), fieldId: field.fieldId,
        expectedPolicyId: current?.routingPolicyId || null, expectedRevision: current?.revision || 0, policy: await draft() });
      setCurrent(result.policy); setMessage(`分拣策略已发布，后台会按新规则重新分配该来源中尚未完成的电影。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分拣策略发布失败。'); }
  }

  return <details className="routing-policy-panel"><summary>收藏架分拣策略</summary>
    <div className="routing-policy-body">
      <div className="routing-policy-head"><strong>{current ? (current.mode === 'direct' ? '全部进入一座收藏架' : '按条件分拣') : '尚未发布'}</strong><span>只决定进哪座收藏架，不会开始整理或移动文件。</span></div>
      <label><span>模式</span><select value={mode} onChange={(event) => setMode(event.target.value as 'direct' | 'sorting')}><option value="direct">全部进入一座收藏架</option><option value="sorting">按优先级判断</option></select></label>
      {mode === 'direct' ? <label><span>目标收藏架</span><select value={directShelfId} onChange={(event) => setDirectShelfId(event.target.value)}>{activeShelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select></label> : <>
        <div className="routing-rule-list">{sortingTargets.map((target, index) => <section className="routing-rule" key={`${target.shelfId}-${index}`}>
          <header><span className="routing-rank">优先级 {index + 1}</span><div><button type="button" className="btn btn-text" disabled={index === 0} onClick={() => moveTarget(index, -1)}>上移</button><button type="button" className="btn btn-text" disabled={index === sortingTargets.length - 1} onClick={() => moveTarget(index, 1)}>下移</button><button type="button" className="btn btn-text danger" disabled={sortingTargets.length === 1} onClick={() => setSortingTargets((items) => items.filter((_item, ordinal) => ordinal !== index))}>删除</button></div></header>
          <label><span>目标收藏架</span><select value={target.shelfId} onChange={(event) => replaceTarget(index, { ...target, shelfId: event.target.value })}>{activeShelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select></label>
          <ExpressionEditor expression={target.matchExpression} depth={1} onChange={(matchExpression) => replaceTarget(index, { ...target, matchExpression })} />
        </section>)}</div>
        <button type="button" className="btn btn-secondary routing-add-rule" disabled={sortingTargets.length >= 64 || activeShelves.length === 0} onClick={() => setSortingTargets((items) => [...items, { shelfId: activeShelves.find((shelf) => !items.some((item) => item.shelfId === shelf.shelfId))?.shelfId || activeShelves[0].shelfId, rank: items.length + 1, matchExpression: { nodeKind: 'always' } }])}>添加分拣规则</button>
        <details><summary>预览用的测试条件</summary><textarea value={factsJson} onChange={(event) => setFactsJson(event.target.value)} rows={4} spellCheck={false} /></details>
      </>}
      <div className="routing-policy-actions"><button type="button" className="btn btn-secondary" onClick={() => void preview()}>预览</button><button type="button" className="btn btn-primary" onClick={() => void publish()}>发布策略</button></div>
      {message && <p className="routing-message" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </details>;
}
