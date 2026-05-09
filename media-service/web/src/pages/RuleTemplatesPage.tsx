import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ruleTemplates } from '../api/client';
import type { RuleTemplate, Rule, RuleCondition, RuleGroup } from '../types';
import Modal from '../components/Modal';
import Alert from '../components/Alert';

// ── constants ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  keep: '保留', delete: '删除', transcode: '转码', upgrade: '洗版',
};

const CONNECTOR_LABELS: Record<string, string> = {
  and: '且 (AND)', or: '或 (OR)',
};

const FIELDS: { value: string; label: string; type: 'number' | 'string' | 'boolean' | 'null' }[] = [
  { value: 'doubanRating', label: '豆瓣评分', type: 'number' },
  { value: 'userRating', label: '用户评分', type: 'number' },
  { value: 'equivalentBitrate', label: '码率 (Mbps)', type: 'number' },
  { value: 'bucket', label: '分辨率分类', type: 'string' },
  { value: 'codec', label: '编码', type: 'string' },
  { value: 'isDiscLike', label: '是否原盘', type: 'boolean' },
  { value: 'watched', label: '已观看', type: 'boolean' },
  { value: 'duration', label: '时长 (秒)', type: 'number' },
  { value: 'type', label: '媒体类型', type: 'string' },
  { value: 'resolution', label: '分辨率 (WxH)', type: 'string' },
  { value: 'audioCodecs', label: '音频编码', type: 'string' },
];

const NUMERIC_OPS = ['>', '>=', '<', '<=', '='];
const STRING_OPS = ['=', 'in', 'not in', 'overlap'];
const BOOLEAN_OPS = ['='];

function opsForField(fieldName: string): string[] {
  const f = FIELDS.find((x) => x.value === fieldName);
  if (!f) return NUMERIC_OPS;
  if (f.type === 'number') return NUMERIC_OPS;
  if (f.type === 'string') return STRING_OPS;
  if (f.type === 'boolean') return BOOLEAN_OPS;
  return NUMERIC_OPS;
}

function emptyCondition(): RuleCondition {
  return { field: 'doubanRating', op: '>=', value: 3 };
}

function emptyGroup(): RuleGroup {
  return { connector: 'or', conditions: [emptyCondition()] };
}

function defaultRule(priority: number): Rule {
  return {
    priority,
    groupsConnector: 'and',
    groups: [emptyGroup()],
    action: 'keep',
    actionParams: {},
    reason: '',
  };
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: { padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 700, color: '#1a1a2e', margin: 0 },
  btn: { padding: '8px 18px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 },
  btnPrimary: { background: '#1a1a2e', color: '#fff' },
  btnOutline: { background: '#fff', color: '#1a1a2e', border: '1px solid #1a1a2e' },
  btnDanger: { background: '#e74c3c', color: '#fff' },
  btnSmall: { padding: '4px 10px', fontSize: 12 },
  card: { background: '#fff', borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: 16, overflow: 'hidden' },
  cardHeader: { padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' },
  cardName: { fontSize: 16, fontWeight: 700, color: '#1a1a2e' },
  cardDesc: { fontSize: 13, color: '#666', marginTop: 2 },
  cardMeta: { fontSize: 12, color: '#999' },
  cardBody: { padding: '0 20px 20px', borderTop: '1px solid #eee' },
  ruleBlock: { background: '#f8f9fb', borderRadius: 8, padding: 16, marginBottom: 12, position: 'relative' },
  ruleHeader: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 },
  rulePriority: { fontSize: 12, color: '#999', fontWeight: 600 },
  groupBox: { background: '#fff', borderRadius: 6, padding: 10, marginBottom: 8, border: '1px solid #e8e8e8' },
  groupLabel: { fontSize: 11, color: '#999', marginBottom: 6, textTransform: 'uppercase' as const, fontWeight: 600 },
  condRow: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 },
  select: { padding: '5px 8px', borderRadius: 4, border: '1px solid #d0d0d0', fontSize: 13, background: '#fff' },
  input: { padding: '5px 8px', borderRadius: 4, border: '1px solid #d0d0d0', fontSize: 13, width: 80 },
  inputWide: { padding: '5px 8px', borderRadius: 4, border: '1px solid #d0d0d0', fontSize: 13, width: 200 },
  paramRow: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 },
  paramLabel: { fontSize: 12, color: '#666', minWidth: 80 },
  addBtn: { padding: '6px 12px', borderRadius: 6, border: '1px dashed #999', background: 'transparent', cursor: 'pointer', fontSize: 12, color: '#666' },
  deleteBtn: { position: 'absolute' as const, top: 8, right: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#e74c3c' },
  empty: { textAlign: 'center' as const, padding: 40, color: '#999' },
  label: { fontSize: 12, fontWeight: 600, color: '#666', marginBottom: 4 },
};

