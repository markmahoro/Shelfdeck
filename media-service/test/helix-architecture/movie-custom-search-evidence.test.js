'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest: digest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const external = require('../../src/helix/domains/libra/model/external-material-contracts');
const { buildMediaRequirement } = require('../../src/helix/domains/libra/model/media-production-contracts');
const { externalSearchSelectionWork } = require('../../src/helix/domains/libra/planning/external-material-work');
const { createExternalMaterialPlanner } = require('../../src/helix/domains/libra/planning/external-material-planner');
const { createAcquisitionCandidateEvidenceStore } = require('../../src/helix/domains/libra/persistence/acquisition-candidate-evidence-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkResultReader } = require('../../src/helix/foundation/execution/work-result-reader');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { fixture: specFixture } = require('./fixtures/custom-acceptance-spec-harness');
const { readMovieCustomSearchEvidence } = require('../../src/helix/domains/libra/planning/movie-custom-search-evidence');

const now = 1_700_000_000_000;
const h = value => digest({ value });
const schema = capability => 'helix://contracts/capabilities/' + capability.replace('@1', '/v1') + '/result';
const QUERY = 'libra.external_material.query.prepare@1';
const SEARCH = 'libra.external_material.search@1';
const SELECT = 'libra.external_material.candidate.select@1';
const IDENTITY = 'libra.product_identity.evidence.observe@1';
const anchor = { provider:'tmdb', namespace:'tmdb_movie', providerKey:'550', seasonNumber:null, identityAnchorDigest:h('anchor') };

function candidate(rank, available = true) {
  const objectId = 'candidate-' + rank;
  const providerCandidateRef = { objectType:'acquisition_candidate', objectId, revision:1, digest:h(objectId) };
  const mediaBasis = {
    resolution:{status:'known', value:'4k', sourceField:'title'},
    videoCodec:{status:'known', value:'hevc', sourceField:'title'},
    primaryAudioClasses:{status:'known', value:['truehd'], sourceField:'title'},
    sizeBytes:{status:'known', value:42, sourceField:'size'},
    source:{provider:'moviepilot', providerCandidateDigest:h('row-' + rank), claimBasis:'structured_and_release_fields'},
  };
  const availabilityBasis = {status:'known', seederCount:4};
  const body = {
    candidateId:digest({schema:'provider-acquisition-candidate-id@1', integrationId:'integration-1', configRevision:3, providerCandidateRef}),
    integrationId:'integration-1', configRevision:3, providerCandidateRef, providerRank:rank,
    identityAnchors:available ? [anchor] : [], structureKind:'single', episodeKeys:[],
    availability:available ? 'available' : 'unavailable',
    availabilityEvidence:{...availabilityBasis, evidenceDigest:digest(availabilityBasis)},
    advertisedMedia:{...mediaBasis, evidenceDigest:digest(mediaBasis)},
    requirementAssessment:'compliant', assessmentReasonCodes:[],
  };
  return {...body, candidateDigest:digest(body)};
}

function setup(count = 1, available = true) {
  const spec = specFixture('movie', 'run-1').baseSpec;
  const snapshot = {run:{libraRunId:'run-1', subjectId:spec.subjectId, acceptanceSpecId:spec.acceptanceSpecId,
    executionBasisDigest:h('run'), priorityClass:'normal'}, spec, members:[], episodeClaims:[]};
  const identity = {subjectId:spec.subjectId, contentProfile:'movie', title:'Fight Club', identityDigest:h('identity'), providerIdentities:[anchor]};
  const observed = {libraRunId:'run-1', result:'resolved', sourceKind:'provider_exact', verifiedIdentity:anchor};
  const identityObservation = {...observed, observationDigest:digest(observed)};
  const identityRow = {workId:'identity-work', eventId:'identity-event', capabilityRef:IDENTITY, state:'succeeded', outcomeKind:'succeeded',
    resultId:'identity-result', resultSchemaRef:schema(IDENTITY), result:identityObservation, resultDigest:digest(identityObservation)};
  const owner = {readRunSnapshot:() => snapshot, readFact:() => ({factKind:'resolved_identity', factRevision:1,
    factDigest:identity.identityDigest, factValue:identity})};
  const records = [];
  const reader = {
    listWorks:() => [{work_id:'identity-work', owner_domain:'libra', process_type:'libra_run', process_id:'run-1', work_kind:'product_identity'}],
    read:id => id === 'identity-work' ? [identityRow] : records,
  };
  const handle = {integrationId:'integration-1', configRevision:3, integrationType:'moviepilot', allowedOperation:SEARCH};
  const planner = createExternalMaterialPlanner({
    registry:{snapshot:[], resolve:ref => ({manifest:{effectClass:'pure_observation', parametersSchemaRef:schema(ref).replace('/result','/parameters'),
      resultSchemaRef:schema(ref), resourceDemandSchemaRef:'resources', fenceSchemaRef:'fence'}})},
    policyRegistry:{digest:h('policy'), bindingFor:() => ({retryPolicyRef:'retry', timeoutPolicyRef:'timeout'})},
    movieProductionReader:owner, workResultReader:reader,
    resolveExternalMaterialIntegrationHandle:() => handle,
  });
  const work = externalSearchSelectionWork(snapshot), attemptId = 'work-attempt';
  const plan = planner.plan({workId:work.workId, executionBasisDigest:work.executionBasisDigest, processId:'run-1', workAttemptId:attemptId});
  const node = ref => plan.nodes.find(item => item.capabilityRef === ref);
  const literal = (item, name) => item.inputBindings.bindings.find(binding => binding.portName === name).value;
  const queryNode = node(QUERY);
  const query = external.buildAcquisitionQuery({resolvedProductIdentity:literal(queryNode,'resolvedProductIdentity'),
    productIdentityEvidenceObservation:literal(queryNode,'productIdentityEvidenceObservation'), productStructure:literal(queryNode,'productStructure'),
    mediaRequirement:literal(queryNode,'mediaRequirement'), acquisitionPolicy:literal(queryNode,'acquisitionPolicy'),
    executionContext:{libraRunId:'run-1', runExecutionBasisDigest:snapshot.run.executionBasisDigest}, producedAtMs:now});
  const items = Array.from({length:count}, (_, i) => candidate(i, available));
  const evidence = {schemaRef:'helix://contracts/types/AcquisitionCandidates/v1', schemaVersion:1, evidenceId:'evidence-1',
    evidenceKind:'external_acquisition_candidates', producerRef:'transport-1', basisDigest:h('request'), payloadDigest:h('response'), observedAtMs:now,
    queryDigest:query.queryDigest, integrationId:handle.integrationId, configRevision:handle.configRevision, candidates:items};
  evidence.candidateSetDigest = digest({schema:'libra.external-acquisition-candidate-set@1', queryDigest:query.queryDigest,
    integrationId:handle.integrationId, configRevision:handle.configRevision, items});
  const scope = {libraRunId:'run-1', runExecutionBasisDigest:snapshot.run.executionBasisDigest, searchWorkId:work.workId,
    searchEventId:node(SEARCH).eventId, searchEventAttemptId:'search-event-attempt'};
  const record = {schemaRef:'helix://contracts/types/AcquisitionCandidatesRecord/v1', schemaVersion:1,
    evidenceId:evidence.evidenceId, evidenceKind:'external_acquisition_candidates_record', producerRef:evidence.producerRef,
    basisDigest:evidence.basisDigest, payloadDigest:digest(evidence), observedAtMs:evidence.observedAtMs,
    recordId:digest({schema:'libra.acquisition-candidate-evidence@1', libraRunId:scope.libraRunId, searchEventAttemptId:scope.searchEventAttemptId}),
    ...scope, queryDigest:query.queryDigest, integrationId:handle.integrationId, configRevision:handle.configRevision,
    candidateCount:items.length, candidateSetDigest:evidence.candidateSetDigest};
  const selection = external.selectCandidate({candidates:evidence, selectionCriteria:literal(node(SELECT),'selectionCriteria'), producedAtMs:now});
  for (const [capabilityRef, result] of [[QUERY,query],[SEARCH,record],[SELECT,selection]]) {
    const entry = node(capabilityRef);
    records.push({workId:work.workId, eventId:entry.eventId, attemptId, planId:plan.planId, nodeId:entry.nodeId,
      capabilityRef, state:'succeeded', outcomeKind:'succeeded', planRevision:1, planDigest:h('plan'),
      resultId:capabilityRef + '-result', resultSchemaRef:schema(capabilityRef), result:structuredClone(result), resultDigest:digest(result),
      inputBindings:structuredClone(entry.inputBindings), inputBindingDigest:digest(entry.inputBindings),
      eventAttemptId:capabilityRef === SEARCH ? scope.searchEventAttemptId : capabilityRef + '-attempt'});
  }
  const status = {work_id:work.workId, owner_domain:'libra', process_type:'libra_run', process_id:'run-1',
    work_kind:'workspace_media_production', basis_digest:work.executionBasisDigest, state:'succeeded',
    latestAttempt:{attempt_id:attemptId, state:'succeeded'}};
  reader.status = () => status;
  reader.readDefinition = () => ({workId:work.workId, definition:work, definitionDigest:digest(work)});
  const store = {read:(value, runId) => {assert.equal(runId, 'run-1'); assert.equal(canonicalJson(value), canonicalJson(record)); return evidence;}};
  return {snapshot, identity, identityRow, identityObservation, owner, reader, records, status, store, work, scope, record, evidence, query, handle};
}
function read(f) {
  return readMovieCustomSearchEvidence({libraRunId:'run-1', movieProductionReader:f.owner,
    workResultReader:f.reader, acquisitionCandidateEvidenceStore:f.store});
}
function refresh(row) { row.resultDigest = digest(row.result); row.inputBindingDigest = digest(row.inputBindings); }

test('Movie search evidence retains exact candidate claims and never asserts provider coverage', () => {
  const f = setup(1, false), result = read(f);
  assert.equal(result.status, 'observed');
  assert.equal(result.coverage, 'unknown');
  assert.equal(result.outputAtContractMaximum, false);
  assert.equal(result.candidateEvidence.candidates[0].availability, 'unavailable');
  assert.deepEqual(result.candidateEvidence.candidates[0].identityAnchors, []);
  assert.equal(result.candidateEvidence.candidates[0].availabilityEvidence.seederCount, 4);
  assert.equal(result.selection.result, 'not_selected');
  assert.equal(Object.hasOwn(result, 'noSource'), false);
  assert.equal(result.candidateEvidence.candidateSetDigest, f.evidence.candidateSetDigest);
  assert.equal(result.observationDigest, digest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'observationDigest'))));
  assert.ok(Object.isFrozen(result.candidateEvidence.candidates[0]));
  const empty = read(setup(0));
  assert.equal(empty.candidateEvidence.candidates.length, 0);
  assert.equal(empty.selection.result, 'not_selected');
  assert.equal(empty.coverage, 'unknown');
  assert.equal(Object.hasOwn(empty, 'noSource'), false);
  const capped = read(setup(100));
  assert.equal(capped.outputAtContractMaximum, true);
  assert.equal(capped.coverage, 'unknown');
  assert.equal(capped.candidateEvidence.candidates.length, 100);
});

