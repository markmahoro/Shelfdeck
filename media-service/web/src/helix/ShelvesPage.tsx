import { useModalFocus } from './useModalFocus';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { newOpaqueId } from './id';
import {
  AdminApiError,
  canonicalDigest,
  helixAdminApi,
  type MovieRuleBranch,
  type PlacementPreview,
  type RuleTemplate,
  type RuleTemplateDraft,
  type RuleTemplatePreview,
  type RuleTemplateRules,
  type Shelf,
  type ShelfPlacementPolicy,
} from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';
import InputSettlementAuthorization from './InputSettlementAuthorization';
import DefectAuthorization from './DefectAuthorization';
import {JavRuleEditor,JavRuleSummary,javEditFromRules,applyJavEdit,type JavRuleEdit} from './JavRuleSettings';

const HIGH_QUALITY_AUDIO = ['dts_hd_ma', 'dts_x', 'eac3_atmos', 'truehd', 'truehd_atmos'];
const SYSTEM_TEMPLATE_ID = 'system-beta-recommended';
const SYSTEM_TEMPLATE_DISPLAY_NAME = '系统推荐整理标准';
const PROFILE_LABELS = { movie: '电影', series: '剧集',jav:'JAV' } as const;
type EditableProfile = keyof typeof PROFILE_LABELS;
const DEFAULT_PLACEMENT: ShelfPlacementPolicy = {
  folderTemplate: '{title} ({year})',
  primaryTemplate: '{stem}{ext}',
  nfoTemplate: '{stem}.nfo',
  subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
  posterTemplate: 'poster{ext}',
  fanartTemplate: 'fanart{ext}',
  collisionPolicy: 'reject',
};

type MovieRuleEdit = {
  conditionKind: MovieRuleBranch['conditionKind'];
  rating?: number;
  hevc: boolean;
  fourK: boolean;
  highQualityAudio: boolean;
  maxSizeGiB: string;
};
type StandardEditor =
  | { kind: 'create'; source: RuleTemplate }
  | { kind: 'shelf'; shelf: Shelf };

