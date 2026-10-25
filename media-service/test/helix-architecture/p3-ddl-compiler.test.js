'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { PARTIAL_UNIQUE, SUPPORT_COLUMNS, compileSchema } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { readFrozenTableContracts } = require('../../scripts/helix-architecture/p3-ddl-materializer');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const contracts = readFrozenTableContracts(contractsRoot);

test('compiles all 235 frozen contracts deterministically without legacy schema artifacts', () => {
  const first = compileSchema(contracts);
  const second = compileSchema([...contracts].reverse());
  assert.equal(first.manifest.tableCount, 235);
  assert.equal(first.ddl, second.ddl);
  assert.equal(first.manifest.ddlDigest, second.manifest.ddlDigest);
  assert.equal((first.ddl.match(/CREATE TABLE/g) || []).length, 235);
  assert.doesNotMatch(first.ddl, /\b(?:nexora_|kairox_|CREATE\s+(?:VIEW|TRIGGER)|MIGRAT)/i);
});

test('retains the exact P2 contract digest for every generated table trace', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(contractsRoot, 'manifests', 'table-inventory.json'), 'utf8'));
  const expected = new Map(inventory.entryFiles.flatMap((relativePath) =>
    JSON.parse(fs.readFileSync(path.join(contractsRoot, 'manifests', relativePath), 'utf8')).entries
  ).map((entry) => [entry.id, entry.contract.contractDigest]));
  const actual = compileSchema(contracts).manifest.tables;
  assert.equal(expected.size, 235);
  for (const table of actual) assert.equal(table.contractDigest, expected.get(table.tableId), table.tableId);
});

test('keeps checked-in DDL and trace manifest reproducible from frozen inputs', () => {
  const compiled = compileSchema(contracts);
  const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
  const checkedInDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(checkedInDdl, compiled.ddl);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8')), compiled.manifest);
});

test('unconditional Event result uniqueness supports indexed lookups without a tautological partial predicate',()=>{
  const db=new Database(':memory:');try{
    db.exec(compileSchema(contracts).ddl);
    const plan=db.prepare('EXPLAIN QUERY PLAN SELECT result_json FROM fx_event_result_bindings WHERE event_id=?').all('event');
    assert.ok(plan.some(row=>/SEARCH.*USING INDEX.*event_id/.test(row.detail)),JSON.stringify(plan));
    db.pragma('foreign_keys = OFF');
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id) VALUES(?,?)').run('one','event');
    assert.throws(()=>db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id) VALUES(?,?)').run('two','event'),/UNIQUE/);
  }finally{db.close();}
});

test('maps every P2 partial-unique rule and only cross-table predicates use support guards', () => {
  const expected = contracts.reduce((count, contract) => count + contract.partialUniqueRules.length, 0);
  const actual = Object.values(PARTIAL_UNIQUE).reduce((count, rules) => count + rules.length, 0);
  assert.equal(expected, 24);
  assert.equal(actual, expected);
  assert.deepEqual(Object.keys(SUPPORT_COLUMNS).sort(), [
    'arca_inventory_materials', 'libra_intake_decisions', 'people_provider_identities'
  ]);
  const compiled = compileSchema(contracts);
  assert.equal(compiled.manifest.tables.flatMap((table) => table.indexes).filter((index) => index.kind === 'partial-unique').length, 24);
  assert.equal(compiled.manifest.tables.flatMap((table) => table.supportColumns).length, 7);
  assert.deepEqual(compiled.manifest.tables.find((table) => table.tableId === 'libra_intake_decisions').supportColumns
    .map((column) => column.name), [
      'candidate_delivery_snapshot_schema_ref',
      'candidate_delivery_snapshot_json',
      'decision_identity_evidence_schema_ref',
      'decision_identity_evidence_json',
      'decision_identity_evidence_digest'
    ]);
});

