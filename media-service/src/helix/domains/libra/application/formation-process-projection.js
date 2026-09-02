'use strict';

const CAPABILITY_COPY = Object.freeze({
  'procurement.triage.bdmv.assess@1':['检查光盘结构','已完成光盘结构检查。'],
  'procurement.triage.playability.inspect@1':['检查媒体是否可播放','已确认媒体可以进入后续整理。'],
  'procurement.triage.structure.inspect@1':['检查材料结构','已确认材料结构可以进入后续整理。'],
  'shared.material.media.probe@1':['读取媒体信息','已读取视频、音轨、字幕和文件信息。'],
  'procurement.triage.identity_claim.resolve@1':['确认材料中的影片身份','已从材料中确认影片身份线索。'],
  'procurement.triage.primary_manifest.build@1':['生成材料清单','已记录主媒体及相关材料。'],
  'procurement.candidate.publish@1':['将材料交给媒体整理','这批材料已经发布，等待媒体整理正式接收。'],
  'libra.intake.candidate.verify@1':['核对材料包','材料包的内容和来源已经核对。'],
  'libra.intake.material.verify@1':['核对实际材料','实际媒体材料已经核对。'],
  'libra.intake.binding.resolve@1':['建立整理材料记录','材料已经纳入本次媒体整理。'],
  'libra.intake.accept.commit@1':['接收整理材料','媒体整理已经正式接收材料。'],
  'libra.routing.fact.observe@1':['核对现有影片信息','已读取材料中现有的影片信息。'],
  'libra.decision_basis.commit@1':['保存本次整理决定','本次目标收藏架或整理要求已经确定。'],
  'libra.product_identity.evidence.observe@1':['查询影片资料','已获得可用于确认影片身份的查询结果。'],
  'libra.product_identity.resolve@1':['确认影片身份','已经确定本次媒体产品的影片身份。'],
  'libra.product_metadata.fetch@1':['获取影片资料','已经取得本次媒体产品需要的影片资料。'],
  'libra.product_artifact.acquire@1':['取得影片图片','已经取得本次媒体产品需要的图片。'],
  'libra.product_sidecar.render@1':['制作影片资料文件','影片资料文件已经生成。'],
  'shared.artifact.manifest.verify@1':['检查影片资料文件','影片资料文件已经通过检查。'],
  'libra.media_cast.resolve@1':['整理演职员信息','已经整理本片的演职员信息。'],
  'libra.media_cast.commit@1':['保存演职员信息','演职员信息已经保存到媒体产品。'],
  'libra.product_metadata.commit@1':['保存影片信息','影片资料已经保存到媒体产品。'],
  'libra.external_material.query.prepare@1':['准备寻源条件','已经冻结本次寻源使用的影片身份和媒体要求。'],
  'libra.external_material.search@1':['寻找合规媒体源','已经取得本次搜索的候选结果。'],
  'libra.external_material.candidate.select@1':['选择下载源','已经从合规候选中选出唯一下载源。'],
  'libra.external_material.acquire.request@1':['提交下载任务','唯一下载任务已经提交给外部下载服务。'],
  'libra.external_material.acquire.observe@1':['下载媒体文件','外部媒体已经下载并整理完成。'],
  'libra.external_material.output.resolve@1':['确认下载结果','已经确认外部下载形成的媒体文件。'],
  'libra.external_material.stability.observe@1':['等待文件稳定','外部媒体文件已经稳定，可以进入工作区。'],
  'libra.external_material.identity.verify@1':['核对下载影片身份','下载媒体的影片身份已经核对。'],
  'libra.external_material.package.verify@1':['检查下载媒体包','下载媒体包已经通过完整性检查。'],
  'libra.workspace.material.import@1':['导入整理工作区','下载媒体已经复制到本次整理工作区。'],
  'libra.product_media.verify@1':['检查媒体是否符合要求','已经逐项核对媒体与收藏要求。'],
  'libra.product_output.select@1':['选定最终媒体文件','已经记录本次选用的最终媒体文件。'],
  'libra.transcode.input.verify@1':['确认视频处理方式','已确认本次视频处理方式可以执行。'],
  'libra.media.transcode@1':['处理视频文件','已经生成符合本次处理要求的新版本。'],
  'libra.media.remux@1':['重新封装媒体文件','已经生成整理后的封装版本。'],
  'libra.product.conformance.verify@1':['检查最终媒体产品','已完成媒体、资料和图片的最终检查。'],
  'libra.product_package.publish@1':['将媒体产品交给收藏架','收藏架已经收到待验收的媒体产品。'],
  'arca.acceptance.identity.verify@1':['核对影片身份','媒体产品身份与本次上架目标一致。'],
  'arca.acceptance.metadata.verify@1':['检查影片资料','影片资料符合收藏架要求。'],
  'arca.acceptance.structure.verify@1':['检查媒体产品结构','媒体产品结构符合收藏架要求。'],
  'arca.acceptance.mandatory_media.verify@1':['检查必需媒体','必需媒体完整且可以读取。'],
  'arca.acceptance.space.verify@1':['检查收藏架空间','已核对本次上架需要的空间。'],
  'arca.acceptance.inventory_feasibility.observe@1':['检查上架可行性','已确认收藏架能够接收本次媒体产品。'],
  'arca.acceptance.accept.commit@1':['接收媒体产品','收藏架已经承担本次上架责任。'],
  'arca.acceptance.rejection.commit@1':['记录验收未通过','收藏架已经记录本次验收结果。'],
  'arca.inventory.target_slot.prepare@1':['准备目标位置','正式目标位置已经准备完成。'],
  'arca.inventory.product.stage@1':['写入媒体产品','媒体产品已经写入收藏架的暂存位置。'],
  'arca.inventory.staged.verify@1':['检查暂存文件','暂存文件与本次媒体产品一致。'],
  'arca.inventory.final_product.verify@1':['检查最终媒体产品','写入后的媒体产品已经完成检查。'],
  'arca.inventory.placement.switch@1':['切换到正式位置','媒体产品已经切换到正式位置。'],
  'arca.ondeck.input_settlement.delete@1':['处理原有输入','原有输入已经按本次上架决定处理。'],
  'arca.ondeck.fulfillment.verify@1':['确认收藏架中的最终状态','已核对收藏架中的最终文件状态。'],
  'arca.ondeck.commit@1':['完成上架','已经建立正式收藏记录。'],
});