function newShelfId() {
  return newOpaqueId('media-shelf-');
}
function branchLabel(branch: { conditionKind: MovieRuleBranch['conditionKind']; rating?: number }) {
  return branch.conditionKind === 'no_rating' ? '未评分' : `${branch.rating}星`;
}
function mediaLabel(branch: MovieRuleBranch) {
  const media = branch.requirements.mandatoryMedia;
  const parts = ['可播放文件'];
  if (media.videoCodec === 'hevc') parts.push('HEVC');
  if (media.minimumRasterClass === '4k') parts.push('4K');
  if (media.acceptedPrimaryAudioClasses.length > 0) parts.push('高质量主音轨');
  return parts.join(' · ');
}
function spaceLabel(branch: MovieRuleBranch) {
  return branch.requirements.space.maxSizeGiB === null ? '不按评分限制空间' : `最多 ${branch.requirements.space.maxSizeGiB} GiB`;
}
function profileRules(value: { profileRuleSets: { contentProfile: string; decisionBranches: MovieRuleBranch[] }[] }, profile: EditableProfile) {
  return value.profileRuleSets.find((item) => item.contentProfile === profile)?.decisionBranches || [];
}
function RuleSummary({ rules }: { rules: RuleTemplateRules }) {
  return <>{(['movie', 'series'] as const).map((profile) => {
    const branches = profileRules(rules, profile);
    return branches.length > 0 && <section key={profile} aria-label={`${PROFILE_LABELS[profile]}整理标准`}>
      <strong>{PROFILE_LABELS[profile]}</strong>
      <div className="movie-rule-grid">{branches.map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}>
        <b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span>
        <small>{profile === 'series' ? '每集 · ' : ''}{spaceLabel(branch)}</small>
      </div>)}</div>
    </section>;
  })}<JavRuleSummary rules={rules}/></>;
}
function renderPreview(template: string, values: Record<string, string>) {
  return template.replace(/\{([^{}]+)\}/g, (_match, token) => values[token] || '');
}
function shelfStatusLabel(status: Shelf['status']) {
  if (status === 'active') return '可接收整理结果';
  if (status === 'deregistering') return '正在注销';
  return '已注销';
}
function commandError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  const reasonCode = cause instanceof AdminApiError && typeof cause.details.reasonCode === 'string' ? cause.details.reasonCode : '';
  return `${cause.message}${reasonCode ? `（${reasonCode}）` : ''}`;
}
function editsFromBranches(branches: MovieRuleBranch[]): MovieRuleEdit[] {
  return branches.map((branch) => ({
    conditionKind: branch.conditionKind,
    rating: branch.rating,
    hevc: branch.requirements.mandatoryMedia.videoCodec === 'hevc',
    fourK: branch.requirements.mandatoryMedia.minimumRasterClass === '4k',
    highQualityAudio: branch.requirements.mandatoryMedia.acceptedPrimaryAudioClasses.length > 0,
    maxSizeGiB: branch.requirements.space.maxSizeGiB == null ? '' : String(branch.requirements.space.maxSizeGiB),
  }));
}
export async function applyProfileEdits(rules: RuleTemplateRules, edits: MovieRuleEdit[], profile: EditableProfile): Promise<RuleTemplateRules> {
  const next = structuredClone(rules);
  const movie = next.profileRuleSets.find((item) => item.contentProfile === profile);
  if (!movie) throw new Error(`当前规则模板没有${PROFILE_LABELS[profile]}整理标准。`);
  if (movie.decisionBranches.length !== edits.length) throw new Error('整理标准与当前草稿不一致，请刷新后重试。');
  movie.decisionBranches = movie.decisionBranches.map((branch, index) => {
    const edit = edits[index];
    if (edit.conditionKind !== branch.conditionKind || edit.rating !== branch.rating) {
      throw new Error('评分分支已变化，请刷新后重试。');
    }
    const original = branch.requirements.mandatoryMedia;
    const raw = edit.maxSizeGiB.trim();
    const maxSizeGiB = raw === '' ? null : Number(raw);
    if (maxSizeGiB !== null && (!Number.isFinite(maxSizeGiB) || maxSizeGiB <= 0)) {
      throw new Error(`${branchLabel(edit)} 的空间上限必须为空或大于 0 GiB。`);
    }
    if (maxSizeGiB !== null && !Number.isSafeInteger(maxSizeGiB * 1073741824)) {
      throw new Error(`${branchLabel(edit)} 的空间上限精度过高或超出范围，请使用 0.5、0.75 或 1 GiB 等值。`);
    }
    const space = maxSizeGiB === null
      ? { ...branch.requirements.space, maxSizeGiB: null, maxSizeBytes: null }
      : { ...branch.requirements.space, maxSizeGiB, maxSizeBytes: maxSizeGiB * 1073741824 };
    return {
      ...branch,
      requirements: {
        ...branch.requirements,
        mandatoryMedia: {
          ...branch.requirements.mandatoryMedia,
          videoCodec: edit.hevc === (original.videoCodec === 'hevc') ? original.videoCodec : edit.hevc ? 'hevc' : 'any',
          minimumRasterClass: edit.fourK === (original.minimumRasterClass === '4k') ? original.minimumRasterClass : edit.fourK ? '4k' : 'none',
          acceptedPrimaryAudioClasses: edit.highQualityAudio === (original.acceptedPrimaryAudioClasses.length > 0)
            ? original.acceptedPrimaryAudioClasses : edit.highQualityAudio ? [...HIGH_QUALITY_AUDIO] : [],
        },
        space,
      },
    };
  });
  const noRating = movie.decisionBranches.find((item) => item.conditionKind === 'no_rating');
  if (noRating) movie.baseRequirements = structuredClone(noRating.requirements) as typeof movie.baseRequirements;
  const unsigned = Object.fromEntries(Object.entries(movie).filter(([key]) => key !== 'profileRuleSetDigest'));
  movie.profileRuleSetDigest = await canonicalDigest(unsigned as never);
  return next;
}
function templateDisplayName(item: Pick<RuleTemplate, 'templateId' | 'name' | 'ownerKind'>) {
  return item.templateId === SYSTEM_TEMPLATE_ID
    ? SYSTEM_TEMPLATE_DISPLAY_NAME
    : item.name;
}
function templateOptionLabel(item: RuleTemplate) {
  return `${templateDisplayName(item)}${item.ownerKind === 'system' ? ' · 系统只读' : ''}`;
}
function reassessmentCopy(entryCount: number, extraShelves = 0, showCount = true) {
  const titles = entryCount === 0
    ? '新收藏条目将按新规则验收。'
    : `${showCount ? `${entryCount} 个已上架条目：` : ''}重新评估并自动修复可处理的差异。`;
  return extraShelves > 0 ? `${titles} 同时影响其他 ${extraShelves} 座收藏架。` : titles;
}

