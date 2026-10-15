'use strict';
const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {javCorrectionRetainedLocation}=require('../../../contracts/jav-correction-retained-location');
const SCHEMA='helix://contracts/application-types/ArcaJavCorrectionFormalRetirementPlan/v1';
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_RETIREMENT_STALE'});};
const locationKey=location=>process.platform==='win32'?path.resolve(location).toLowerCase():path.resolve(location);
const signed=value=>{const {planDigest,...body}=value||{};return planDigest===canonicalDigest(body);};
function commitDigest(receipt){return canonicalDigest({schema:'arca.jav-correction-inventory-commit@1',changeDigest:receipt.changeDigest,
  controlChangeDigest:receipt.controlChangeDigest,receiptDigest:canonicalDigest(receipt)});}
function buildJavCorrectionFormalRetirementPlan({record,commit,plan,manifest,raw,controlProjections,activeCases}){
  const receipt=commit?.result,basis=record?.proof?.basis;
  if(!basis||!receipt||record.state!=='committed'||record.terminalAtMs!==receipt.committedAtMs||
      receipt.schemaRef!=='helix://contracts/types/JavCorrectionCommitReceipt/v1'||receipt.correctionId!==record.correctionId||
      receipt.shelfEntryId!==record.shelfEntryId||receipt.scopeId!==record.correctionId||receipt.ownerDomain!=='arca'||
      commit.resultSchemaRef!==receipt.schemaRef||commit.kind!=='succeeded'||commit.effectReceipt?.effectClass!=='responsibility_control_commit'||
      commit.effectReceipt.effectReceiptId!==receipt.effectReceiptRef||commit.effectReceipt.verificationEvidenceDigest!==commitDigest(receipt)||
      record.terminalEvidenceDigest!==commit.effectReceipt.verificationEvidenceDigest||receipt.originalCommitDigest!==basis.originalCommitDigest)
    fail('Formal retirement requires this correction\'s actual committed Receipt and terminal Evidence.');
  const {manifestDigest,...manifestBody}=manifest||{};
  if(!signed(plan)||plan.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionFilePlan/v1'||plan.correctionId!==record.correctionId||
      plan.shelfEntryId!==record.shelfEntryId||plan.admissionDigest!==record.admissionDigest||plan.basisDigest!==basis.basisDigest||
      plan.scopeDigest!==receipt.scopeDigest||manifestDigest!==canonicalDigest(manifestBody)||manifest.sourceProductManifestDigest!==plan.planDigest||
      !Array.isArray(plan.members)||plan.members.length<4||plan.members.length>1024||manifest.stagedMembers?.length!==plan.members.length||
      basis.materials?.length!==plan.members.length)
    fail('Formal retirement requires the exact complete committed File Plan and staged Manifest.');
  const entry=raw?.entry,identity=raw?.identity,inventory=raw?.inventory;
  const gate=raw?.correctionGate,ownCleanupGate=gate?.correction_id===record.correctionId&&gate.shelf_entry_id===record.shelfEntryId&&gate.state==='committed'&&
    ['pending','active','attention_required'].includes(gate.cleanup_state)&&gate.cleanup_state===record.cleanupState;
  if(!entry||entry.shelf_entry_id!==record.shelfEntryId||entry.shelf_id!==basis.shelfId||entry.status!=='active'||raw.shelf?.status!=='active'||
      Number(entry.canonical_identity_revision)!==receipt.newCanonicalIdentityRevision||Number(entry.current_inventory_revision)!==receipt.newInventoryRevision||
      entry.canonical_identity_key!==receipt.canonicalIdentityKey||identity?.identity_digest!==receipt.canonicalIdentityDigest||inventory?.representation_digest!==receipt.inventoryDigest||
      !Array.isArray(raw.reservations)||!Object.hasOwn(raw,'correctionGate')||!Array.isArray(activeCases)||
      raw.reservations.some(row=>row.state==='active')||gate&&!ownCleanupGate||activeCases.some(row=>['queued','active','attention_required'].includes(row.state))||
      raw.materials?.length!==plan.members.length)
    fail('Current collection or competing maintenance changed after the correction Commit.');
  const root=path.resolve(plan.target.rootLocation),directory=path.join(root,'.shelfdeck-'+record.correctionId+'-stage'),finals=[],retirements=[],locations=new Set();
  for(let index=0;index<plan.members.length;index++){
    const member=plan.members[index],staged=manifest.stagedMembers[index],original=basis.materials[index],row=raw.materials[index],
      stageLocation=path.join(directory,String(index).padStart(4,'0')+'-'+path.basename(member.targetLocation));
    if(member.ordinal!==index||member.role!==original.role||canonicalDigest(member.original)!==canonicalDigest(original)||
        member.retainedLocation!==javCorrectionRetainedLocation(record.correctionId,index,original.location)||staged.location!==stageLocation||
        staged.role!==member.role||!/^[a-f0-9]{64}$/.test(staged.fullByteDigest||'')||Number(row.ordinal)!==index||row.role!==member.role||
        row.location!==member.targetLocation||row.endpoint_id!==member.targetEndpointId||Number(row.binding_revision)!==original.bindingRevision+1||
        canonicalDigest(physicalIdentityFromInventoryRow(row))!==canonicalDigest(staged.physicalIdentity)||!path.isAbsolute(original.location))
      fail('Retirement must conserve every exact original, final binding and staged physical identity.');
    const relative=path.relative(root,member.targetLocation);
    if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||locations.has(locationKey(member.targetLocation)))
      fail('Final bindings must be distinct and inside the frozen Shelf target.');
    locations.add(locationKey(member.targetLocation));
    finals.push({ordinal:index,role:member.role,location:member.targetLocation,physicalIdentity:staged.physicalIdentity,fullByteDigest:staged.fullByteDigest});
  }
  function retire(kind,location,physicalIdentity,fullByteDigest){
    if(locations.has(locationKey(location))||retirements.some(row=>locationKey(row.location)===locationKey(location)))
      fail('Retirement must never include a current final path or an ambiguous alias.');
    retirements.push({ordinal:retirements.length,kind,location,physicalIdentity,fullByteDigest});
  }
  for(let index=0;index<plan.members.length;index++){
    const member=plan.members[index],staged=manifest.stagedMembers[index],original=member.original,
      oldDigest=member.source.kind==='retained_inventory'?staged.fullByteDigest:null;
    if(!locations.has(locationKey(original.location)))retire('superseded_binding',original.location,original.physicalIdentity,oldDigest);
    retire('retained_alias',member.retainedLocation,original.physicalIdentity,oldDigest);
    retire('stage_alias',staged.location,staged.physicalIdentity,staged.fullByteDigest);
  }
  const keys=[...new Set([...finals,...retirements].map(row=>row.physicalIdentity.materialKey))].sort(),byKey=new Map((controlProjections||[]).map(row=>[row.materialKey,row])),
    finalKeys=new Set(finals.map(row=>row.physicalIdentity.materialKey));
  if(byKey.size!==controlProjections?.length||byKey.size!==keys.length||keys.some(key=>!byKey.has(key)))fail('Retirement requires the exact current old and new material Control set.');
  const controls=keys.map(key=>{
    const row=byKey.get(key),owned=row.controlState==='controlled'&&row.ownerDomain==='arca'&&row.ownerScopeType==='shelf_entry'&&row.ownerScopeId===record.shelfEntryId;
    if(row.resultKind!=='available'||!/^[a-f0-9]{64}$/.test(row.projectionDigest||'')||!Number.isSafeInteger(row.controlRevision)||row.controlRevision<0||
        (finalKeys.has(key)?!owned:row.controlState!=='uncontrolled'))fail('Retirement cannot release or delete a foreign or reacquired material.');
    return {materialKey:key,controlRevision:row.controlRevision,projectionDigest:row.projectionDigest};
  });
  const retirementSetDigest=canonicalDigest({targetRoot:root,stageDirectory:directory,finals,retirements,filePlanDigest:plan.planDigest,stagedManifestDigest:manifestDigest}),
    guard={correctionId:record.correctionId,admissionDigest:record.admissionDigest,commitReceiptDigest:canonicalDigest(receipt),retirementSetDigest,
    shelfEntryId:record.shelfEntryId,canonicalIdentityRevision:receipt.newCanonicalIdentityRevision,inventoryRevision:receipt.newInventoryRevision,
    inventoryDigest:receipt.inventoryDigest,canonicalIdentityDigest:receipt.canonicalIdentityDigest,controls},body={schemaRef:SCHEMA,schemaVersion:1,
    correctionId:record.correctionId,shelfEntryId:record.shelfEntryId,admissionDigest:record.admissionDigest,filePlanDigest:plan.planDigest,
    stagedManifestDigest:manifestDigest,commitReceiptDigest:canonicalDigest(receipt),guard,guardDigest:canonicalDigest(guard),targetRoot:root,stageDirectory:directory,finals,retirements};
  if(finals.filter(row=>row.role==='primary_payload').length!==1||Buffer.byteLength(canonicalJson(body))>4*1024*1024)fail('Formal retirement exceeds its single-video bounded scope.');
  return Object.freeze({...body,planDigest:canonicalDigest(body)});
}
function javCorrectionFormalRetirementSchema(){
  const text=()=>({type:'string',minLength:1,maxLength:4096}),digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),
    object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)}),
    physical={$ref:'helix://contracts/types/PhysicalMaterialIdentity/v2'},ordinal={type:'integer',minimum:0,maximum:3071};
  return object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},correctionId:text(),shelfEntryId:text(),admissionDigest:digest(),filePlanDigest:digest(),
    stagedManifestDigest:digest(),commitReceiptDigest:digest(),guardDigest:digest(),targetRoot:text(),stageDirectory:text(),planDigest:digest(),
    guard:object({correctionId:text(),admissionDigest:digest(),commitReceiptDigest:digest(),retirementSetDigest:digest(),shelfEntryId:text(),
      canonicalIdentityRevision:{type:'integer',minimum:1},inventoryRevision:{type:'integer',minimum:1},inventoryDigest:digest(),canonicalIdentityDigest:digest(),
      controls:{type:'array',minItems:4,maxItems:2048,items:object({materialKey:digest(),controlRevision:{type:'integer',minimum:0},projectionDigest:digest()})}}),
    finals:{type:'array',minItems:4,maxItems:1024,items:object({ordinal,role:text(),location:text(),physicalIdentity:physical,fullByteDigest:digest()})},
    retirements:{type:'array',minItems:8,maxItems:3072,items:object({ordinal,kind:{enum:['superseded_binding','retained_alias','stage_alias']},location:text(),physicalIdentity:physical,
      fullByteDigest:{anyOf:[digest(),{type:'null'}]}})}});
}
module.exports=Object.freeze({SCHEMA,buildJavCorrectionFormalRetirementPlan,javCorrectionFormalRetirementSchema});