test('emits JSON validity and byte limits, enum checks, RESTRICT foreign keys, and hot indexes', () => {
  const { ddl, manifest } = compileSchema(contracts);
  const jsonCount = contracts.reduce((count, contract) => count + contract.jsonContracts.length, 0);
  const foreignKeyCount = contracts.reduce((count, contract) => count + contract.foreignKeys.length + contract.revisionContract.pointerTargets.length, 0);
  assert.equal((ddl.match(/json_valid\(/g) || []).length, jsonCount + 2);
  assert.equal((ddl.match(/length\(CAST\(/g) || []).length, jsonCount + 4);
  assert.ok((ddl.match(/ON DELETE RESTRICT/g) || []).length <= foreignKeyCount);
  assert.ok((ddl.match(/ON DELETE RESTRICT/g) || []).length > 0);
  assert.match(ddl, /CHECK \("state" IN \('open', 'accepted', 'dismissed', 'superseded'\)\)/);
  assert.match(ddl, /"revision" INTEGER CHECK \("revision" >= 1\)/);
  assert.match(ddl, /"package_revision_head" INTEGER NOT NULL DEFAULT 0 CHECK \("package_revision_head" >= 0\)/);
  assert.match(ddl, /"expected_admission_head_revision" INTEGER NOT NULL CHECK \("expected_admission_head_revision" >= 0\)/);
  assert.match(ddl, /CREATE TABLE "libra_workspace_cleanup_members"[\s\S]*?"expected_control_revision" INTEGER CHECK \("expected_control_revision" >= 0\)/);
  assert.match(ddl, /CHECK \("verified_artifact_manifest_json" IS NULL OR length\(CAST\("verified_artifact_manifest_json" AS BLOB\)\) <= 262144\)/);
  assert.match(ddl, /CHECK \(length\(CAST\("episode_claims_json" AS BLOB\)\) <= 16384\)/);
  assert.match(ddl, /CHECK \("product_verification_json" IS NULL OR length\(CAST\("product_verification_json" AS BLOB\)\) <= 131072\)/);
  assert.match(ddl, /CHECK \("outcome_evidence_json" IS NULL OR json_valid\("outcome_evidence_json"\)\)/);
  assert.match(ddl, /FOREIGN KEY \("run_material_manifest_id", "member_ordinal"\) REFERENCES "libra_run_material_members" \("run_material_manifest_id", "ordinal"\) ON DELETE RESTRICT/);
  assert.match(ddl, /FOREIGN KEY \("reference_asset_id"\) REFERENCES "people_reference_assets" \("reference_asset_id"\) ON DELETE RESTRICT/);
  assert.match(ddl, /FOREIGN KEY \("reference_face_id"\) REFERENCES "people_reference_faces" \("reference_face_id"\) ON DELETE RESTRICT/);
  assert.equal(manifest.digestAlgorithm, 'sha256');
  const digestColumnCount = contracts.reduce((count, contract) => count + contract.columns
    .filter((column) => column.name.endsWith('_digest') || column.name === 'digest' || column.name.endsWith('digest_hex')).length, 0);
  assert.equal((ddl.match(/NOT GLOB '\*\[\^0-9a-f\]\*'/g) || []).length, digestColumnCount + 1);
  assert.equal(manifest.tables.flatMap((table) => table.indexes).filter((index) => index.kind === 'hot').length,
    contracts.reduce((count, contract) => count + contract.hotIndexes.length, 0));
});

test('clean DDL accepts each Workspace Reference JSON limit and rejects one byte beyond it', () => {
  const db = new Database(':memory:');
  db.exec(compileSchema(contracts).ddl);
  const jsonBytes = (bytes) => `{"v":"${'x'.repeat(bytes - 8)}"}`;
  const insert = db.prepare('INSERT INTO libra_workspace_material_refs ' +
    '(reference_id,reference_revision,workspace_handle_json,episode_claims_json,product_verification_json) ' +
    'VALUES (?,?,?,?,?)');
  insert.run('exact', 1, jsonBytes(4096), jsonBytes(16384), jsonBytes(131072));
  assert.throws(() => insert.run('handle-over', 1, jsonBytes(4097), '[]', '{}'), /CHECK constraint failed/);
  assert.throws(() => insert.run('claims-over', 1, '{}', jsonBytes(16385), '{}'), /CHECK constraint failed/);
  assert.throws(() => insert.run('verification-over', 1, '{}', '[]', jsonBytes(131073)), /CHECK constraint failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM libra_workspace_material_refs').get().count, 1);
  db.close();
});

test('fails closed on an unknown partial-unique rule shape', () => {
  const changed = structuredClone(contracts);
  changed.find((contract) => contract.tableId === 'fx_command_receipts').partialUniqueRules.push('new unsupported invariant');
  assert.throws(() => compileSchema(changed), /P3_DDL_UNSUPPORTED_PARTIAL_UNIQUE:fx_command_receipts/);
});

test('committed correction context is atomic with terminal state and has an exact four MiB JSON limit',()=>{
  const db=new Database(':memory:');try{
    db.exec(compileSchema(contracts).ddl);db.pragma('foreign_keys = OFF');
    const insert=db.prepare('INSERT INTO arca_jav_identity_corrections(correction_id,shelf_entry_id,preview_proof_schema_ref,preview_proof_json,state,state_revision,terminal_evidence_digest,terminal_at_ms,committed_context_schema_ref,committed_context_json,committed_context_digest,cleanup_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'),statement={run(...values){return insert.run(...values,values[4]==='committed'?'pending':null);}},
      proof='helix://contracts/application-types/ArcaJavCorrectionPreviewProof/v1',context='helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1',digest='a'.repeat(64);
    statement.run('active','one',proof,'{}','active',1,null,null,null,null,null);
    assert.throws(()=>statement.run('active-context','two',proof,'{}','active',1,null,null,context,'{}',digest),/CHECK constraint failed/);
    assert.throws(()=>statement.run('no-context','three',proof,'{}','committed',3,digest,1,null,null,null),/CHECK constraint failed/);
    assert.throws(()=>statement.run('partial-context','four',proof,'{}','committed',3,digest,1,context,'{}',null),/CHECK constraint failed/);
    assert.throws(()=>statement.run('null-schema','eight',proof,'{}','committed',3,digest,1,null,'{}',digest),/CHECK constraint failed/);
    assert.throws(()=>statement.run('wrong-schema','five',proof,'{}','committed',3,digest,1,'foreign-schema','{}',digest),/CHECK constraint failed/);
    const jsonBytes=bytes=>`{"v":"${'x'.repeat(bytes-8)}"}`;
    statement.run('exact-limit','six',proof,'{}','committed',3,digest,1,context,jsonBytes(4*1024*1024),digest);
    assert.throws(()=>statement.run('over-limit','seven',proof,'{}','committed',3,digest,1,context,jsonBytes(4*1024*1024+1),digest),/CHECK constraint failed/);
    assert.equal(db.prepare('SELECT count(*) n FROM arca_jav_identity_corrections').get().n,2);
    assert.throws(()=>statement.run('second-correction','six',proof,'{}','active',1,null,null,null,null,null),/UNIQUE constraint failed/);
    assert.throws(()=>db.prepare('UPDATE arca_jav_identity_corrections SET cleanup_state=? WHERE correction_id=?').run('completed','exact-limit'),/CHECK constraint failed/);
    assert.throws(()=>db.prepare('UPDATE arca_jav_identity_corrections SET cleanup_state=NULL WHERE correction_id=?').run('exact-limit'),/CHECK constraint failed/);
    assert.throws(()=>db.prepare('UPDATE arca_jav_identity_corrections SET cleanup_state=? WHERE correction_id=?').run('pending','active'),/CHECK constraint failed/);
  }finally{db.close();}
});

test('recovery history enforces nominal schemas, bounded complete observations and immutable owner repositories',()=>{
  const generated=compileSchema(contracts),db=new Database(':memory:');
  try{db.exec(generated.ddl);db.pragma('foreign_keys = OFF');
    const receipt='helix://contracts/application-types/ArcaJavCorrectionRecoveryIntentReceipt/v1',observation='helix://contracts/application-types/ArcaJavCorrectionRecoveryObservation/v1',digest='0'.repeat(64),
      insert=db.prepare('INSERT INTO arca_jav_correction_recovery_intents (recovery_id,correction_id,shelf_entry_id,previous_intent_digest,receipt_schema_ref,receipt_json,receipt_digest,observation_schema_ref,observation_json,observation_digest,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)'),
      row=['recovery','correction','entry',null,receipt,'{}',digest,observation,'{}',digest,1];
    insert.run(...row);
    assert.throws(()=>insert.run(...row.map((value,index)=>index===0?'another':value)),/UNIQUE constraint failed/);
    for(const [index,value] of [[4,'helix://wrong/Receipt/v1'],[7,'helix://wrong/Observation/v1'],[5,'{"v":"'+'x'.repeat(16384)+'"}'],[8,'{"v":"'+'x'.repeat(1024*1024)+'"}']]){
      const changed=[...row];changed[0]='invalid-'+index;changed[6]='1'.repeat(64);changed[index]=value;assert.throws(()=>insert.run(...changed),/CHECK constraint failed/);
    }
    const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository'),common={repositoryId:'fixture_recovery_history',owner:'arca',schemaManifest:generated.manifest};
    assert.throws(()=>createRepositoryDefinition({...common,statements:{change:{kind:'update',tableId:'arca_jav_correction_recovery_intents',setColumns:['observation_json'],keyColumns:['recovery_id']}}}),{code:'P3_REPOSITORY_IMMUTABLE_UPDATE'});
    assert.throws(()=>createRepositoryDefinition({...common,statements:{remove:{kind:'delete',tableId:'arca_jav_correction_recovery_intents',keyColumns:['recovery_id']}}}),{code:'P3_REPOSITORY_UNSUPPORTED_STATEMENT'});
    assert.throws(()=>createRepositoryDefinition({...common,statements:{remove:{kind:'delete-one',tableId:'arca_jav_correction_recovery_intents',keyColumns:['recovery_id']}}}),{code:'P3_REPOSITORY_IMMUTABLE_DELETE'});
  }finally{db.close();}
});

test('fails closed on unresolved FK targets and unsupported logical types', () => {
  const badForeignKey = structuredClone(contracts);
  const contractWithForeignKey = badForeignKey.find((contract) => contract.foreignKeys.length > 0);
  contractWithForeignKey.foreignKeys[0].targetTable = null;
  assert.throws(() => compileSchema(badForeignKey), /P3_DDL_UNRESOLVED_FOREIGN_KEY/);

  const badType = structuredClone(contracts);
  badType[0].columns[0].logicalType = 'MAGIC';
  assert.throws(() => compileSchema(badType), /P3_DDL_UNSUPPORTED_LOGICAL_TYPE/);

  const badExpression = structuredClone(contracts);
  badExpression[0].hotIndexes.push(['LOWER(state)']);
  assert.throws(() => compileSchema(badExpression), /P3_DDL_UNSUPPORTED_INDEX_EXPRESSION/);

  const unboundedState = structuredClone(contracts);
  unboundedState.find((contract) => contract.tableId === 'fx_supporting_works').columns
    .find((column) => column.name === 'state').enumValues = [];
  assert.throws(() => compileSchema(unboundedState), /P3_DDL_UNBOUNDED_STATE/);
});
