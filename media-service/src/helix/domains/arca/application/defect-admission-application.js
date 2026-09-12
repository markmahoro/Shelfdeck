'use strict';

const path=require('node:path');
const { canonicalDigest, canonicalJson }=require('../../../contracts/canonical-json');
const { createMaterialControlAdmissionReadParticipant }=require('../../../foundation/persistence/material-control');
const { admissionPreview, acceptedFinding, currentFindings, findingGap }=require('../model/accepted-gap-contracts');
const { freezeCareObjective }=require('../model/care-objective');
const { assertProcessingRequirement }=require('../model/aftercare-contract');
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const SUPPORTED=new Set(['presentation:nfo_missing','presentation:poster_missing','conformance:container_unmet',
  'conformance:file_extension_unmet','conformance:video_codec_unmet','conformance:max_size_exceeded']);

function createDefectAdmissionApplication(options) {
  const reader=options.contextReader,store=reader.store,defects=store.defectStore,now=options.now || Date.now;
  function snapshot(entryId) {
    const context=reader.read(entryId);
    if(!context)fail('ARCA_DEFECT_ENTRY_MISSING','Current collection entry is unavailable.');
    const history=store.history(entryId),preview=admissionPreview(context,history,context.defectAuthorization,now());
    const accepted=currentFindings(context,history).findings.filter(finding=>acceptedFinding(context,finding));
    const acceptedGaps=accepted.map(finding=>findingGap(context,finding)).filter(Boolean).sort((a,b)=>a.gapDigest.localeCompare(b.gapDigest));
    const repairable=accepted.filter(finding=>SUPPORTED.has(finding.findingKind)&&finding.repairability==='auto_repair');
    return {context,history,preview,accepted,acceptedGaps,repairable};
  }
  function physicalGuard(context) {
    const primary=context.raw.materials.filter(item=>item.role==='primary_payload');
    if(!primary.length)fail('ARCA_DEFECT_PRIMARY_MISSING','Current Primary material is missing.');
    for(const material of context.raw.materials){
      const relative=path.relative(context.raw.shelf.target_root_location,material.location);
      if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))fail('ARCA_DEFECT_CONTAINMENT','Current material is outside its Shelf Target.');
      const observed=options.computeBoundedMaterialFingerprintSync(material.location);
      if(String(observed.stat.ino)!==String(material.inode)||Number(observed.stat.size)!==Number(material.size_bytes)||
        observed.fingerprintAlgorithm!==material.fingerprint_algorithm||Number(observed.fingerprintVersion)!==Number(material.fingerprint_version)||
        observed.contentFingerprint!==material.content_fingerprint)fail('ARCA_DEFECT_MATERIAL_CHANGED','Current material changed after the health assessment.');
    }
  }
  function controlGuard(context) {
    return createMaterialControlAdmissionReadParticipant({schemaManifest:options.schemaManifest,boundBusinessOwner:'arca',
      participantId:'arca_defect_control_guard',materialKeys:[...new Set(context.raw.materials.map(item=>item.material_key))].sort(),
      accept(projections){if(projections.some(item=>item.controlState!=='controlled'||item.ownerDomain!=='arca'||
        item.ownerScopeType!=='shelf_entry'||item.ownerScopeId!==context.shelfEntryId))
        fail('ARCA_DEFECT_CONTROL_CHANGED','Arca no longer controls the exact Inventory materials.');}});
  }
  function request(entryId,body,actorId,s) {
    if(!body||body.acknowledged!==true||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||body.idempotencyKey.length>256||
      typeof actorId!=='string'||!actorId||actorId.length>256)fail('ARCA_DEFECT_COMMAND_INVALID','Explicit acknowledgement and an idempotent administrator command are required.');
    const c=s.context,p=s.preview;
    if(p.candidateDigest!==body.expectedCandidateDigest||p.inventoryRevision!==body.expectedInventoryRevision||
      p.careBasisDigest!==body.expectedCareBasisDigest||p.authorizationRevision!==body.expectedAuthorizationRevision)
      fail('ARCA_DEFECT_PREVIEW_STALE','The displayed gaps changed; reload before confirming.');
    if(p.eligibility!=='eligible')fail('ARCA_DEFECT_INELIGIBLE','Current safety and exact gap evidence do not permit this command.');
    return {...p,actorId,idempotencyKey:body.idempotencyKey,identityRevision:Number(c.raw.entry.canonical_identity_revision),
      standardRevision:c.basis.standardRevision,placementRevision:c.basis.placementRevision,
      validateReality:()=>physicalGuard(c),controlParticipant:controlGuard(c)};
  }
  function preview(entryId) {
    const s=snapshot(entryId);
    const result={...s.preview,acceptedGaps:s.acceptedGaps,repairableGapDigests:s.repairable.map(finding=>findingGap(s.context,finding).gapDigest),
      unavailableRepairs:s.accepted.filter(finding=>!s.repairable.includes(finding)).map(finding=>({findingKind:finding.findingKind,reasonCode:'no_current_bounded_repair_path'}))};
    if(Buffer.byteLength(canonicalJson(result))>65536)fail('ARCA_DEFECT_SCOPE_TOO_LARGE','The complete preview exceeds 64 KiB and cannot be truncated.');
    return result;
  }
  function accept(entryId,body,actorId) {
    if(typeof body?.idempotencyKey!=='string'||!body.idempotencyKey)fail('ARCA_DEFECT_COMMAND_INVALID','Idempotency key is required.');
    const replay=defects.acceptanceReplay(entryId,actorId,body.idempotencyKey,body.expectedCandidateDigest);
    if(replay)return replay;
    const s=snapshot(entryId),value=request(entryId,body,actorId,s);
    const result=defects.accept(value);options.wake?.();return result;
  }
  function repair(entryId,body,actorId) {
    if(typeof body?.idempotencyKey!=='string'||!body.idempotencyKey)fail('ARCA_DEFECT_COMMAND_INVALID','Idempotency key is required.');
    const intentDigest=canonicalDigest({entryId,actorId,inventoryRevision:body?.expectedInventoryRevision,
      careBasisDigest:body?.expectedCareBasisDigest,candidateDigest:body?.expectedCandidateDigest,authorizationRevision:body?.expectedAuthorizationRevision});
    const prior=defects.repairIntent({shelfEntryId:entryId,actorId,idempotencyKey:body?.idempotencyKey});
    if(prior){if(prior.intent_digest!==intentDigest)fail('ARCA_DEFECT_REPAIR_KEY_CONFLICT','Repair key belongs to another exact request.');
      return {resultKind:'repair_requested',aftercareCaseId:prior.aftercare_case_id,replayed:true};}
    const s=snapshot(entryId),value=request(entryId,body,actorId,s);
    if(!s.repairable.length)return {resultKind:'repair_unavailable',reasonCode:'no_current_bounded_repair_path'};
    const intentId='arca-defect-repair-'+canonicalDigest({entryId,actorId,key:body.idempotencyKey}).slice(0,40),
      gaps=s.acceptedGaps,gapSetDigest=canonicalDigest(gaps),serialized=canonicalJson(gaps);
    if(Buffer.byteLength(serialized)>16384)fail('ARCA_DEFECT_REPAIR_SCOPE_TOO_LARGE','Exact repair objective exceeds 16 KiB and cannot be truncated.');
    const effects=s.repairable.map(finding=>({objectId:finding.findingId,revision:1,schemaRef:'helix://arca/types/RequiredCareEffect/v1',digest:finding.findingDigest,objectKind:'required-effect'}));
    const typedParameters=s.repairable.map(finding=>({parameter:'finding.'+canonicalDigest(finding.findingKind).slice(0,16),valueType:'string',value:finding.findingKind,valueDigest:canonicalDigest(finding.findingKind)}));
    for(const [parameter,text] of Object.entries({'trigger.kind':'repair_accepted_defects','trigger.intentId':intentId,'target.acceptedGaps':serialized}))
      typedParameters.push({parameter,valueType:'string',value:text,valueDigest:canonicalDigest(text)});
    const base={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:intentId+':requirement',revision:1,
      careBasisDigest:s.context.basis.digest,requiredEffects:effects,acceptanceDigest:canonicalDigest(effects),typedParameters:[...typedParameters,...freezeCareObjective(s.context)]};
    const requirement={...base,digest:canonicalDigest(base)};assertProcessingRequirement(requirement);
    const care=store.createCase({shelfEntryId:entryId,careBasis:s.context.basis,careRequirement:requirement,
      findingSetDigest:canonicalDigest(s.repairable.map(finding=>finding.findingDigest).sort()),
      triggerDigest:canonicalDigest({kind:'repair_accepted_defects',intentId,intentDigest}),
      basisInputs:[{inputKind:'shelf_entry',ownerDomain:'arca',aggregateType:'shelf_entry',aggregateId:entryId,revision:value.inventoryRevision,inputDigest:value.careBasisDigest},
        {inputKind:'manual_defect_repair',ownerDomain:'arca',aggregateType:'defect_repair_intent',aggregateId:intentId,revision:1,inputDigest:intentDigest}],
      atomicParticipants:caseId=>[value.controlParticipant,defects.repairParticipant({...value,gaps,intentId,intentDigest,gapSetDigest,
        inheritedManifestDigest:s.context.authorizedDefectManifest?.manifestDigest||null},caseId),
        defects.repairReceiptParticipant({...value,intentId,intentDigest,gapSetDigest},caseId)]});
    options.wake?.();return {resultKind:'repair_requested',aftercareCaseId:care.aftercareCaseId,replayed:false};
  }
  return Object.freeze({preview,accept,repair});
}
module.exports=Object.freeze({createDefectAdmissionApplication});
