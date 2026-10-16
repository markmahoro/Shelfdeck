'use strict';
const {readJavAftercareVerifiedSource}=require('./jav-aftercare-source-reader');
const {acceptedFactDigest}=require('../../../contracts/related-primary-mappings');

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { acceptedProductRequirements } = require('../model/accepted-product-requirements');
const { validManifest } = require('../model/authorized-defect-manifest');
const { effectiveRequirements } = require('../model/care-objective');
const {inventoryContentProfile}=require('../model/product-content-profile');
const { excludeCompletedSettlementBindings } = require('../model/completed-settlement-bindings');
const { createAftercareStore } = require('../persistence/aftercare-store');

function sealed(schemaRef, objectId, revision, body) {
  const base={schemaRef,schemaVersion:1,objectId,revision,...body};return Object.freeze({...base,digest:canonicalDigest(base)});
}
function usesRatingDecision(standardValue,structureKind,identity){const contentProfile=inventoryContentProfile(identity,structureKind),profile=(standardValue?.profileRuleSets||[]).find((item)=>
  item.contentProfile===contentProfile);
  return Boolean(profile?.decisionInputKinds?.includes('rating'));
}
function defectManifest(facts){const row=(facts||[]).find((item)=>item.fact_kind==='authorized_defect_manifest');if(!row)return null;try{return JSON.parse(row.fact_json);}catch{return null;}}
function createAftercareContextReader(options){const store=options.aftercareStore||createAftercareStore(options);
  const requirementCache=new Map();
  function originalRequirements(items) {
    const requested=new Map();
    for(const item of items) {
      const manifest=item.authorizedDefectManifest,ref=item.acceptedPackageReference;
      if(!validManifest(manifest)||manifest.gapScope)continue;
      if(!ref||typeof options.productDeliveryPort?.readAcceptedRequirements!=='function')
        throw Object.assign(new Error('Accepted Product requirement evidence is unavailable.'),{code:'ARCA_ACCEPTED_REQUIREMENTS_UNAVAILABLE'});
      const key=ref.onDeckPackageId+':'+ref.expectedPackageDigest;
      if(!requirementCache.has(key))requested.set(ref.onDeckPackageId,ref);
    }
    const refs=[...requested.values()];
    for(let offset=0;offset<refs.length;offset+=500) {
      const batch=refs.slice(offset,offset+500),result=options.productDeliveryPort.readAcceptedRequirements({
        queryContract:'libra.accepted-product-requirements@1',
        packages:batch.map(ref=>({onDeckPackageId:ref.onDeckPackageId,expectedPackageDigest:ref.expectedPackageDigest}))});
      for(const ref of batch) {
        const delivery=result.items.find(value=>value.onDeckPackageId===ref.onDeckPackageId);
        if(delivery?.resultKind!=='found')throw Object.assign(new Error('Accepted Product requirement snapshot is missing.'),{code:'ARCA_ACCEPTED_REQUIREMENTS_UNAVAILABLE'});
        requirementCache.set(ref.onDeckPackageId+':'+ref.expectedPackageDigest,delivery);
      }
    }
    const result=new Map(items.map(item=>{
      const ref=item.acceptedPackageReference,manifest=item.authorizedDefectManifest;
      return [item.shelfEntryId,ref&&validManifest(manifest)&&!manifest.gapScope
        ?acceptedProductRequirements(ref,requirementCache.get(ref.onDeckPackageId+':'+ref.expectedPackageDigest),manifest):null];
    }));
    while(requirementCache.size>256)requirementCache.delete(requirementCache.keys().next().value);
    return result;
  }
  function normalizedRatingTarget(item){
    const source=item.ratingTarget,identity=typeof options.buildRatingTargetIdentity==='function'
      ?options.buildRatingTargetIdentity(source):source;
    const body={targetType:source.targetType,targetId:source.targetId,targetRevision:source.targetRevision,
      title:identity.title,year:identity.year,providerIdentity:identity.providerIdentity,
      canonicalIdentityDigest:source.canonicalIdentityDigest};
    return Object.freeze({...body,targetDigest:canonicalDigest(body)});
  }
  function careBasis(shelfEntryId,inventoryRevision,standardRevision,placementRevision,canonicalIdentityDigest,sourcePackageId,factDigests,decisionFactDigests){const decisionFactSetDigest=canonicalDigest({schema:'arca.aftercare-decision-facts@1',shelfEntryId,facts:[...decisionFactDigests].sort()}),acceptedProductFactSetDigest=canonicalDigest({schema:'arca.aftercare-accepted-product-facts@1',shelfEntryId,facts:[...factDigests].sort()});return sealed('helix://contracts/domain-types/CareBasis/v1',shelfEntryId+':care-basis',1,{shelfEntryId,inventoryRevision,standardRevision,placementRevision,canonicalIdentityDigest,sourcePackageId,acceptedProductFactSetDigest,decisionFactSetDigest,assessments:Object.freeze([])});}
  function read(shelfEntryId){const stored=store.currentContext(shelfEntryId);if(!stored||stored.entry.status!=='active')return null;
    const settled=excludeCompletedSettlementBindings(stored,options.workResultReader),verified=readJavAftercareVerifiedSource(settled,options.workResultReader),
      raw=verified?Object.freeze({...settled,javMetadataVerifiedSource:verified}):settled;
    const ratingRelevant=usesRatingDecision(raw.standard.value,raw.entry.structure_kind,raw.identity),perceptionRating=ratingRelevant&&typeof options.readPerceptionRating==='function'?options.readPerceptionRating(shelfEntryId):null,decisionDigests=ratingRelevant?[...raw.facts.filter((x)=>x.fact_kind==='decision_fact').map((x)=>x.fact_digest),...(perceptionRating?.state==='ready'&&perceptionRating.resolutionDigest?[perceptionRating.resolutionDigest]:[])]:[],basis=careBasis(shelfEntryId,raw.entry.current_inventory_revision,raw.shelf.current_standard_revision,raw.shelf.current_placement_revision,raw.identity.identity_digest,raw.inventory.source_package_id,raw.facts.filter((x)=>x.fact_kind!=='decision_fact').map(acceptedFactDigest),decisionDigests);
    const currentLocations=new Set(raw.materials.map((item)=>item.location));
    const bindings=[...raw.materials.map((item)=>Object.freeze({objectId:shelfEntryId+':binding:'+item.ordinal,revision:Number(item.binding_revision),schemaRef:'helix://arca/types/MaterialBindingSnapshot/v1',digest:canonicalDigest({materialKey:item.material_key,endpointId:item.endpoint_id,location:item.location,sizeBytes:Number(item.size_bytes),digestHex:item.digest_hex}),objectKind:'arca-material-binding'})),...(raw.oldBindings||[]).filter((item)=>!currentLocations.has(item.location)).map((item)=>Object.freeze({objectId:shelfEntryId+':old-binding:'+item.material_key,revision:Number(item.binding_revision),schemaRef:'helix://arca/types/MaterialBindingSnapshot/v1',digest:canonicalDigest({materialKey:item.material_key,role:item.role,endpointId:item.endpoint_id,location:item.location,evidenceDigest:item.evidence_digest}),objectKind:'arca-material-binding'}))];
    const knownBindings=sealed('helix://contracts/domain-types/KnownBindings/v1',shelfEntryId+':known-bindings',raw.entry.current_inventory_revision,{shelfEntryId,bindings:Object.freeze(bindings),bindingSetDigest:canonicalDigest(bindings)});
    const inventoryRevision=sealed('helix://contracts/domain-types/InventoryRevision/v1',shelfEntryId+':inventory',raw.entry.current_inventory_revision,{shelfEntryId,inventoryRevision:raw.entry.current_inventory_revision,inventoryDigest:raw.inventory.representation_digest});
    const metadataRefs=sealed('helix://contracts/domain-types/InventoryMetadataArtifactRefs/v1',shelfEntryId+':presentation-input',raw.entry.current_inventory_revision,{shelfEntryId,inventoryRevision:raw.entry.current_inventory_revision,metadataFactRefs:Object.freeze(raw.facts.filter((x)=>x.fact_kind==='product_metadata').map((x)=>x.fact_digest)),artifactHandles:Object.freeze([])});
    const standard=sealed('helix://contracts/domain-types/Standard/v1',raw.shelf.shelf_id+':standard',raw.shelf.current_standard_revision,{standardId:raw.shelf.shelf_id,standardRevision:raw.shelf.current_standard_revision,standardDigest:raw.standard.standard_digest});
    const placement=sealed('helix://contracts/domain-types/Placement/v1',shelfEntryId+':placement',raw.shelf.current_placement_revision,{shelfEntryId,placementRevision:raw.shelf.current_placement_revision,targetEndpointId:raw.shelf.target_endpoint_id,placementDigest:raw.placement.policy_digest});
    return Object.freeze({shelfEntryId,originalRequirements:originalRequirements([{shelfEntryId,acceptedPackageReference:raw.acceptedPackageReference,authorizedDefectManifest:defectManifest(raw.facts)}]).get(shelfEntryId),defectAuthorization:store.defectStore.current(shelfEntryId),raw:Object.freeze({...raw,perceptionRating}),basis,knownBindings,inventoryRevision,metadataRefs,standard,placement,authorizedDefectManifest:defectManifest(raw.facts)});}
  function healthProjectionInputs(shelfEntryIds){
    const items=store.healthProjectionInputs(shelfEntryIds,{includeAssessments:false}),originals=originalRequirements(items),
      authorizations=store.defectStore.currentMany(shelfEntryIds),
      ratingTargets=items.filter(item=>usesRatingDecision(item.standardValue,item.structureKind,item.canonicalIdentity)).map(normalizedRatingTarget),
      ratings=ratingTargets.length&&typeof options.readPerceptionRatings==='function'?options.readPerceptionRatings(ratingTargets):new Map();
    const contexts=items.map(item=>{
      const relevant=usesRatingDecision(item.standardValue,item.structureKind,item.canonicalIdentity),rating=ratings.get(item.shelfEntryId),
        digests=relevant?[...item.decisionFactDigests,...(rating?.state==='ready'&&rating.resolutionDigest?[rating.resolutionDigest]:[])]:[];
      return {shelfEntryId:item.shelfEntryId,originalRequirements:originals.get(item.shelfEntryId),materialRoles:item.materialRoles,
        defectAuthorization:authorizations.get(item.shelfEntryId)||null,
        effectiveRequirements:effectiveRequirements({raw:{identity:item.canonicalIdentity,entry:{structure_kind:item.structureKind},standard:{value:item.standardValue},facts:item.decisionFacts||[],perceptionRating:rating}}),
        incidentResourceHints:item.incidentResourceHints,authorizedDefectManifest:item.authorizedDefectManifest,
        basis:careBasis(item.shelfEntryId,item.inventoryRevision,item.standardRevision,item.placementRevision,item.canonicalIdentityDigest,item.sourcePackageId,item.factDigests,digests),history:item.history};
    });
    const histories=store.healthAssessmentHistory(contexts.map((context,index)=>({
      shelfEntryId:context.shelfEntryId,careBasisDigest:context.basis.digest,
      inventoryRevision:context.basis.inventoryRevision,standardRevision:context.basis.standardRevision,
      placementRevision:context.basis.placementRevision,canonicalIdentityRevision:Number(items[index].canonicalIdentity.revision)})));
    return contexts.map(context=>Object.freeze({...context,history:Object.freeze({...context.history,...histories.get(context.shelfEntryId)})}));
  }
  return Object.freeze({store,read,
    sourceTargetBinding:(shelfEntryId,material)=>store.sourceTargetBinding(shelfEntryId,material),
    inventoryMaterials:(shelfEntryId,inventoryRevision)=>store.inventoryMaterials(shelfEntryId,inventoryRevision),
    healthProjectionInputs,listPage:(cursor,limit)=>store.listEntryPage(cursor,limit)});
}
module.exports=Object.freeze({createAftercareContextReader,usesRatingDecision});
