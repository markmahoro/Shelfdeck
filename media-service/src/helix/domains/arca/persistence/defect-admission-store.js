'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { SCHEMA_REF, validAuthorization } = require('../model/accepted-gap-contracts');
const COLUMNS=['shelf_entry_id','revision','inventory_revision','care_basis_digest','gap_set_digest',
  'authorization_schema_ref','authorization_json','authorization_digest','actor_id','idempotency_key','decided_at_ms'];
const INTENT_COLUMNS=['intent_id','shelf_entry_id','inventory_revision','care_basis_digest','gap_set_digest',
  'authorization_revision','aftercare_case_id','actor_id','idempotency_key','intent_digest','issued_at_ms'];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function createArcaDefectAdmissionStore(options) {
  const repository=createRepositoryDefinition({repositoryId:'arca_defect_admissions',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    head:{kind:'select-one',tableId:'arca_defect_admission_heads',columns:['shelf_entry_id','current_revision'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    heads:{kind:'select-in',tableId:'arca_defect_admission_heads',columns:['shelf_entry_id','current_revision'],keyColumn:'shelf_entry_id',maxItems:500,safeIntegers:true},
    authorization:{kind:'select-one',tableId:'arca_defect_admissions',columns:COLUMNS,keyColumns:['shelf_entry_id','revision'],safeIntegers:true},
    authorization_key:{kind:'select-one',tableId:'arca_defect_admissions',columns:COLUMNS,keyColumns:['shelf_entry_id','actor_id','idempotency_key'],safeIntegers:true},
    insert:{kind:'insert',tableId:'arca_defect_admissions',columns:COLUMNS},
    insert_head:{kind:'insert',tableId:'arca_defect_admission_heads',columns:['shelf_entry_id','current_revision','updated_at_ms']},
    advance:{kind:'update',tableId:'arca_defect_admission_heads',setColumns:['current_revision','updated_at_ms'],keyColumns:['shelf_entry_id'],compareColumns:[{column:'current_revision',parameter:'expected_revision'}]},
    intent_key:{kind:'select-one',tableId:'arca_defect_repair_intents',columns:INTENT_COLUMNS,keyColumns:['shelf_entry_id','actor_id','idempotency_key'],safeIntegers:true},
    intent_case:{kind:'select-one',tableId:'arca_defect_repair_intents',columns:INTENT_COLUMNS,keyColumns:['aftercare_case_id'],safeIntegers:true},
    insert_intent:{kind:'insert',tableId:'arca_defect_repair_intents',columns:INTENT_COLUMNS},
    entry:{kind:'select-one',tableId:'arca_shelf_entries',columns:['shelf_entry_id','shelf_id','status','canonical_identity_revision','current_inventory_revision'],keyColumns:['shelf_entry_id'],safeIntegers:true},
    shelf:{kind:'select-one',tableId:'arca_shelves',columns:['shelf_id','status','current_standard_revision','current_placement_revision'],keyColumns:['shelf_id'],safeIntegers:true},
    reservations:{kind:'select-all',tableId:'arca_offdeck_reservations',columns:['state'],keyColumns:['shelf_entry_id']},
    cases:{kind:'select-all',tableId:'arca_aftercare_cases',columns:['aftercare_case_id','state'],keyColumns:['shelf_entry_id']},
  }});
  const read=execute=>options.unitOfWork.execute([{participantId:'arca_defect_read',owner:'arca',repositories:[repository],execute:context=>execute(context.repository(repository.repositoryId))}]).arca_defect_read;
  function fromRow(row) {
    if(!row)return null;
    const authorization=JSON.parse(row.authorization_json);
    if(!validAuthorization(authorization)||authorization.authorizationDigest!==row.authorization_digest||
      authorization.revision!==Number(row.revision)||authorization.shelfEntryId!==row.shelf_entry_id)
      fail('ARCA_DEFECT_AUTHORIZATION_CORRUPT','Stored defect authorization is invalid.');
    return Object.freeze(authorization);
  }
  function currentIn(repo,entryId) {
    const head=repo.invoke('head',{shelf_entry_id:entryId});
    if(!head)return null;
    const value=fromRow(repo.invoke('authorization',{shelf_entry_id:entryId,revision:Number(head.current_revision)}));
    if(!value)fail('ARCA_DEFECT_AUTHORIZATION_CORRUPT','Defect authorization Head is unresolved.');
    return value;
  }
  function currentMany(ids) {
    if(!ids.length)return new Map();
    const unique=[...new Set(ids)];
    return read(repo=>{const result=new Map();for(let offset=0;offset<unique.length;offset+=500)
      for(const head of repo.invoke('heads',{values:unique.slice(offset,offset+500)}))result.set(head.shelf_entry_id,currentIn(repo,head.shelf_entry_id));
      return result;});
  }
  const current=entryId=>read(repo=>currentIn(repo,entryId));
  function guard(repo,expected,allowCaseId=null) {
    const entry=repo.invoke('entry',{shelf_entry_id:expected.shelfEntryId}),shelf=entry&&repo.invoke('shelf',{shelf_id:entry.shelf_id});
    if(!entry||entry.status!=='active'||!shelf||shelf.status!=='active'||Number(entry.current_inventory_revision)!==expected.inventoryRevision||
      Number(entry.canonical_identity_revision)!==expected.identityRevision||Number(shelf.current_standard_revision)!==expected.standardRevision||
      Number(shelf.current_placement_revision)!==expected.placementRevision||
      repo.invoke('reservations',{shelf_entry_id:expected.shelfEntryId}).some(row=>row.state==='active')||
      repo.invoke('cases',{shelf_entry_id:expected.shelfEntryId}).some(row=>['queued','active'].includes(row.state)&&row.aftercare_case_id!==allowCaseId))
      fail('ARCA_DEFECT_BASIS_STALE','Collection basis or modification authority changed.');
    if((currentIn(repo,expected.shelfEntryId)?.revision || 0)!==expected.authorizationRevision)
      fail('ARCA_DEFECT_AUTHORIZATION_STALE','Accepted defect authorization changed.');
  }
  function write(repo,value,at) {
    const body={schemaRef:SCHEMA_REF,schemaVersion:1,shelfEntryId:value.shelfEntryId,
      revision:value.authorizationRevision+1,inventoryRevision:value.inventoryRevision,careBasisDigest:value.careBasisDigest,
      gaps:value.gaps,gapSetDigest:canonicalDigest(value.gaps),candidateDigest:value.candidateDigest || null,actorId:value.actorId,decidedAtMs:at};
    const authorization={...body,authorizationDigest:canonicalDigest(body)};
    if(!validAuthorization(authorization))fail('ARCA_DEFECT_AUTHORIZATION_INVALID','The exact authorization exceeds its contract.');
    repo.invoke('insert',{shelf_entry_id:body.shelfEntryId,revision:body.revision,inventory_revision:body.inventoryRevision,
      care_basis_digest:body.careBasisDigest,gap_set_digest:body.gapSetDigest,authorization_schema_ref:SCHEMA_REF,
      authorization_json:canonicalJson(authorization),authorization_digest:authorization.authorizationDigest,
      actor_id:value.actorId,idempotency_key:value.idempotencyKey,decided_at_ms:at});
    if(value.authorizationRevision===0)repo.invoke('insert_head',{shelf_entry_id:body.shelfEntryId,current_revision:body.revision,updated_at_ms:at});
    else if(repo.invoke('advance',{shelf_entry_id:body.shelfEntryId,current_revision:body.revision,expected_revision:value.authorizationRevision,updated_at_ms:at}).changes!==1)
      fail('ARCA_DEFECT_AUTHORIZATION_STALE','Defect authorization Head changed.');
    return authorization;
  }
  function accept(value) {
    const commandContract='arca.accept-existing-defects@1',key=canonicalDigest({commandContract,entry:value.shelfEntryId,actor:value.actorId,key:value.idempotencyKey});
    const requestDigest=canonicalDigest({candidateDigest:value.candidateDigest,actorId:value.actorId});
    const committed=createCommandCommitCoordinator(options).execute({command:{commandReceiptId:key,ownerDomain:'arca',commandContract,
      callerScope:value.actorId+':'+value.shelfEntryId,idempotencyKey:value.idempotencyKey,requestDigest,targetType:'shelf_entry',targetId:value.shelfEntryId},
      domainParticipant:{participantId:'arca_defect_accept',owner:'arca',repositories:[repository],execute(context){const repo=context.repository(repository.repositoryId);
        guard(repo,value);value.validateReality();return write(repo,value,context.commitTimeMs);}},
      controlParticipant:value.controlParticipant,
      commitMarker:{commitMarker:key,scopeType:'shelf_entry',scopeId:value.shelfEntryId,commitDigest:requestDigest},
      auditRecords:[{auditId:key,actorType:'admin',actorId:value.actorId,action:'accept_existing_defects',scopeType:'shelf_entry',scopeId:value.shelfEntryId,evidenceDigest:requestDigest}],
      resultEnvelope:authorization=>({resultSchemaRef:'helix://contracts/application-types/ArcaDefectAuthorizationReceipt/v1',resultRef:{shelfEntryId:value.shelfEntryId,revision:authorization.revision,authorizationDigest:authorization.authorizationDigest}})});
    return {authorization:current(value.shelfEntryId),replayed:committed.replayed};
  }
  function repairIntent(value) {
    return read(repo=>repo.invoke('intent_key',{shelf_entry_id:value.shelfEntryId,actor_id:value.actorId,idempotency_key:value.idempotencyKey}));
  }
  function acceptanceReplay(entryId,actorId,idempotencyKey,candidateDigest) {
    const prior=read(repo=>fromRow(repo.invoke('authorization_key',{shelf_entry_id:entryId,actor_id:actorId,idempotency_key:idempotencyKey})));
    if(!prior)return null;
    if(prior.candidateDigest!==candidateDigest)fail('ARCA_DEFECT_COMMAND_KEY_CONFLICT','Acceptance key belongs to another exact preview.');
    return {authorization:current(entryId),replayed:true};
  }
  function repairParticipant(value,caseId) {
    return {participantId:'arca_defect_repair_intent',owner:'arca',repositories:[repository],execute(context){const repo=context.repository(repository.repositoryId);
      guard(repo,value,caseId);value.validateReality();
      let authorizationRevision=value.authorizationRevision;
      if(authorizationRevision===0) {
        if(!value.inheritedManifestDigest||!value.gaps?.length||canonicalDigest(value.gaps)!==value.gapSetDigest)
          fail('ARCA_DEFECT_INHERITED_SCOPE_REQUIRED','Manual repair requires the exact inherited accepted gaps.');
        authorizationRevision=write(repo,{...value,idempotencyKey:'inherit:'+value.intentId},context.commitTimeMs).revision;
      }
      repo.invoke('insert_intent',{intent_id:value.intentId,shelf_entry_id:value.shelfEntryId,inventory_revision:value.inventoryRevision,
        care_basis_digest:value.careBasisDigest,gap_set_digest:value.gapSetDigest,authorization_revision:authorizationRevision,
        aftercare_case_id:caseId,actor_id:value.actorId,idempotency_key:value.idempotencyKey,intent_digest:value.intentDigest,issued_at_ms:context.commitTimeMs});
      return {intentId:value.intentId,aftercareCaseId:caseId};}};
  }
  function repairCommitParticipant(value) {
    return {participantId:'arca_defect_repair_commit',owner:'arca',repositories:[repository],execute(context){const repo=context.repository(repository.repositoryId);
      const intent=repo.invoke('intent_case',{aftercare_case_id:value.aftercareCaseId});
      if(!intent)return null;
      const prior=currentIn(repo,intent.shelf_entry_id);
      if((prior?.revision || 0)!==Number(intent.authorization_revision)||value.gapSetDigest!==intent.gap_set_digest)
        fail('ARCA_DEFECT_REPAIR_STALE','Repair no longer refers to the current exact accepted gaps.');
      if(!value.fixedGapDigests?.length)fail('ARCA_DEFECT_REPAIR_NO_IMPROVEMENT','No accepted defect was verified as repaired.');
      const fixed=new Set(value.fixedGapDigests);
      if(canonicalDigest(value.gaps)!==value.gapSetDigest||[...fixed].some(digest=>!value.gaps.some(gap=>gap.gapDigest===digest)))fail('ARCA_DEFECT_REPAIR_NO_IMPROVEMENT','Verified repair does not match every exact accepted gap.');
      return write(repo,{shelfEntryId:intent.shelf_entry_id,inventoryRevision:Number(intent.inventory_revision)+1,
        careBasisDigest:intent.care_basis_digest,authorizationRevision:Number(intent.authorization_revision),
        gaps:value.gaps.filter(gap=>!fixed.has(gap.gapDigest)),actorId:intent.actor_id,
        idempotencyKey:'repair-commit:'+intent.intent_id},context.commitTimeMs);}};
  }
  function repairReceiptParticipant(value,aftercareCaseId) {
    const {createCommandReceiptParticipant}=require('../../../foundation/persistence/commit-foundation');
    return createCommandReceiptParticipant(options,{
      participantId:'arca_defect_repair_command',
      command:{commandReceiptId:value.intentId,ownerDomain:'arca',commandContract:'arca.repair-accepted-defects@1',
        callerScope:value.actorId,idempotencyKey:value.idempotencyKey,requestDigest:value.intentDigest,
        targetType:'shelf_entry',targetId:value.shelfEntryId},
      resultSchemaRef:'helix://contracts/application-types/ArcaDefectRepairResult/v1',
      resultRef:{resultKind:'repair_requested',aftercareCaseId,replayed:false},
      auditRecords:[{auditId:value.intentId,actorType:'admin',actorId:value.actorId,action:'repair_accepted_defects',
        scopeType:'aftercare_case',scopeId:aftercareCaseId,evidenceDigest:value.gapSetDigest}],
    });
  }
  return Object.freeze({current,currentMany,accept,acceptanceReplay,repairIntent,repairParticipant,repairReceiptParticipant,repairCommitParticipant});
}
module.exports=Object.freeze({createArcaDefectAdmissionStore});
