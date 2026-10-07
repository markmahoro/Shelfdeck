'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { requirementGapValue, requirementGapValueDigest } = require('../../../contracts/requirement-gap-values');
const {seriesInventoryMetadataFieldMissing}=require('./series-metadata');
const { effectiveRequirements } = require('./care-objective');
const { validManifest } = require('./authorized-defect-manifest');

const SCHEMA_REF='helix://contracts/application-types/ArcaDefectAuthorization/v1';
const MEDIA_CODES=new Set(['video_codec_unmet','container_unmet','file_extension_unmet',
  'minimum_raster_unmet','primary_audio_unmet','max_size_exceeded']);
const IDENTITY_FIELDS=new Set(['tmdb_movie_id','tmdb_series_id','internal_identity','jav_code','season_number','episode_number']);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function missingFields(context) {
  const fields=effectiveRequirements(context)?.metadata?.requiredFieldCodes || [];
  const metadata=context.raw.facts.find(item=>item.fact_kind==='product_metadata')?.value || {};
  const descriptive=new Map((metadata.descriptiveFacts?.entries || []).map(item=>[item.key,item.value]));
  const cast=context.raw.facts.find(item=>item.fact_kind==='media_cast')?.value;
  const relations=cast?.relations || context.raw.people || [];
  return fields.filter(field=>{
    const seriesMissing=seriesInventoryMetadataFieldMissing(context.raw,field);
    if(seriesMissing!==null)return seriesMissing;
    if(IDENTITY_FIELDS.has(field))return false; // Canonical Identity has its independent safety assessment.
    if(field==='actor')return !relations.some(item=>item.role==='actor');
    const value=descriptive.get(field);
    return value==null||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length;
  }).sort();
}

function findingGap(context,finding) {
  const [dimension,code]=String(finding.findingKind).split(':'),requirements=effectiveRequirements(context);
  let requirementCode,targetKind,targetId;
  if(dimension==='conformance'&&MEDIA_CODES.has(code)) {
    requirementCode=code;targetKind='media';targetId=context.raw.materials.find(item=>item.role==='primary_payload')?.material_key;
  } else if(dimension==='conformance'&&code.startsWith('metadata_field_missing__')) {
    requirementCode='metadata_field_unmet';targetKind='metadata_field';targetId=code.slice('metadata_field_missing__'.length);
    if(IDENTITY_FIELDS.has(targetId))return null;
  } else if(dimension==='presentation'&&['nfo_missing','poster_missing'].includes(code)) {
    requirementCode='artifact_unmet';targetKind='artifact';targetId=code==='nfo_missing'?'nfo':'poster';
    // A disappeared registered file is damage, never a newly waivable omission.
    if(context.raw.materials.some(item=>item.role===(targetId==='nfo'?'metadata_sidecar':'poster')))return null;
  } else return null;
  if(!targetId||!requirementGapValue(requirements,requirementCode,targetId))return null;
  const body={ownerDomain:'arca',shelfEntryId:context.shelfEntryId,requirementCode,targetKind,targetId,
    requiredValue:requirementGapValue(requirements,requirementCode,targetId),
    requiredValueDigest:requirementGapValueDigest(requirements,requirementCode,targetId),
    findingKind:finding.findingKind,findingDigest:finding.findingDigest};
  return Object.freeze({...body,gapDigest:canonicalDigest(body)});
}

function currentFindings(context,history) {
  const latest=new Map();
  for(const assessment of history.assessments || [])if(assessment.careBasisDigest===context.basis.digest&&
    (!latest.has(assessment.assessmentKind)||assessment.assessedAtMs>latest.get(assessment.assessmentKind).assessedAtMs))latest.set(assessment.assessmentKind,assessment);
  const complete=['custody','presentation','conformance'].every(kind=>latest.has(kind)&&latest.get(kind).result!=='not_assessable');
  const ids=new Set([...latest.values()].map(item=>item.assessmentId));
  return {complete,assessments:[...latest.values()],findings:(history.findings || []).filter(item=>ids.has(item.assessmentId)&&item.state==='open')};
}

