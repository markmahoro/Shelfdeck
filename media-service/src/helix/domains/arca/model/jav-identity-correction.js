'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildJavQueryAnchor,assertJavSourceSelectionSnapshot}=require('../../../contracts/jav-source-contracts');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {canonicalContentIdentity}=require('./canonical-content-identity');
function fail(code,message){throw Object.assign(new TypeError(message),{code});}
function integer(value,name){const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail('ARCA_JAV_CORRECTION_BASIS_INVALID',name+' must be an exact positive revision.');return n;}
function immutable(value){if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}return value;}
function signed(value,field='basisDigest'){return immutable(JSON.parse(canonicalJson({...value,[field]:canonicalDigest(value)})));}
function assertDigest(value){if(!/^[a-f0-9]{64}$/.test(value||''))fail('ARCA_JAV_CORRECTION_BASIS_INVALID','Correction requires complete immutable digest references.');return value;}
function projectedRow(row){return Object.fromEntries(Object.entries(row).filter(([key])=>key!=='value').map(([key,value])=>[key,typeof value==='bigint'?String(value):value]));}

function buildJavCorrectionBasis({raw,controlProjections,activeCases=[]}) {
  if(!raw?.entry||raw.entry.status!=='active'||raw.shelf?.status!=='active'||raw.entry.structure_kind!=='single'||
      raw.identity?.identity_kind!=='jav_code'||raw.identity.provider!=='jav')
    fail('ARCA_JAV_CORRECTION_INELIGIBLE','Correction requires one active owned JAV single Entry.');
  if(raw.correctionGate||(raw.reservations||[]).some(row=>row.state==='active')||activeCases.some(row=>['queued','active'].includes(row.state)))
    fail('ARCA_JAV_CORRECTION_BUSY','An existing Entry modification must finish before correction admission.');
  const entry=raw.entry,shelf=raw.shelf,code=buildJavQueryAnchor('jav_code',raw.identity.provider_key).javCode;
  const canonical=canonicalContentIdentity(shelf.shelf_id,{identityDigest:raw.identity.identity_digest,identityKind:'jav_code',contentProfile:'jav',structureKind:'single',
    providerIdentities:[{provider:'jav',namespace:'jav_code',providerKey:code}]});
  if(entry.shelf_id!==shelf.shelf_id||code!==raw.identity.provider_key||canonical.canonicalIdentityKey!==entry.canonical_identity_key)
    fail('ARCA_JAV_CORRECTION_BASIS_INVALID','Correction must conserve the exact current Shelf and canonical code.');
  if(!Array.isArray(raw.materials)||raw.materials.length<1||raw.materials.length>1024||
      raw.materials.filter(row=>row.role==='primary_payload').length!==1||!raw.onDeckCommit)
    fail('ARCA_JAV_CORRECTION_INELIGIBLE','Correction retains exactly one actually owned video and its original Commit.');
  const controls=new Map((controlProjections||[]).map(row=>[row.materialKey,row]));
  if(controls.size!==raw.materials.length||controlProjections.length!==raw.materials.length)fail('ARCA_JAV_CORRECTION_CONTROL_INVALID','Correction requires the exact current owned material Control set.');
  const materials=[...raw.materials].sort((a,b)=>Number(a.ordinal)-Number(b.ordinal)).map((row,ordinal)=>{
    const identity=physicalIdentityFromInventoryRow(row),control=controls.get(row.material_key);
    if(Number(row.ordinal)!==ordinal||control?.resultKind!=='available'||control.controlState!=='controlled'||
        control.ownerDomain!=='arca'||control.ownerScopeType!=='shelf_entry'||control.ownerScopeId!==entry.shelf_entry_id)
      fail('ARCA_JAV_CORRECTION_CONTROL_INVALID','Correction may only retain or replace this Entry material set.');
    return Object.freeze({ordinal,role:row.role,physicalIdentity:identity,endpointId:row.endpoint_id,location:row.location,
      bindingRevision:integer(row.binding_revision,'bindingRevision'),controlRevision:integer(control.controlRevision,'controlRevision'),
      controlProjectionDigest:assertDigest(control.projectionDigest)});
  });
  const value={schema:'arca.jav-correction-basis@1',shelfEntryId:entry.shelf_entry_id,shelfId:shelf.shelf_id,
    canonicalIdentityRevision:integer(entry.canonical_identity_revision,'canonicalIdentityRevision'),canonicalIdentityKey:assertDigest(entry.canonical_identity_key),
    canonicalIdentityDigest:assertDigest(raw.identity.identity_digest),javCode:code,
    inventoryRevision:integer(entry.current_inventory_revision,'inventoryRevision'),inventoryDigest:assertDigest(raw.inventory.representation_digest),
    deckFactRevision:integer(entry.current_deck_fact_revision,'deckFactRevision'),
    shelfTargetDigest:canonicalDigest({endpointId:shelf.target_endpoint_id,rootLocation:shelf.target_root_location,mountScopeId:shelf.target_mount_scope_id,mountScopeRevision:Number(shelf.target_mount_scope_revision)}),
    standardRevision:integer(shelf.current_standard_revision,'standardRevision'),standardDigest:assertDigest(raw.standard.standard_digest),
    placementRevision:integer(shelf.current_placement_revision,'placementRevision'),placementDigest:assertDigest(raw.placement.policy_digest),
    originalSourcePackageId:raw.inventory.source_package_id,originalCommitDigest:canonicalDigest(Object.fromEntries(Object.entries(raw.onDeckCommit).map(([key,value])=>[key,typeof value==='bigint'?String(value):value]))),
    materials,relatedSetDigest:canonicalDigest((raw.related||[]).map(projectedRow).sort((a,b)=>String(a.reference_id).localeCompare(String(b.reference_id)))),acceptedFactSetDigest:canonicalDigest((raw.facts||[]).map(row=>({factKind:row.fact_kind,factDigest:row.fact_digest})).sort((a,b)=>a.factKind.localeCompare(b.factKind))),
    peopleSetDigest:canonicalDigest((raw.people||[]).map(row=>row.relation_digest).sort())};
  if(Buffer.byteLength(canonicalJson(value))>1024*1024)fail('ARCA_JAV_CORRECTION_BASIS_INVALID','Correction Basis exceeds its bounded Entry scope.');
  return signed(value);
}

