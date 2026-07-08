import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { systemConfig, subLibraries } from '../api/client';
import type { SystemConfig } from '../api/client';
import Alert from '../components/Alert';
import LoadingSpinner from '../components/LoadingSpinner';
import '../policyPages.css';

type DeleteRule = NonNullable<NonNullable<SystemConfig['deleteGatePolicy']>['rules']>[number];

function defaultRule(index: number): DeleteRule {
  return {
    id: `delete-low-rating-${Date.now()}-${index}`,
    name: '低评分归档媒体',
    enabled: true,
    archivedForDays: 180,
    ratingLte: 2,
  };
}

export default function DisposalPolicyPage() {
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [rules, setRules] = useState<DeleteRule[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['disposal-policy'],
    queryFn: async () => {
      const [cfg, libs] = await Promise.all([
        systemConfig.get(),
        subLibraries.list().catch(() => ({ subLibraries: [] })),
      ]);
      return { cfg, libs: libs.subLibraries || [] };
    },
  });

  useEffect(() => {
    if (!data || initialized) return;
    setEnabled(data.cfg.deleteGatePolicy?.enabled === true);
    setRules(Array.isArray(data.cfg.deleteGatePolicy?.rules) ? data.cfg.deleteGatePolicy!.rules! : []);
    setInitialized(true);
  }, [data, initialized]);

  const saveMut = useMutation({
    mutationFn: () => systemConfig.patch({ deleteGatePolicy: { enabled, rules } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['disposal-policy'] });
      setAlert({ type: 'success', msg: '处置策略已保存。已归档媒体会进入处置候选，而不是 optimize delete。' });
    },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  function patchRule(index: number, patch: Partial<DeleteRule>) {
    setRules((prev) => prev.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="kairoxPolicyPage">
      <div className="kairoxPolicyHeader">
        <div>
          <h2>处置策略</h2>
          <p>定义 archived 后哪些媒体进入处置队列。确认删除后才创建 `targetGate=delete` 任务。</p>
        </div>
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>{saveMut.isPending ? '保存中...' : '保存策略'}</button>
      </div>

      {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}
      {error && <Alert type="error" message={error instanceof Error ? error.message : String(error)} />}

      <section className="kairoxPolicyCard">
        <label className="kairoxPolicySwitch">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>启用归档后处置评估</span>
        </label>
        <p>关闭时，不会生成新的处置候选；已经存在的候选仍可在处置队列里处理。</p>
      </section>

      <section className="kairoxPolicyCard">
        <div className="kairoxPolicySectionHeader">
          <h3>候选规则</h3>
          <button onClick={() => setRules((prev) => [...prev, defaultRule(prev.length + 1)])}>新增规则</button>
        </div>

        {rules.length === 0 ? (
          <div className="kairoxPolicyEmpty">暂无规则。启用处置策略后，需要至少一条规则才会生成候选。</div>
        ) : (
          <div className="kairoxPolicyRuleList">
            {rules.map((rule, index) => (
              <article key={rule.id || index} className="kairoxPolicyRule">
                <div className="kairoxPolicyRuleTitle">
                  <input value={rule.name || ''} onChange={(e) => patchRule(index, { name: e.target.value })} placeholder="规则名称" />
                  <label><input type="checkbox" checked={rule.enabled !== false} onChange={(e) => patchRule(index, { enabled: e.target.checked })} />启用</label>
                  <button onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}>删除</button>
                </div>
                <div className="kairoxPolicyGrid">
                  <label>
                    已归档至少
                    <input type="number" min={0} value={Number(rule.archivedForDays ?? rule.minArchivedDays ?? 0)} onChange={(e) => patchRule(index, { archivedForDays: Number(e.target.value) })} />
                    天
                  </label>
                  <label>
                    评分不高于
                    <input type="number" min={1} max={5} value={Number(rule.ratingLte ?? rule.maxRating ?? 2)} onChange={(e) => patchRule(index, { ratingLte: Number(e.target.value) })} />
                    星
                  </label>
                  <label>
                    媒体库
                    <select value={rule.subLibraryId || ''} onChange={(e) => patchRule(index, { subLibraryId: e.target.value || undefined })}>
                      <option value="">全部</option>
                      {data?.libs.map((lib) => <option key={lib.uuid} value={lib.uuid}>{lib.name}</option>)}
                    </select>
                  </label>
                  <label>
                    媒体类型
                    <select value={rule.mediaType || ''} onChange={(e) => patchRule(index, { mediaType: e.target.value || undefined })}>
                      <option value="">全部</option>
                      <option value="movie">电影</option>
                      <option value="episode">剧集</option>
                      <option value="adult">成人库</option>
                    </select>
                  </label>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