test('Absent and unfinished search never become a no-source finding', () => {
  for (const state of [null, 'ready', 'running', 'blocked', 'failed', 'cancelled']) {
    const f = setup();
    f.reader.status = () => state === null ? null : {...f.status, state};
    f.reader.read = () => { throw new Error('unfinished work must not be read as a result'); };
    const result = read(f);
    assert.equal(result.status, 'evidence_pending');
    assert.equal(result.coverage, 'unknown');
    assert.equal(Object.hasOwn(result, 'noSource'), false);
  }
});

test('Succeeded work rejects changed basis, identity, event graph, selection and candidate evidence', () => {
  const changes = [
    f => {f.status.process_id = 'other-run';},
    f => {f.status.basis_digest = h('other');},
    f => {f.reader.readDefinition = () => ({workId:f.work.workId, definition:{...f.work, processId:'other'}, definitionDigest:h('bad')});},
    f => {f.identity.subjectId = 'other-subject';},
    f => {f.identityRow.result = {...f.identityObservation, sourceKind:'related_nfo'}; f.identityRow.resultDigest = digest(f.identityRow.result);},
    f => {f.records[1].eventId = 'other-search';},
    f => {f.records[1].eventAttemptId = 'other-attempt';},
    f => {f.records[2].inputBindings.bindings[0].eventId = 'other-search'; refresh(f.records[2]);},
    f => {f.records[2].inputBindings.bindings.push(f.records[2].inputBindings.bindings[0]); refresh(f.records[2]);},
    f => {f.records[0].result = {...f.records[0].result, mediaRequirementDigest:h('stale')}; refresh(f.records[0]);},
    f => {f.records[2].result = {...f.records[2].result, selectedCandidateId:'wrong'}; refresh(f.records[2]);},
    f => {f.store.read = () => ({...f.evidence, candidateSetDigest:h('tamper')});},
    f => {f.records.push({...f.records[2]});},
  ];
  for (const change of changes) {const f = setup(); change(f); assert.throws(() => read(f));}
  const unknownState = setup(); unknownState.status.state = 'unexpected';
  assert.throws(() => read(unknownState));
});

