'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createMaterialControlParticipant, controlScopeDigest } = require('../../src/helix/foundation/persistence/material-control');
const { createAftercareStore } = require('../../src/helix/domains/arca/persistence/aftercare-store');
const { createAftercareCapabilityPorts,
  resolveAftercareSettlementTarget,
  assertAftercareSettlementHandle } = require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const { settlementScopeDigest, buildAftercareSettlementHandles, aftercareSettlementEventId,
  aftercareServiceCatalogRevision, aftercareSettlementApprovalId, aftercareInventoryCommitId, deriveInventoryMaterialChanges,
  aftercareInventoryCommitDigest,
  CAPABILITY_REFS:C } = require('../../src/helix/domains/arca/model/aftercare-contract');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const digest = (value) => canonicalDigest({ value });

function boundedFingerprint(location) {
  const stat=fs.statSync(location),contentFingerprint=crypto.createHash('sha256').update(fs.readFileSync(location)).digest('hex');
  return Object.freeze({ stat,fingerprintAlgorithm:'sha256',fingerprintVersion:1,contentFingerprint });
}

function physicalIdentity(location,mountScopeId) {
  const bounded=boundedFingerprint(location),tuple={ mountScopeId,inode:String(bounded.stat.ino),sizeBytes:Number(bounded.stat.size),
    fingerprintAlgorithm:bounded.fingerprintAlgorithm,fingerprintVersion:bounded.fingerprintVersion,
    contentFingerprint:bounded.contentFingerprint };
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:canonicalDigest({ schema:'physical-material-identity@2',...tuple }),...tuple });
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aftercare-approval-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let at = 10_000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => at });
  const seed = new Database(databasePath);
  seed.pragma('foreign_keys = OFF');
  const careBasis = Object.freeze({ schemaRef:'helix://contracts/domain-types/CareBasis/v1', schemaVersion:1,
    inventoryRevision:1, standardRevision:3, placementRevision:2, canonicalIdentityDigest:digest('identity'),
    sourcePackageId:'package-1', acceptedProductFactSetDigest:digest('facts'), decisionFactSetDigest:digest('decision') });
  const frozen = Object.freeze({ ...careBasis, digest:canonicalDigest(careBasis) });
  const requirement = Object.freeze({ schemaRef:'helix://contracts/domain-types/CareRequirement/v1', schemaVersion:1,
    requirementId:'requirement-1', revision:1, careBasisDigest:frozen.digest, requiredEffects:Object.freeze([]),
    acceptanceDigest:digest('acceptance'), typedParameters:Object.freeze([]), digest:digest('requirement') });
  seed.prepare(`INSERT INTO arca_aftercare_cases
    (aftercare_case_id,shelf_entry_id,finding_set_digest,care_basis_schema_ref,care_basis_json,care_basis_digest,
     care_requirement_schema_ref,care_requirement_json,care_requirement_digest,case_generation,trigger_digest,state,
     terminal_reason_code,terminal_evidence_digest,created_at_ms,terminal_at_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,?,NULL)`).run('case-1','entry-1',digest('findings'),frozen.schemaRef,canonicalJson(frozen),
      frozen.digest,requirement.schemaRef,canonicalJson(requirement),requirement.digest,1,digest('trigger'),'active',at);
  seed.prepare('INSERT INTO fx_workflow_events (event_id) VALUES (?)').run('inventory-event-atomic');
  seed.close();
  const unitOfWork=createSqliteUnitOfWork({ kernel }),store = createAftercareStore({ schemaManifest, unitOfWork, now:() => at });
  return { root, databasePath, kernel, unitOfWork, store, frozen, setTime(value) { at = value; }, close() {
    kernel.close(); fs.rmSync(root, { recursive:true, force:true });
  } };
}

function inventoryResultBinding(request,eventId='inventory-event-atomic') {
  const receiptId=aftercareInventoryCommitId(request),effectReceiptId='arca-care-effect-receipt-'+canonicalDigest({eventId}).slice(0,40),
    result=Object.freeze({schemaRef:'helix://contracts/types/AftercareInventoryCommitReceipt/v1',schemaVersion:1,
      receiptId,receiptKind:'aftercare_inventory_committed',ownerDomain:'arca',scopeType:'shelf_entry',scopeId:request.shelfEntryId,
      scopeDigest:digest('care-basis'),effectReceiptRef:effectReceiptId,committedAtMs:request.committedAtMs,
      aftercareCaseId:request.aftercareCaseId,shelfEntryId:request.shelfEntryId,
      previousInventoryRevision:request.previousInventoryRevision,newInventoryRevision:request.previousInventoryRevision+1,
      controlChangeDigest:request.controlChangeDigest}),evidence=Object.freeze({evidenceId:'inventory-evidence-1',
      evidenceKind:'arca_aftercare',producerRef:C.inventoryCommit,basisDigest:digest('care-basis'),
      payloadDigest:canonicalDigest(result),observedAtMs:request.committedAtMs});
  const resultDigest=canonicalDigest(result),commitDigest=aftercareInventoryCommitDigest(request,resultDigest),
    effectReceipt=Object.freeze({schemaRef:'helix://contracts/types/EffectReceipt/v1',
    schemaVersion:1,effectReceiptId,effectId:digest('inventory-effect'),effectClass:'responsibility_control_commit',
    idempotencyKey:'inventory-key',commitMarker:'inventory-effect-marker',externalReceiptRef:null,
    outputDigest:resultDigest,verificationEvidenceDigest:commitDigest,committedAtMs:request.committedAtMs});
  return Object.freeze({resultId:'inventory-result-'+canonicalDigest({eventId}).slice(0,40),eventId,outcomeKind:'succeeded',
    resultSchemaRef:'helix://contracts/capabilities/arca.aftercare.inventory.commit/v1/result',result,
    evidenceSchemaRef:'helix://contracts/capabilities/arca.aftercare.inventory.commit/v1/evidence',evidence,effectReceiptId,effectReceipt});
}

