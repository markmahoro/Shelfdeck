'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../src/helix/foundation/persistence/domain-commit-registry');
const domainFactTransaction = require('../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { controlScopeDigest, materialKey } = require('../../src/helix/foundation/persistence/material-control');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const factSchemaRef = 'helix://domains/libra/facts/SubjectCreated/v1';
const resultSchemaRef = 'helix://domains/libra/results/SubjectCreated/v1';

const subjects = createRepositoryDefinition({
  repositoryId: 'subjects', owner: 'libra', schemaManifest,
  statements: {
    find: { kind: 'select-one', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision'], keyColumns: ['routing_policy_id','revision'] },
    insert: { kind: 'insert', tableId: 'libra_routing_policy_revisions', columns: ['routing_policy_id','revision','field_id','mode','policy_schema_ref','policy_json','policy_digest','effective_at_ms'] }
  }
});

function registration(owner = 'libra') {
  return {
    ownerDomain: 'libra', aggregateType: 'subject', factType: 'subject.created', factSchemaRef,
    effectClass: 'domain_fact_commit', revisionFence: true,
    createParticipant({ handle, payload }) {
      return {
        participantId: 'libra_subject_fact', owner, boundBusinessOwner: owner, repositories: [subjects],
        execute(context) {
          const repository = context.repository('subjects');
          const existing = repository.invoke('find', { routing_policy_id:handle.aggregateId,revision:1 });
          if (handle.expectedRevision !== 0 || existing) {
            const error = new Error('Domain revision fence failed');
            error.code = 'TEST_DOMAIN_REVISION_CONFLICT';
            throw error;
          }
          if (payload.subjectId !== handle.aggregateId || payload.structureKind !== 'movie') throw new Error('typed payload mismatch');
          repository.invoke('insert', {
            routing_policy_id:payload.subjectId,revision:1,field_id:'fixture-field',mode:'direct',policy_schema_ref:'helix://fixtures/routing-policy/v1',
            policy_json:'{}',policy_digest:digest({subjectId:payload.subjectId}),effective_at_ms:context.commitTimeMs
          });
          return Object.freeze({ schemaRef: resultSchemaRef, schemaVersion: 1, subjectId: payload.subjectId, revision: 1 });
        }
      };
    }
  };
}

const workReads = createRepositoryDefinition({
  repositoryId: 'product_fact_work_reads', owner: 'execution-foundation', schemaManifest,
  statements: { find: { kind:'select-one', tableId:'fx_supporting_works',
    columns:['work_id','owner_domain','process_type','process_id','state'], keyColumns:['work_id'] } }
});

const undeclaredReads = createRepositoryDefinition({
  repositoryId:'undeclared_product_fact_reads', owner:'libra', schemaManifest,
  statements:{ find:{kind:'select-one',tableId:'libra_routing_policy_revisions',columns:['routing_policy_id','revision'],
    keyColumns:['routing_policy_id','revision']} }
});

function productFactRegistration(readRepository = workReads) {
  return { ownerDomain:'libra', aggregateType:'subject', factType:'media_cast',
    factSchemaRef:'helix://contracts/types/MediaCastFact/v1', effectClass:'domain_fact_commit', revisionFence:true,
    createParticipant({ handle, payload }) {
      let observedWork;
      const participant = { participantId:'libra_media_cast_fact', owner:'libra', boundBusinessOwner:'libra', repositories:[subjects],
        execute(context) {
          if (!observedWork || observedWork.work_id !== 'work-1' || observedWork.owner_domain !== 'libra')
            throw Object.assign(new Error('Product Fact read continuity failed'), { code:'TEST_PRODUCT_FACT_READ' });
          context.repository('subjects').invoke('insert',{routing_policy_id:payload.subjectId,revision:1,field_id:'fixture-field',mode:'direct',
            policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:digest(payload.subjectId),effective_at_ms:context.commitTimeMs});
          return Object.freeze({schemaRef:handle.resultSchemaRef,schemaVersion:1,subjectId:payload.subjectId,revision:1});
        } };
      participant.readParticipants=[{participantId:'product_fact_exact_reads',owner:'execution-foundation',boundBusinessOwner:'libra',
        repositories:[readRepository],execute(context){if(readRepository===workReads)
          observedWork=context.repository('product_fact_work_reads').invoke('find',{work_id:'work-1'});}}];
      return participant;
    } };
}

function postMarkerRegistration(failWrite = false) {
  return { ownerDomain:'libra',aggregateType:'subject',factType:'media_cast',
    factSchemaRef:'helix://contracts/types/MediaCastFact/v1',effectClass:'domain_fact_commit',revisionFence:true,
    createParticipant({handle,payload}) { const participant={participantId:'libra_media_cast_prepare',owner:'libra',boundBusinessOwner:'libra',
      repositories:[subjects],execute(){return Object.freeze({schemaRef:handle.resultSchemaRef,schemaVersion:1,subjectId:payload.subjectId,revision:1});}};
      participant.postMarkerParticipants=[{participantId:'libra_media_cast_owner_write',owner:'libra',boundBusinessOwner:'libra',repositories:[subjects],
        execute(context){if(failWrite)throw Object.assign(new Error('Owner write failed'),{code:'TEST_POST_MARKER_WRITE'});
          context.repository('subjects').invoke('insert',{routing_policy_id:payload.subjectId,revision:1,field_id:'fixture-field',mode:'direct',
            policy_schema_ref:'helix://fixtures/routing-policy/v1',policy_json:'{}',policy_digest:digest(payload.subjectId),effective_at_ms:context.commitTimeMs});}}];
      return participant;} };
}

function fixture(run, registrations = [registration()], contracts = [domainFactTransaction]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-domain-commit-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1700000000600;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const registry = createDomainCommitRegistry({ registrations });
  const coordinator = createDomainCommitCoordinator({
    schemaManifest, registry, transactionRegistry: createCanonicalTransactionRegistry({ contracts }),
    unitOfWork: createSqliteUnitOfWork({ kernel })
  });
  const setup = new Database(databasePath);
  setup.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('work-1', 'libra', 'subject', 'subject-1', 'test', digest('basis'), 'normal', 'running', 'work-key', 1, 1);
  setup.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)')
    .run('attempt-1', 'work-1', 1, digest('basis'), 'running', 1);
  setup.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('plan-1', 'attempt-1', 'test-planner@1', 1, digest('catalog'), digest('basis'), digest('graph'), 'planned', 1);
  setup.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('event-1', 'plan-1', 'node-1', 'work-1', 'attempt-1', 'libra', 'libra.test.commit@1', 1, 'executing', 'normal', 1);
  setup.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('event-2', 'plan-1', 'node-2', 'work-1', 'attempt-1', 'libra', 'libra.test.commit@1', 1, 'executing', 'normal', 1);
  setup.close();
  try {
    return run({ coordinator, databasePath, kernel, registry });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function payload(subjectId = 'subject-1') {
  return { subjectId, structureKind: 'movie' };
}

function domainHandle(value = payload(), overrides = {}) {
  return {
    schemaRef: 'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion: 1,
    handleId: overrides.handleId || 'handle-1', ownerDomain: overrides.ownerDomain || 'libra',
    aggregateType: overrides.aggregateType || 'subject', aggregateId: overrides.aggregateId || value.subjectId,
    factType: overrides.factType || 'subject.created', factSchemaRef: overrides.factSchemaRef || factSchemaRef,
    resultSchemaRef: overrides.resultSchemaRef || resultSchemaRef,
    expectedRevision: overrides.expectedRevision === undefined ? 0 : overrides.expectedRevision,
    payloadDigest: overrides.payloadDigest || digest(JSON.stringify({ structureKind: value.structureKind, subjectId: value.subjectId })),
    commitIdempotencyKey: overrides.commitIdempotencyKey || 'domain-key-1', eventFenceDigest: digest('event-fence')
  };
}

function outbox(subjectId = 'subject-1') {
  return [{
    messageId: 'message-' + subjectId,
    producerDomain: 'libra', messageKind: 'subject.created', aggregateType: 'subject', aggregateId: subjectId,
    aggregateRevision: 1, dedupKey: subjectId + '/created', intendedConsumers: ['perception'],
    payloadSchemaRef: 'helix://contracts/types/SubjectCreatedSignal/v1',
    payload: { subjectId, subjectRevision: 1, factDigest: digest('fact-' + subjectId) }
  }];
}

function request(value = payload(), overrides = {}) {
  return {
    transactionId: 'helix.transaction.domain-fact-commit',
    handle: overrides.handle || domainHandle(value), payload: value,
    commitMarker: {
      commitMarker: overrides.commitMarker || 'marker-' + value.subjectId,
      effectId: null,
      commitDigest: overrides.commitDigest || digest('commit-' + value.subjectId)
    },
    resultBinding: overrides.resultBinding || {
      resultId: 'result-' + value.subjectId, eventId: value.subjectId === 'subject-1' ? 'event-1' : 'event-2',
      evidenceSchemaRef: 'helix://contracts/types/TestEvidence/v1',
      evidence: { schemaRef: 'helix://contracts/types/TestEvidence/v1', schemaVersion: 1, evidenceId: 'evidence-' + value.subjectId }
    },
    outboxMessages: overrides.outboxMessages || outbox(value.subjectId),
    control: overrides.control
  };
}

function physicalIdentity(name) {
  const identity = {
    schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion: 2,
    mountScopeId: 'mount-1', inode: BigInt('0x' + digest('inode-' + name).slice(0, 15)).toString(), sizeBytes:100,
    fingerprintAlgorithm: 'middle-256k-sha256', fingerprintVersion:1, contentFingerprint: digest('content-' + name)
  };
  identity.materialKey = materialKey(identity);
  return identity;
}

function controlRequest(change) {
  return {
    changes: [change],
    handle: {
      schemaRef: 'helix://contracts/types/ResponsibilityControlCommitHandle/v1', schemaVersion: 1,
      handleId: 'control-handle', operationKind: 'acquire', ownerDomain: 'libra', processType: 'subject', processId: 'subject-1',
      basisRef: { objectType: 'subject', objectId: 'subject-1', revision: 1, digest: digest('basis-ref') },
      basisDigest: digest('basis'), canonicalFactSetDigest: digest('facts'), bindingSetDigest: digest('bindings'),
      controlScopeDigest: controlScopeDigest([change]),
      expectedControlRevisions: [{ materialKey: change.identity.materialKey, revision: change.expectedRevision }],
      receiptContract: {
        receiptSchemaRef: 'helix://contracts/types/TestControlReceipt/v1',
        controlRevisionSetSchemaRef: 'test.control-revision-set@1'
      }, eventFenceDigest: digest('control-fence')
    }
  };
}

test('builds a deterministic exact typed registration manifest', () => {
  const first = createDomainCommitRegistry({ registrations: [registration()] });
  const second = createDomainCommitRegistry({ registrations: [registration()] });
  assert.equal(first.manifest.entryCount, 1);
  assert.equal(first.manifest.registryDigest, second.manifest.registryDigest);
  assert.deepEqual(first.manifest.entries[0], {
    ownerDomain: 'libra', aggregateType: 'subject', factType: 'subject.created', factSchemaRef,
    effectClass: 'domain_fact_commit', revisionFence: true
  });
  assert.throws(() => createDomainCommitRegistry({ registrations: [registration(), registration()] }),
    (error) => error.code === 'P3_DOMAIN_COMMIT_DUPLICATE_REGISTRATION');
  assert.throws(() => createDomainCommitRegistry({ registrations: [{ ...registration(), effectClass: 'generic_write' }] }),
    (error) => error.code === 'P3_DOMAIN_COMMIT_EFFECT_CLASS_REQUIRED');
  assert.throws(() => createDomainCommitRegistry({ registrations: [{ ...registration(), revisionFence: false }] }),
    (error) => error.code === 'P3_DOMAIN_COMMIT_REVISION_FENCE_REQUIRED');
  assert.throws(() => createCanonicalTransactionRegistry({ contracts: [domainFactTransaction.contract] }),
    (error) => error.code === 'P3_DOMAIN_COMMIT_INVALID_TRANSACTION_CONTRACT');
  assert.throws(() => createCanonicalTransactionRegistry({ contracts: [{ ...domainFactTransaction,
    contract: { ...domainFactTransaction.contract, fenceContract:{ ...domainFactTransaction.contract.fenceContract, outboxRequired:false } } }] }),
  (error) => error.code === 'P3_DOMAIN_COMMIT_INVALID_TRANSACTION_CONTRACT');
});

test('selects exact Product Fact transaction variants and rejects partial namespace matches', () => {
  const transactions = createCanonicalTransactionRegistry({ contracts: [domainFactTransaction] });
  const generic = transactions.resolveVariant('helix.transaction.domain-fact-commit', domainHandle());
  assert.equal(generic.fenceContract.outboxRequired, true);
  const mediaCast = transactions.resolveVariant('helix.transaction.domain-fact-commit', domainHandle(payload(), {
    factType: 'media_cast', factSchemaRef: 'helix://contracts/types/MediaCastFact/v1',
    resultSchemaRef: 'helix://contracts/types/MediaCastFact/v1'
  }));
  assert.equal(mediaCast.variantId, 'libra_media_cast_fact@1');
  assert.equal(mediaCast.fenceContract.outboxRequired, false);
  assert.equal(mediaCast.writeTables.includes('fx_outbox'), false);
  assert.throws(() => transactions.resolveVariant('helix.transaction.domain-fact-commit', domainHandle(payload(), {
    factType: 'media_cast', factSchemaRef: 'helix://contracts/types/ProductMetadataFact/v1',
    resultSchemaRef: 'helix://contracts/types/MediaCastFact/v1'
  })), (error) => error.code === 'P3_TRANSACTION_VARIANT_SELECTOR_MISMATCH');
});

test('atomically coordinates typed Domain fact, Commit Marker, Outbox, and stable replay', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    const first = coordinator.execute(request());
    assert.equal(first.replayed, false);
    assert.deepEqual(first.domainResult, { schemaRef: resultSchemaRef, schemaVersion: 1, subjectId: 'subject-1', revision: 1 });
    assert.deepEqual(first.typedResult, first.domainResult);
    assert.equal(first.outboxResult.length, 1);
    const replay = coordinator.execute(request());
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.typedResult, first.typedResult);
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_outbox_deliveries').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count, 1);
    const marker = database.prepare('SELECT result_id,result_schema_ref,result_digest FROM fx_commit_markers').get();
    assert.equal(marker.result_id, 'result-subject-1');
    assert.equal(marker.result_schema_ref, resultSchemaRef);
    assert.equal(marker.result_digest, first.resultBinding.resultDigest);
    database.close();
  });
});

