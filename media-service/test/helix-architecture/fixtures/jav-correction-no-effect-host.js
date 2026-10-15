'use strict';
const fs=require('node:fs'),path=require('node:path'),Database=require('better-sqlite3');
const assert=require('node:assert/strict');
const {openSqliteKernel}=require('../../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../../src/helix/foundation/capability/contract-validator');
const {createMaterialControlProjectionPort}=require('../../../src/helix/foundation/persistence/material-control');
const {createAftercareStore}=require('../../../src/helix/domains/arca/persistence/aftercare-store');
const {createJavIdentityCorrectionStore}=require('../../../src/helix/domains/arca/persistence/jav-identity-correction-store');
const {createJavCorrectionNoEffectReader}=require('../../../src/helix/domains/arca/persistence/jav-correction-no-effect-reader');
const {buildJavCorrectionBasis}=require('../../../src/helix/domains/arca/model/jav-identity-correction');
const {buildArcaApplicationSchemas}=require('../../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../../scripts/helix-architecture/shared-type-schema-builder');
function observeNoEffectFailure({dataDir,correctionId,db,cancel=false,executionEvidence=false,recoveryCommand=false}){
  const root=db.prepare('SELECT endpoint_id,mount_scope_id,mount_scope_revision,resolved_root FROM platform_workspace_roots WHERE root_id=?').get('service-arca-aftercare-workspace');
  const generated=path.resolve(__dirname,'../../../src/helix/foundation/persistence/generated'),
    schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),
    schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),
    kernel=openSqliteKernel({Database,databasePath:path.join(dataDir,'shelfdeck.db'),schemaDdl,schemaManifest}),
    options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),aftercareWorkspaceRoot:root.resolved_root,
      aftercareWorkspaceEndpointId:root.endpoint_id,aftercareWorkspaceMountScopeId:root.mount_scope_id,aftercareWorkspaceMountScopeRevision:Number(root.mount_scope_revision),
      contractValidator:createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas())]})};
  try{
    const store=createAftercareStore(options);store.ensureAftercareWorkspaceRoot();
    const record=createJavIdentityCorrectionStore(options).get(correctionId);
    if(executionEvidence){const reader=require('../../../src/helix/domains/arca/persistence/jav-correction-recovery-reader').createJavCorrectionRecoveryReader(options),
      value=reader.read(record),failed=value.snapshot.works.find(work=>work.state==='failed');
      assert.ok(failed);assert.equal(value.source(null),null);
      return {snapshot:value.snapshot,snapshotDigest:value.snapshotDigest,failedWorkEvidenceDigest:value.workEvidence(failed.work_id)};}
    const raw=store.currentContext(record.shelfEntryId),
      keys=[...new Set(raw.materials.map(row=>row.material_key))].sort(),controls=[],controlPort=createMaterialControlProjectionPort(options);
    for(let offset=0;offset<keys.length;offset+=500)controls.push(...controlPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
    const basis=buildJavCorrectionBasis({raw:{...raw,correctionGate:null},controlProjections:controls,activeCases:store.history(record.shelfEntryId).cases}),
      reader=createJavCorrectionNoEffectReader({...options,rootSnapshot:store.aftercareWorkspaceRootSnapshot});
    const observation=options.unitOfWork.execute([reader.participant({record,currentBasisDigest:basis.basisDigest})]).arca_jav_no_effect_observation;
    if(recoveryCommand){
      const {canonicalDigest}=require('../../../src/helix/contracts/canonical-json'),
        {buildJavCorrectionRecoveryReceipt}=require('../../../src/helix/domains/arca/model/jav-correction-recovery'),
        executionReader=require('../../../src/helix/domains/arca/persistence/jav-correction-recovery-reader').createJavCorrectionRecoveryReader(options),
        execution=executionReader.read(record),failed=execution.snapshot.works[0],workDefinition=execution.definitions.get(failed.work_id),
        workspacePath=path.join(root.resolved_root,correctionId+'-assets');
      assert.equal(execution.snapshot.works.length,1);assert.equal(failed.state,'failed');assert.equal(fs.existsSync(workspacePath),false);
      const realityObservation={schema:'arca.jav-correction-recovery-reality@1',correctionId,phase:failed.work_kind,observedAtMs:Date.now(),classification:'matching',files:[],directories:[{location:workspacePath,exists:false,memberNames:[],memberSetDigest:canonicalDigest([])}]};
      const body={schema:'arca.jav-correction-recovery-observation@1',correctionId,admissionDigest:record.admissionDigest,stateRevision:record.stateRevision,updatedAtMs:record.updatedAtMs,
        previousIntentDigest:null,scopeDigest:failed.basis_digest,executionRevision:workDefinition.dependencyRefs[0].revision,filePlanDigest:null,sourceResultReference:null,
        realityClassification:'matching',realityDigest:canonicalDigest(realityObservation),realityObservation,executionSnapshot:execution.snapshot,
        failedWork:{ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:correctionId,state:'failed',hasUnresolvedEffects:false,
          workKind:failed.work_kind,baseWorkId:failed.work_id,workId:failed.work_id,definitionDigest:failed.definition_digest,
          executionEvidenceDigest:execution.workEvidence(failed.work_id),basisDigest:failed.basis_digest}},
        preparation={currentBasisDigest:basis.basisDigest,executionSnapshotDigest:execution.snapshotDigest,observation:{...body,observationDigest:canonicalDigest(body)}},
        input={shelfEntryId:record.shelfEntryId,correctionId,actorId:'admin',idempotencyKey:'source-only-recovery',expectedStateRevision:record.stateRevision,
          expectedAdmissionDigest:record.admissionDigest,expectedCleanupState:null,expectedRecoveryIntentDigest:null},
        commandOptions={...options,rootSnapshot:{...store.aftercareWorkspaceRootSnapshot,resolvedRoot:root.resolved_root}},
        recoveryStore=createJavIdentityCorrectionStore(commandOptions),
        snapshot=()=>({intents:db.prepare('SELECT * FROM arca_jav_correction_recovery_intents ORDER BY recovery_id').all(),correction:db.prepare('SELECT * FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),
          commands:db.prepare('SELECT * FROM fx_command_receipts ORDER BY command_receipt_id').all(),markers:db.prepare('SELECT * FROM fx_commit_markers ORDER BY commit_marker').all(),
          audits:db.prepare('SELECT * FROM fx_audit_records ORDER BY audit_id').all(),
          works:db.prepare('SELECT * FROM fx_supporting_works ORDER BY work_id').all(),events:db.prepare('SELECT * FROM fx_workflow_events ORDER BY event_id').all(),
          effects:db.prepare('SELECT * FROM fx_effect_journal ORDER BY effect_id').all(),controls:db.prepare('SELECT * FROM fx_material_controls ORDER BY material_key').all()}),before=snapshot();
      assert.throws(()=>recoveryStore.admitRecovery(input,null),{code:'ARCA_JAV_CORRECTION_RECOVERY_PREPARATION_REQUIRED'});assert.deepEqual(snapshot(),before);
      assert.throws(()=>recoveryStore.admitRecovery({...input,expectedStateRevision:2},preparation),{code:'ARCA_JAV_CORRECTION_RECOVERY_STALE'});assert.deepEqual(snapshot(),before);
      const faulty=createJavIdentityCorrectionStore({...commandOptions,unitOfWork:{execute(participants){return options.unitOfWork.execute(participants.map(participant=>
        participant.participantId==='commit_foundation'?{...participant,execute(context){participant.execute(context);throw Object.assign(new Error('Crash after recovery command Receipt.'),{code:'FIXTURE_LATE_RECOVERY_FAILURE'});}}:participant));}}});
      assert.throws(()=>faulty.admitRecovery(input,preparation),{code:'FIXTURE_LATE_RECOVERY_FAILURE'});assert.deepEqual(snapshot(),before);
      const accepted=recoveryStore.admitRecovery(input,preparation),receipt=accepted.receipt.resultRef,after=snapshot();
      options.contractValidator.validate(receipt.schemaRef,receipt);assert.equal(receipt.mode,'continue_correction');assert.equal(receipt.acceptedStateRevision,record.stateRevision+1);
      assert.equal(receipt.receiptDigest,buildJavCorrectionRecoveryReceipt({record,command:input,observation:preparation.observation,admittedAtMs:receipt.admittedAtMs}).receiptDigest);
      assert.equal(after.intents.length,before.intents.length+1);assert.deepEqual(JSON.parse(after.intents.at(-1).observation_json),preparation.observation);
      assert.equal(after.correction.state,'active');assert.equal(after.correction.recovery_intent_digest,receipt.receiptDigest);
      assert.deepEqual(recoveryStore.get(correctionId).recoveryIntent,receipt);assert.deepEqual(after.works,before.works);assert.deepEqual(after.events,before.events);
      assert.deepEqual(after.effects,before.effects);assert.deepEqual(after.controls,before.controls);assert.equal(after.commands.length,before.commands.length+1);
      const replay=recoveryStore.admitRecovery(input,null);assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,accepted.receipt);assert.deepEqual(snapshot(),after);
      assert.throws(()=>recoveryStore.admitRecovery({...input,expectedAdmissionDigest:'0'.repeat(64)},null),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
      assert.throws(()=>recoveryStore.admitRecovery({...input,idempotencyKey:'second-while-active'},preparation),{code:'ARCA_JAV_CORRECTION_RECOVERY_STALE'});
      assert.deepEqual(snapshot(),after);return receipt;
    }
    if(!cancel)return observation;
    const commandOptions={...options,rootSnapshot:store.aftercareWorkspaceRootSnapshot},correctionStore=createJavIdentityCorrectionStore(commandOptions),
      input={shelfEntryId:record.shelfEntryId,correctionId,actorId:'admin',idempotencyKey:'source-only-cancel',expectedStateRevision:record.stateRevision,expectedAdmissionDigest:record.admissionDigest},
      state=()=>({correction:db.prepare('SELECT state,state_revision,terminal_evidence_digest,terminal_at_ms FROM arca_jav_identity_corrections WHERE correction_id=?').get(correctionId),
        commands:db.prepare('SELECT * FROM fx_command_receipts ORDER BY command_receipt_id').all(),markers:db.prepare('SELECT * FROM fx_commit_markers ORDER BY commit_marker').all(),
        audits:db.prepare('SELECT * FROM fx_audit_records ORDER BY audit_id').all(),controls:db.prepare('SELECT * FROM fx_material_controls ORDER BY material_key').all(),
        history:db.prepare('SELECT * FROM fx_material_control_revisions ORDER BY material_key,revision').all()}),before=state();
    assert.throws(()=>correctionStore.cancelNoEffect({...input,expectedStateRevision:record.stateRevision-1}),{code:'ARCA_JAV_CORRECTION_CANCEL_STALE'});
    assert.deepEqual(state(),before);
    const faulty=createJavIdentityCorrectionStore({...commandOptions,unitOfWork:{execute(participants){return options.unitOfWork.execute(participants.map(participant=>
      participant.participantId==='commit_foundation'?{...participant,execute(context){participant.execute(context);throw Object.assign(new Error('Crash window after Receipt write.'),{code:'FIXTURE_LATE_CANCEL_FAILURE'});}}:participant));}}});
    assert.throws(()=>faulty.cancelNoEffect(input),{code:'FIXTURE_LATE_CANCEL_FAILURE'});assert.deepEqual(state(),before);
    const accepted=correctionStore.cancelNoEffect(input),receipt=accepted.receipt.resultRef;
    assert.equal(accepted.replayed,false);assert.equal(receipt.state,'cancelled');assert.equal(receipt.stateRevision,record.stateRevision+1);
    assert.equal(receipt.noEffectObservationDigest,observation.observationDigest);
    const after=state();assert.equal(after.correction.terminal_evidence_digest,receipt.receiptDigest);
    assert.deepEqual(after.controls,before.controls);assert.deepEqual(after.history,before.history);
    assert.equal(after.commands.length,before.commands.length+1);assert.equal(after.markers.length,before.markers.length+1);assert.equal(after.audits.length,before.audits.length+1);
    assert.deepEqual(correctionStore.cancelNoEffect(input).receipt,accepted.receipt);assert.deepEqual(state(),after);
    assert.throws(()=>correctionStore.cancelNoEffect({...input,expectedAdmissionDigest:'0'.repeat(64)}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
    assert.throws(()=>correctionStore.cancelNoEffect({...input,idempotencyKey:'new-key-after-terminal'}),{code:'ARCA_JAV_CORRECTION_CANCEL_STALE'});
    assert.deepEqual(state(),after);assert.equal(store.currentContext(record.shelfEntryId).correctionGate,null);
    return receipt;
  }finally{kernel.close();}
}
module.exports={observeNoEffectFailure};
