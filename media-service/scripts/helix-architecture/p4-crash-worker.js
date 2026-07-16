'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createEffectJournal, effectIdentity } = require('../../src/helix/foundation/effects/effect-journal');
const { digest } = require('../../src/helix/foundation/persistence/ddl-compiler');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const serviceRoot = path.resolve(__dirname, '../..');
const generatedRoot = path.join(serviceRoot, 'src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const nonPure = ['workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'];
const [mode, databasePath, ledgerPath, effectClass, crashPoint] = process.argv.slice(2);

function ledger() {
  return fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { applied: false, dispatchCount: 0 };
}

function dispatchFakeOnce() {
  const current = ledger();
  if (!current.applied) {
    current.applied = true;
    current.dispatchCount += 1;
    fs.writeFileSync(ledgerPath, JSON.stringify(current));
  }
  return current;
}

function crash() {
  process.exit(73);
}

async function main() {
  if (!['crash', 'recover'].includes(mode) || !nonPure.includes(effectClass)) throw new Error('Invalid P4 crash worker arguments.');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000010000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const journal = createEffectJournal({
    schemaManifest,
    unitOfWork,
    now: () => 1700000010001,
    realityVerifiers: Object.fromEntries(nonPure.map((candidate) => [candidate, { async verify() {
      if (mode === 'crash' && crashPoint === 'after_observation') crash();
      return { verified: ledger().applied === true, evidenceDigest: digest('p4-fake-reality/' + effectClass) };
    } }]))
  });
  const idempotencyKey = 'p4-crash/' + effectClass;
  const effectId = effectIdentity(effectClass, idempotencyKey);
  try {
    if (mode === 'crash' && crashPoint === 'before_intent') crash();
    journal.intend({ eventAttemptId: 'event-attempt', effectClass, idempotencyKey, intentDigest: digest('p4-intent/' + effectClass) });
    if (mode === 'crash' && crashPoint === 'after_intent') crash();
    dispatchFakeOnce();
    if (mode === 'crash' && crashPoint === 'after_fake_effect') crash();
    await journal.settle({
      effectId,
      receipt: {
        schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1,
        effectReceiptId: 'p4-receipt/' + effectClass, effectId, effectClass, idempotencyKey,
        commitMarker: 'p4-marker/' + effectClass,
        externalReceiptRef: effectClass === 'external_request' ? 'p4-external/' + effectClass : null,
        outputDigest: digest('p4-output/' + effectClass),
        verificationEvidenceDigest: digest('p4-fake-reality/' + effectClass), committedAtMs: 1700000010000
      },
      scope: { ownerDomain: 'libra', scopeType: 'p4_fake_scope', scopeId: effectClass }
    });
    if (mode === 'crash' && crashPoint === 'after_commit') crash();
  } finally {
    kernel.close();
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ code: error.code || 'P4_CRASH_WORKER_FAILED', message: error.message }) + '\n');
  process.exitCode = 1;
});