test('runs bounded typed read participants inside the exact Product Fact transaction', () => {
  fixture(({ coordinator, databasePath }) => {
    const value=payload(), handle=domainHandle(value,{factType:'media_cast',
      factSchemaRef:'helix://contracts/types/MediaCastFact/v1',resultSchemaRef:'helix://contracts/types/MediaCastFact/v1'});
    const committed=coordinator.execute({...request(value,{handle,outboxMessages:[]}),supportingWorkId:'work-1'});
    assert.equal(committed.replayed,false);
    const database=new Database(databasePath,{readonly:true});
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count,1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,0);
    database.close();
  },[productFactRegistration()]);
  fixture(({coordinator})=>{const value=payload(),handle=domainHandle(value,{factType:'media_cast',
    factSchemaRef:'helix://contracts/types/MediaCastFact/v1',resultSchemaRef:'helix://contracts/types/MediaCastFact/v1'});
    assert.throws(()=>coordinator.execute({...request(value,{handle,outboxMessages:[]}),supportingWorkId:'work-1'}),
      (error)=>error.code==='P3_DOMAIN_COMMIT_READ_PARTICIPANT_UNDECLARED');},[productFactRegistration(undeclaredReads)]);
  const registry=createDomainCommitRegistry({registrations:[productFactRegistration(subjects)]});
  const value=payload(),handle=domainHandle(value,{factType:'media_cast',factSchemaRef:'helix://contracts/types/MediaCastFact/v1',
    resultSchemaRef:'helix://contracts/types/MediaCastFact/v1'});
  assert.throws(()=>registry.resolve(handle,value),(error)=>error.code==='P3_DOMAIN_COMMIT_READ_PARTICIPANT_INVALID');
});