function MovieRuleEditor({ edits, onChange, profile }: { profile: EditableProfile; edits: MovieRuleEdit[]; onChange: (value: MovieRuleEdit[]) => void }) {
  function replace(index: number, value: MovieRuleEdit) {
    onChange(edits.map((item, ordinal) => (ordinal === index ? value : item)));
  }
  return <div className="movie-rule-grid movie-rule-editor">{edits.map((edit, index) => <div key={`${edit.conditionKind}-${edit.rating || 0}`}>
    <b>{branchLabel(edit)}</b>
    <label><input type="checkbox" checked={edit.hevc} onChange={(event) => replace(index, { ...edit, hevc: event.target.checked })} /><span>HEVC</span></label>
    <label><input type="checkbox" checked={edit.fourK} onChange={(event) => replace(index, { ...edit, fourK: event.target.checked })} /><span>4K</span></label>
    <label><input type="checkbox" checked={edit.highQualityAudio} onChange={(event) => replace(index, { ...edit, highQualityAudio: event.target.checked })} /><span>高质量主音轨</span></label>
    <label><span>{profile === 'series' ? '每集空间上限 GiB' : '空间上限 GiB'}</span><input type="number" min={0} step="any" placeholder="不限制" value={edit.maxSizeGiB} onChange={(event) => replace(index, { ...edit, maxSizeGiB: event.target.value })} /></label>
  </div>)}</div>;
}

function PlacementFields({ placement, onChange }: { placement: ShelfPlacementPolicy; onChange: (value: ShelfPlacementPolicy) => void }) {
  return <>
    <label><span>目录命名</span><input value={placement.folderTemplate} onChange={(event) => onChange({ ...placement, folderTemplate: event.target.value })} required /></label>
    <label><span>主视频命名</span><input value={placement.primaryTemplate} onChange={(event) => onChange({ ...placement, primaryTemplate: event.target.value })} required /></label>
    <label><span>资料文件命名</span><input value={placement.nfoTemplate} onChange={(event) => onChange({ ...placement, nfoTemplate: event.target.value })} required /></label>
    <label><span>字幕命名</span><input value={placement.subtitleTemplate} onChange={(event) => onChange({ ...placement, subtitleTemplate: event.target.value })} required /></label>
    <label><span>海报命名</span><input value={placement.posterTemplate} onChange={(event) => onChange({ ...placement, posterTemplate: event.target.value })} required /></label>
    <label><span>背景图命名</span><input value={placement.fanartTemplate} onChange={(event) => onChange({ ...placement, fanartTemplate: event.target.value })} required /></label>
    <label><span>名称冲突</span><select value={placement.collisionPolicy} onChange={(event) => onChange({ ...placement, collisionPolicy: event.target.value as ShelfPlacementPolicy['collisionPolicy'] })}><option value="reject">拒绝并等待处理</option><option value="suffix">添加确定性后缀</option></select></label>
  </>;
}

