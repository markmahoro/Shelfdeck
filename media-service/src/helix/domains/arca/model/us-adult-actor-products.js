'use strict';
const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertSelection}=require('../../../contracts/us-adult-actor-selection');
const {buildUsAdultTitle}=require('../../../contracts/us-adult-presentation');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {buildAftercareInventoryRequest}=require('./aftercare-placement');
const {retainedName}=require('../../../contracts/us-adult-retained-name');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_PRODUCT_INVALID'});}
function buildFacts(context,selection){
  assertSelection(selection,{shelfEntryId:context.shelfEntryId,aftercareCaseId:selection.aftercareCaseId});
  const metadata=context.raw.facts.find(item=>item.fact_kind==='product_metadata'),cast=context.raw.facts.find(item=>item.fact_kind==='media_cast'),
    title=buildUsAdultTitle({actorName:selection.personSnapshot.canonicalName,originalName:selection.originalName}).title;
  if(!metadata?.value||!cast?.value)fail('Actor update requires the exact original Inventory metadata and cast.');
  const relationBody={relationId:'arca-us-actor-'+canonicalDigest({caseId:selection.aftercareCaseId,personId:selection.personSnapshot.personId}),
    personId:selection.personSnapshot.personId,displayName:selection.personSnapshot.canonicalName,
    displayNameNormalized:selection.personSnapshot.canonicalName.trim().normalize('NFKC').toLowerCase(),role:'actor',
    source:selection.selectionOrigin==='specified'?'user_actor_choice':'face_reference_match',providerIdentities:[],originEvidenceDigest:selection.selectionDigest,
    confidenceClass:selection.selectionOrigin==='specified'?'user_confirmed':'strong'},actor={...relationBody,relationDigest:canonicalDigest(relationBody)},
    common={shelfEntryId:selection.shelfEntryId,aftercareCaseId:selection.aftercareCaseId,intentDigest:selection.intentDigest,
      selectionDigest:selection.selectionDigest,canonicalIdentityDigest:selection.canonicalIdentityDigest},
    metadataBody={schemaRef:'helix://contracts/application-types/ArcaUsAdultMetadataFact/v1',schemaVersion:1,...common,sourceFactDigest:metadata.fact_digest,
      descriptiveFacts:{entries:[...metadata.value.descriptiveFacts.entries.filter(item=>!['title','display_title'].includes(item.key)),{key:'title',value:title}]}},
    castBody={schemaRef:'helix://contracts/application-types/ArcaUsAdultActorFact/v1',schemaVersion:1,...common,sourceFactDigest:cast.fact_digest,
      personSnapshotDigest:selection.personSnapshot.snapshotDigest,referenceAssetId:selection.referenceAssetId,sourceBasisKind:'us_adult_actor_refresh',
      relations:[actor],relationCount:1,relationsDigest:canonicalDigest({schema:'arca.us-adult-actor-relations@1',relations:[actor]})};
  return {metadata:{...metadataBody,factDigest:canonicalDigest(metadataBody)},cast:{...castBody,factDigest:canonicalDigest(castBody)},actor};
}
function buildFilePlan({context,selection,outputs,inventoryPort,sourceTargetBinding,atMs}){
  if(context.raw.entry.current_inventory_revision!==selection.inventoryRevision||context.raw.inventory.representation_digest!==selection.representationDigest)
    fail('Actor File Plan requires its exact original Inventory revision.');
  const placement=buildAftercareInventoryRequest(context,inventoryPort,atMs,selection.aftercareCaseId,selection),counts={metadata_sidecar:0,poster:0},
    rows=[...context.raw.materials].sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)),members=rows.map((row,ordinal)=>{
      const target=placement.finalInventoryDecision.members.find(item=>item.sourceMaterialKey===row.material_key),kind={metadata_sidecar:'nfoHandle',poster:'posterHandle'}[row.role],
        original={rootLocation:sourceTargetBinding(context.shelfEntryId,row).rootLocation,location:row.location,physicalIdentity:physicalIdentityFromInventoryRow(row),bindingRevision:Number(row.binding_revision)};
      if(!target||Number(row.ordinal)!==ordinal)fail('Actor placement must cover every current Inventory member exactly once.');
      if(kind)counts[row.role]++;
      return {ordinal,role:row.role,original,source:kind?{kind:'actor_artifact',workspaceMaterialHandle:outputs[kind]}:{kind:'retained_inventory'},
        retainedLocation:path.join(path.dirname(row.location),retainedName(selection.aftercareCaseId,ordinal)),targetEndpointId:target.targetEndpointId,targetLocation:target.targetLocation};
    });
  if(rows.filter(row=>row.role==='primary_payload').length!==1||Object.values(counts).some(count=>count!==1))
    fail('Actor refresh requires one owned video, NFO and poster; unrelated owned sidecars remain in the same complete plan.');
  const body={schemaRef:'helix://contracts/domain-types/UsAdultActorFilePlan/v1',schemaVersion:1,aftercareCaseId:selection.aftercareCaseId,shelfEntryId:selection.shelfEntryId,
    intentId:selection.intentId,intentDigest:selection.intentDigest,selectionDigest:selection.selectionDigest,inventoryRevision:selection.inventoryRevision,
    representationDigest:selection.representationDigest,canonicalIdentityDigest:selection.canonicalIdentityDigest,placementDecisionDigest:placement.finalInventoryDecision.decisionDigest,
    target:placement.shelf.target,members};
  if(Buffer.byteLength(canonicalJson(body))>2*1024*1024)fail('Actor File Plan exceeds its complete bounded Entry scope.');
  return Object.freeze({...body,planDigest:canonicalDigest(body)});
}
module.exports=Object.freeze({buildFacts,buildFilePlan});