test('runs declared Owner writes after Result and Marker and rolls the whole transaction back on failure',()=>{
  const mediaVariant=domainFactTransaction.contract.variants.find((item)=>item.variantId==='libra_media_cast_fact@1');
  const declaredVariant={...mediaVariant,writeTables:[...mediaVariant.writeTables,'libra_routing_policy_revisions'],
    participants:mediaVariant.participants.map((participant)=>participant.owner==='libra'
      ? {...participant,tables:[...participant.tables,'libra_routing_policy_revisions']}:participant)};
  const transaction={...domainFactTransaction,contract:{...domainFactTransaction.contract,
    variants:domainFactTransaction.contract.variants.map((item)=>item.variantId===declaredVariant.variantId?declaredVariant:item)}};
  const execute=(coordinator)=>{const value=payload(),handle=domainHandle(value,{factType:'media_cast',
    factSchemaRef:'helix://contracts/types/MediaCastFact/v1',resultSchemaRef:'helix://contracts/types/MediaCastFact/v1'});
    return coordinator.execute({...request(value,{handle,outboxMessages:[]}),supportingWorkId:'work-1'});};
  fixture(({coordinator,databasePath})=>{assert.equal(execute(coordinator).replayed,false);const database=new Database(databasePath,{readonly:true});
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count,1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count,1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,1);database.close();},[postMarkerRegistration()],[transaction]);
  fixture(({coordinator,databasePath})=>{assert.throws(()=>execute(coordinator),(error)=>error.code==='TEST_POST_MARKER_WRITE');
    const database=new Database(databasePath,{readonly:true});
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count,0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_result_bindings').get().count,0);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,0);database.close();},[postMarkerRegistration(true)],[transaction]);
});

test('rejects unregistered Owner/fact schema, payload drift, and wrong-Owner participant factory', () => {
  fixture(({ registry }) => {
    const value = payload();
    assert.throws(() => registry.resolve(domainHandle(value, { factSchemaRef: 'helix://domains/libra/facts/Unknown/v1' }), value),
      (error) => error.code === 'P3_DOMAIN_COMMIT_UNREGISTERED_FACT');
    assert.throws(() => registry.resolve(domainHandle(value, { payloadDigest: digest('wrong') }), value),
      (error) => error.code === 'P3_DOMAIN_COMMIT_PAYLOAD_DIGEST_MISMATCH');
  });
  fixture(({ registry }) => {
    assert.throws(() => registry.resolve(domainHandle(payload()), payload()),
      (error) => error.code === 'P3_DOMAIN_COMMIT_PARTICIPANT_OWNER_MISMATCH');
  }, [registration('arca')]);
});

test('Domain revision fence failure leaves no marker or Outbox', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    const value = payload();
    assert.throws(() => coordinator.execute(request(value, { handle: domainHandle(value, { expectedRevision: 1 }) })),
      (error) => error.code === 'TEST_DOMAIN_REVISION_CONFLICT');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    for (const table of ['libra_routing_policy_revisions', 'fx_commit_markers', 'fx_outbox', 'fx_outbox_deliveries']) {
      assert.equal(database.prepare('SELECT COUNT(*) count FROM ' + table).get().count, 0, table);
    }
    database.close();
  });
});

