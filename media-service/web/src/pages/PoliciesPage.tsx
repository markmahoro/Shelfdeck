import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminSettings, people, ruleTemplates, subLibraries } from '../api/client';
import type { ApprovalMode, RuleTemplate, SubLibrary } from '../types';
import { Button, Dialog, Field, Loading, Page, PageHeader, Panel, Tabs, Toast } from '../components/ui';

type TabKey = 'objectives' | 'metadata' | 'approval';
type EditableCondition = { field: string; op: string; value: string };
type EditableRule = { priority: number; reason: string; conditions: EditableCondition[]; qualityTier: string; targetCodec: string; maxSizeGB: string };

const fields = [
  ['doubanRating', '豆瓣评分'], ['userRating', '用户评分'], ['watched', '已观看'], ['bucket', '清晰度'],
  ['actorPersonIds', '包含指定演员'], ['actorPreferenceMax', '任一演员偏好至少'], ['actorPreferenceMin', '任一演员偏好至多'],
];
const preferenceNames: Record<string, string> = { '2': '非常喜欢', '1': '喜欢', '0': '普通', '-1': '不喜欢', '-2': '回避' };
const metadataFields = [['title', '标题'], ['overview', '剧情简介'], ['poster', '海报'], ['genres', '类型'], ['actors', '演员'], ['providerIds', '外部编号']];
const approvalLabels: Record<string, string> = {
  'transcode.dolbyVisionTonemap': '杜比视界转换', 'transcode.beforeReplace': '转码后替换原文件',
  'upgrade.candidateSelect': '选择升级资源', 'upgrade.identityMismatch': '资源身份不一致', 'upgrade.beforeReplace': '升级后替换原文件',
  'scrape.beforeWriteMetadata': '写入媒体信息', 'scrape.beforeOrganize': '整理媒体目录', 'scrape.reviewResult': '确认识别结果',
};
const modeNames: Record<ApprovalMode, string> = { auto: '自动执行', confirm: '需要确认', forceConfirm: '始终确认' };

function normalizeRules(template: RuleTemplate): EditableRule[] {
  return (template.rules || []).map((rule: any) => ({
    priority: Number(rule.priority || 0), reason: rule.reason || '',
    conditions: (rule.groups || []).flatMap((group: any) => (Array.isArray(group) ? group : group.conditions || [])).map((condition: any) => {
      const row = Array.isArray(condition) ? condition : [condition.field, condition.op, condition.value];
      return { field: String(row[0] || 'doubanRating'), op: String(row[1] || '>='), value: Array.isArray(row[2]) ? row[2].join(',') : String(row[2] ?? '') };
    }),
    qualityTier: String(rule.targetMediaFacts?.qualityTier || 'standard'),
    targetCodec: String(rule.targetMediaFacts?.targetCodec || 'h265'),
    maxSizeGB: rule.targetMediaFacts?.maxSizeGB == null ? '' : String(rule.targetMediaFacts.maxSizeGB),
  }));
}

function encodeValue(condition: EditableCondition) {
  if (condition.field === 'actorPersonIds') return condition.value.split(',').map((value) => value.trim()).filter(Boolean);
  if (['doubanRating', 'userRating', 'actorPreferenceMax', 'actorPreferenceMin'].includes(condition.field)) return Number(condition.value);
  if (condition.field === 'watched') return condition.value === 'true';
  return condition.value;
}