export function namingExamples(placement: ShelfPlacementPolicy, sample: string) {
  const series=sample.startsWith('series'), title=sample==='jav'?'示例 JAV 影片':series?'示例剧集':'示例电影', base=title+' (2026)';
  const primaryStems=sample==='series_shared'?[base+' - S01E01-E02']:sample==='series_parts'?[base+' - S01E01-part01',base+' - S01E01-part02']:[base+(series?' - S01E01':'')];
  const nfoStems=series?['season',base+' - S01E01',...(sample==='series_shared'?[base+' - S01E02']:[])]:[base];
  return {
    directory:renderPreview(placement.folderTemplate,{title,year:'2026'})+(series?'/Season 01':''),
    names:[...primaryStems.map(stem=>renderPreview(placement.primaryTemplate,{stem,ext:'.mkv'})),
      ...nfoStems.map(stem=>renderPreview(placement.nfoTemplate,{stem,ext:'.nfo'})),
      renderPreview(placement.subtitleTemplate,{stem:base,language:'.zh-CN',forced:'.forced',sdh:'.sdh',ext:'.srt'}),
      renderPreview(placement.posterTemplate,{ext:'.jpg'}),renderPreview(placement.fanartTemplate,{ext:'.jpg'})],
  };
}
function NamingPreview({placement,profiles}:{placement:ShelfPlacementPolicy;profiles:string[]}) {
  const [selected,setSelected]=useState('movie');
  const samples=[...(profiles.includes('movie')?[{value:'movie',label:'电影'}]:[]),
    ...(profiles.includes('jav')?[{value:'jav',label:'JAV'}]:[]),
    ...(profiles.includes('series')?[{value:'series',label:'剧集：一集一文件'},{value:'series_shared',label:'剧集：两集共文件'},{value:'series_parts',label:'剧集：一集多个 part'}]:[])];
  if(!samples.length)return null;
  const sample=samples.some(item=>item.value===selected)?selected:samples[0].value;
  const preview=namingExamples(placement,sample);
  return <div className="template-preview" aria-label="最终命名保存前预览">
    <label><span>命名示例</span><select value={sample} onChange={event=>setSelected(event.target.value)}>{samples.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <span>{preview.directory}</span>
    <small>{preview.names.join(' · ')}</small>
  </div>;
}

export default function ShelvesPage({openSettlementAuthorization=false}:{openSettlementAuthorization?:boolean}={}) {
  const { expire } = useSession();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [standardConflict, setStandardConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [shelfId, setShelfId] = useState(newShelfId);
  const [name, setName] = useState('媒体收藏架');
  const [targetRootLocation, setTargetRootLocation] = useState('');
  const [templateId, setTemplateId] = useState(SYSTEM_TEMPLATE_ID);
  const [placement, setPlacement] = useState<ShelfPlacementPolicy>({ ...DEFAULT_PLACEMENT });
  const [confirmShelf, setConfirmShelf] = useState<Shelf | null>(null);
  const deregistrationDialog = useRef<HTMLDialogElement>(null);
  const deregistrationTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!confirmShelf) return;
    const dialog = deregistrationDialog.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (deregistrationTrigger.current?.isConnected) deregistrationTrigger.current.focus();
    };
  }, [confirmShelf]);
  const [enteredShelfName, setEnteredShelfName] = useState('');
  const [preserveFilesAcknowledged, setPreserveFilesAcknowledged] = useState(false);
  const [releaseControlAcknowledged, setReleaseControlAcknowledged] = useState(false);
  const [placementShelf, setPlacementShelf] = useState<Shelf | null>(null);
  const [placementDraft, setPlacementDraft] = useState<ShelfPlacementPolicy>({ ...DEFAULT_PLACEMENT });
  const [placementTarget, setPlacementTarget] = useState('');
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [bindShelf, setBindShelf] = useState<Shelf | null>(null);
  const [bindTemplateId, setBindTemplateId] = useState('');
  const [standardEditor, setStandardEditor] = useState<StandardEditor | null>(null);
  const [copyName, setCopyName] = useState('');
  const [editingProfile, setEditingProfile] = useState<EditableProfile>('movie');
  const [seriesEdits, setSeriesEdits] = useState<MovieRuleEdit[]>([]);
  const [movieEdits, setMovieEdits] = useState<MovieRuleEdit[]>([]);
  const [javEdit,setJavEdit]=useState<JavRuleEdit|null>(null);
  const [standardPreview, setStandardPreview] = useState<RuleTemplatePreview | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<{ template: RuleTemplate; draft: RuleTemplateDraft } | null>(null);
  const standardDialog = useModalFocus(Boolean(standardEditor), () => setStandardEditor(null), loading);
  const placementDialog = useModalFocus(Boolean(placementShelf), () => setPlacementShelf(null), loading);
  const bindDialog = useModalFocus(Boolean(bindShelf), () => setBindShelf(null), loading);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [shelfResult, templateResult] = await Promise.all([helixAdminApi.listShelves(), helixAdminApi.listRuleTemplates()]);
      setShelves(shelfResult.items);
      setTemplates(templateResult.items);
      setTemplateId((current) => {
        if (templateResult.items.some((item) => item.templateId === current && item.status === 'active')) return current;
        const recommended = templateResult.items.find((item) => item.templateId === SYSTEM_TEMPLATE_ID && item.status === 'active');
        return recommended?.templateId || current;
      });
      if (shelfResult.items.length === 0) setShowCreate(true);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '收藏架读取失败。');
    } finally { setLoading(false); }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);

  const activeTemplates = useMemo(() => templates.filter((item) => item.status === 'active'), [templates]);
  const selectedTemplate = activeTemplates.find((item) => item.templateId === templateId);
  const managedShelves = shelves.filter((item) => item.status !== 'deregistered');
  const deregisteredShelves = shelves.filter((item) => item.status === 'deregistered');
  const editorShelf = standardEditor?.kind === 'shelf' ? standardEditor.shelf : null;
  const editorSource = preparedDraft?.template
    || (standardEditor?.kind === 'create'
      ? standardEditor.source
      : editorShelf
        ? templates.find((item) => item.templateId === editorShelf.standard.ruleTemplateId)
        : selectedTemplate);
  function templateLabel(id: string) {
    if (id === SYSTEM_TEMPLATE_ID) return SYSTEM_TEMPLATE_DISPLAY_NAME;
    return templates.find((item) => item.templateId === id)?.name || id;
  }

  async function createShelf(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetRootLocation.trim() || !selectedTemplate) {
      setError('请填写收藏架名称、实际目标目录并选择可用规则模板。');
      return;
    }
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.createShelf({
        idempotencyKey: `shelf:${shelfId}:create:v1`,
        shelfId,
        name: name.trim(),
        targetRootLocation: targetRootLocation.trim(),
        ruleTemplateId: selectedTemplate.templateId,
        expectedTemplateRevision: selectedTemplate.currentRevision,
        placementPolicy: Object.fromEntries(Object.entries(placement).map(([key, value]) => [key, value.trim()])),
      });
      setShelfId(newShelfId());
      setName('媒体收藏架');
      setTargetRootLocation('');
      setPlacement({ ...DEFAULT_PLACEMENT });
      setShowCreate(false);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else {
        setError(commandError(cause, '收藏架创建失败。'));
        setLoading(false);
      }
    }
  }

  async function deregisterShelf() {
    if (!confirmShelf || enteredShelfName !== confirmShelf.name || !preserveFilesAcknowledged || !releaseControlAcknowledged) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.deregisterShelf(confirmShelf, enteredShelfName, preserveFilesAcknowledged, releaseControlAcknowledged);
      setConfirmShelf(null); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(cause instanceof Error ? cause.message : '收藏架注销请求失败。'); setLoading(false); }
    }
  }

  function openPlacement(shelf: Shelf) {
    setPlacementShelf(shelf);
    setPlacementDraft({ ...shelf.placement.value });
    setPlacementTarget(shelf.target.rootLocation);
    setPlacementPreview(null);
    setError(''); setNotice('');
  }
  function openBind(shelf: Shelf) {
    setBindShelf(shelf);
    setBindTemplateId(shelf.standard.ruleTemplateId);
    setError(''); setNotice('');
  }
  function openStandard(shelf: Shelf) {
    const source = templates.find((item) => item.templateId === shelf.standard.ruleTemplateId);
    setStandardEditor({ kind: 'shelf', shelf });
    setCopyName(`${shelf.name} 整理标准`);
    setMovieEdits(editsFromBranches(profileRules(source?.current.rules || shelf.standard.value, 'movie')));
    setSeriesEdits(editsFromBranches(profileRules(source?.current.rules || shelf.standard.value, 'series')));
    setJavEdit(javEditFromRules(source?.current.rules||shelf.standard.value));
    setEditingProfile(profileRules(source?.current.rules || shelf.standard.value, 'movie').length ? 'movie' : profileRules(source?.current.rules||shelf.standard.value,'series').length?'series':'jav');
    setStandardPreview(null);
    setPreparedDraft(null);
    setError(''); setNotice('');
  }
  function openCreateStandard() {
    if (!selectedTemplate) {
      setError('请先选择规则模板。');
      return;
    }
    setStandardEditor({ kind: 'create', source: selectedTemplate });
    setCopyName(`${name.trim() || '媒体收藏架'} 整理标准`);
    setMovieEdits(editsFromBranches(profileRules(selectedTemplate.current.rules, 'movie')));
    setSeriesEdits(editsFromBranches(profileRules(selectedTemplate.current.rules, 'series')));
    setJavEdit(javEditFromRules(selectedTemplate.current.rules));
    setEditingProfile(profileRules(selectedTemplate.current.rules, 'movie').length ? 'movie' : profileRules(selectedTemplate.current.rules,'series').length?'series':'jav');
    setStandardPreview(null);
    setPreparedDraft(null);
    setError(''); setNotice('');
  }

  async function previewPlacement() {
    if (!placementShelf) return;
    setLoading(true); setError('');
    try {
      setPlacementPreview(await helixAdminApi.previewPlacement(placementShelf, placementDraft, placementTarget));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(commandError(cause, '目录布局预览失败。'));
    } finally { setLoading(false); }
  }
  async function publishPlacement() {
    if (!placementShelf || !placementPreview) return;
    setLoading(true); setError('');
    try {
      await helixAdminApi.publishPlacement(placementShelf, placementDraft, placementPreview, placementTarget);
      setPlacementShelf(null); setPlacementPreview(null);
      setNotice('目录布局已发布');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(commandError(cause, '目录布局发布失败。')); setLoading(false); }
    }
  }
  async function bindTemplate() {
    if (!bindShelf) return;
    const template = activeTemplates.find((item) => item.templateId === bindTemplateId);
    if (!template) { setError('请选择已发布的规则模板。'); return; }
    setLoading(true); setError('');
    try {
      await helixAdminApi.bindShelfTemplate(bindShelf, template);
      setBindShelf(null);
      setNotice('整理标准已更换');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(commandError(cause, '规则模板绑定失败。')); setLoading(false); }
    }
  }
  async function prepareStandardDraft() {
    const source = editorSource;
    if (!source) throw new Error('找不到当前规则模板，请刷新后重试。');
    let working = preparedDraft;
    if (!working && source.ownerKind === 'user') {
      const current = await helixAdminApi.getRuleTemplateDraft(source.templateId);
      if (!current.writable || !current.draft) throw new Error('系统推荐模板不可改写，请复制后再发布。');
      // Edits are initialized from the displayed published revision, not an older saved draft.
      working = { template: source, draft: { ...current.draft,
        basePublishedRevision: source.currentRevision,
        rules: current.draft.basePublishedRevision === source.currentRevision ? current.draft.rules : source.current.rules } };
      setPreparedDraft(working);
    }
    if (!working) {
      if (!copyName.trim()) throw new Error('请填写自己的规则模板名称。');
      const copied = await helixAdminApi.copyRuleTemplate(source, copyName.trim());
      const current = await helixAdminApi.getRuleTemplateDraft(copied.template.templateId);
      if (!current.draft) throw new Error('复制后的规则模板没有可编辑草稿。');
      working = { template: copied.template, draft: current.draft };
      setPreparedDraft(working);
    }
    let rules = working.draft.rules;
    if (movieEdits.length) rules = await applyProfileEdits(rules, movieEdits, 'movie');
    if (seriesEdits.length) rules = await applyProfileEdits(rules, seriesEdits, 'series');
    if(javEdit)rules=await applyJavEdit(rules,javEdit);
    const revised = await helixAdminApi.reviseRuleTemplateDraft(working.draft, rules);
    const draft: RuleTemplateDraft = { ...working.draft, ...revised, rules };
    const prepared = { template: working.template, draft };
    setPreparedDraft(prepared);
    return prepared;
  }
  async function previewStandard() {
    if (!standardEditor) return;
    setLoading(true); setError('');
    try {
      const prepared = await prepareStandardDraft();
      setStandardPreview(await helixAdminApi.previewRuleTemplate(prepared.template, prepared.draft));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else {
        const conflict = cause instanceof AdminApiError && cause.code === 'ADMIN_RULE_TEMPLATE_CONFLICT';
        setStandardConflict(conflict);
        setError(conflict ? '规则版本已变化，当前修改尚未发布。' : commandError(cause, '整理标准预览失败。'));
        setLoading(false);
      }
    } finally { setLoading(false); }
  }
  async function publishStandard() {
    if (!standardEditor) return;
    setLoading(true); setError('');
    try {
      const prepared = preparedDraft || await prepareStandardDraft();
      const preview = standardPreview || await helixAdminApi.previewRuleTemplate(prepared.template, prepared.draft);
      const published = await helixAdminApi.publishRuleTemplate(preview);
      if (standardEditor.kind === 'shelf' && standardEditor.shelf.standard.ruleTemplateId !== published.template.templateId) {
        await helixAdminApi.bindShelfTemplate(standardEditor.shelf, published.template);
      }
      if (standardEditor.kind === 'create') setTemplateId(published.template.templateId);
      setStandardEditor(null); setStandardPreview(null); setPreparedDraft(null);
      setNotice(standardEditor.kind === 'create'
        ? '整理标准已发布'
        : '整理标准已发布');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else {
        const conflict = cause instanceof AdminApiError && cause.code === 'ADMIN_RULE_TEMPLATE_CONFLICT';
        setStandardConflict(conflict);
        setError(conflict ? '规则版本已变化，当前修改尚未发布。' : commandError(cause, '整理标准发布失败。'));
        setLoading(false);
      }
    }
  }

  if (!shelves.length && !showCreate && !standardEditor && loading && !error) return <LoadingState>正在读取收藏架…</LoadingState>;

  return <section className="source-page shelf-page">
    <PageHeader title="收藏架配置" actions={<>
      <Button type="button" onClick={() => void load()} disabled={loading}>刷新</Button>
      <InputSettlementAuthorization openRequested={openSettlementAuthorization} />
      <DefectAuthorization />
      <Button variant="primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '新建收藏架'}</Button>
    </>} />
    {showCreate && <form className="source-create" onSubmit={createShelf}>
      <div className="source-create-heading"><div><h2>创建收藏架</h2></div></div>
      <div className="source-form-grid">
        <label><span>收藏架名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="template-bind-field">
          <label><span>规则模板</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{templateOptionLabel(item)}</option>)}</select></label>
          <Button type="button" onClick={() => openCreateStandard()}>复制模板</Button>
        </div>
        <label className="wide"><span>收藏最终目录</span><input value={targetRootLocation} onChange={(event) => setTargetRootLocation(event.target.value)} placeholder="例如 E:\Movies 或 /media/Film" required /></label>
        <PlacementFields placement={placement} onChange={setPlacement} />
      </div>
      <NamingPreview placement={placement} profiles={selectedTemplate?.current.rules.profileRuleSets.map(item=>item.contentProfile)||[]} />
      {selectedTemplate && <div className="template-preview">
        <RuleSummary rules={selectedTemplate.current.rules} />
      </div>}
      <div className="source-create-footer"><Button variant="primary" type="submit" disabled={loading || activeTemplates.length === 0}>{loading ? '正在验证并保存…' : '创建收藏架'}</Button></div>
    </form>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {error && !standardEditor && <p className="form-error" role="alert">{error}</p>}
    <div className="source-registry">
      {managedShelves.length === 0 ? <div className="source-empty"><strong>还没有当前收藏架</strong></div> : managedShelves.map((shelf) => <article className="source-record shelf-record" key={shelf.shelfId}>
        <div className="source-record-main">
          <div className="source-record-title"><div><h2>{shelf.name}</h2><p>{shelf.target.rootLocation}</p>{shelf.status !== 'active' && <span className="source-state" data-state={shelf.status}>{shelfStatusLabel(shelf.status)}</span>}</div></div>
          <dl>
            <div><dt>规则模板</dt><dd>{templateLabel(shelf.standard.ruleTemplateId)}</dd></div>
            <div><dt>目录布局</dt><dd>{shelf.placement.value.folderTemplate}</dd></div>
            <div><dt>收藏条目</dt><dd>{shelf.deregistrationSummary.entryCount}</dd></div>
          </dl>
        </div>
        <div className="shelf-standard">
          <div className="shelf-standard-head"><div><strong>整理标准</strong></div></div>
          <RuleSummary rules={shelf.standard.value} />
        </div>
        {shelf.status === 'active' && <div className="shelf-card-actions">
          <Button type="button" onClick={() => openStandard(shelf)}>复制并修改整理标准</Button>
          <Button type="button" onClick={() => openBind(shelf)}>更换规则模板</Button>
          <Button type="button" onClick={() => openPlacement(shelf)}>调整目录布局</Button>
          <Button variant="danger" type="button" onClick={(event) => { deregistrationTrigger.current = event.currentTarget; setConfirmShelf(shelf); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false); }}>注销收藏架</Button>
        </div>}
        {shelf.status === 'deregistering' && shelf.deregistrationSummary.process?.blockingReason && <p className="form-neutral" role="status">{shelf.deregistrationSummary.process.blockingReason}</p>}
      </article>)}
    </div>
    {deregisteredShelves.length > 0 && <details className="source-registry shelf-history">
      <summary><strong>已注销收藏架</strong><span>{deregisteredShelves.length} 座</span></summary>

      {deregisteredShelves.map((shelf) => <article className="source-row" key={shelf.shelfId}>
        <div><strong>{shelf.name}</strong><small>{shelf.target.rootLocation}</small></div>
        <div><span>{shelfStatusLabel(shelf.status)}</span><small>{shelf.deregistrationSummary.entryCount} 条原收藏记录</small></div>
      </article>)}
    </details>}
    {placementShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (!loading && event.target === event.currentTarget) setPlacementShelf(null); }}>
      <div className="dialog dialog-wide" ref={placementDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={loading} aria-labelledby="shelf-placement-title">
        <div className="dialog-head"><h2 id="shelf-placement-title">调整“{placementShelf.name}”的目录布局</h2></div>
        <div className="dialog-body">
          {!placementPreview && <p>发布后将重新评估目录命名，并自动修复可处理的差异。</p>}
          <div className="source-form-grid">
            <label className="wide"><span>收藏最终目录</span><input value={placementTarget} onChange={(event) => { setPlacementTarget(event.target.value); setPlacementPreview(null); }} required /></label>
            <PlacementFields placement={placementDraft} onChange={(value) => { setPlacementDraft(value); setPlacementPreview(null); }} />
          </div>
          <NamingPreview placement={placementDraft} profiles={placementShelf.standard.value.profileRuleSets.map(item=>item.contentProfile)} />
          {placementPreview && <div className="template-preview" role="status">
            <strong>将影响 {placementPreview.affectedActiveEntryCount} 个已上架条目</strong>
            <small>{reassessmentCopy(placementPreview.affectedActiveEntryCount, 0, false)}</small>
          </div>}
        </div>
        <div className="dialog-actions">
          <Button type="button" disabled={loading} onClick={() => setPlacementShelf(null)}>返回</Button>
          <Button type="button" disabled={loading} onClick={() => void previewPlacement()}>{loading ? '正在预览…' : '预览影响'}</Button>
          <Button variant="primary" type="button" disabled={loading || !placementPreview} onClick={() => void publishPlacement()}>发布目录布局</Button>
        </div>
      </div>
    </div>}
    {bindShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (!loading && event.target === event.currentTarget) setBindShelf(null); }}>
      <div className="dialog" ref={bindDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={loading} aria-labelledby="shelf-bind-title">
        <div className="dialog-head"><h2 id="shelf-bind-title">更换“{bindShelf.name}”的规则模板</h2></div>
        <div className="dialog-body">
          <p>{reassessmentCopy(bindShelf.deregistrationSummary.entryCount)}</p>
          <label><span>已发布的规则模板</span><select value={bindTemplateId} onChange={(event) => setBindTemplateId(event.target.value)}>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{templateOptionLabel(item)}</option>)}</select></label>
        </div>
        <div className="dialog-actions">
          <Button type="button" disabled={loading} onClick={() => setBindShelf(null)}>返回</Button>
          <Button variant="primary" type="button" disabled={loading || !bindTemplateId} onClick={() => void bindTemplate()}>{loading ? '正在应用…' : '应用到此收藏架'}</Button>
        </div>
      </div>
    </div>}
    {standardEditor && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (!loading && event.target === event.currentTarget) setStandardEditor(null); }}>
      <div className="dialog dialog-wide shelf-standard-dialog" ref={standardDialog} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={loading} aria-labelledby="shelf-standard-title">
        <div className="dialog-head"><h2 id="shelf-standard-title">{standardEditor.kind === 'create' ? '复制并发布自己的整理标准' : `复制并发布“${standardEditor.shelf.name}”的整理标准`}</h2></div>
        <div className="dialog-body">
          {standardEditor.kind === 'shelf' && !standardPreview && <p>发布后将按新标准重新评估已上架条目。</p>}
          {editorSource?.ownerKind !== 'user' && !preparedDraft && <label><span>自己的规则模板名称</span><input value={copyName} onChange={(event) => { setCopyName(event.target.value); setStandardPreview(null); }} required /></label>}
          <label><span>媒体类型</span><select value={editingProfile} onChange={(event) => setEditingProfile(event.target.value as EditableProfile)}>{movieEdits.length > 0 && <option value="movie">电影</option>}{seriesEdits.length > 0 && <option value="series">剧集</option>}{javEdit&&<option value="jav">JAV</option>}</select></label>
          {editingProfile==='jav'?javEdit&&<JavRuleEditor edit={javEdit} onChange={value=>{setJavEdit(value);setStandardPreview(null);}}/>:
            <MovieRuleEditor profile={editingProfile} edits={editingProfile === 'movie' ? movieEdits : seriesEdits} onChange={(value) => { (editingProfile === 'movie' ? setMovieEdits : setSeriesEdits)(value); setStandardPreview(null); }} />}
          {standardPreview && <div className="template-preview" role="status">
            <strong>将影响 {standardPreview.currentEntryPotentialGapCount || editorShelf?.deregistrationSummary.entryCount || 0} 个已上架条目</strong>
            <small>{reassessmentCopy(standardPreview.currentEntryPotentialGapCount || editorShelf?.deregistrationSummary.entryCount || 0, Math.max(0, standardPreview.affectedShelfCount - (editorShelf && editorShelf.standard.ruleTemplateId === standardPreview.templateId ? 1 : 0)), false)}</small>
          </div>}
        </div>
        <div className="dialog-actions">
          {error && <p className="form-error standard-editor-error" role="alert">{error}</p>}
          <Button type="button" disabled={loading} onClick={() => setStandardEditor(null)}>返回</Button>
          {error && standardConflict && <Button type="button" disabled={loading} onClick={() => { setStandardEditor(null); void load(); }}>返回查看最新规则</Button>}
          <Button type="button" disabled={loading} onClick={() => void previewStandard()}>{loading ? '正在预览…' : '预览影响'}</Button>
          <Button variant="primary" type="button" disabled={loading || !standardPreview} onClick={() => void publishStandard()}>发布整理标准</Button>
        </div>
      </div>
    </div>}
    {confirmShelf && <dialog ref={deregistrationDialog} className="shelf-deregister-dialog" aria-labelledby="shelf-deregister-title" onCancel={() => setConfirmShelf(null)} onClick={(event) => { if (event.target === event.currentTarget) setConfirmShelf(null); }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
    }}>
      <div className="dialog">
        <div className="dialog-head"><h2 id="shelf-deregister-title">永久注销“{confirmShelf.name}”</h2></div>
        <div className="dialog-body">
          <p>当前包含 {confirmShelf.deregistrationSummary.entryCount} 个收藏条目。进行中的上架、退出和健康修复会先安全收口。</p>
          <p>所有文件和目标目录都会原样保留。收藏记录会结束，且不可恢复。</p>
          <label><span>输入完整收藏架名称确认</span><input autoFocus value={enteredShelfName} onChange={(event) => setEnteredShelfName(event.target.value)} /></label>
          <label className="shelf-deregister-ack"><input type="checkbox" checked={preserveFilesAcknowledged} onChange={(event) => setPreserveFilesAcknowledged(event.target.checked)} /><span>我理解目标目录和其中全部文件将原样保留。</span></label>
          <label className="shelf-deregister-ack"><input type="checkbox" checked={releaseControlAcknowledged} onChange={(event) => setReleaseControlAcknowledged(event.target.checked)} /><span>我确认结束此收藏架对已上架文件的管理。</span></label>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setConfirmShelf(null)}>返回</Button>
          <Button variant="danger" type="button" disabled={loading || enteredShelfName !== confirmShelf.name || !preserveFilesAcknowledged || !releaseControlAcknowledged} onClick={() => void deregisterShelf()}>永久注销收藏架</Button>
        </div>
      </div>
    </dialog>}
  </section>;
}