test('rejects a participant Result with the wrong nominal schema and leaves no durable residue', () => {
  const wrong = registration();
  const original = wrong.createParticipant;
  wrong.createParticipant = (input) => {
    const participant = original(input);
    return { ...participant, execute(context) { return { ...participant.execute(context), schemaRef: 'helix://wrong/result/v1' }; } };
  };
  fixture(({ coordinator, databasePath, kernel }) => {
    assert.throws(() => coordinator.execute(request()), (error) => error.code === 'P3_DOMAIN_COMMIT_RESULT_SCHEMA_MISMATCH');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    for (const table of ['libra_routing_policy_revisions', 'fx_event_result_bindings', 'fx_commit_markers', 'fx_outbox']) {
      assert.equal(database.prepare('SELECT COUNT(*) count FROM ' + table).get().count, 0, table);
    }
    database.close();
  }, [wrong]);
});

test('fails closed when a stored replay Result no longer matches its marker and JCS digest', () => {
  fixture(({ coordinator, databasePath }) => {
    coordinator.execute(request());
    const changed = new Database(databasePath);
    changed.prepare('UPDATE fx_event_result_bindings SET result_json=? WHERE result_id=?')
      .run(JSON.stringify({ schemaRef: resultSchemaRef, schemaVersion: 1, subjectId: 'tampered', revision: 1 }), 'result-subject-1');
    changed.close();
    assert.throws(() => coordinator.execute(request()), (error) => error.code === 'P3_DOMAIN_COMMIT_RESULT_BINDING_CORRUPT');
  });
});

