'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createAftercareStore } = require('../../src/helix/domains/arca/persistence/aftercare-store');
const { createAftercareCapabilityPorts } = require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const { settlementScopeDigest, buildAftercareSettlementHandles, aftercareSettlementEventId,
  aftercareServiceCatalogRevision, aftercareSettlementApprovalId,
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
  seed.close();
  const unitOfWork=createSqliteUnitOfWork({ kernel }),store = createAftercareStore({ schemaManifest, unitOfWork, now:() => at });
  return { root, databasePath, kernel, unitOfWork, store, frozen, setTime(value) { at = value; }, close() {
    kernel.close(); fs.rmSync(root, { recursive:true, force:true });
  } };
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

test('Settlement scope changes when identity or final mapping changes', () => {
  const base = { endpointId:'endpoint-1', location:'F:/shelf/old.mkv',
    bindingRevision:1, mountScopeRevision:1, readScope:'exact_aftercare_settlement',
    identity:Object.freeze({ materialKey:digest('old'), sizeBytes:12 }), finalLocation:'F:/shelf/movie.mkv',
    finalMaterialKey:digest('final') };
  assert.notEqual(settlementScopeDigest([base]), settlementScopeDigest([{ ...base, identity:{ ...base.identity,
    materialKey:digest('changed') } }]));
  assert.notEqual(settlementScopeDigest([base]), settlementScopeDigest([{ ...base,
    finalMaterialKey:digest('another-final') }]));
  assert.notEqual(settlementScopeDigest([base]), settlementScopeDigest([{ ...base,
    bindingRevision:2 }]));
  assert.notEqual(settlementScopeDigest([base]), settlementScopeDigest([{ ...base,
    mountScopeRevision:2 }]));
});

test('Planner and Inventory commit share one Settlement Event identity and current Catalog revision source', () => {
  const workAttemptId='work-attempt-7',expected='care-settlement-'+canonicalDigest(workAttemptId).slice(0,18),
    planner=fs.readFileSync(path.join(__dirname,'../../src/helix/domains/arca/planning/aftercare-planners.js'),'utf8');
  assert.equal(aftercareSettlementEventId(workAttemptId),expected);
  assert.match(planner,/const settlement=aftercareSettlementEventId\(request\.workAttemptId\)/);
  assert.equal(aftercareServiceCatalogRevision({ resolve:() => ({ manifest:{ contractVersion:7 } }) }),7);
  assert.throws(() => aftercareServiceCatalogRevision(null),/current Service Catalog revision/);
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

test('Inventory commit recovery reuses the durable revision and issues its missing Settlement Approval', () => {
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
      approvals=[],store={ history:() => Object.freeze({ cases:Object.freeze([care]),commits:Object.freeze([prior]) }),
        getCase:() => care,issueSettlementApproval:(request) => { approvals.push(request);return Object.freeze({ ...request,state:'active' }); },
        commitInventory:() => { throw new Error('durable Inventory must not be committed twice'); } },
      contextReader={ store,read:() => current,inventoryMaterials:() => Object.freeze([]) },
      workResultReader={ read:() => Object.freeze([{ outcomeKind:'succeeded',capabilityRef:C.artifactMaterialize,result:receipt }]),
        readBindings:() => Object.freeze([{ capabilityRef:C.settlement,inputBindings:Object.freeze({ bindings:Object.freeze([]) }) }]) },
      ports=createAftercareCapabilityPorts({ schemaManifest,unitOfWork:value.unitOfWork,contextReader,workResultReader,
        registry:{ resolve:() => ({ manifest:{ contractVersion:1 } }) },computeBoundedMaterialFingerprintSync:boundedFingerprint }),
      execution={ eventId:'inventory-event-1',workId:'commit-work-1',workAttemptId:'commit-attempt-1',idempotencyKey:'inventory-key-1',
        effectOccurredAtMs:14_000,ownerScope:{ processId:'entry-1' },namedInputs:{ verifiedCareInventoryChange:{ aftercareCaseId:'case-1' },
          responsibilityControlCommitHandle:{ controlScopeDigest:controlScope } } },outcome=ports[C.inventoryCommit].execute(execution);
    assert.equal(approvals.length,1);
    assert.equal(approvals[0].settlementEventId,aftercareSettlementEventId(execution.workAttemptId));
    assert.equal(outcome.result.receiptId,prior.inventoryCommitId);
    assert.equal(outcome.result.committedAtMs,prior.committedAtMs);
    assert.equal(outcome.evidence.observedAtMs,prior.committedAtMs);
    assert.throws(() => ports[C.inventoryCommit].execute({ ...execution,namedInputs:{ ...execution.namedInputs,
      responsibilityControlCommitHandle:{ controlScopeDigest:digest('another-control') } } }),
    (error) => error.code==='ARCA_AFTERCARE_INVENTORY_REPLAY_CONFLICT');
  } finally { value.close(); }
});

function settlementCapabilityFixture(value,locations) {
  const targetRoot=path.join(value.root,'shelf'),oldRoot=path.join(value.root,'old');
  fs.mkdirSync(targetRoot,{ recursive:true });fs.mkdirSync(oldRoot,{ recursive:true });
  const frozen={ inventoryRevision:1,standardRevision:3,placementRevision:2,canonicalIdentityDigest:digest('identity'),
    sourcePackageId:'package-1',acceptedProductFactSetDigest:digest('facts'),decisionFactSetDigest:digest('decision') },
    care={ aftercareCaseId:'case-1',state:'active',careBasis:frozen,careBasisDigest:digest('care-basis') },
    current={ inventoryRevision:2,standardRevision:3,placementRevision:2,canonicalIdentityDigest:frozen.canonicalIdentityDigest,
      sourcePackageId:frozen.sourcePackageId,acceptedProductFactSetDigest:frozen.acceptedProductFactSetDigest,
      decisionFactSetDigest:frozen.decisionFactSetDigest },approval={ state:'active' },files=locations.map((name)=>{
      const location=path.join(oldRoot,name);fs.writeFileSync(location,Buffer.from('old-'+name));return { location,identity:physicalIdentity(location,'mount-1') };
    }),handles=files.map((item,index)=>Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
      handleId:'handle-'+index,identity:item.identity,ownerDomain:'arca',ownerScope:{ scopeType:'aftercare_case',scopeId:'case-1' },
      bindingRevision:1,endpointId:'endpoint-1',location:item.location,mountScopeRevision:1,expectedSizeBytes:item.identity.sizeBytes,
      expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:10_000,readScope:'exact_aftercare_settlement',expiresAtMs:Number.MAX_SAFE_INTEGER })),
    scope=settlementScopeDigest(handles),eventId='settlement-event-1',approvalId=aftercareSettlementApprovalId({ aftercareCaseId:'case-1',settlementScopeDigest:scope,careBasisDigest:care.careBasisDigest,
        settlementEventId:eventId });
  Object.assign(approval,{ approvalId,aftercareCaseId:'case-1',settlementScopeDigest:scope,serviceCatalogRevision:1,
    shelfStandardRevision:3,careBasisDigest:care.careBasisDigest,derivedAtMs:11_000 });
  const store={ history:() => ({ cases:[care],commits:[] }),getSettlementApproval:() => Object.freeze({ ...approval }),
    consumeSettlementApproval:({ approvalId:requested }) => { assert.equal(requested,approvalId);approval.state='consumed';return Object.freeze({ ...approval }); } },
    context={ shelfEntryId:'entry-1',basis:current,raw:{ shelf:{ status:'active',target_root_location:targetRoot,
      target_mount_scope_id:'mount-1' },reservations:[],materials:[],oldBindings:[] } },contextReader={ store,read:() => context },
    ports=createAftercareCapabilityPorts({ schemaManifest,unitOfWork:value.unitOfWork,contextReader,workResultReader:{},
      registry:{ resolve:() => ({ manifest:{ contractVersion:1 } }) },
      computeBoundedMaterialFingerprintSync:boundedFingerprint }),approvalHandle={ schemaRef:'helix://contracts/types/ApprovalHandle/v1',
      approvalId,eventId,exactEffectScopeDigest:scope,invalidatingFactDigests:[care.careBasisDigest] };
  return { ports,store,approval,files,handles,eventId,approvalHandle };
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