function admissionPreview(context,history,authorization,at=Date.now()) {
  if(!context)fail('ARCA_DEFECT_ENTRY_MISSING','Current collection entry is unavailable.');
  const observed=currentFindings(context,history),gaps=[],reasons=[];
  if(context.raw.entry.structure_kind!=='single'||context.raw.identity?.identity_kind!=='tmdb_movie')reasons.push('movie_only');
  if(context.raw.shelf.status!=='active'||context.raw.reservations.some(item=>item.state==='active'))reasons.push('modification_fenced');
  if(history.cases.some(item=>['queued','active'].includes(item.state)))reasons.push('maintenance_in_progress');
  for(const finding of observed.findings){
    const manifest=context.authorizedDefectManifest;
    const permitted=validManifest(manifest)&&acceptedFinding(context,finding)&&manifest.defects.some(defect=>
      finding.findingKind==='conformance:metadata_field_missing__actor'&&defect.defectCode==='actor_unavailable'&&
        defect.sourceFailureCode==='product_metadata_required_cast_missing'||
      finding.findingKind==='conformance:max_size_exceeded'&&defect.defectCode==='size_cap_exceeded'&&
        defect.workspaceMediaVerificationId&&defect.workspaceMediaVerificationDigest);
    const gap=permitted?findingGap(context,finding):null;
    if(gap)gaps.push(gap);else reasons.push(finding.findingKind);
  }
  gaps.sort((a,b)=>a.gapDigest.localeCompare(b.gapDigest));
  const missingEvidence=!observed.complete?['current_health_assessment']:observed.assessments.some(item=>at-item.assessedAtMs>24*60*60*1000)?['fresh_health_assessment']:[];
  const base={shelfEntryId:context.shelfEntryId,inventoryRevision:context.basis.inventoryRevision,
    careBasisDigest:context.basis.digest,authorizationRevision:authorization?.revision || 0,
    gaps,gapSetDigest:canonicalDigest(gaps),evidenceDigest:canonicalDigest(observed.assessments.map(item=>item.evidenceDigest).sort()),
    eligibility:missingEvidence.length?'evidence_pending':reasons.length||!gaps.length?'ineligible':'eligible',
    missingEvidence,ineligibleReasons:[...new Set(reasons.length?reasons:!gaps.length?['no_current_gaps']:[])].sort()};
  if(Buffer.byteLength(canonicalJson(base))>65536)fail('ARCA_DEFECT_SCOPE_TOO_LARGE','The exact gap preview exceeds 64 KiB and cannot be truncated.');
  return Object.freeze({...base,candidateDigest:canonicalDigest(base)});
}

function validAuthorization(value) {
  if(!value||value.schemaRef!==SCHEMA_REF||!Array.isArray(value.gaps)||
    Buffer.byteLength(canonicalJson(value))>65536)return false;
  const {authorizationDigest,...body}=value;
  return authorizationDigest===canonicalDigest(body)&&value.gapSetDigest===canonicalDigest(value.gaps)&&
    value.gaps.every(gap=>{const {gapDigest,...rest}=gap;return gapDigest===canonicalDigest(rest);});
}

function acceptedFinding(context,finding) {
  const requirements=context.effectiveRequirements || (context.raw?effectiveRequirements(context):null);
  const admission=context.defectAuthorization;
  if(validAuthorization(admission)&&admission.shelfEntryId===context.shelfEntryId&&
    admission.gaps.some(gap=>gap.findingKind===finding.findingKind&&gap.findingDigest===finding.findingDigest&&
      requirements&&gap.requiredValueDigest===requirementGapValueDigest(requirements,gap.requirementCode,gap.targetId)))return true;
  if(validAuthorization(admission))return false;
  const manifest=context.authorizedDefectManifest;
  if(!validManifest(manifest))return false;
  const [dimension,code]=String(finding.findingKind).split(':');
  if(dimension==='presentation'&&['nfo_missing','poster_missing'].includes(code)&&manifest.gapScope&&requirements) {
    const kind=code==='nfo_missing'?'nfo':'poster',roles=context.materialRoles||context.raw?.materials?.map(item=>item.role);
    if(!roles||roles.includes(kind==='nfo'?'metadata_sidecar':kind))return false;
    return manifest.gapScope.gaps.some(gap=>gap.targetKind==='artifact'&&gap.targetId===kind&&
      gap.requiredValueDigest===requirementGapValueDigest(requirements,'metadata_artifact_unmet',kind));
  }
  if(dimension!=='conformance')return false;
  const field=code.startsWith('metadata_field_missing__')?code.slice('metadata_field_missing__'.length):null;
  if(manifest.gapScope){
    if(!requirements)return false;
    return manifest.gapScope.gaps.some(gap=>gap.requirementCode===(field?'metadata_field_unmet':code)&&
      (!field||gap.targetKind==='metadata_field'&&gap.targetId===field)&&
      gap.requiredValueDigest===requirementGapValueDigest(requirements,gap.requirementCode,gap.targetId));
  }
  // Historical v1 remains readable, but its actor-only decision never covers another field.
  if(field)return manifest.defects.some(item=>item.defectCode==='actor_unavailable'&&field==='actor');
  return MEDIA_CODES.has(code)&&manifest.waivedRequirementCodes.includes(code)&&Boolean(requirements&&context.originalRequirements)&&
    requirementGapValueDigest(requirements,code,'primary')===requirementGapValueDigest(context.originalRequirements,code,'primary');
}

module.exports=Object.freeze({SCHEMA_REF,MEDIA_CODES,missingFields,findingGap,currentFindings,
  admissionPreview,validAuthorization,acceptedFinding});
