import {canonicalDigest,type MovieRuleBranch,type RuleTemplateRules} from './api';
type Requirements=MovieRuleBranch['requirements']&{metadata:{requiredFieldCodes:string[];requiredArtifactKinds:string[]}};
export type JavRuleEdit={hevc:boolean;fourK:boolean;highQualityAudio:boolean;maxSizeGiB:string};
const javProfile=(rules:RuleTemplateRules)=>rules.profileRuleSets.find(profile=>profile.contentProfile==='jav');
export function javEditFromRules(rules:RuleTemplateRules):JavRuleEdit|null{
  const base=javProfile(rules)?.baseRequirements as Requirements|undefined;if(!base)return null;
  return {hevc:base.mandatoryMedia.videoCodec==='hevc',fourK:base.mandatoryMedia.minimumRasterClass==='4k',
    highQualityAudio:base.mandatoryMedia.acceptedPrimaryAudioClasses.length>0,maxSizeGiB:base.space.maxSizeGiB===null?'':String(base.space.maxSizeGiB)};
}
export async function applyJavEdit(rules:RuleTemplateRules,edit:JavRuleEdit){
  const next=structuredClone(rules),profile=javProfile(next),base=profile?.baseRequirements as Requirements|undefined;
  if(!profile||!base||profile.decisionBranches.length||profile.decisionInputKinds.length)throw new Error('JAV 标准已变化，请重新打开后编辑。');
  const maximum=edit.maxSizeGiB.trim()===''?null:Number(edit.maxSizeGiB);
  if(maximum!==null&&(!Number.isFinite(maximum)||maximum<=0||!Number.isSafeInteger(maximum*1073741824)))throw new Error('每部空间上限必须为空或有效的正数 GiB。');
  const original=base.mandatoryMedia;
  base.mandatoryMedia={...original,videoCodec:edit.hevc===(original.videoCodec==='hevc')?original.videoCodec:edit.hevc?'hevc':'any',
    minimumRasterClass:edit.fourK===(original.minimumRasterClass==='4k')?original.minimumRasterClass:edit.fourK?'4k':'none',
    acceptedPrimaryAudioClasses:edit.highQualityAudio===(original.acceptedPrimaryAudioClasses.length>0)?original.acceptedPrimaryAudioClasses:
      edit.highQualityAudio?['dts_hd_ma','dts_x','eac3_atmos','truehd','truehd_atmos']:[]};
  base.space={...base.space,maxSizeGiB:maximum,maxSizeBytes:maximum===null?null:maximum*1073741824};
  profile.profileRuleSetDigest=await canonicalDigest(Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='profileRuleSetDigest')) as never);return next;
}
export function JavRuleSummary({rules}:{rules:RuleTemplateRules}){
  const profile=javProfile(rules);if(!profile)return null;const base=profile.baseRequirements as Requirements|undefined;
  if(!base)return <p role="alert">JAV 标准读取失败。</p>;
  const fields:Record<string,string>={title:'标题'},artifacts:Record<string,string>={nfo:'NFO',poster:'海报',fanart:'背景图'},media=base.mandatoryMedia;
  return <section aria-label="JAV整理标准"><strong>JAV</strong><div className="movie-rule-grid"><div><b>每部影片</b>
    <span>{[media.videoCodec==='hevc'?'HEVC':'可播放视频',media.container==='matroska'?'Matroska (.mkv)':media.container,
      media.minimumRasterClass==='4k'?'4K':null,media.acceptedPrimaryAudioClasses.length?'高质量主音轨':null].filter(Boolean).join(' · ')}</span>
    <small>{base.space.maxSizeGiB===null?'不限制空间':`最多 ${base.space.maxSizeGiB} GiB`}</small>
    <small>必需资料：{base.metadata.requiredFieldCodes.map(field=>fields[field]||field).join('、')}</small>
    <small>{base.metadata.requiredArtifactKinds.map(kind=>artifacts[kind]||kind).join('、')}</small></div></div></section>;
}
export function JavRuleEditor({edit,onChange}:{edit:JavRuleEdit;onChange:(edit:JavRuleEdit)=>void}){
  return <div className="movie-rule-grid movie-rule-editor"><div><b>每部 JAV 影片</b>
    <label><input type="checkbox" checked={edit.hevc} onChange={event=>onChange({...edit,hevc:event.target.checked})}/><span>HEVC</span></label>
    <label><input type="checkbox" checked={edit.fourK} onChange={event=>onChange({...edit,fourK:event.target.checked})}/><span>4K</span></label>
    <label><input type="checkbox" checked={edit.highQualityAudio} onChange={event=>onChange({...edit,highQualityAudio:event.target.checked})}/><span>高质量主音轨</span></label>
    <label><span>每部空间上限 GiB</span><input type="number" min={0} step="any" placeholder="不限制" value={edit.maxSizeGiB} onChange={event=>onChange({...edit,maxSizeGiB:event.target.value})}/></label>
  </div></div>;
}