test('same marker cannot replay a different signed aggregate commit', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    coordinator.execute(request());
    const secondValue = payload('subject-2');
    assert.throws(() => coordinator.execute(request(secondValue, {
      handle: domainHandle(secondValue, { handleId: 'handle-2', commitIdempotencyKey: 'key-2' }),
      commitMarker: 'marker-subject-1', commitDigest: digest('commit-subject-1'),
      outboxMessages: outbox('subject-2')
    })), (error) => error.code === 'P3_DOMAIN_COMMIT_MARKER_CONFLICT');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count, 1);
    database.close();
  });
});

test('coordinates optional Material Control and rolls back every participant on Control CAS failure', () => {
  fixture(({ coordinator, databasePath, kernel }) => {
    const identity = physicalIdentity('inode-domain-commit');
    const validChange = {
      action: 'acquire', identity, expectedRevision: 0, fromScope: null,
      toScope: { ownerDomain: 'libra', scopeType: 'subject', scopeId: 'subject-1' }
    };
    const success = coordinator.execute(request(payload(), { control: controlRequest(validChange) }));
    assert.equal(success.controlResult[0].revision, 1);
    const secondValue = payload('subject-2');
    const staleChange = {
      action: 'acquire', identity: physicalIdentity('inode-stale'), expectedRevision: 1, fromScope: null,
      toScope: { ownerDomain: 'libra', scopeType: 'subject', scopeId: 'subject-2' }
    };
    assert.throws(() => coordinator.execute(request(secondValue, {
      handle: domainHandle(secondValue, { handleId: 'handle-2', commitIdempotencyKey: 'key-2' }),
      commitMarker: 'marker-subject-2', commitDigest: digest('commit-subject-2'),
      outboxMessages: outbox('subject-2'), control: controlRequest(staleChange)
    })), (error) => error.code === 'P3_CONTROL_CAS_CONFLICT');
    kernel.close();
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_routing_policy_revisions').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count, 1);
    database.close();
  });
});
