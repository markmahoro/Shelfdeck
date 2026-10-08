'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {artifactRequirement}=require('../../../contracts/product-artifact-requirement');
const {seriesArtifactContext,seriesNfoTargets}=require('./series-artifact-targets');
const SCHEMA_REF='helix://arca/inventory-artifact-scope/v1';
const KEYS=['schemaRef','schemaVersion','artifactKind','seasonNumber','episodeScope','requirementDigest',
  'sourcePackageId','sourceArtifactHandleId','sourceArtifactReferenceDigest','scopeDigest'].sort().join(',');
function validateInventoryArtifactScope(value) {
  const fail=()=>{throw new TypeError('Inventory Artifact scope is not an exact accepted Series NFO target.');};
  if(!value||Object.keys(value).sort().join(',')!==KEYS||value.schemaRef!==SCHEMA_REF||value.schemaVersion!==1||
      value.artifactKind!=='nfo'||!Number.isSafeInteger(value.seasonNumber)||value.seasonNumber<1||
      ![value.sourcePackageId,value.sourceArtifactHandleId].every(item=>typeof item==='string'&&item.length>0&&item.length<=256)||
      !/^[a-f0-9]{64}$/.test(value.sourceArtifactReferenceDigest)||Buffer.byteLength(canonicalJson(value))>4096)fail();
  if(value.episodeScope!==null&&value.episodeScope?.seasonNumber!==value.seasonNumber)fail();
  if(artifactRequirement('nfo',value.episodeScope).requirementDigest!==value.requirementDigest)fail();
  const {scopeDigest,...body}=value;if(scopeDigest!==canonicalDigest(body))fail();
  return value;
}
function readInventoryArtifactScope(row) {
  if(row.artifact_scope_json==null&&row.artifact_scope_schema_ref==null)return null;
  if(row.artifact_scope_schema_ref!==SCHEMA_REF||row.artifact_scope_json==null)throw new TypeError('Inventory Artifact scope schema reference is absent or invalid.');
  if(row.role!=='metadata_sidecar')throw new TypeError('Only NFO Inventory members may carry an Artifact scope.');
  const value=JSON.parse(row.artifact_scope_json);validateInventoryArtifactScope(value);
  if(canonicalJson(value)!==row.artifact_scope_json)throw new TypeError('Inventory Artifact scope must be canonical JSON.');
  return Object.freeze(value);
}
function acceptedInventoryArtifactScopes(packageValue) {
  const values=new Map();
  if(packageValue.productStructureSnapshot?.structureKind!=='season'||
      !packageValue.productMaterialManifest.members.some(member=>member.role==='metadata_sidecar'))return values;
  const context=seriesArtifactContext(packageValue);
  for(const target of seriesNfoTargets(packageValue)) {
    const {referenceDigest,...reference}=target.artifact;
    if(referenceDigest!==canonicalDigest(reference))throw new TypeError('Accepted Artifact reference digest is invalid.');
    const body={schemaRef:SCHEMA_REF,schemaVersion:1,artifactKind:'nfo',seasonNumber:context.seasonNumber,
      episodeScope:target.episodeScope,requirementDigest:target.artifact.requirementDigest,
      sourcePackageId:packageValue.onDeckPackageId,sourceArtifactHandleId:target.artifact.artifactHandleId,
      sourceArtifactReferenceDigest:referenceDigest};
    const scope=Object.freeze({...body,scopeDigest:canonicalDigest(body)});
    validateInventoryArtifactScope(scope);values.set(target.sourceMaterialKey,scope);
  }
  return values;
}
module.exports=Object.freeze({SCHEMA_REF,acceptedInventoryArtifactScopes,readInventoryArtifactScope,validateInventoryArtifactScope});