// ── Create Template Modal ──────────────────────────────────────────────────────

function CreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    if (open) { setId(''); setName(''); setDesc(''); setErr(''); }
  }, [open]);

  const create = useMutation({
    mutationFn: () => ruleTemplates.create({ id, name, description: desc || undefined, rules: [] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ruleTemplates'] }); onClose(); },
    onError: (e: Error) => setErr(e.message),
  });

  if (!open) return null;
  return (
    <Modal open={open} title="新建策略模板" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 360 }}>
        {err && <Alert type="error" message={err} onClose={() => setErr('')} />}
        <div>
          <div style={s.label}>模板 ID（英文标识）</div>
          <input style={s.inputWide} value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. tv-show" />
        </div>
        <div>
          <div style={s.label}>模板名称</div>
          <input style={s.inputWide} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 剧集专用" />
        </div>
        <div>
          <div style={s.label}>定性描述</div>
          <input style={s.inputWide} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="针对剧集媒体库的保守策略" />
        </div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button style={{ ...s.btn, ...s.btnOutline }} onClick={onClose}>取消</button>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => create.mutate()} disabled={!id || !name || create.isPending}>
            {create.isPending ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Rule Editor ────────────────────────────────────────────────────────────────

function RuleEditor({ rule, onChange, onDelete }: {
  rule: Rule;
  onChange: (r: Rule) => void;
  onDelete: () => void;
}) {
  const update = (patch: Partial<Rule>) => onChange({ ...rule, ...patch });

  function updateCondition(groupIdx: number, condIdx: number, patch: Partial<RuleCondition>) {
    const groups = rule.groups.map((g, gi) => {
      if (gi !== groupIdx) return g;
      return {
        ...g,
        conditions: g.conditions.map((c, ci) =>
          ci === condIdx ? { ...c, ...patch, op: patch.op ?? c.op } as RuleCondition : c
        ),
      };
    });
    update({ groups });
  }

  function updateGroup(groupIdx: number, patch: Partial<RuleGroup>) {
    const groups = rule.groups.map((g, gi) =>
      gi === groupIdx ? { ...g, ...patch } : g
    );
    update({ groups });
  }

  function addCondition(groupIdx: number) {
    const groups = rule.groups.map((g, gi) =>
      gi === groupIdx ? { ...g, conditions: [...g.conditions, emptyCondition()] } : g
    );
    update({ groups });
  }

  function removeCondition(groupIdx: number, condIdx: number) {
    const groups = rule.groups.map((g, gi) => {
      if (gi !== groupIdx) return g;
      const next = g.conditions.filter((_, ci) => ci !== condIdx);
      if (next.length === 0) return g;
      return { ...g, conditions: next };
    });
    update({ groups });
  }

  function addGroup() {
    update({ groups: [...rule.groups, emptyGroup()] });
  }

  function removeGroup(groupIdx: number) {
    const next = rule.groups.filter((_, gi) => gi !== groupIdx);
    if (next.length === 0) return;
    update({ groups: next });
  }

  function setAction(action: Rule['action']) {
    const params: Rule['actionParams'] = {};
    if (action === 'transcode') params.targetBitrate = rule.actionParams?.targetBitrate ?? 8;
    if (action === 'transcode' || action === 'upgrade') params.targetCodec = rule.actionParams?.targetCodec ?? 'h265';
    if (action === 'upgrade') {
      params.maxSizeGB = rule.actionParams?.maxSizeGB;
      params.seedPreferences = rule.actionParams?.seedPreferences ?? { codecPreference: [], resolutionPreference: [], audioPreference: [], sitePreference: [], preferCNSub: false };
    }
    update({ action, actionParams: params });
  }

  return (
    <div style={s.ruleBlock}>
      <button style={s.deleteBtn} onClick={onDelete} title="删除规则">✕</button>
      <div style={s.ruleHeader}>
        <span style={s.rulePriority}>优先级</span>
        <select style={s.select} value={rule.priority} onChange={(e) => update({ priority: Number(e.target.value) })}>
          {[1,2,3,4,5,6,7,8,9,10].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <span style={{ fontSize: 12, color: '#666' }}>组间:</span>
        <select style={s.select} value={rule.groupsConnector} onChange={(e) => update({ groupsConnector: e.target.value as 'and' | 'or' })}>
          {Object.entries(CONNECTOR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {rule.groups.map((group, gi) => (
        <div key={gi} style={s.groupBox}>
          <div style={s.groupLabel}>
            条件组 {gi + 1}
            <select style={{ ...s.select, marginLeft: 8 }} value={group.connector} onChange={(e) => updateGroup(gi, { connector: e.target.value as 'and' | 'or' })}>
              {Object.entries(CONNECTOR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {rule.groups.length > 1 && (
              <button style={{ ...s.btn, ...s.btnSmall, marginLeft: 8, fontSize: 11, color: '#e74c3c', border: 'none', background: 'none' }} onClick={() => removeGroup(gi)}>移除组</button>
            )}
          </div>
          {group.conditions.map((cond, ci) => (
            <div key={ci} style={s.condRow}>
              <select style={s.select} value={cond.field} onChange={(e) => {
                const newField = e.target.value;
                const newF = FIELDS.find((x) => x.value === newField);
                const ops = opsForField(newField);
                const defaultVal = newF?.type === 'boolean' ? true : newF?.type === 'number' ? null : '';
                updateCondition(gi, ci, { field: newField, op: ops[0] as RuleCondition['op'], value: defaultVal });
              }}>
                {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <select style={s.select} value={cond.op} onChange={(e) => updateCondition(gi, ci, { op: e.target.value as RuleCondition['op'] })}>
                {opsForField(cond.field).map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
              <ConditionValue cond={cond} onChange={(v) => updateCondition(gi, ci, { value: v })} />
              {group.conditions.length > 1 && (
                <button style={{ ...s.btn, ...s.btnSmall, fontSize: 11, color: '#e74c3c', border: 'none', background: 'none' }} onClick={() => removeCondition(gi, ci)}>−</button>
              )}
            </div>
          ))}
          <button style={s.addBtn} onClick={() => addCondition(gi)}>+ 添加条件</button>
        </div>
      ))}
      <button style={s.addBtn} onClick={addGroup}>+ 添加条件组</button>

      {/* Action */}
      <div style={{ marginTop: 12, borderTop: '1px solid #e8e8e8', paddingTop: 10 }}>
        <div style={s.paramRow}>
          <span style={s.paramLabel}>动作:</span>
          <select style={s.select} value={rule.action} onChange={(e) => setAction(e.target.value as Rule['action'])}>
            {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {rule.action === 'transcode' && (
          <>
            <div style={s.paramRow}>
              <span style={s.paramLabel}>目标码率 (Mbps)</span>
              <input style={s.input} type="number" value={rule.actionParams?.targetBitrate ?? ''} onChange={(e) => update({ actionParams: { ...rule.actionParams, targetBitrate: Number(e.target.value) || undefined } })} />
            </div>
            <div style={s.paramRow}>
              <span style={s.paramLabel}>输出编码</span>
              <select style={s.select} value={rule.actionParams?.targetCodec ?? 'h265'} onChange={(e) => update({ actionParams: { ...rule.actionParams, targetCodec: e.target.value } })}>
                <option value="h265">h265</option>
                <option value="av1">av1</option>
              </select>
            </div>
          </>
        )}

        {rule.action === 'upgrade' && (
          <div style={s.paramRow}>
            <span style={s.paramLabel}>目标码率 (Mbps)</span>
            <input style={s.input} type="number" value={rule.actionParams?.targetBitrate ?? ''} onChange={(e) => update({ actionParams: { ...rule.actionParams, targetBitrate: Number(e.target.value) || undefined } })} />
          </div>
        )}

        {rule.action === 'upgrade' && (
          <>
            <div style={s.paramRow}>
              <span style={s.paramLabel}>种子体积上限 (GB)</span>
              <input style={s.input} type="number" value={rule.actionParams?.maxSizeGB ?? ''} onChange={(e) => update({ actionParams: { ...rule.actionParams, maxSizeGB: Number(e.target.value) || undefined } })} />
            </div>

            {/* Seed preferences: checkboxes */}
            <div style={{ marginTop: 8, padding: '10px 12px', background: '#f8f9fb', borderRadius: 6 }}>
              <div style={{ ...s.groupLabel, marginBottom: 8 }}>种子筛选（留空 = 不限制）</div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>编码格式</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {(['h265','h264','dv'] as const).map((opt) => {
                    const arr = rule.actionParams?.seedPreferences?.codecPreference || [];
                    const checked = arr.includes(opt);
                    return (
                      <label key={opt} style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const next = checked ? arr.filter((x: string) => x !== opt) : [...arr, opt];
                          update({ actionParams: { ...rule.actionParams, seedPreferences: { ...(rule.actionParams?.seedPreferences || {}), codecPreference: next } } });
                        }} />
                        {{ h265: 'H.265', h264: 'H.264', dv: 'Dolby Vision' }[opt]}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>分辨率</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['4K','1080p','720p'].map((opt) => {
                    const arr = rule.actionParams?.seedPreferences?.resolutionPreference || [];
                    const checked = arr.includes(opt);
                    return (
                      <label key={opt} style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const next = checked ? arr.filter((x: string) => x !== opt) : [...arr, opt];
                          update({ actionParams: { ...rule.actionParams, seedPreferences: { ...(rule.actionParams?.seedPreferences || {}), resolutionPreference: next } } });
                        }} />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#666', marginBottom: 4, display: 'block' }}>音轨</span>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {['DTS','TrueHD','Atmos','AC3','AAC','FLAC'].map((opt) => {
                    const arr = rule.actionParams?.seedPreferences?.audioPreference || [];
                    const checked = arr.includes(opt);
                    return (
                      <label key={opt} style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const next = checked ? arr.filter((x: string) => x !== opt) : [...arr, opt];
                          update({ actionParams: { ...rule.actionParams, seedPreferences: { ...(rule.actionParams?.seedPreferences || {}), audioPreference: next } } });
                        }} />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              <label style={{ fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={!!rule.actionParams?.seedPreferences?.preferCNSub} onChange={(e) => update({ actionParams: { ...rule.actionParams, seedPreferences: { ...(rule.actionParams?.seedPreferences || {}), preferCNSub: e.target.checked } } })} />
                仅含中文字幕的种子
              </label>
            </div>
          </>
        )}

        <div style={s.paramRow}>
          <span style={s.paramLabel}>说明文字</span>
          <input style={s.inputWide} value={rule.reason} onChange={(e) => update({ reason: e.target.value })} />
        </div>
      </div>
    </div>
  );
}

// ── Condition Value Input ──────────────────────────────────────────────────────

function ConditionValue({ cond, onChange }: { cond: RuleCondition; onChange: (v: RuleCondition['value']) => void }) {
  const f = FIELDS.find((x) => x.value === cond.field);

  // in / not in: comma-separated text input
  if (cond.op === 'in' || cond.op === 'not in' || cond.op === 'overlap') {
    const arr = Array.isArray(cond.value) ? cond.value : [];
    const str = arr.map(String).join(', ');
    return (
      <input style={s.inputWide} value={str} placeholder="输入多个值，逗号分隔"
        onChange={(e) => {
          const raw = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
          if (f && f.type === 'number') {
            onChange(raw.map((x) => (isNaN(Number(x)) ? x : Number(x))));
          } else {
            onChange(raw);
          }
        }}
      />
    );
  }

  // Boolean field: dropdown
  if (f && f.type === 'boolean') {
    return (
      <select style={s.select} value={String(cond.value)} onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  const isNull = cond.value === null || cond.value === undefined;

  // Numeric field with = operator: dropdown for common values (including null)
  if (f && f.type === 'number' && cond.op === '=') {
    // Rating fields get explicit 1-5★ options
    if (cond.field === 'doubanRating' || cond.field === 'userRating') {
      const options = [
        { label: 'null（空）', value: null },
        { label: '1 ★', value: 1 }, { label: '2 ★', value: 2 }, { label: '3 ★', value: 3 },
        { label: '4 ★', value: 4 }, { label: '5 ★', value: 5 },
      ];
      const currentVal = isNull ? 'null' : String(cond.value);
      return (
        <select style={s.select} value={currentVal} onChange={(e) => {
          const v = e.target.value;
          if (v === 'null') onChange(null);
          else onChange(Number(v));
        }}>
          {options.map((o) => (
            <option key={String(o.value)} value={o.value === null ? 'null' : String(o.value)}>{o.label}</option>
          ))}
        </select>
      );
    }
    // Other numeric fields: fall through to regular number input
  }

  // Null value with >, <, >=, <= etc: show as "null" with button to set a value
  if (isNull) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: '#999', background: '#f0f0f0', padding: '4px 8px', borderRadius: 4 }}>null</span>
        <button style={{ ...s.btn, ...s.btnSmall, fontSize: 10, padding: '2px 6px' }} onClick={() => onChange(f && f.type === 'number' ? 0 : '')}>
          设置值
        </button>
      </div>
    );
  }

  // Regular value input
  return (
    <input style={s.input} type={f && f.type === 'number' ? 'number' : 'text'}
      value={typeof cond.value === 'number' || typeof cond.value === 'string' ? String(cond.value) : ''}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') { onChange(f && f.type === 'number' ? 0 : ''); return; }
        if (f && f.type === 'number') onChange(Number(v));
        else onChange(v);
      }}
    />
  );
}

// ── Template Card ──────────────────────────────────────────────────────────────

function TemplateCard({ tpl }: { tpl: RuleTemplate }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Convert editor objects back to API format (arrays for conditions)
  function denormalizeRules(editorRules: Rule[]): any[] {
    return editorRules.map((r) => ({
      ...r,
      groups: r.groups.map((g) => ({
        connector: g.connector,
        conditions: g.conditions.map((c) => [c.field, c.op, c.value]),
      })),
    }));
  }

  const save = useMutation({
    mutationFn: () => ruleTemplates.update(tpl.id, { name, description: desc, rules: denormalizeRules(rules) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ruleTemplates'] }); setAlert({ type: 'success', msg: '模板已保存，策略引擎将在下个周期自动应用' }); setEditing(false); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  const del = useMutation({
    mutationFn: () => ruleTemplates.remove(tpl.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['ruleTemplates'] }); },
    onError: (e: Error) => setAlert({ type: 'error', msg: e.message }),
  });

  // Normalize: API returns conditions as [field, op, value] arrays,
  // but the editor uses { field, op, value } objects.
  // Also handles old format (innerConnector + array-of-arrays groups)
  // and new format (groupsConnector + array-of-objects groups).
  function normalizeRule(rule: any): Rule {
    function normalizeCondition(c: any): RuleCondition {
      if (Array.isArray(c)) return { field: c[0], op: c[1], value: c[2] };
      return c as RuleCondition;
    }
    function normalizeGroup(g: any): RuleGroup {
      if (Array.isArray(g)) {
        // Old format: group was an array of conditions
        return { connector: rule.innerConnector || 'or', conditions: g.map(normalizeCondition) };
      }
      return {
        connector: g.connector || 'and',
        conditions: (g.conditions || []).map(normalizeCondition),
      };
    }
    const groups = (rule.groups || []).map(normalizeGroup);
    return {
      priority: typeof rule.priority === 'number' ? rule.priority : 1,
      groupsConnector: rule.groupsConnector || 'and',
      groups,
      action: rule.action || 'keep',
      actionParams: rule.actionParams || {},
      reason: rule.reason || '',
    };
  }

  const startEdit = () => {
    setName(tpl.name);
    setDesc(tpl.description || '');
    setRules((tpl.rules || []).map(normalizeRule));
    setEditing(true);
    setExpanded(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    if (rules.length === 0 && (tpl.rules || []).length === 0) setExpanded(false);
  };

  const addRule = () => {
    const maxP = rules.reduce((m, r) => Math.max(m, r.priority), 0);
    setRules([...rules, defaultRule(maxP + 1)]);
  };

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.cardHeader} onClick={() => { if (!editing) setExpanded(!expanded); }}>
        <div>
          <div style={s.cardName}>{tpl.name}</div>
          <div style={s.cardDesc}>{tpl.description || '无描述'}</div>
          <div style={s.cardMeta}>{(tpl.rules || []).length} 条规则</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && tpl.tag?.type !== 'default' && (
            <button style={{ ...s.btn, ...s.btnOutline, ...s.btnSmall }} onClick={(e) => { e.stopPropagation(); startEdit(); }}>编辑</button>
          )}
          <button
            style={{ ...s.btn, ...s.btnOutline, ...s.btnSmall }}
            onClick={async (e) => {
              e.stopPropagation();
              const copyId = prompt('请输入新模板 ID（英文标识）', tpl.id + '_copy');
              if (!copyId) return;
              try {
                await ruleTemplates.create({
                  id: copyId,
                  name: tpl.name + ' (副本)',
                  description: tpl.description || '',
                  rules: tpl.rules,
                });
                qc.invalidateQueries({ queryKey: ['ruleTemplates'] });
              } catch (err: any) {
                window.alert('复制失败: ' + (err.message || String(err)));
              }
            }}
          >
            复制
          </button>
          {tpl.tag?.type !== 'default' && (
            <button style={{ ...s.btn, ...s.btnDanger, ...s.btnSmall }} onClick={(e) => { e.stopPropagation(); if (confirm('确定删除此模板？')) del.mutate(); }}>
              {del.isPending ? '...' : '删除'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded body */}
      {(expanded || editing) && (
        <div style={s.cardBody}>
          {editing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {alert && <Alert type={alert.type} message={alert.msg} onClose={() => setAlert(null)} />}
              <div style={s.paramRow}>
                <span style={s.paramLabel}>名称</span>
                <input style={s.inputWide} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div style={s.paramRow}>
                <span style={s.paramLabel}>描述</span>
                <input style={s.inputWide} value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
            </div>
          )}

          {editing ? (
            <>
              {rules.length > 0 ? (
                rules
                  .sort((a, b) => b.priority - a.priority)
                  .map((rule, idx) => (
                    <RuleEditor
                      key={idx}
                      rule={rule}
                      onChange={(r) => {
                        const next = [...rules];
                        next[idx] = r;
                        setRules(next);
                      }}
                      onDelete={() => {
                        setRules(rules.filter((_, i) => i !== idx));
                      }}
                    />
                  ))
              ) : (
                <div style={s.empty}>暂无规则。点击下方按钮添加第一条规则。</div>
              )}
            </>
          ) : (
            /* Read-only view */
            <div>
              {(tpl.rules || []).sort((a, b) => b.priority - a.priority).map((rule, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>
                  <span style={{ color: '#999', fontSize: 11, minWidth: 24 }}>P{rule.priority}</span>
                  <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{ACTION_LABELS[rule.action] || rule.action}</span>
                  <span style={{ color: '#666' }}>{rule.reason}</span>
                </div>
              ))}
            </div>
          )}

          {editing && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <button style={s.addBtn} onClick={addRule}>+ 新增规则</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ ...s.btn, ...s.btnOutline }} onClick={cancelEdit}>取消</button>
                <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => save.mutate()} disabled={save.isPending}>
                  {save.isPending ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function RuleTemplatesPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['ruleTemplates'],
    queryFn: () => ruleTemplates.list(),
  });

  const templates = data?.ruleTemplates || [];

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>策略模板管理</h1>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => setCreateOpen(true)}>+ 新建模板</button>
      </div>

      {isLoading && <div style={s.empty}>加载中...</div>}
      {error && <Alert type="error" message={String(error)} />}

      {!isLoading && templates.length === 0 && (
        <div style={s.empty}>暂无策略模板，请新建或确认配置迁移已执行。</div>
      )}

      {templates.map((tpl) => (
        <TemplateCard key={tpl.id} tpl={tpl} />
      ))}

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}