test('Aftercare Settlement Approval is durable, exact, one-shot, and replay-safe', () => {
  const value = fixture();
  try {
    const scope = settlementScopeDigest([{ endpointId:'endpoint-1', location:'F:/shelf/old.mkv',
      bindingRevision:1, mountScopeRevision:1, readScope:'exact_aftercare_settlement',
      identity:Object.freeze({ materialKey:digest('old'), sizeBytes:12 }), finalLocation:'F:/shelf/movie.mkv',
      finalMaterialKey:digest('final') }]);
    const request = { aftercareCaseId:'case-1', settlementScopeDigest:scope, serviceCatalogRevision:1,
      shelfStandardRevision:3, careBasisDigest:value.frozen.digest, settlementEventId:'settlement-event-1' };
    const issued = value.store.issueSettlementApproval(request);
    assert.equal(issued.state, 'active');
    assert.deepEqual(value.store.issueSettlementApproval(request), issued);
    assert.equal(value.store.getSettlementApproval('case-1', scope).approvalId, issued.approvalId);
    assert.equal(value.store.consumeSettlementApproval({ ...request, approvalId:issued.approvalId }).state, 'consumed');
    assert.equal(value.store.consumeSettlementApproval({ ...request, approvalId:issued.approvalId }).state, 'consumed');
    assert.throws(() => value.store.issueSettlementApproval({ ...request, settlementEventId:'settlement-event-2' }),
      (error) => error.code === 'ARCA_AFTERCARE_SETTLEMENT_APPROVAL_CONFLICT');
    assert.throws(() => value.store.issueSettlementApproval({ ...request, shelfStandardRevision:4 }),
      (error) => error.code === 'ARCA_AFTERCARE_SETTLEMENT_APPROVAL_CONFLICT');
  } finally { value.close(); }
});