function ObjectivePolicies() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['rule-templates'], queryFn: ruleTemplates.list });
  const actors = useQuery({ queryKey: ['people-policy-options'], queryFn: () => people.list({ limit: 200 }) });
  const [editing, setEditing] = useState<RuleTemplate | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTemplate, setNewTemplate] = useState({ id: '', name: '' });
  const [name, setName] = useState('');
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [toast, setToast] = useState('');
  const save = useMutation({
    mutationFn: () => ruleTemplates.update(editing!.id, { name, rules: rules.map((rule) => ({
      priority: rule.priority,
      groupsConnector: 'and',
      groups: rule.conditions.length ? [{ connector: 'and', conditions: rule.conditions.map((condition) => [condition.field, condition.op, encodeValue(condition)]) }] : [],
      targetMediaFacts: { qualityTier: rule.qualityTier, targetCodec: rule.targetCodec, ...(rule.maxSizeGB ? { maxSizeGB: Number(rule.maxSizeGB) } : {}) },
      reason: rule.reason,
    })) as unknown as RuleTemplate['rules'] }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rule-templates'] }); setEditing(null); setToast('维护目标已保存'); },
    onError: (error) => setToast(error.message),
  });
  const create = useMutation({ mutationFn: () => ruleTemplates.create({ id: newTemplate.id, name: newTemplate.name, rules: [] }), onSuccess: (template) => { qc.invalidateQueries({ queryKey: ['rule-templates'] }); setCreateOpen(false); setNewTemplate({ id: '', name: '' }); open(template); }, onError: (error) => setToast(error.message) });
  const copy = useMutation({ mutationFn: (template: RuleTemplate) => ruleTemplates.create({ id: `${template.id}-${Date.now()}`, name: `${template.name} 副本`, description: template.description, rules: template.rules }), onSuccess: (template) => { qc.invalidateQueries({ queryKey: ['rule-templates'] }); open(template); }, onError: (error) => setToast(error.message) });
  const open = (template: RuleTemplate) => { setEditing(template); setName(template.name); setRules(normalizeRules(template)); };
  if (templates.isLoading) return <Loading />;
  return <>
    <div className="toolbar"><div className="toolbar-spacer" /><Button variant="primary" icon="plus" onClick={() => setCreateOpen(true)}>新建策略</Button></div>
    <div className="policy-list">{(templates.data?.ruleTemplates || []).map((template) => <Panel key={template.id} title={template.name} action={<Button onClick={() => template.tag?.type === 'default' ? copy.mutate(template) : open(template)}>{template.tag?.type === 'default' ? '复制并编辑' : '编辑'}</Button>}><div className="policy-summary"><span>{template.rules.length} 条目标规则</span><span>{template.description || '—'}</span></div></Panel>)}</div>
    <Dialog open={!!editing} title="编辑维护目标" onClose={() => setEditing(null)} actions={<><Button onClick={() => setEditing(null)}>取消</Button><Button variant="primary" disabled={save.isPending || !name} onClick={() => save.mutate()}>保存</Button></>}>
      <div className="stack"><Field label="策略名称"><input className="input" value={name} onChange={(event) => setName(event.target.value)} /></Field>
        {rules.map((rule, index) => <section className="rule-card" key={index}>
          <div className="rule-head"><strong>规则 {index + 1}</strong><Button variant="quiet" onClick={() => setRules(rules.filter((_, i) => i !== index))}>移除</Button></div>
          <div className="form-grid"><Field label="优先级"><input className="input" type="number" value={rule.priority} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, priority: Number(event.target.value) } : item))} /></Field><Field label="规则名称"><input className="input" value={rule.reason} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, reason: event.target.value } : item))} /></Field><Field label="目标质量"><select className="select" value={rule.qualityTier} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, qualityTier: event.target.value } : item))}><option value="premium">优质</option><option value="high">高</option><option value="standard">标准</option><option value="baseline">基础</option></select></Field><Field label="目标编码"><select className="select" value={rule.targetCodec} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, targetCodec: event.target.value } : item))}><option value="h265">H.265</option><option value="av1">AV1</option></select></Field><Field label="最大体积（GB）"><input className="input" type="number" value={rule.maxSizeGB} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, maxSizeGB: event.target.value } : item))} /></Field></div>
          <div className="condition-list">{rule.conditions.map((condition, conditionIndex) => <div className="condition-row" key={conditionIndex}><select className="select" value={condition.field} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.map((entry, c) => c === conditionIndex ? { ...entry, field: event.target.value, value: '' } : entry) } : item))}>{fields.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select className="select" value={condition.op} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.map((entry, c) => c === conditionIndex ? { ...entry, op: event.target.value } : entry) } : item))}><option value="=">等于</option><option value=">=">至少</option><option value="<=">至多</option><option value="overlap">包含任一</option></select>{condition.field === 'actorPersonIds' ? <select className="select" value={condition.value} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.map((entry, c) => c === conditionIndex ? { ...entry, value: event.target.value } : entry) } : item))}><option value="">选择演员</option>{(actors.data?.people || []).map((person) => <option value={person.personId} key={person.personId}>{person.name}</option>)}</select> : condition.field.startsWith('actorPreference') ? <select className="select" value={condition.value} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.map((entry, c) => c === conditionIndex ? { ...entry, value: event.target.value } : entry) } : item))}>{Object.entries(preferenceNames).reverse().map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <input className="input" value={condition.value} onChange={(event) => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.map((entry, c) => c === conditionIndex ? { ...entry, value: event.target.value } : entry) } : item))} />}<Button variant="quiet" aria-label="移除条件" onClick={() => setRules(rules.map((item, i) => i === index ? { ...item, conditions: item.conditions.filter((_, c) => c !== conditionIndex) } : item))}>×</Button></div>)}</div>
          <Button onClick={() => setRules(rules.map((item, i) => i === index ? { ...item, conditions: [...item.conditions, { field: 'doubanRating', op: '>=', value: '3' }] } : item))}>添加条件</Button>
        </section>)}
        <Button onClick={() => setRules([...rules, { priority: 1, reason: '', conditions: [], qualityTier: 'standard', targetCodec: 'h265', maxSizeGB: '' }])}>添加规则</Button>
      </div>
    </Dialog>
    <Dialog open={createOpen} title="新建维护策略" onClose={() => setCreateOpen(false)} actions={<><Button onClick={() => setCreateOpen(false)}>取消</Button><Button variant="primary" disabled={!newTemplate.id || !newTemplate.name || create.isPending} onClick={() => create.mutate()}>创建</Button></>}><div className="form-grid"><Field label="策略 ID"><input className="input" value={newTemplate.id} onChange={(event) => setNewTemplate({ ...newTemplate, id: event.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })} /></Field><Field label="策略名称"><input className="input" value={newTemplate.name} onChange={(event) => setNewTemplate({ ...newTemplate, name: event.target.value })} /></Field></div></Dialog><Toast message={toast} />
  </>;
}