function buildJavCorrectionProposal({basis,sourceSnapshot,sourceOrdinal,observation}) {
  if(basis?.schema!=='arca.jav-correction-basis@1'||basis.basisDigest!==canonicalDigest(Object.fromEntries(Object.entries(basis).filter(([key])=>key!=='basisDigest'))))
    fail('ARCA_JAV_CORRECTION_BASIS_INVALID','Correction proposal requires its exact current Entry Basis.');
  const snapshot=assertJavSourceSelectionSnapshot(sourceSnapshot),source=snapshot.sources[sourceOrdinal],
    title=observation?.descriptiveEntries?.find(item=>item.key==='title')?.value;
  if(!Number.isSafeInteger(sourceOrdinal)||!source||snapshot.queryAnchor.queryKind!=='jav_code'||observation?.result!=='qualified'||observation.siteRef!==source.siteRef||
      observation.queryAnchorDigest!==snapshot.queryAnchor.anchorDigest||observation.endpointProfileDigest!==source.endpointProfileDigest||
      observation.networkRouteDigest!==source.networkRouteDigest||observation.resolvedProviderIdentity?.provider!=='jav'||
      observation.resolvedProviderIdentity.namespace!=='jav_code'||observation.resolvedProviderIdentity.seasonNumber!==null||observation.resolvedProviderIdentity.providerKey!==snapshot.queryAnchor.javCode||
      observation.resolvedProviderIdentity.identityAnchorDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation.resolvedProviderIdentity).filter(([key])=>key!=='identityAnchorDigest')))||
      typeof title!=='string'||!title.trim()||!observation.cover?.byteDigest||
      !Number.isSafeInteger(observation.cover.byteCount)||observation.cover.byteCount<1||observation.cover.byteCount>16*1024*1024||!Number.isSafeInteger(observation.cover.width)||observation.cover.width<1||
      !Number.isSafeInteger(observation.cover.height)||observation.cover.height<1||!['jpeg','png','webp'].includes(observation.cover.format)||
      observation.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest'))))
    fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction requires one qualified same-film source, title and cover.');
  assertDigest(observation.cover.byteDigest);
  const identity={schema:'arca.jav-canonical-identity-proposal@1',shelfEntryId:basis.shelfEntryId,shelfId:basis.shelfId,
    structureKind:'single',contentProfile:'jav',identityKind:'jav_code',providerIdentities:[{provider:'jav',namespace:'jav_code',providerKey:snapshot.queryAnchor.javCode,seasonNumber:null}],
    displayIdentity:{entries:[{key:'title',value:title},{key:'jav_code',value:snapshot.queryAnchor.javCode}]}};
  const newIdentity=signed(identity,'identityDigest'),canonicalIdentityKey=canonicalContentIdentity(basis.shelfId,newIdentity).canonicalIdentityKey,
    value={schema:'arca.jav-correction-proposal@1',shelfEntryId:basis.shelfEntryId,shelfId:basis.shelfId,basisDigest:basis.basisDigest,
      oldJavCode:basis.javCode,newJavCode:snapshot.queryAnchor.javCode,newIdentity,newCanonicalIdentityKey:canonicalIdentityKey,
      sourceQualification:{sourceSnapshot:snapshot,sourceOrdinal,observation},retainedPrimaryMaterialKey:basis.materials.find(row=>row.role==='primary_payload').physicalIdentity.materialKey};
  if(Buffer.byteLength(canonicalJson(value))>64*1024)fail('ARCA_JAV_CORRECTION_SOURCE_INVALID','Correction proposal exceeds its source proof bound.');
  return signed(value,'proposalDigest');
}
module.exports=Object.freeze({buildJavCorrectionBasis,buildJavCorrectionProposal});