test('Exact candidate record is reconstructed from a durable Owner store and corruption is rejected', t => {
  const f = setup(100), root = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-search-evidence-'));
  assert.ok(Buffer.byteLength(canonicalJson(f.evidence)) > 65536);
  const databasePath = path.join(root, 'data.db');
  const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
  const schemaDdl = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
  const schemas = [], pending = [path.resolve(__dirname, '../../src/helix/contracts')];
  while (pending.length) for (const entry of fs.readdirSync(pending.pop(), {withFileTypes:true})) {
    const full = path.join(entry.parentPath || entry.path, entry.name);
    if (entry.isDirectory()) pending.push(full);
    else if (entry.name.endsWith('schema.json')) {const value = JSON.parse(fs.readFileSync(full)); if (value.$id) schemas.push(value);}
  }
  const contractValidator = createCapabilityContractValidator({schemas});
  let kernel;
  const open = () => {kernel = openSqliteKernel({Database, databasePath, schemaDdl, schemaManifest, now:() => now});
    return createAcquisitionCandidateEvidenceStore({schemaManifest, unitOfWork:createSqliteUnitOfWork({kernel}), contractValidator, now:() => now});};
  t.after(() => {kernel?.close(); fs.rmSync(root, {recursive:true, force:true});});
  let store = open();
  const db = new Database(databasePath); db.pragma('foreign_keys=ON');
  db.prepare('INSERT INTO libra_subjects(subject_id) VALUES(?)').run(f.snapshot.run.subjectId);
  db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,state,execution_basis_digest) VALUES(?,?,?,?)')
    .run('run-1',f.snapshot.run.subjectId,'active',f.snapshot.run.executionBasisDigest);
  const addWork = (workId, kind, definition, attemptId, planId, planDigest) => {
    db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,definition_json,definition_digest,state) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(workId,'libra','libra_run','run-1',kind,f.snapshot.run.executionBasisDigest,canonicalJson(definition),digest(definition),'succeeded');
    db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,state) VALUES(?,?,?,?)').run(attemptId,workId,1,'succeeded');
    db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_version,graph_digest,state) VALUES(?,?,?,?,?)')
      .run(planId,attemptId,1,planDigest,'planned');
  };
  const addResult = row => {
    db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,input_bindings_json) VALUES(?,?,?,?)')
      .run(row.planId,row.nodeId,row.capabilityRef,canonicalJson(row.inputBindings));
    db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state) VALUES(?,?,?,?,?,?,?,?)')
      .run(row.eventId,row.planId,row.nodeId,row.workId,row.attemptId,'libra',row.capabilityRef,'succeeded');
    db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind) VALUES(?,?,?,?,?)')
      .run(row.eventAttemptId,row.eventId,1,'completed','succeeded');
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest) VALUES(?,?,?,?,?,?)')
      .run(row.resultId,row.eventId,'succeeded',row.resultSchemaRef,canonicalJson(row.result),row.resultDigest);
  };
  addWork(f.work.workId,'workspace_media_production',f.work,f.records[0].attemptId,f.records[0].planId,f.records[0].planDigest);
  for (const row of f.records) addResult(row);
  addWork('identity-work','product_identity',{},'identity-work-attempt','identity-plan',h('identity-plan'));
  addResult({...f.identityRow,planId:'identity-plan',nodeId:'identity-node',attemptId:'identity-work-attempt',eventAttemptId:'identity-attempt',
    inputBindings:{schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[]}});
  db.close();
  assert.deepEqual(store.save(f.scope, f.query, f.handle, f.evidence), f.record);
  kernel.close(); kernel = null; store = open(); f.store = store;
  f.reader = createWorkResultReader({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
  assert.equal(read(f).candidateEvidence.candidateSetDigest, f.evidence.candidateSetDigest);
  const corrupt = new Database(databasePath); corrupt.prepare('UPDATE libra_acquisition_candidate_evidence SET evidence_digest=?').run(h('tampered')); corrupt.close();
  assert.throws(() => read(f));
});
