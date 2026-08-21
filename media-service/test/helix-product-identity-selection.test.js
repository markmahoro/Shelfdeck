'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createProductIdentitySelectionService } = require('../src/helix/domains/libra/application/product-identity-selection-service');
const { observeProductIdentity } = require('../src/helix/domains/libra/capabilities/routing-capability-ports');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hex = (value) => canonicalDigest({ value });

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-product-identity-selection-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 100;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const database = new Database(databasePath);
  database.prepare(
    'INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)',
  ).run('subject-1', 'single', 'movie', 'active', 1, hex('continuity'), hex('episode-scope'));
  database.prepare(
    'INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_schema_ref,execution_basis_record_json,execution_basis_digest,run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_policy_ref,recovery_policy_digest,recovery_attempt_ordinal,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('run-1', 'subject-1', 1, 'LibraRunExecutionBasis@1', '{}', hex('basis'), hex('scope'), 'active', 1,
    hex('state'), 'normal', hex('priority'), 'LibraRunRecoveryPolicy@1', hex('recovery'), 0, 100);
  database.close();
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try { return run({ databasePath, service:createProductIdentitySelectionService({ schemaManifest, unitOfWork }) }); }
  finally { kernel.close(); fs.rmSync(root, { recursive:true, force:true }); }
}

test('manual Product Identity choice appends one immutable intent and replays the same command', () => fixture(({ databasePath, service }) => {
  const request = { idempotencyKey:'choose-tmdb-1', expectedRunStateRevision:1, expectedIdentityRevision:null,
    tmdbMovieId:'278', candidateSetDigest:hex('candidate-set') };
  const first = service.choose('run-1', request);
  const replay = service.choose('run-1', request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.selectionIntentId, first.selectionIntentId);
  assert.equal(replay.providerKey, '278');
  const current = service.readCurrent('run-1');
  assert.equal(current.provider_key, '278');
  assert.equal(current.selection_kind, 'provider_id');
  const database = new Database(databasePath, { readonly:true });
  assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_product_identity_selection_intents').get().count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM fx_command_receipts WHERE command_contract='libra.choose-product-identity@1'",
  ).get().count, 1);
  database.close();
}));

test('manual choice rejects stale Run/Identity fences and idempotency payload reuse', () => fixture(({ service }) => {
  const request = { idempotencyKey:'choose-tmdb-1', expectedRunStateRevision:1, expectedIdentityRevision:null, tmdbMovieId:'278' };
  service.choose('run-1', request);
  assert.throws(() => service.choose('run-1', { ...request, tmdbMovieId:'13' }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT');
  assert.throws(() => service.choose('run-1', { ...request, idempotencyKey:'stale-run', expectedRunStateRevision:2 }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_STALE');
  assert.throws(() => service.choose('run-1', { ...request, idempotencyKey:'stale-identity', expectedIdentityRevision:1 }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_IDENTITY_STALE');
}));

function evidenceIntent(associationKind) {
  const aliases = [{ value:'Expected Movie', sourceKind:associationKind === 'manual_selection' ? 'manual_selection' : 'related_nfo' }]
    .map((item) => ({ ...item, aliasDigest:canonicalDigest(item) }));
  const body = { intentId:'identity-intent-1', libraRunId:'run-1', subjectId:'subject-1',
    runExecutionBasisDigest:hex('basis'), contentProfile:'movie', sourceKind:'provider_exact', aliases,
    yearHint:2000, integrationId:'tmdb-main', configRevision:1, provider:'tmdb', namespace:'tmdb_movie',
    providerKey:'278', associationKind, associationEvidenceDigest:hex(associationKind) };
  return { ...body, intentDigest:canonicalDigest(body) };
}

test('NFO exact-ID evidence rejects a real TMDB object whose alias/year do not prove the association', async () => {
  const result = await observeProductIdentity({ observeRoutingProvider:async () => [{
    providerKey:'278', title:'Different Movie', originalTitle:'Different Movie', releaseYear:1999,
  }] }, evidenceIntent('nfo_claim'), { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(result.result, 'conflicting');
  assert.equal(result.reasonCode, 'provider_identity_conflicting');
  assert.equal(result.verifiedIdentity, null);
});

test('manual Selection Intent still performs exact TMDB observation before resolving', async () => {
  let calls = 0;
  const result = await observeProductIdentity({ observeRoutingProvider:async ({ operationId }) => {
    calls += 1;
    assert.equal(operationId, 'libra.product_identity.evidence.observe@1');
    return [{ providerKey:'278', title:'The Shawshank Redemption', originalTitle:'The Shawshank Redemption', releaseYear:1994 }];
  } }, evidenceIntent('manual_selection'), { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(calls, 1);
  assert.equal(result.result, 'resolved');
  assert.equal(result.verifiedIdentity.providerKey, '278');
});

test('provider-local alias provenance is normalized before Product Identity evidence leaves Libra', async () => {
  const result = await observeProductIdentity({ observeRoutingProvider:async () => [{
    providerKey:'278', title:'Expected Movie', originalTitle:'Expected Movie', releaseYear:2000,
    aliases:[
      { value:'Expected Movie', sourceKind:'localized' },
      { value:'The Expected Movie', sourceKind:'alternative_title' },
    ],
  }] }, { ...evidenceIntent('manual_selection'), yearHint:2000,
    aliases:[{ value:'Expected Movie', sourceKind:'candidate', aliasDigest:canonicalDigest({ value:'Expected Movie', sourceKind:'candidate' })}],
  }, { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(result.result, 'resolved');
  assert.deepEqual(result.verifiedIdentity.aliases.map((item) => item.sourceKind), ['provider', 'provider']);
});

test('technical release suffix after a year is removed before TMDB identity search', async () => {
  let searchedTitle;
  const base = evidenceIntent('manual_selection');
  const alias = { value:'看不见的朋友 (2023) - 1080p H.264 CHDWEB', sourceKind:'candidate' };
  const intent = {
    ...base,
    sourceKind:'candidate',
    aliases:[{ ...alias, aliasDigest:canonicalDigest(alias) }],
    yearHint:2023,
  };
  const result = await observeProductIdentity({ observeRoutingProvider:async ({ intent:providerIntent }) => {
    searchedTitle = providerIntent.candidateDisplayTitle;
    return [{ providerKey:'1140983', title:'看不见的朋友', originalTitle:'Hello Ghost!', releaseYear:2023 }];
  } }, intent, { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(searchedTitle, '看不见的朋友');
  assert.equal(result.result, 'resolved');
});