const WORK_TITLES = Object.freeze({
  evidence_assessment:'检查材料结构', candidate_assembly:'准备整理材料',
  evidence:'接收整理材料', acceptance:'确认接收整理材料', rejection:'记录材料未接收',
  routing_nfo_facts:'核对现有影片信息', routing_provider_facts:'查询影片资料',
  routing_basis:'确定目标收藏架', acceptance_spec_basis:'确定整理要求',
  product_identity:'核对并确认影片身份', product_metadata_observation:'获取影片资料',
  artifact_production:'制作影片资料文件', product_sidecar_render:'制作影片资料文件',
  product_artifact_acquisition:'取得影片图片', artifact_verification:'检查影片资料文件',
  product_fact_assembly:'整理演职员和影片信息', source_media_observation:'检查原始媒体',
  product_conformance:'检查最终媒体产品',
  deliverable_promotion:'将媒体产品交给收藏架', acceptance_assessment:'检查媒体产品是否可以上架',
  acceptance_commit:'接收媒体产品', acceptance_rejection:'记录验收未通过',
  on_deck_execution:'将媒体写入收藏架',
});

const FAILURE_COPY = Object.freeze({
  CLEAN_ARCA_SETTLEMENT_HANDLE_INVALID:'无法确认这项原文件属于本次上架授权的处理范围',
  CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID:'本次计划没有保存完整的原文件与最终文件对应关系',
  CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT:'原文件与最终文件的对应关系已经发生变化',
  CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER:'原文件所在目录中出现了本次计划没有包含的文件',
  CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT:'原文件内容与计划核对时已经不一致',
  CLEAN_ARCA_SETTLEMENT_DELETE_FAILED:'原文件在完成替换后仍未能移除',
  CLEAN_ARCA_FINAL_REALITY_MISSING:'正式位置中没有找到本次写入的媒体产品',
  CLEAN_ARCA_FINAL_REALITY_DRIFT:'最终文件状态与本次计划记录不一致',
  CLEAN_ARCA_STAGED_NFO_SEMANTIC_DRIFT:'暂存位置中的 NFO 内容与本次已接受的媒体信息不一致',
  CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT:'正式位置中的 NFO 内容与本次已接受的媒体信息不一致',
  CLEAN_ARCA_PRODUCT_SOURCE_MISSING:'没有找到本次上架使用的媒体产品',
  CLEAN_ARCA_TARGET_ROOT_UNAVAILABLE:'目标收藏架当前无法访问',
  CLEAN_ARCA_TARGET_OCCUPIED:'目标位置已经存在其他媒体文件',
  CLEAN_ARCA_TARGET_COLLISION:'本次写入会与目标位置中的现有文件冲突',
  FENCE_REJECTED:'执行前核对发现文件或计划状态已经发生变化',
});

