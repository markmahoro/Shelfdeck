'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createLibraRunCreator } = require('../../src/helix/domains/libra/application/libra-run-creator');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const D = (value) => canonicalDigest({ value });

function releasedControlFixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p9-run-creator-'));
  const databasePath = path.join(dir, 'db.sqlite');
  let now = 100;
  openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ }).close();
  const identity = {
    mountScopeId: 'mount-1', inode: '11', sizeBytes: 100,
    fingerprintAlgorithm: 'middle-256k-sha256', fingerprintVersion: 1, contentFingerprint: D('content'),
  };
  const materialKey = canonicalDigest({ schema: 'physical-material-identity@2', ...identity });
  const db = new Database(databasePath);
  db.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    materialKey, identity.mountScopeId, identity.inode, identity.sizeBytes,
    identity.fingerprintAlgorithm, identity.fingerprintVersion, identity.contentFingerprint,
    null, null, null, 2, 'released', 2,
  );
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    materialKey, 1, 'acquire', null, null, null, 'libra', 'subject', 'subject-1', D('control-1'), 'control-marker-1', 1,
  );
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    materialKey, 2, 'release', 'libra', 'subject', 'subject-1', null, null, null, D('control-2'), 'control-marker-2', 2,
  );
  db.close();
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => now++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try { return run({ databasePath, unitOfWork, identity, materialKey }); }
  finally { kernel.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function discardedReadyContext(materialKey, identity) {
  const related = D('related');
  const relatedScope = D('related-scope');
  return Object.freeze({
    kind: 'ready',
    subject: Object.freeze({
      subject_id: 'subject-1', structure_kind: 'single', content_profile: 'movie',
      intake_revision: 1, current_continuity_set_digest: D('continuity'),
      current_episode_scope_digest: D('episodes'),
    }),
    spec: Object.freeze({
      acceptanceSpecId: 'spec-1', specRevision: 1, specDigest: D('spec'), recordDigest: D('record'),
    }),
    runs: Object.freeze([Object.freeze({
      libra_run_id: 'run-discarded', state: 'discarded', state_revision: 4,
      state_digest: D('discarded'), acceptance_spec_id: 'spec-1',
      execution_basis_digest: D('basis'),
    })]),
    bindings: Object.freeze([Object.freeze({
      authority_kind: 'primary_control', material_key: materialKey, role: 'primary_payload',
      primary_material_key: null, association_evidence_digest: null, disposition_basis_digest: null,
      mount_scope_id: identity.mountScopeId, inode: identity.inode,
      fingerprint_algorithm: identity.fingerprintAlgorithm, fingerprint_version: identity.fingerprintVersion,
      content_fingerprint: identity.contentFingerprint, size_bytes: identity.sizeBytes,
      endpoint_id: 'endpoint-1', location: '/library/input.mkv', binding_revision: 1,
      evidence_digest: D('binding'), origin_intake_decision_id: 'intake-1', origin_offer_id: 'offer-1',
      origin_candidate_package_id: 'candidate-1', origin_package_revision: 1, origin_package_digest: D('package'),
      origin_candidate_delivery_snapshot_digest: D('delivery'),
      origin_related_reference_set_digest: related, origin_related_disposition_scope_digest: relatedScope,
    })]),
    claims: Object.freeze([]),
    acceptedDeliveryRunIds: Object.freeze([]),
  });
}

test('does not admit a new Libra Run after a discarded Run released Control', () => releasedControlFixture((input) => {
  const admitParticipants = [];
  const unitOfWork = {
    execute(participants) {
      for (const participant of participants) {
        if (String(participant.participantId || '').startsWith('run_admission')) {
          admitParticipants.push(participant.participantId);
        }
      }
      return input.unitOfWork.execute(participants);
    },
  };
  const creator = createLibraRunCreator({
    schemaManifest,
    unitOfWork,
    contextReader: {
      read: () => discardedReadyContext(input.materialKey, input.identity),
      headSnapshot() { throw new Error('Run Creator must not build an admission head after Discard.'); },
      decisionHeadSnapshot() { throw new Error('Run Creator must not read Decision Head after Discard.'); },
    },
  });
  const result = creator.reconcile('subject-1');
  assert.equal(result.kind, 'awaiting_reintake');
  assert.equal(result.subjectId, 'subject-1');
  assert.equal(result.reasonCode, 'LIBRA_RUN_CONTROL_RELEASED');
  assert.deepEqual(admitParticipants, []);
  const db = new Database(input.databasePath, { readonly: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_runs').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_run_admission_heads').get().n, 0);
  db.close();
}));
