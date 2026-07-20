'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PARTIAL_UNIQUE, SUPPORT_COLUMNS, compileSchema } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { readFrozenTableContracts } = require('../../scripts/helix-architecture/p3-ddl-materializer');

const contractsRoot = path.resolve(__dirname, '../../src/helix/contracts');
const contracts = readFrozenTableContracts(contractsRoot);

test('compiles all 177 frozen contracts deterministically without legacy schema artifacts', () => {
  const first = compileSchema(contracts);
  const second = compileSchema([...contracts].reverse());
  assert.equal(first.manifest.tableCount, 177);
  assert.equal(first.ddl, second.ddl);
  assert.equal(first.manifest.ddlDigest, second.manifest.ddlDigest);
  assert.equal((first.ddl.match(/CREATE TABLE/g) || []).length, 177);
  assert.doesNotMatch(first.ddl, /\b(?:nexora_|kairox_|CREATE\s+(?:VIEW|TRIGGER)|MIGRAT)/i);
});

test('retains the exact P2 contract digest for every generated table trace', () => {
  const inventory = JSON.parse(fs.readFileSync(path.join(contractsRoot, 'manifests', 'table-inventory.json'), 'utf8'));
  const expected = new Map(inventory.entryFiles.flatMap((relativePath) =>
    JSON.parse(fs.readFileSync(path.join(contractsRoot, 'manifests', relativePath), 'utf8')).entries
  ).map((entry) => [entry.id, entry.contract.contractDigest]));
  const actual = compileSchema(contracts).manifest.tables;
  assert.equal(expected.size, 177);
  for (const table of actual) assert.equal(table.contractDigest, expected.get(table.tableId), table.tableId);
});

test('keeps checked-in DDL and trace manifest reproducible from frozen inputs', () => {
  const compiled = compileSchema(contracts);
  const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
  const checkedInDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8').replaceAll('\r\n', '\n');
  assert.equal(checkedInDdl, compiled.ddl);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8')), compiled.manifest);
});

test('maps every P2 partial-unique rule and only cross-table predicates use support guards', () => {
  const expected = contracts.reduce((count, contract) => count + contract.partialUniqueRules.length, 0);
  const actual = Object.values(PARTIAL_UNIQUE).reduce((count, rules) => count + rules.length, 0);
  assert.equal(expected, 21);
  assert.equal(actual, expected);
  assert.deepEqual(Object.keys(SUPPORT_COLUMNS).sort(), [
    'arca_inventory_materials', 'people_provider_identities'
  ]);
  const compiled = compileSchema(contracts);
  assert.equal(compiled.manifest.tables.flatMap((table) => table.indexes).filter((index) => index.kind === 'partial-unique').length, 21);
  assert.equal(compiled.manifest.tables.flatMap((table) => table.supportColumns).length, 2);
});

test('emits JSON validity and byte limits, enum checks, RESTRICT foreign keys, and hot indexes', () => {
  const { ddl, manifest } = compileSchema(contracts);
  const jsonCount = contracts.reduce((count, contract) => count + contract.jsonContracts.length, 0);
  const foreignKeyCount = contracts.reduce((count, contract) => count + contract.foreignKeys.length + contract.revisionContract.pointerTargets.length, 0);
  assert.equal((ddl.match(/json_valid\(/g) || []).length, jsonCount);
  assert.equal((ddl.match(/length\(CAST\(/g) || []).length, jsonCount);
  assert.ok((ddl.match(/ON DELETE RESTRICT/g) || []).length <= foreignKeyCount);
  assert.ok((ddl.match(/ON DELETE RESTRICT/g) || []).length > 0);
  assert.match(ddl, /CHECK \("state" IN \('open', 'accepted', 'dismissed', 'superseded'\)\)/);
  assert.match(ddl, /"revision" INTEGER CHECK \("revision" >= 1\)/);
  assert.match(ddl, /"package_revision_head" INTEGER NOT NULL DEFAULT 0 CHECK \("package_revision_head" >= 0\)/);
  assert.match(ddl, /"expected_admission_head_revision" INTEGER NOT NULL CHECK \("expected_admission_head_revision" >= 0\)/);
  assert.match(ddl, /FOREIGN KEY \("run_material_manifest_id", "member_ordinal"\) REFERENCES "libra_run_material_members" \("run_material_manifest_id", "ordinal"\) ON DELETE RESTRICT/);
  assert.match(ddl, /FOREIGN KEY \("reference_asset_id"\) REFERENCES "people_reference_assets" \("reference_asset_id"\) ON DELETE RESTRICT/);
  assert.match(ddl, /FOREIGN KEY \("reference_face_id"\) REFERENCES "people_reference_faces" \("reference_face_id"\) ON DELETE RESTRICT/);
  assert.equal(manifest.digestAlgorithm, 'sha256');
  const digestColumnCount = contracts.reduce((count, contract) => count + contract.columns
    .filter((column) => column.name.endsWith('_digest') || column.name === 'digest' || column.name.endsWith('digest_hex')).length, 0);
  assert.equal((ddl.match(/NOT GLOB '\*\[\^0-9a-f\]\*'/g) || []).length, digestColumnCount);
  assert.equal(manifest.tables.flatMap((table) => table.indexes).filter((index) => index.kind === 'hot').length,
    contracts.reduce((count, contract) => count + contract.hotIndexes.length, 0));
});

test('fails closed on an unknown partial-unique rule shape', () => {
  const changed = structuredClone(contracts);
  changed.find((contract) => contract.tableId === 'fx_command_receipts').partialUniqueRules.push('new unsupported invariant');
  assert.throws(() => compileSchema(changed), /P3_DDL_UNSUPPORTED_PARTIAL_UNIQUE:fx_command_receipts/);
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