function readableToken(value) {
  return String(value || '').replace(/@\d+$/,'').split(/[./_-]+/).filter(Boolean).slice(-3).join(' ');
}
function valueAt(root, paths) {
  for (const path of paths) {
    let value = root;
    for (const key of path.split('.')) value = value?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}
function formatBytes(value) {
  const bytes=Number(value); if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return bytes >= 1073741824 ? (bytes / 1073741824).toFixed(bytes >= 10737418240 ? 1 : 2)+' GiB'
    : bytes >= 1048576 ? (bytes / 1048576).toFixed(1)+' MiB' : bytes+' B';
}
function formatDuration(value) {
  const ms=Number(value); if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes=Math.round(ms / 60000), hours=Math.floor(minutes / 60), rest=minutes % 60;
  return hours ? hours+' 小时 '+rest+' 分' : minutes+' 分钟';
}
function formatBitrate(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric=Number(value); if (!Number.isFinite(numeric)) return String(value);
  return numeric >= 1000000 ? (numeric / 1000000).toFixed(numeric % 1000000 ? 1 : 0)+' Mbps' : Math.round(numeric / 1000)+' Kbps';
}
function humanValue(value) {
  if (value === true) return '是'; if (value === false) return '否';
  const map={passed:'通过',failed:'未通过',resolved:'已确认',selected:'已选定',not_selected:'未选定',
    available:'可用',not_available:'不可用',accepted:'已接收',rejected:'未接收',succeeded:'已完成',
    procurement_candidate_published:'待整理材料包已发布',libra_binding_draft_resolved:'整理材料已确认',
    handoff_a_accepted:'媒体整理已正式接收',libra_product_package_published:'媒体产品已交给收藏架',
    handoff_b_accepted:'收藏架已接收',handoff_b_rejected:'收藏架未接收',placement_switched:'已进入正式位置',
    on_deck_committed:'已完成上架'};
  return map[value] || null;
}
function humanReason(value) {
  const reason=String(value || '');
  const exact={size_cap_exceeded:'文件超过收藏架允许的大小',max_size_exceeded:'文件超过收藏架允许的大小',minimum_raster_unmet:'画面清晰度未达到要求',
    video_codec_unmet:'视频格式未达到要求',metadata_field_unmet:'缺少收藏要求中的影片资料',
    primary_audio_unmet:'主要音轨未达到要求',product_metadata_required_cast_missing:'缺少收藏要求中的演员资料',
    CLEAN_ARCA_FINAL_REALITY_DRIFT:'最终文件状态与本次计划记录不一致',
    CLEAN_ARCA_PRODUCT_SOURCE_MISSING:'没有找到本次上架使用的媒体产品'};
  if (exact[reason]) return exact[reason];
  if (/size|too_large/i.test(reason)) return '文件大小未达到收藏要求';
  if (/identity/i.test(reason)) return '影片身份未能通过核对';
  if (/metadata|artifact|nfo|poster/i.test(reason)) return '影片资料或图片未能通过核对';
  if (/space/i.test(reason)) return '收藏架可用空间不足';
  return reason ? '运行未通过，详细原因已由系统记录' : null;
}
function failureMessage(value) {
  const code=String(value || ''); if (!code) return null;
  if (FAILURE_COPY[code]) return FAILURE_COPY[code];
  if (/REALITY_DRIFT|MAPPING_DRIFT|DECISION_DRIFT|MANIFEST_DRIFT|SLOT_DRIFT/.test(code)) return '执行时发现文件或计划状态已经发生变化';
  if (/SOURCE_MISSING|PRIMARY_MISSING|SLOT_MISSING/.test(code)) return '没有找到本步骤需要处理的文件';
  if (/TARGET_ROOT_UNAVAILABLE/.test(code)) return '目标收藏架当前无法访问';
  if (/TARGET_OCCUPIED|TARGET_COLLISION|STAGE_CONFLICT/.test(code)) return '目标位置与现有文件发生冲突';
  if (/DELETE_FAILED/.test(code)) return '计划要求移除的文件仍然存在';
  if (/PERMISSION|ACCESS_DENIED/.test(code)) return 'ShelfDeck 没有权限处理目标文件';
  if (/TIMEOUT|DEADLINE/.test(code)) return '这一步在允许时间内没有完成';
  return null;
}
function addFact(facts, label, value) {
  if (!['string','number','bigint','boolean'].includes(typeof value) || value === '' || facts.some((item)=>item.label===label)) return;
  facts.push(Object.freeze({ label, value:String(value) }));
}
function displayIdentityEntries(value) {
  if (!value || typeof value!=='object' || !Array.isArray(value.entries)) return new Map();
  return new Map(value.entries.filter((item)=>item && typeof item.key==='string' &&
    ['string','number','bigint','boolean'].includes(typeof item.value)).map((item)=>[item.key,item.value]));
}
function identityDisplayScalar(value) {
  return ['string','number','bigint'].includes(typeof value) && String(value).trim() ? value : null;
}
function identityPresentation(value) {
  const display=value?.displayIdentity, entries=displayIdentityEntries(display);
  const directTitle=valueAt(value,['claimedDisplayIdentity','title','metadata.title','identity.title','candidate.displayTitle']);
  const directYear=valueAt(value,['releaseYear','year','metadata.releaseYear','identity.releaseYear']);
  const title=identityDisplayScalar(display) ?? identityDisplayScalar(directTitle) ??
    identityDisplayScalar(entries.get('title')) ?? identityDisplayScalar(entries.get('display_title'));
  const year=identityDisplayScalar(directYear) ?? identityDisplayScalar(entries.get('year'));
  return Object.freeze({ title, year });
}
function resultEntryMap(value) {
  return new Map(Array.isArray(value?.postDeleteReality?.entries)
    ? value.postDeleteReality.entries.map((entry)=>[entry.key,entry.value]) : []);
}
function settlementAction(event) {
  if (event.capabilityRef!=='arca.ondeck.input_settlement.delete@1') return null;
  const entries=resultEntryMap(event.result?.result), disposition=entries.get('disposition');
  if (disposition==='retained_as_final') return '保留原有输入作为最终文件';
  if (disposition==='settled_to_final') return '移除已完成替换的原有输入';
  return null;
}
function addSettlementFacts(facts, event, value) {
  if (event.capabilityRef!=='arca.ondeck.input_settlement.delete@1') return;
  const entries=resultEntryMap(value), disposition=entries.get('disposition'), directory=entries.get('old_directory_disposition');
  const dispositionCopy={retained_as_final:'原有输入已保留为最终文件',
    settled_to_final:entries.get('absent')===true?'原有输入已移除，最终文件已确认':'原有输入已经完成替换'};
  const directoryCopy={removed_empty:'原目录为空，已经一并移除',retained_as_final:'原目录就是最终位置，继续保留',
    retained_with_final_inventory:'原目录仍包含最终媒体文件，继续保留',
    awaiting_managed_settlement:'原目录中仍有后续计划需要处理的内容',not_present:'原目录已经不存在'};
  addFact(facts,'处理结果',dispositionCopy[disposition]);
  addFact(facts,'原目录',directoryCopy[directory]);
}
function resultFacts(event) {
  const value=event.result?.result, facts=[];
  const failureCode=event.failure?.failureCode;
  if (failureCode) {
    addFact(facts,'失败原因',event.failure.message || failureMessage(failureCode) || '系统没有保存可展示的文字原因');
    addFact(facts,'失败代码',failureCode);
  }
  if (value && typeof value === 'object') {
    const {title,year}=identityPresentation(value);
    const result=valueAt(value,['result','resultKind','outcome','decision','receiptKind']);
    const reason=valueAt(value,['reasonCode','selectionReasonCode','failureCode','code']);
    const count=valueAt(value,['memberCount','primaryCount','candidateMatchCount','matchedCount']);
    const size=valueAt(value,['spaceSummary.actualSizeBytes','sizeBytes','physicalIdentity.sizeBytes','workspaceMaterialHandle.sizeBytes','mediaSummary.sizeBytes']);
    const maxSize=valueAt(value,['spaceSummary.maxSizeBytes']);
    const duration=valueAt(value,['durationMs','mediaSummary.durationMs']);
    const video=(value.videoStreams || value.mediaSummary?.videoStreams || [])[0];
    const audio=(value.audioStreams || value.mediaSummary?.audioStreams || [])[0];
    addFact(facts,'获得的信息',title && year ? title+'（'+year+'）' : title);
    addFact(facts,/verify|inspect|assess/.test(event.capabilityRef) ? '检查结果' : '运行结果',result === null ? null : humanValue(result));
    addFact(facts,'数量',count);
    addFact(facts,'文件大小',formatBytes(size));
    addFact(facts,'收藏上限',formatBytes(maxSize));
    addFact(facts,'时长',formatDuration(duration));
    if (video) {
      const codec=valueAt(video,['codecName','codec','codec_name']), width=valueAt(video,['displayWidth','width','codedWidth']), height=valueAt(video,['displayHeight','height','codedHeight']);
      addFact(facts,'视频',[codec && String(codec).toUpperCase(),width&&height&&(width+' × '+height)].filter(Boolean).join(' · '));
      addFact(facts,'画面',valueAt(video,['dynamicRangeKind','hdrFormat','colorTransfer']));
    }
    addFact(facts,'主要音轨',audio && [valueAt(audio,['codecName','codec']),valueAt(audio,['channelLayout','audioClass'])].filter(Boolean).join(' · '));
    addSettlementFacts(facts,event,value);
    if (Array.isArray(value.reasonCodes) && value.reasonCodes.length) addFact(facts,'核对说明',value.reasonCodes.map(humanReason).join('、'));
    addFact(facts,'未通过原因',humanReason(reason));
  }
  if (!facts.length && value && typeof value === 'object') addFact(facts,'保存结果','本步骤的实际运行结果已保存');
  return Object.freeze(facts.slice(0,6));
}
function literalBindings(event) {
  return new Map((event.inputBindings?.bindings || []).filter((item)=>item.bindingKind==='literal')
    .map((item)=>[item.portName,item.value]));
}
function transcodeDetails(event) {
  if (event.capabilityRef !== 'libra.media.transcode@1') return null;
  const bindings=literalBindings(event), intent=bindings.get('encodeIntent') || {}, device=bindings.get('mediaExecutionDeviceSnapshot') || {};
  const video=intent.video || {}, audio=intent.audio || {}, subtitle=intent.subtitle || {}, container=intent.container || intent.output || {};
  const classLabels={intel_qsv:'Intel QSV',nvidia_nvenc:'NVIDIA NVENC',amd_vaapi:'AMD VAAPI',software_cpu:'CPU 软件编码',remote_worker:'远程处理节点'};
  const operationLabels={preserve:'保留原画面',preserve_hdr:'保留 HDR',copy:'保留原始内容',tone_map_to_sdr_bt709:'转换为 SDR'};
  const fields=[];
  addFact(fields,'转码工具','FFmpeg');
  addFact(fields,'处理方式',classLabels[device.deviceClass || event.executionDeviceClass] || device.deviceClass || event.executionDeviceClass);
  addFact(fields,'视频格式',valueAt(video,['codec','codecName','outputCodec'])?.toString().toUpperCase());
  addFact(fields,'文件格式',valueAt(container,['format','container','name']) || valueAt(intent,['containerFormat','outputContainer']));
  addFact(fields,'目标码率',formatBitrate(valueAt(video,['targetBitrate','bitrate','targetBitrateBps'])));
  const dynamicRange=valueAt(video,['dynamicRangeOperation','hdrMode']), audioMode=valueAt(audio,['mode','operation']), subtitleMode=valueAt(subtitle,['mode','operation']);
  addFact(fields,'画面处理',operationLabels[dynamicRange] || dynamicRange);
  addFact(fields,'音轨',operationLabels[audioMode] || audioMode);
  addFact(fields,'字幕',operationLabels[subtitleMode] || subtitleMode);
  const parameters=[];
  for (const [key,value] of Object.entries({
    hardware_accel:device.deviceClass || event.executionDeviceClass,
    pipeline_profile:video.pipelineProfileId, rate_control:video.rateControlMode,
    target_bitrate:valueAt(video,['targetBitrate','bitrate','targetBitrateBps']),
    hdr_mode:valueAt(video,['dynamicRangeOperation','hdrMode']), audio_mode:valueAt(audio,['mode','operation']),
    subtitle_mode:valueAt(subtitle,['mode','operation']), output_container:valueAt(container,['format','container','name']) || valueAt(intent,['containerFormat','outputContainer']),
  })) if (value !== undefined && value !== null && value !== '') parameters.push(Object.freeze({ label:key, value:String(value) }));
  return Object.freeze({ summary:'仅显示本次真实计划中已经冻结的处理方式；内部路径和运行标识已隐藏。',
    fields:Object.freeze(fields), parameters:Object.freeze(parameters) });
}
function nodeState(event) {
  if (event.result?.outcomeKind==='failed' || event.state==='failed') return 'failed';
  if (event.state==='cancelled') return 'cancelled';
  if (event.state==='skipped') return 'skipped';
  if (event.state==='succeeded' || event.result?.outcomeKind==='succeeded') return 'completed';
  if (['ready','executing','waiting_for_resource','waiting_for_external','waiting_for_approval'].includes(event.state)) return 'running';
  return 'pending';
}
function nodeStatusText(event, state) {
  if (state==='completed') return '已完成';
  if (state==='failed') return '执行失败';
  if (state==='cancelled') return '未执行';
  if (state==='skipped') return '无需执行';
  if (event.state==='waiting_for_resource') return '等待处理资源';
  if (event.state==='waiting_for_external') {
    if (event.capabilityRef==='libra.external_material.acquire.observe@1' && event.progress?.mode==='determinate') {
      return Number(event.progress.rate)>0 ? '正在下载' : '等待下载数据';
    }
    return '等待外部服务';
  }
  if (event.state==='waiting_for_approval') return '等待确认';
  if (event.state==='executing') return '正在执行';
  if (event.state==='ready') return '准备执行';
  return state==='running' ? '进行中' : '等待前序步骤';
}
function topologicalEvents(events, edges) {
  const byId=new Map(events.map((event)=>[event.nodeId,event])), indegree=new Map(events.map((event)=>[event.nodeId,0])), next=new Map();
  for (const edge of edges || []) if (byId.has(edge.fromNodeId) && byId.has(edge.toNodeId)) {
    indegree.set(edge.toNodeId,(indegree.get(edge.toNodeId)||0)+1);
    next.set(edge.fromNodeId,[...(next.get(edge.fromNodeId)||[]),edge.toNodeId]);
  }
  const queue=[...events.filter((event)=>indegree.get(event.nodeId)===0)].sort((a,b)=>a.nodeId.localeCompare(b.nodeId)), ordered=[];
  while (queue.length) { const event=queue.shift(); ordered.push(event); for (const id of next.get(event.nodeId)||[]) {
    indegree.set(id,indegree.get(id)-1); if (indegree.get(id)===0) queue.push(byId.get(id));
    queue.sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
  } }
  return ordered.length===events.length ? ordered : events.slice().sort((a,b)=>a.nodeId.localeCompare(b.nodeId));
}
function planState(nodes, resolution='planned') {
  if (resolution==='no_effect_required') return 'completed';
  if (resolution==='contract_unplannable') return 'attention';
  if (resolution==='temporarily_unplannable') return 'pending';
  if (nodes.some((node)=>node.state==='failed')) return 'attention';
  if (nodes.some((node)=>node.state==='running')) return 'running';
  if (nodes.length && nodes.every((node)=>['completed','skipped'].includes(node.state))) return 'completed';
  if (nodes.some((node)=>node.state==='cancelled')) return 'attention';
  return 'pending';
}
function description(event, state, copy) {
  if (state==='completed') return settlementAction(event) ? settlementAction(event)+'。' : copy[1];
  if (state==='failed') {
    const message=event.failure?.message || failureMessage(event.failure?.failureCode);
    if (message) return '这一步没有完成：'+message+'。';
    if (event.failure?.failureCode) return '这一步没有完成；ShelfDeck 记录的失败代码是 '+event.failure.failureCode+'。';
    return '这一步没有完成；系统没有保存可展示的失败原因。';
  }
  if (state==='cancelled') return '前置步骤未完成，因此这一步没有执行。';
  if (state==='skipped') return '本次计划确认不需要执行这一步。';
  if (state==='running') {
    if (event.capabilityRef==='libra.media.transcode@1') return '正在生成符合收藏要求的新版本。';
    if (event.capabilityRef==='libra.external_material.acquire.observe@1') return Number(event.progress?.rate)>0
      ? 'MoviePilot 正在下载唯一选定的媒体源。'
      : '下载任务已经提交，正在等待来源提供数据。';
    return 'ShelfDeck 正在执行这一步。';
  }
  return '等待前置步骤完成后执行。';
}
function workspaceMediaPlanTitle(events, nodes) {
  const capabilities=new Set(events.map((event)=>event.capabilityRef));
  if (capabilities.has('libra.external_material.acquire.observe@1')) return '下载外部媒体';
  if (capabilities.has('libra.external_material.search@1')) return '寻找外部媒体';
  if (capabilities.has('libra.workspace.material.import@1')) return '导入外部媒体';
  if (capabilities.has('libra.media.transcode@1')) return '处理媒体文件';
  if (capabilities.has('libra.media.remux@1')) return '重新封装媒体文件';
  if (capabilities.has('libra.transcode.input.verify@1')) return '确认视频处理方式';
  if (capabilities.has('libra.product_media.verify@1') && capabilities.has('libra.product_output.select@1')) {
    return '判断原片是否可以直接使用';
  }
  if (capabilities.has('shared.material.media.probe@1')) return '读取原始媒体信息';
  return nodes[0]?.label || '处理媒体文件';
}
function planTitle(work, events, nodes) {
  if (work.workKind==='workspace_media_production') return workspaceMediaPlanTitle(events,nodes);
  return WORK_TITLES[work.workKind] || nodes[0]?.label || readableToken(work.workKind);
}
function projectPlans(works) {
  const groups=new Map();
  for (const work of works) {
    for (const plan of work.plans || []) groups.set(plan.planId,{work,plan,events:[]});
    for (const event of work.events || []) {
      const current=groups.get(event.planId) || { work, plan:event.plan, events:[] }; current.events.push(event); groups.set(event.planId,current);
    }
  }
  return Object.freeze([...groups.values()].sort((a,b)=>a.plan.createdAtMs-b.plan.createdAtMs || a.plan.planId.localeCompare(b.plan.planId)).map((group)=>{
    const ordered=topologicalEvents(group.events,group.plan.edges);
    const baseLabels=ordered.map((event)=>settlementAction(event) || (CAPABILITY_COPY[event.capabilityRef] || [readableToken(event.capabilityRef)])[0]);
    const labelTotals=new Map(); for (const label of baseLabels) labelTotals.set(label,(labelTotals.get(label)||0)+1);
    const labelOrdinals=new Map();
    const nodes=ordered.map((event,index)=>{
      const state=nodeState(event), copy=CAPABILITY_COPY[event.capabilityRef] || [readableToken(event.capabilityRef),'该步骤的实际运行结果已保存。'];
      const baseLabel=baseLabels[index], ordinal=(labelOrdinals.get(baseLabel)||0)+1; labelOrdinals.set(baseLabel,ordinal);
      // A pending settlement freezes only an opaque materialKey. Use its real Plan order instead of leaking or guessing identity.
      const label=labelTotals.get(baseLabel)>1 ? baseLabel+'（第 '+ordinal+' 项）' : baseLabel;
      return Object.freeze({ nodeId:event.nodeId, label, description:description(event,state,copy), state,
        statusText:nodeStatusText(event,state),
        progress:event.progress || null, results:resultFacts(event), technicalDetail:transcodeDetails(event) });
    });
    const state=planState(nodes,group.plan.state);
    return Object.freeze({ planId:group.plan.planId, title:planTitle(group.work,group.events,nodes),
      state, createdAtMs:group.plan.createdAtMs, nodes:Object.freeze(nodes) });
  }));
}
function currentResponsibilityWorks(works) {
  const current=new Map();
  for (const work of works) {
    const key=[work.ownerDomain,work.processType,work.processId,work.workKind].join('\0');
    const previous=current.get(key);
    if (!previous || Number(work.createdAtMs)>Number(previous.createdAtMs) ||
      (Number(work.createdAtMs)===Number(previous.createdAtMs) && String(work.workId).localeCompare(String(previous.workId))>0)) {
      current.set(key,work);
    }
  }
  return [...current.values()];
}
const BUSINESS_STAGE_STATES = new Set(['not_started','in_progress','attention','completed']);
function stageState(plans, works=[], businessState) {
  if (!BUSINESS_STAGE_STATES.has(businessState)) throw new TypeError('Formation process stage requires a business completion state.');
  if (businessState==='completed') return 'completed';
  const currentWorks=currentResponsibilityWorks(works);
  if (currentWorks.some((work)=>['admitted','ready','running'].includes(work.state))) return 'running';
  if (currentWorks.some((work)=>['failed','blocked'].includes(work.state))) return 'attention';
  if (plans.some((plan)=>plan.state==='attention')) return 'attention';
  if (plans.some((plan)=>plan.state==='running')) return 'running';
  if (businessState==='attention') return 'attention';
  if (businessState==='in_progress') return 'running';
  return 'pending';
}
function stageSummary(label, plans, works, businessState) {
  const state=stageState(plans,works,businessState); let current=-1;
  for (let index=plans.length-1;index>=0;index-=1) if (plans[index].state===state) { current=index; break; }
  if (!plans.length) {
    if (state==='completed') return '本阶段的业务结果已经成立；当前没有可展示的实际计划';
    return label==='验收与上架' ? '等待媒体整理完成；当前还没有形成这一阶段的计划' : '当前还没有形成可展示的计划';
  }
  if (state==='completed') return '共 '+plans.length+' 个实际计划，本阶段业务结果已完成';
  if (current>=0) return '计划'+(current+1)+(state==='attention'?'需要处理':'正在进行');
  if (state==='running' && plans.every((plan)=>plan.state==='completed')) return '已有 '+plans.length+' 个实际计划完成，等待本阶段继续推进';
  return plans.length+' 个真实计划，等待继续执行';
}
function stage(key, label, descriptionText, works, businessState) {
  const plans=projectPlans(works); return Object.freeze({ key,label,description:descriptionText,
    state:stageState(plans,works,businessState),summary:stageSummary(label,plans,works,businessState),plans });
}
function workBindsCandidate(work, scope) {
  return (work.events || []).some((event)=>{
    if (event.capabilityRef!=='procurement.candidate.publish@1') return false;
    const packageBound=!scope.candidatePackageId ||
      event.result?.result?.candidatePackageId===scope.candidatePackageId;
    const unitBound=!scope.structureUnitId || (event.inputBindings?.bindings || [])
      .some((binding)=>binding?.parameters?.unitId===scope.structureUnitId);
    return packageBound && unitBound;
  });
}
function workMatchesScope(work, scope) {
  if (work.processType!==scope.processType || work.processId!==scope.processId) return false;
  if (work.ownerDomain==='procurement' && work.processType==='procurement_run') {
    if (!scope.candidatePackageId && !scope.structureUnitId) return false;
    return work.workKind==='candidate_assembly' && workBindsCandidate(work,scope);
  }
  if (!scope.candidatePackageId && !scope.structureUnitId) return true;
  return workBindsCandidate(work,scope);
}
function buildFormationProcessDetail(input) {
  const businessStates=input.businessStageStates;
  if (!businessStates || !BUSINESS_STAGE_STATES.has(businessStates.materialPreparation) ||
      !BUSINESS_STAGE_STATES.has(businessStates.mediaOrganization) ||
      !BUSINESS_STAGE_STATES.has(businessStates.acceptanceShelving)) {
    throw new TypeError('Formation process detail requires explicit business stage states.');
  }
  const exact=(works,ownerDomain,scopes)=>works.filter((work)=>work.ownerDomain===ownerDomain && scopes.some((scope)=>
    workMatchesScope(work,scope)));
  const procurement=exact(input.works,'procurement',input.procurementScopes || []);
  const libra=exact(input.works,'libra',input.libraScopes || []);
  const arca=exact(input.works,'arca',input.arcaScopes || []);
  return Object.freeze({ contract:'formation_process_actual_plans@1', stages:Object.freeze([
    stage('material_preparation','材料准备','发现并准备《'+input.displayIdentity+'》的原始媒体材料',procurement,businessStates.materialPreparation),
    stage('media_organization','媒体整理',input.targetShelfName ? '按“'+input.targetShelfName+'”收藏架的要求制作媒体产品' : '确定收藏目标并制作媒体产品',libra,businessStates.mediaOrganization),
    stage('acceptance_shelving','验收与上架','由收藏架检查并接收最终媒体产品',arca,businessStates.acceptanceShelving),
  ]) });
}

function currentPlanSummary(detail) {
  const stages=detail?.stages || [];
  const finalStage=stages.at(-1);
  const stage=finalStage?.state==='completed' ? finalStage :
    stages.find((item)=>item.state==='running') || stages.find((item)=>item.state==='attention');
  if (!stage) return null;
  let planIndex=-1;
  for (let index=stage.plans.length-1;index>=0;index-=1) {
    if (stage.plans[index].state===stage.state) { planIndex=index; break; }
  }
  if (planIndex<0) return null;
  const plan=stage.plans[planIndex];
  const node=plan.nodes.find((item)=>item.state==='running'||item.state==='failed') || plan.nodes.at(-1) || null;
  return Object.freeze({ stageKey:stage.key, planId:plan.planId, planNumber:planIndex+1, title:plan.title,
    label:'计划'+(planIndex+1)+' '+plan.title, state:plan.state, statusText:node?.statusText || null,
    progress:node?.progress || null });
}

module.exports=Object.freeze({ buildFormationProcessDetail, currentPlanSummary, nodeState, projectPlans, resultFacts, transcodeDetails });