function MetadataPolicies() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['libraries'], queryFn: subLibraries.list });
  const [toast, setToast] = useState('');
  const update = useMutation({ mutationFn: ({ library, selected }: { library: SubLibrary; selected: string[] }) => subLibraries.update(library.uuid, { metadataGate: { all: selected } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['libraries'] }); setToast('Metadata 要求已保存'); }, onError: (error) => setToast(error.message) });
  if (query.isLoading) return <Loading />;
  return <><div className="policy-list">{(query.data?.subLibraries || []).map((library) => {
    const selected = Array.isArray(library.metadataGate?.all) ? library.metadataGate!.all!.filter((value): value is string => typeof value === 'string') : [];
    return <Panel key={library.uuid} title={library.name}><div className="check-grid">{metadataFields.map(([value, label]) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={(event) => update.mutate({ library, selected: event.target.checked ? [...selected, value] : selected.filter((item) => item !== value) })} /> {label}</label>)}</div></Panel>;
  })}</div><Toast message={toast} /></>;
}

function ApprovalPolicies() {
  const query = useQuery({ queryKey: ['maintenance-policy'], queryFn: adminSettings.getMaintenancePolicy });
  const [toast, setToast] = useState('');
  const [draft, setDraft] = useState<Record<string, ApprovalMode> | null>(null);
  const policy = draft || query.data?.approvalPolicy || {};
  const save = useMutation({ mutationFn: () => adminSettings.patchMaintenancePolicy({ approvalPolicy: policy }), onSuccess: () => setToast('风险审批策略已保存'), onError: (error) => setToast(error.message) });
  if (query.isLoading) return <Loading />;
  return <Panel title="风险审批" action={<Button variant="primary" onClick={() => save.mutate()}>保存</Button>}><div className="settings-list">{Object.entries(approvalLabels).map(([key, label]) => <div className="setting-row" key={key}><div><strong>{label}</strong></div><select className="select compact" value={policy[key] || 'confirm'} onChange={(event) => setDraft({ ...policy, [key]: event.target.value as ApprovalMode })}>{Object.entries(modeNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></div>)}</div><Toast message={toast} /></Panel>;
}

export default function PoliciesPage() {
  const [tab, setTab] = useState<TabKey>('objectives');
  const content = useMemo(() => tab === 'objectives' ? <ObjectivePolicies /> : tab === 'metadata' ? <MetadataPolicies /> : <ApprovalPolicies />, [tab]);
  return <Page><PageHeader title="管理策略" /><Tabs items={[{ key: 'objectives', label: '维护目标' }, { key: 'metadata', label: 'Metadata 要求' }, { key: 'approval', label: '风险审批' }]} value={tab} onChange={(value) => setTab(value as TabKey)} />{content}</Page>;
}
