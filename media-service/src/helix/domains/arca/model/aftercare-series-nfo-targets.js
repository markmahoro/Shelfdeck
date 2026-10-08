'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {readInventoryArtifactScope}=require('./inventory-artifact-scope');
const KINDS=new Set(['presentation:nfo_missing','presentation:nfo_corrupt','custody:nfo_corrupt']);

function invalid() {
  throw Object.assign(new Error('Series NFO repair lacks exact current Finding and Artifact target evidence.'),
    {code:'ARCA_AFTERCARE_SERIES_NFO_TARGET_STALE'});
}
function seriesNfoFindingDraft(code,material,repairability='attention_required') {
  if(!['nfo_missing','nfo_corrupt'].includes(code)||material.role!=='metadata_sidecar'||
      !['attention_required','auto_repair'].includes(repairability))invalid();
  const kind='presentation',severity='warning',basis=canonicalDigest({materialKey:material.material_key,
    endpointId:material.endpoint_id,location:material.location,bindingRevision:Number(material.binding_revision),
    artifactScope:canonicalDigest({schemaRef:material.artifact_scope_schema_ref??null,value:material.artifact_scope_json??null})});
  return Object.freeze({objectId:'arca-finding-'+canonicalDigest({kind,code,basis}).slice(0,40),revision:1,
    schemaRef:'helix://arca/findings/'+kind+'/'+code+'/'+severity+'/'+repairability+'/v1',
    snapshotDigest:canonicalDigest({kind,code,severity,repairability,basis}),objectKind:'finding-draft'});
}
function findingDigest(finding,material) {
  if(finding.findingKind==='custody:nfo_corrupt')return canonicalDigest({kind:'custody',code:'nfo_corrupt',
    severity:'warning',repairability:finding.repairability,basis:material.material_key});
  return seriesNfoFindingDraft(finding.findingKind.split(':')[1],material,finding.repairability).snapshotDigest;
}

function seriesNfoRepairTargets(context,care,history) {
  if(context.raw.entry.structure_kind!=='season'||care?.state!=='active'||
      care.careBasisDigest!==context.basis.digest||care.careRequirement?.careBasisDigest!==context.basis.digest)invalid();
  const {digest,...requirement}=care.careRequirement;
  if(digest!==care.careRequirementDigest||digest!==canonicalDigest(requirement))invalid();
  const effects=care.careRequirement.requiredEffects;
  if(!Array.isArray(effects)||new Set(effects.map(effect=>effect.objectId)).size!==effects.length)invalid();
  const materials=context.raw.materials.filter(row=>row.role==='metadata_sidecar'),targets=new Map();
  for(const effect of effects) {
    const findings=history.findings.filter(row=>row.findingId===effect.objectId&&row.findingDigest===effect.digest);
    if(findings.length!==1)invalid();
    const finding=findings[0];if(!KINDS.has(finding.findingKind))continue;
    const assessments=history.assessments.filter(row=>row.assessmentId===finding.assessmentId&&
      row.careBasisDigest===care.careBasisDigest&&row.assessmentKind===finding.findingKind.split(':')[0]);
    if(assessments.length!==1||finding.severity!=='warning'||!['attention_required','auto_repair'].includes(finding.repairability))invalid();
    const matches=materials.filter(material=>findingDigest(finding,material)===finding.findingDigest);
    if(matches.length!==1)invalid();
    const material=matches[0],scope=readInventoryArtifactScope(material);if(!scope)invalid();
    const previous=targets.get(material.material_key);
    if(previous&&finding.findingKind.startsWith('presentation:')&&previous.presentationCode&&
        previous.presentationCode!==finding.findingKind)invalid();
    targets.set(material.material_key,{material,scope,
      presentationCode:finding.findingKind.startsWith('presentation:')?finding.findingKind:previous?.presentationCode});
  }
  if(!targets.size)invalid();
  if(new Set([...targets.values()].map(target=>target.scope.requirementDigest)).size!==targets.size)invalid();
  return Object.freeze([...targets.values()].sort((a,b)=>a.material.material_key.localeCompare(b.material.material_key))
    .map(({material,scope})=>Object.freeze({material,scope})));
}

function seriesNfoProfileParameters(context,care,history,parameters) {
  const target=seriesNfoRepairTargets(context,care,history).find(item=>item.material.material_key===parameters.materialKey);
  if(!target||target.scope.scopeDigest!==parameters.artifactScopeDigest)invalid();
  const values={materialKey:target.material.material_key,artifactScopeDigest:target.scope.scopeDigest,
    careRequirementDigest:care.careRequirementDigest};
  if(!/^[a-f0-9]{64}$/.test(values.careRequirementDigest))invalid();
  return Object.freeze(Object.entries(values).map(([parameter,value])=>{
    const body={parameter,valueType:'string',value};return Object.freeze({...body,valueDigest:canonicalDigest(body)});
  }));
}

function resolveSeriesNfoProfile(context,care,history,profile) {
  if(!profile||profile.schemaRef!=='helix://contracts/domain-types/ArtifactProfile/v1'||profile.schemaVersion!==1||
      canonicalDigest(profile.artifactKinds)!==canonicalDigest(['nfo'])||profile.revision!==context.raw.shelf.current_standard_revision||
      profile.qualityPolicyDigest!==context.raw.standard.standard_digest)invalid();
  const {digest,...body}=profile;if(digest!==canonicalDigest(body))invalid();
  const values=profile.typedParameters;
  if(!Array.isArray(values)||values.length!==3||new Set(values.map(item=>item.parameter)).size!==3)invalid();
  const parameters=Object.fromEntries(values.map(item=>[item.parameter,item.value]));
  const expected=seriesNfoProfileParameters(context,care,history,parameters);
  if(canonicalDigest(values)!==canonicalDigest(expected))invalid();
  return seriesNfoRepairTargets(context,care,history).find(item=>item.material.material_key===parameters.materialKey);
}

module.exports=Object.freeze({seriesNfoFindingDraft,seriesNfoRepairTargets,seriesNfoProfileParameters,resolveSeriesNfoProfile});
