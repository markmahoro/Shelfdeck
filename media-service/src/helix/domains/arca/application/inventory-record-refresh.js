'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createMaterialControlParticipant,createMaterialControlProjectionPort,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const {observedIdentity}=require('../model/known-old-binding');
const {isAftercareArtifactMaterial,physicalIdentityFromInventoryRow}=require('../model/aftercare-contract');

function createInventoryRecordRefresh(options){
  const controls=createMaterialControlProjectionPort(options),readFingerprint=options.computeBoundedMaterialFingerprintSync;
  if(typeof readFingerprint!=='function')throw new TypeError('Inventory record refresh requires the bounded fingerprint reader.');
  function observe(row){
    const snapshot=readFingerprint(row.location,{requireStableSnapshot:true});
    if(!Number(snapshot.stat.size))throw Object.assign(new Error('Empty NFO needs physical repair.'),{code:'ARCA_RECORD_REFRESH_EMPTY'});
    // Binding refresh observes Physical Identity; it does not parse or compare NFO content.
    return Object.freeze({ordinal:Number(row.ordinal),previousMaterialKey:row.material_key,endpointId:row.endpoint_id,location:row.location,
      identity:observedIdentity(row.location,row.mount_scope_id,()=>snapshot),digestHex:snapshot.contentFingerprint,
      statFence:canonicalDigest({ino:String(snapshot.stat.ino),size:String(snapshot.stat.size),mtimeNs:String(snapshot.stat.mtimeNs),ctimeNs:String(snapshot.stat.ctimeNs)})});
  }
  return Object.freeze({refresh(c){
    if(c.raw.correctionGate)return Object.freeze({kind:'records_deferred',reasonCode:'identity_correction_pending'});
    if(c.raw.reservations.some(item=>item.state==='active')||options.contextReader.store.history(c.shelfEntryId).cases.some(item=>item.state==='active'))
      return Object.freeze({kind:'records_deferred',reasonCode:'active_modification'});
    const candidates=c.raw.materials.filter(item=>item.role!=='primary_payload'&&isAftercareArtifactMaterial(item,'nfo'));
    if(candidates.length>250)return Object.freeze({kind:'records_deferred',reasonCode:'observation_scope_too_large'});
    const observations=[];
    try{
      for(const row of candidates){const observation=observe(row);if(observation.identity.materialKey!==row.material_key)observations.push(observation);}
    }catch(error){return Object.freeze({kind:'records_deferred',reasonCode:error.code||'record_observation_failed'});}
    if(!observations.length)return Object.freeze({kind:'records_unchanged'});
    observations.sort((a,b)=>a.ordinal-b.ordinal);
    const observationDigest=canonicalDigest(observations),expectedInventoryRevision=Number(c.raw.entry.current_inventory_revision),
      identity={shelfEntryId:c.shelfEntryId,expectedInventoryRevision,observationDigest},key=canonicalDigest(identity),
      oldByOrdinal=new Map(c.raw.materials.map(row=>[Number(row.ordinal),row])),scope={ownerDomain:'arca',scopeType:'shelf_entry',scopeId:c.shelfEntryId},
      changes=observations.flatMap(item=>[
        {identity:physicalIdentityFromInventoryRow(oldByOrdinal.get(item.ordinal)),action:'release',fromScope:scope},
        {identity:item.identity,action:'acquire',toScope:scope},
      ]),keys=[...new Set(changes.map(item=>item.identity.materialKey))].sort(),
      projections=new Map(controls.getMaterialControlProjections(keys).map(item=>[item.materialKey,item]));
    for(const change of changes){
      const projection=projections.get(change.identity.materialKey);
      if(projection.resultKind==='unavailable')return Object.freeze({kind:'records_deferred',reasonCode:'control_unavailable'});
      change.expectedRevision=Number(projection.controlRevision||0);change.expectedProjectionDigest=projection.projectionDigest;
    }
    const controlChangeDigest=controlScopeDigest(changes),handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
      handleId:'arca-record-control-'+key,operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_shelf_entry',processId:c.shelfEntryId,
      basisRef:{objectType:'inventory_revision',objectId:c.shelfEntryId,revision:expectedInventoryRevision,digest:c.raw.inventory.representation_digest},
      basisDigest:c.basis.digest,canonicalFactSetDigest:c.basis.acceptedProductFactSetDigest,bindingSetDigest:observationDigest,controlScopeDigest:controlChangeDigest,
      expectedControlRevisions:changes.map(item=>({materialKey:item.identity.materialKey,revision:item.expectedRevision})).sort((a,b)=>a.materialKey.localeCompare(b.materialKey)),
      receiptContract:{receiptSchemaRef:'InventoryRecordRefreshReceipt@1',controlRevisionSetSchemaRef:'arca.inventory-record-control-revisions@1'},
      eventFenceDigest:canonicalDigest({command:'arca.inventory.records.refresh@1',...identity})};
    const controlParticipant=createMaterialControlParticipant({...options,handle,changes,commitMarker:'arca-record-refresh-'+key});
    const result=options.contextReader.store.refreshInventoryRecords({...identity,observations,controlChangeDigest,controlParticipant,
      expectedInventoryDigest:c.raw.inventory.representation_digest,standardRevision:Number(c.raw.shelf.current_standard_revision),
      placementRevision:Number(c.raw.shelf.current_placement_revision),canonicalIdentityRevision:Number(c.raw.entry.canonical_identity_revision),
      validateObservation(item){
        if(canonicalDigest(observe(oldByOrdinal.get(item.ordinal)))!==canonicalDigest(item))
          throw Object.assign(new Error('NFO changed before record commit.'),{code:'ARCA_RECORD_REFRESH_OBSERVATION_STALE'});
      }});
    return Object.freeze({kind:'inventory_records_refreshed',...result});
  }});
}
module.exports=Object.freeze({createInventoryRecordRefresh});