test('Inventory revision and its Settlement Approval commit in one Arca transaction', () => {
  const value=fixture();
  try {
    const seed=new Database(value.databasePath);seed.pragma('foreign_keys = OFF');
    seed.prepare(`INSERT INTO arca_shelf_entries
      (shelf_entry_id,shelf_id,structure_kind,status,canonical_identity_revision,canonical_identity_key,
       current_inventory_revision,current_deck_fact_revision,created_at_ms,terminal_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,NULL)`).run('entry-1','shelf-1','movie','active',1,'identity-1',1,1,10_000);
    seed.prepare(`INSERT INTO arca_inventory_representations
      (shelf_entry_id,revision,representation_digest,source_package_id,committed_at_ms)
      VALUES (?,?,?,?,?)`).run('entry-1',1,digest('inventory-1'),'package-1',10_000);seed.close();
    const tuple={mountScopeId:'mount-1',inode:'1',sizeBytes:1,fingerprintAlgorithm:'middle-256k-sha256',
      fingerprintVersion:1,contentFingerprint:digest('control-bytes')},identity=Object.freeze({
        schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
        materialKey:canonicalDigest({schema:'physical-material-identity@2',...tuple}),...tuple}),scope=Object.freeze({
        ownerDomain:'arca',scopeType:'shelf_entry',scopeId:'entry-1'}),controlChange=Object.freeze({
        action:'acquire',identity,expectedRevision:0,fromScope:null,toScope:scope}),controlDigest=controlScopeDigest([controlChange]),
      settlementApproval={aftercareCaseId:'case-1',settlementScopeDigest:digest('scope'),serviceCatalogRevision:1,
      shelfStandardRevision:3,careBasisDigest:value.frozen.digest,settlementEventId:'settlement-event-atomic'},baseRequest={
        aftercareCaseId:'case-1',shelfEntryId:'entry-1',previousInventoryRevision:1,representationDigest:digest('inventory-2'),
        controlChangeDigest:controlDigest,materials:[],related:[],facts:[],people:[],committedAtMs:12_345,settlementApproval},
      request={...baseRequest,resultBinding:inventoryResultBinding(baseRequest)},controlHandle={
        schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,
        handleId:'aftercare-control-handle',operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_shelf_entry',
        processId:'entry-1',basisRef:{objectType:'aftercare_case',objectId:'case-1',revision:1,digest:value.frozen.digest},
        basisDigest:value.frozen.digest,canonicalFactSetDigest:digest('facts'),bindingSetDigest:digest('bindings'),
        controlScopeDigest:controlDigest,expectedControlRevisions:[{materialKey:identity.materialKey,revision:0}],
        receiptContract:{receiptSchemaRef:'AftercareInventoryCommitReceipt@1',controlRevisionSetSchemaRef:'arca.aftercare-control-revision-set@1'},
        eventFenceDigest:digest('event-fence')},controlParticipant=createMaterialControlParticipant({schemaManifest,
        handle:controlHandle,changes:[controlChange],authorizedScopeDigest:controlDigest,
        commitMarker:request.resultBinding.effectReceipt.commitMarker});
    assert.throws(()=>value.store.commitInventory({...request,settlementApproval:{...settlementApproval,serviceCatalogRevision:0}}),
      (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_APPROVAL_INVALID');
    assert.throws(()=>value.store.commitInventory({...request,resultBinding:{...request.resultBinding,eventId:'missing-event'}},controlParticipant),
      (error)=>error.code==='SQLITE_CONSTRAINT_FOREIGNKEY');
    let inspect=new Database(value.databasePath,{readonly:true});
    assert.equal(inspect.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get('entry-1').revision,1);
    assert.equal(inspect.prepare('SELECT count(*) count FROM arca_aftercare_inventory_commits').get().count,0);
    assert.equal(inspect.prepare('SELECT count(*) count FROM arca_aftercare_settlement_approvals').get().count,0);
    assert.equal(inspect.prepare('SELECT count(*) count FROM fx_event_result_bindings').get().count,0);
    assert.equal(inspect.prepare('SELECT count(*) count FROM fx_commit_markers').get().count,0);
    assert.equal(inspect.prepare('SELECT count(*) count FROM fx_material_controls').get().count,0);
    assert.equal(inspect.prepare('SELECT count(*) count FROM fx_material_control_revisions').get().count,0);inspect.close();
    const committed=value.store.commitInventory(request,controlParticipant);
    assert.equal(committed.newInventoryRevision,2);
    inspect=new Database(value.databasePath,{readonly:true});
    assert.equal(inspect.prepare('SELECT current_inventory_revision revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get('entry-1').revision,2);
    assert.equal(inspect.prepare('SELECT count(*) count FROM arca_aftercare_inventory_commits').get().count,1);
    assert.equal(inspect.prepare('SELECT state FROM arca_aftercare_settlement_approvals').get().state,'active');
    assert.deepEqual(inspect.prepare('SELECT control_revision,state,owner_domain,owner_scope_id FROM fx_material_controls').get(),{
      control_revision:1,state:'controlled',owner_domain:'arca',owner_scope_id:'entry-1'});
    assert.equal(inspect.prepare('SELECT count(*) count FROM fx_material_control_revisions').get().count,1);
    const resultRow=inspect.prepare('SELECT event_id,result_id,result_schema_ref,result_digest,effect_receipt_id FROM fx_event_result_bindings').get(),
      markerRow=inspect.prepare('SELECT effect_id,scope_id,commit_digest,result_id,result_schema_ref,result_digest FROM fx_commit_markers WHERE scope_type=?').get('shelf_entry');
    assert.equal(resultRow.event_id,request.resultBinding.eventId);
    assert.equal(resultRow.result_digest,canonicalDigest(request.resultBinding.result));
    assert.deepEqual(markerRow,{effect_id:request.resultBinding.effectReceipt.effectId,scope_id:'entry-1',commit_digest:request.resultBinding.effectReceipt.verificationEvidenceDigest,
      result_id:resultRow.result_id,result_schema_ref:resultRow.result_schema_ref,result_digest:resultRow.result_digest});
    assert.notEqual(markerRow.commit_digest,resultRow.result_digest);
    assert.equal(resultRow.effect_receipt_id,request.resultBinding.effectReceiptId);inspect.close();
  } finally { value.close(); }
});

test('terminal Aftercare Case makes every unconsumed Settlement Approval stale', () => {
  const value = fixture();
  try {
    const scope = settlementScopeDigest([{ endpointId:'endpoint-1', location:'F:/shelf/old.nfo',
      bindingRevision:1, mountScopeRevision:1, readScope:'exact_aftercare_settlement',
      identity:Object.freeze({ materialKey:digest('old-nfo'), sizeBytes:12 }) }]);
    const request = { aftercareCaseId:'case-1', settlementScopeDigest:scope, serviceCatalogRevision:1,
      shelfStandardRevision:3, careBasisDigest:value.frozen.digest, settlementEventId:'settlement-event-1' };
    const approval=value.store.issueSettlementApproval(request);
    value.setTime(20_000);
    value.store.terminateCase('case-1', 'invalidated', 'test_invalidated', digest('terminal-evidence'));
    assert.equal(value.store.getSettlementApproval('case-1', scope).state, 'stale');
    assert.throws(() => value.store.consumeSettlementApproval({ ...request, approvalId:approval.approvalId }),
      (error) => error.code === 'ARCA_AFTERCARE_SETTLEMENT_APPROVAL_STALE');
  } finally { value.close(); }
});

test('Settlement scope changes when identity or binding fence changes', () => {
  const readHandle = { endpointId:'endpoint-1', location:'F:/shelf/old.mkv',
    bindingRevision:1, mountScopeRevision:1, readScope:'exact_aftercare_settlement',
    identity:Object.freeze({ materialKey:digest('old'), sizeBytes:12 }) };
  assert.notEqual(settlementScopeDigest([readHandle]), settlementScopeDigest([{
    ...readHandle,identity:{ ...readHandle.identity,materialKey:digest('changed') } }]));
  assert.notEqual(settlementScopeDigest([readHandle]), settlementScopeDigest([{
    ...readHandle,location:'F:/shelf/another-old.mkv' }]));
  assert.notEqual(settlementScopeDigest([readHandle]), settlementScopeDigest([{
    ...readHandle,bindingRevision:2 }]));
  assert.notEqual(settlementScopeDigest([readHandle]), settlementScopeDigest([{
    ...readHandle,mountScopeRevision:2 }]));
});

test('known-old Settlement mapping validates through the exact runtime input contract', () => {
  const identity=Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:digest('old'),mountScopeId:'mount-1',inode:'9',sizeBytes:9,
    fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:digest('bytes')}),
    final={material_key:digest('final'),location:'F:/shelf/movie.mkv',size_bytes:identity.sizeBytes,
      fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,
      content_fingerprint:identity.contentFingerprint},binding={material_key:identity.materialKey,
      mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,
      fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:identity.fingerprintVersion,
      content_fingerprint:identity.contentFingerprint,binding_revision:1,endpoint_id:'endpoint-1',location:'F:/old/movie.mkv'},
    handles=buildAftercareSettlementHandles({context:{raw:{shelf:{target_mount_scope_revision:1},materials:[final]}},
      aftercareCaseId:'case-1',receipts:[],frozenMaterials:[],observedAtMs:10,
      observedOldBindings:[{kind:'duplicate_of_final',binding,identity,final}]}),scope=settlementScopeDigest(handles),
    input={supersededInventoryHandleList:handles,aftercareSettlementApproval:{
      schemaRef:'helix://contracts/types/ApprovalHandle/v1',schemaVersion:1,approvalId:'approval-1',
      ownerDomain:'arca',processType:'aftercare',processId:'case-1',eventId:'event-1',
      exactEffectScopeDigest:scope,approvalRevision:1,actorId:'arca',invalidatingFactDigests:[digest('basis')],approvedAtMs:10}},
    contractsRoot=path.resolve(__dirname,'../../src/helix/contracts'),schemas=[
      'capabilities/arca/aftercare/input_settlement/delete/v1/inputs.schema.json',
      'types/PhysicalMaterialReadHandle/v1/schema.json','types/PhysicalMaterialIdentity/v2/schema.json',
      'types/ApprovalHandle/v1/schema.json',
    ].map((relative)=>JSON.parse(fs.readFileSync(path.join(contractsRoot,relative),'utf8'))),validator=createCapabilityContractValidator({schemas});
  assert.equal(validator.validate(schemas[0].$id,input),input);
  assert.throws(()=>validator.validate(schemas[0].$id,{...input,supersededInventoryHandleList:[{
    ...handles[0],unexpected:true}]}),/additional properties/);
  const target=resolveAftercareSettlementTarget({raw:{materials:[final]}},handles[0]);
  assert.equal(target.finalReplacement.materialKey,final.material_key);
  assert.equal(target.finalReplacement.location,final.location);
  assert.throws(()=>resolveAftercareSettlementTarget({raw:{materials:[]}},handles[0]),
    (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_FINAL_MISMATCH');
});

test('Inventory Control ignores unmanaged target drift while Settlement retains its exact identity', () => {
  const identity=(name)=>({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:digest(name),mountScopeId:'mount-1',inode:String(name.length),sizeBytes:name.length,
    fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:digest(name+'-bytes')}),
    frozen=identity('frozen-inventory'),drift=identity('current-drift'),final=identity('final'),receipt={
    finalMaterialIdentity:final,supersededMaterialIdentity:drift,supersededLocation:'F:/shelf/movie.nfo.superseded',
    targetEndpointId:'endpoint-1',committedAtMs:10_000,
    retiredMaterials:Object.freeze([{identity:frozen,location:'F:/shelf/movie.nfo.superseded',requiresSettlement:false}])};
  const changes=deriveInventoryMaterialChanges([], [receipt]);
  assert.deepEqual(changes.map((item)=>[item.action,item.identity.materialKey]).sort(),[
    ['acquire',final.materialKey],['release',frozen.materialKey],
  ].sort());
  const handles=buildAftercareSettlementHandles({context:{raw:{shelf:{target_mount_scope_revision:1},materials:[]}},
    aftercareCaseId:'case-1',receipts:[receipt],frozenMaterials:[]});
  assert.equal(handles.some((item)=>item.identity.materialKey===drift.materialKey),true);
});

test('Inventory Control releases a superseded Primary when its replacement changes extension', () => {
  const identity=(name)=>({schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,
    materialKey:digest(name),mountScopeId:'mount-1',inode:String(name.length),sizeBytes:name.length,
    fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:digest(name+'-bytes')}),
    oldPrimary=identity('movie-avi'),finalPrimary=identity('movie-mkv'),materials=[{
      material_key:oldPrimary.materialKey,location:'F:/shelf/movie.avi',mount_scope_id:oldPrimary.mountScopeId,
      inode:oldPrimary.inode,size_bytes:oldPrimary.sizeBytes,fingerprint_algorithm:oldPrimary.fingerprintAlgorithm,
      fingerprint_version:oldPrimary.fingerprintVersion,content_fingerprint:oldPrimary.contentFingerprint,
    }],receipt={finalMaterialIdentity:finalPrimary,targetLocation:'F:/shelf/movie.mkv',
      supersededMaterialIdentity:oldPrimary,supersededLocation:'F:/shelf/movie.avi.superseded-case-1',
      retiredMaterials:Object.freeze([])};
  const changes=deriveInventoryMaterialChanges(materials,[receipt]);
  assert.deepEqual(changes.map((item)=>[item.action,item.identity.materialKey]).sort(),[
    ['acquire',finalPrimary.materialKey],['release',oldPrimary.materialKey],
  ].sort());
});

test('Planner and Inventory commit share one Settlement Event identity and current Catalog revision source', () => {
  const workAttemptId='work-attempt-7',expected='care-settlement-'+canonicalDigest(workAttemptId).slice(0,18),
    planner=fs.readFileSync(path.join(__dirname,'../../src/helix/domains/arca/planning/aftercare-planners.js'),'utf8');
  assert.equal(aftercareSettlementEventId(workAttemptId),expected);
  assert.match(planner,/const settlement=aftercareSettlementEventId\(request\.workAttemptId\)/);
  assert.equal(aftercareServiceCatalogRevision({ resolve:() => ({ manifest:{ contractVersion:7 } }) }),7);
  assert.throws(() => aftercareServiceCatalogRevision(null),/current Service Catalog revision/);
});

test('production composition gives every Aftercare stage the current Service Catalog', () => {
  const composition=fs.readFileSync(path.join(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'),'utf8');
  assert.match(composition,/let host, registry;/);
  assert.match(composition,/const currentServiceCatalog = Object\.freeze\(\{/);
  assert.match(composition,/arcaConstruction\.createCapabilityRegistration\(\{\.\.\.options,now,workResultReader,[\s\S]*?registry:currentServiceCatalog,/);
  assert.match(composition,/registry = createCapabilityRegistry\(\{ registrations, expectedCapabilityRefs: ENABLED \}\);/);
  assert.match(composition,/createProcessServices\(\{\.\.\.options,now,registry,workResultReader,/);
  assert.match(composition,/createPlanningRegistration\(\{\.\.\.options,registry,policyRegistry,/);
  assert.match(composition,/materialControlProjectionPort,controlScopeDigest,computeBoundedMaterialFingerprintSync,now/);
  assert.doesNotMatch(composition,/projectMaterialControlRow/);
});

test('Aftercare projection reads current Foundation Control only and never reconstructs Foundation history', () => {
  const source=fs.readFileSync(path.join(__dirname,'../../src/helix/domains/arca/planning/aftercare-projections.js'),'utf8');
  assert.doesNotMatch(source,/recoveredControlChange|projectMaterialControlRow|CONTROL_RECOVERY_STALE/);
  assert.match(source,/controls\.getMaterialControlProjections/);
});

test('Settlement handles reconstruct identically after a known old Binding is already absent', () => {
  const tuple={ mountScopeId:'mount-1', inode:'12', sizeBytes:123, fingerprintAlgorithm:'middle-256k-sha256',
    fingerprintVersion:1, contentFingerprint:digest('bytes') },materialKey=canonicalDigest({ schema:'physical-material-identity@2', ...tuple }),
    identity=Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey,...tuple }),
    binding={ material_key:materialKey,mount_scope_id:tuple.mountScopeId,inode:tuple.inode,size_bytes:tuple.sizeBytes,
      fingerprint_algorithm:tuple.fingerprintAlgorithm,fingerprint_version:tuple.fingerprintVersion,
      content_fingerprint:tuple.contentFingerprint,binding_revision:4,endpoint_id:'endpoint-1',location:'F:/old/movie.mkv' },
    final={ ...binding,material_key:digest('final-material'),location:'F:/shelf/movie.mkv' },
    context={ raw:{ shelf:{ target_mount_scope_revision:7 },materials:[final] } },input={ context,aftercareCaseId:'case-1',
      receipts:[],frozenMaterials:[],observedAtMs:20_000 };
  const before=buildAftercareSettlementHandles({ ...input,observedOldBindings:[{ kind:'duplicate_of_final',binding,identity,final }] });
  const after=buildAftercareSettlementHandles({ ...input,observedOldBindings:[{ kind:'absent',binding }] });
  assert.deepEqual(after,before);
  assert.equal(settlementScopeDigest(after),settlementScopeDigest(before));
});

test('Settlement handle scope preserves two exact locations for one Physical Identity', () => {
  const identity=Object.freeze({ materialKey:digest('shared-hardlink'),sizeBytes:12 }),context={ raw:{
    shelf:{ target_mount_scope_revision:1 },materials:[] } },receipt={ targetEndpointId:'endpoint-1',committedAtMs:10,
    retiredMaterials:[{ identity,location:'F:/old/a.mkv',requiresSettlement:true },
      { identity,location:'F:/old/b.mkv',requiresSettlement:true }] };
  const handles=buildAftercareSettlementHandles({ context,aftercareCaseId:'case-1',receipts:[receipt],frozenMaterials:[] });
  assert.equal(handles.length,2);
  assert.notEqual(handles[0].location,handles[1].location);
});

test('resolved Aftercare Case commit replays the same terminal Result', () => {
  const value=fixture();
  try {
    const care=Object.freeze({ aftercareCaseId:'case-1',shelfEntryId:'entry-1',state:'resolved',terminalAtMs:15_000 }),
      store={ getCase:() => care,terminateCase:() => care,history:() => Object.freeze({ commits:[Object.freeze({
        aftercareCaseId:'case-1',inventoryCommitId:'inventory-1' })] }) },contextReader={ store,
        read:() => Object.freeze({ shelfEntryId:'entry-1' }) },ports=createAftercareCapabilityPorts({ schemaManifest,
        unitOfWork:value.unitOfWork,contextReader,workResultReader:{},computeBoundedMaterialFingerprintSync:() => null }),
      reassessedBase={ schemaRef:'helix://contracts/domain-types/ReassessedResult/v1',schemaVersion:1,
        objectId:'case-1:reassessed',revision:1,aftercareCaseId:'case-1',resultState:'resolved',
        reassessmentDigest:digest('reassessment') },reassessedResult=Object.freeze({ ...reassessedBase,digest:canonicalDigest(reassessedBase) }),
      execution={ eventId:'case-event-1',idempotencyKey:'case-key-1',effectOccurredAtMs:12_000,
        ownerScope:{ processId:'entry-1' },namedInputs:{ reassessedResult,domainFactCommitHandle:{ ownerDomain:'arca',
          aggregateType:'aftercare_case',aggregateId:'case-1',factType:'aftercare_case_result',
          payloadDigest:reassessedResult.digest,eventFenceDigest:canonicalDigest({ schema:'arca.aftercare-case-event@1',
            eventId:'case-event-1' }) } } };
    const first=ports[C.caseCommit].execute(execution);
    const replay=ports[C.caseCommit].execute(execution);
    assert.deepEqual(replay,first);
    assert.equal(replay.result.committedAtMs,15_000);
    assert.equal(replay.evidence.observedAtMs,12_000);
    assert.throws(() => ports[C.caseCommit].execute({ ...execution,namedInputs:{ ...execution.namedInputs,
      domainFactCommitHandle:{ ...execution.namedInputs.domainFactCommitHandle,payloadDigest:digest('stale') } } }),
    (error) => error.code==='ARCA_AFTERCARE_CASE_COMMIT_HANDLE_STALE');
  } finally { value.close(); }
});

test('active Aftercare Case closure fails closed when a reservation races after Reassessment', () => {
  const value=fixture();
  try {
    const care=Object.freeze({ aftercareCaseId:'case-1',shelfEntryId:'entry-1',state:'active',careBasis:value.frozen,
      careBasisDigest:value.frozen.digest,careRequirementDigest:digest('requirement') }),inventoryCommit=Object.freeze({
        aftercareCaseId:'case-1',inventoryCommitId:'inventory-1',newInventoryRevision:2 }),current=Object.freeze({ shelfEntryId:'entry-1',
        basis:Object.freeze({ ...value.frozen,inventoryRevision:2,digest:digest('post-inventory') }),raw:Object.freeze({
          shelf:Object.freeze({ status:'active' }),reservations:Object.freeze([Object.freeze({ state:'active' })]) }) }),
      store={ getCase:()=>care,history:()=>Object.freeze({ cases:Object.freeze([care]),commits:Object.freeze([inventoryCommit]) }),
        terminateCase:()=>{throw new Error('stale closure must not terminate the Case');} },contextReader={ store,read:()=>current },
      ports=createAftercareCapabilityPorts({ schemaManifest,unitOfWork:value.unitOfWork,contextReader,workResultReader:{},
        computeBoundedMaterialFingerprintSync:boundedFingerprint }),reassessedBase={ schemaRef:'helix://contracts/domain-types/ReassessedResult/v1',
        schemaVersion:1,objectId:'case-1:reassessed',revision:1,aftercareCaseId:'case-1',resultState:'resolved',
        reassessmentDigest:digest('reassessment') },reassessedResult=Object.freeze({ ...reassessedBase,digest:canonicalDigest(reassessedBase) }),
      execution={ eventId:'case-event-race',idempotencyKey:'case-key-race',ownerScope:{ processId:'entry-1' },namedInputs:{ reassessedResult,
        domainFactCommitHandle:{ ownerDomain:'arca',aggregateType:'aftercare_case',aggregateId:'case-1',factType:'aftercare_case_result',
          payloadDigest:reassessedResult.digest,eventFenceDigest:canonicalDigest({ schema:'arca.aftercare-case-event@1',eventId:'case-event-race' }) } } };
    assert.throws(()=>ports[C.caseCommit].execute(execution),(error)=>error.code==='ARCA_AFTERCARE_INVENTORY_BASIS_STALE');
  } finally { value.close(); }
});

test('an Arca Inventory commit cannot fabricate a missing Foundation atomic Result on replay', () => {
  const value=fixture();
  try {
    const care=Object.freeze({ aftercareCaseId:'case-1',shelfEntryId:'entry-1',state:'active',careBasis:value.frozen,
      careBasisDigest:value.frozen.digest,careRequirementDigest:digest('requirement') }),controlScope=digest('control'),
      prior=Object.freeze({ inventoryCommitId:'inventory-1',aftercareCaseId:'case-1',previousInventoryRevision:1,
        newInventoryRevision:2,controlChangeDigest:controlScope,commitDigest:digest('commit'),committedAtMs:14_000 }),
      receipt=Object.freeze({ receiptKind:'aftercare_output_materialized',retiredMaterials:Object.freeze([]),committedAtMs:13_000 }),
      current=Object.freeze({ shelfEntryId:'entry-1',basis:Object.freeze({ ...value.frozen,inventoryRevision:2,digest:digest('new-basis') }),
        raw:Object.freeze({ entry:Object.freeze({ current_inventory_revision:2 }),shelf:Object.freeze({ status:'active',
          target_mount_scope_revision:1 }),inventory:Object.freeze({ source_package_id:'package-1' }),materials:Object.freeze([]),
          oldBindings:Object.freeze([]),reservations:Object.freeze([]),related:Object.freeze([]),facts:Object.freeze([]),people:Object.freeze([]) }) }),
      store={ history:() => Object.freeze({ cases:Object.freeze([care]),commits:Object.freeze([prior]) }),
        getCase:() => care,issueSettlementApproval:() => { throw new Error('corrupt replay must not issue new approval'); },
        commitInventory:() => { throw new Error('durable Inventory must not be committed twice'); } },
      contextReader={ store,read:() => current,inventoryMaterials:() => Object.freeze([]) },
      workResultReader={ read:() => Object.freeze([{ outcomeKind:'succeeded',capabilityRef:C.artifactMaterialize,result:receipt }]),
        readBindings:() => Object.freeze([{ capabilityRef:C.settlement,inputBindings:Object.freeze({ bindings:Object.freeze([]) }) }]) },
      ports=createAftercareCapabilityPorts({ schemaManifest,unitOfWork:value.unitOfWork,contextReader,workResultReader,
        registry:{ resolve:() => ({ manifest:{ contractVersion:1 } }) },computeBoundedMaterialFingerprintSync:boundedFingerprint }),
      execution={ eventId:'inventory-event-1',workId:'commit-work-1',workAttemptId:'commit-attempt-1',idempotencyKey:'inventory-key-1',
        effectOccurredAtMs:14_000,ownerScope:{ processId:'entry-1' },namedInputs:{ verifiedCareInventoryChange:{ aftercareCaseId:'case-1' },
          responsibilityControlCommitHandle:{ controlScopeDigest:controlScope } } };
    assert.throws(()=>ports[C.inventoryCommit].execute(execution),
      (error)=>error.code==='ARCA_AFTERCARE_ATOMIC_RESULT_REQUIRED');
  } finally { value.close(); }
});

function settlementCapabilityFixture(value,locations,fingerprint=boundedFingerprint) {
  const targetRoot=path.join(value.root,'shelf'),oldRoot=path.join(targetRoot,'old');
  fs.mkdirSync(targetRoot,{ recursive:true });fs.mkdirSync(oldRoot,{ recursive:true });
  const frozen={ inventoryRevision:1,standardRevision:3,placementRevision:2,canonicalIdentityDigest:digest('identity'),
    sourcePackageId:'package-1',acceptedProductFactSetDigest:digest('facts'),decisionFactSetDigest:digest('decision') },
    care={ aftercareCaseId:'case-1',state:'active',careBasis:frozen,careBasisDigest:digest('care-basis') },
    current={ inventoryRevision:2,standardRevision:3,placementRevision:2,canonicalIdentityDigest:frozen.canonicalIdentityDigest,
      sourcePackageId:frozen.sourcePackageId,acceptedProductFactSetDigest:frozen.acceptedProductFactSetDigest,
      decisionFactSetDigest:frozen.decisionFactSetDigest },approval={ state:'active' },files=locations.map((name)=>{
      const location=path.join(oldRoot,name);fs.writeFileSync(location,Buffer.from('old-'+name));return { location,identity:physicalIdentity(location,'mount-1') };
    }),handles=files.map((item,index)=>{const base={ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
      handleId:'handle-'+index,identity:item.identity,ownerDomain:'arca',ownerScope:{ scopeType:'aftercare_case',scopeId:'case-1' },
      bindingRevision:1,endpointId:'endpoint-1',location:item.location,mountScopeRevision:1,expectedSizeBytes:item.identity.sizeBytes,
      expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:10_000,readScope:'exact_aftercare_settlement',expiresAtMs:Number.MAX_SAFE_INTEGER };
      return Object.freeze({...base,fenceDigest:canonicalDigest(base)});}),
    scope=settlementScopeDigest(handles),eventId='settlement-event-1',approvalId=aftercareSettlementApprovalId({ aftercareCaseId:'case-1',settlementScopeDigest:scope,careBasisDigest:care.careBasisDigest,
        settlementEventId:eventId });
  Object.assign(approval,{ approvalId,aftercareCaseId:'case-1',settlementScopeDigest:scope,serviceCatalogRevision:1,
    shelfStandardRevision:3,careBasisDigest:care.careBasisDigest,derivedAtMs:11_000 });
  const store={ history:() => ({ cases:[care],commits:[] }),getSettlementApproval:() => Object.freeze({ ...approval }),
    consumeSettlementApproval:({ approvalId:requested }) => { assert.equal(requested,approvalId);approval.state='consumed';return Object.freeze({ ...approval }); } },
    context={ shelfEntryId:'entry-1',basis:current,raw:{ shelf:{ status:'active',target_root_location:targetRoot,
      target_mount_scope_id:'mount-1',target_mount_scope_revision:1 },reservations:[],materials:[],oldBindings:[] } },contextReader={ store,read:() => context },
    ports=createAftercareCapabilityPorts({ schemaManifest,unitOfWork:value.unitOfWork,contextReader,workResultReader:{},
      registry:{ resolve:() => ({ manifest:{ contractVersion:1 } }) },
      computeBoundedMaterialFingerprintSync:fingerprint }),approvalHandle={ schemaRef:'helix://contracts/types/ApprovalHandle/v1',
      approvalId,eventId,exactEffectScopeDigest:scope,invalidatingFactDigests:[care.careBasisDigest] };
  return { ports,store,approval,files,handles,eventId,approvalHandle,context,care };
}

test('consumed Settlement Approval replays only its exact Event with deterministic evidence', async () => {
  const value=fixture();
  try {
    const x=settlementCapabilityFixture(value,['old-a.mkv']),execution={ eventId:x.eventId,idempotencyKey:'settlement-key',
      effectOccurredAtMs:12_000,ownerScope:{ processId:'entry-1' },namedInputs:{ supersededInventoryHandleList:x.handles,
        aftercareSettlementApproval:x.approvalHandle } },first=await x.ports[C.settlement].execute(execution);
    assert.equal(fs.existsSync(x.files[0].location),false);
    assert.equal(first.result.postDeleteReality.entries.every((entry)=>entry.value===null||['string','number','boolean'].includes(typeof entry.value)),true);
    assert.match(first.result.postDeleteReality.entries.find((entry)=>entry.key==='settlement_directory_set_digest').value,/^[a-f0-9]{64}$/);
    const replay=await x.ports[C.settlement].execute({ ...execution,recoveryDecision:'already_committed' });
    assert.deepEqual(replay,first);
    await assert.rejects(() => x.ports[C.settlement].execute(execution),/not durably current/);
  } finally { value.close(); }
});

test('Settlement revalidates Approval immediately before every physical deletion', async () => {
  const value=fixture();
  try {
    const x=settlementCapabilityFixture(value,['old-a.mkv','old-b.mkv']),original=x.store.getSettlementApproval;
    x.store.getSettlementApproval=() => {if(!fs.existsSync(x.files[0].location))x.approval.state='stale';return original();};
    await assert.rejects(() => x.ports[C.settlement].execute({ eventId:x.eventId,idempotencyKey:'settlement-key',
      effectOccurredAtMs:12_000,ownerScope:{ processId:'entry-1' },namedInputs:{ supersededInventoryHandleList:x.handles,
        aftercareSettlementApproval:x.approvalHandle } }),/authority is stale/);
    assert.equal(fs.existsSync(x.files[0].location),false);
    assert.equal(fs.existsSync(x.files[1].location),true);
  } finally { value.close(); }
});

test('Settlement revalidates the exact old identity immediately before unlink', async () => {
  const value=fixture();
  try {
    let reads=0;
    const x=settlementCapabilityFixture(value,['old-a.mkv'],(location)=>{
      reads+=1;
      if(reads===2)fs.writeFileSync(location,Buffer.from('replacement-bytes'));
      return boundedFingerprint(location);
    });
    await assert.rejects(() => x.ports[C.settlement].execute({ eventId:x.eventId,idempotencyKey:'settlement-key',
      effectOccurredAtMs:12_000,ownerScope:{ processId:'entry-1' },namedInputs:{ supersededInventoryHandleList:x.handles,
        aftercareSettlementApproval:x.approvalHandle } }),
    (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_IDENTITY_CHANGED');
    assert.equal(fs.readFileSync(x.files[0].location,'utf8'),'replacement-bytes');
    assert.equal(x.approval.state,'active');
  } finally { value.close(); }
});

test('Settlement rejects a foreign owner or a drifted Handle fence at the effect boundary', () => {
  const value=fixture();
  try {
    const x=settlementCapabilityFixture(value,['old-a.mkv']),handle=x.handles[0];
    assert.equal(assertAftercareSettlementHandle(x.context,x.care,handle),handle);
    assert.throws(()=>assertAftercareSettlementHandle(x.context,x.care,{...handle,ownerDomain:'libra'}),
      (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID');
    assert.throws(()=>assertAftercareSettlementHandle(x.context,x.care,{...handle,fenceDigest:digest('drifted')}),
      (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID');
  } finally { value.close(); }
});

test('known-old Settlement requires exactly one offload Binding when the same physical tuple is also a Product Binding', () => {
  const value=fixture();
  try {
    const x=settlementCapabilityFixture(value,['old-subtitle.ass']),file=x.files[0],base=x.handles[0],handleBase={...base,
      readScope:'exact_known_old_binding_settlement'},handle=Object.freeze({...handleBase,
        fenceDigest:canonicalDigest(Object.fromEntries(Object.entries(handleBase).filter(([key])=>key!=='fenceDigest')))}),
      binding={ material_key:file.identity.materialKey,location:file.location,endpoint_id:'endpoint-1',binding_revision:1,
        mount_scope_id:'mount-1' };
    x.context.raw.oldBindings=[{...binding,role:'offload:related_input'},{...binding,role:'product:subtitle'}];
    assert.equal(assertAftercareSettlementHandle(x.context,x.care,handle),handle);
    x.context.raw.oldBindings=[{...binding,role:'product:subtitle'}];
    assert.throws(()=>assertAftercareSettlementHandle(x.context,x.care,handle),
      (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID');
    x.context.raw.oldBindings=[{...binding,role:'offload:related_input'},{...binding,role:'offload:related_input'}];
    assert.throws(()=>assertAftercareSettlementHandle(x.context,x.care,handle),
      (error)=>error.code==='ARCA_AFTERCARE_SETTLEMENT_HANDLE_INVALID');
  } finally { value.close(); }
});

test('Settlement Evidence overflow fails closed before deleting any Material', async () => {
  const value=fixture();
  try {
    const x=settlementCapabilityFixture(value,Array.from({ length:85 },(_,index)=>'old-'+String(index).padStart(3,'0')+'.mkv'));
    await assert.rejects(() => x.ports[C.settlement].execute({ eventId:x.eventId,idempotencyKey:'settlement-key',
      effectOccurredAtMs:12_000,ownerScope:{ processId:'entry-1' },namedInputs:{ supersededInventoryHandleList:x.handles,
        aftercareSettlementApproval:x.approvalHandle } }),
    (error) => error.code==='ARCA_AFTERCARE_SETTLEMENT_EVIDENCE_BOUND'&&error.details.evidenceEntryCount===257);
    assert.equal(x.files.every((item)=>fs.existsSync(item.location)),true);
    assert.equal(x.approval.state,'active');
  } finally { value.close(); }
});
