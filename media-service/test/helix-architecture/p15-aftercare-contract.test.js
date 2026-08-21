'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } = require('../../src/helix/integrations/bounded-material-fingerprint');
const { observedIdentity, observeKnownOldBindings } = require('../../src/helix/domains/arca/model/known-old-binding');
const { validNfo } = require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {
  PERIODS,
  stableJitterMs,
  projectHealth,
  dispositionFromAssessments,
} = require('../../src/helix/domains/arca/model/aftercare-contract');

const digest = (character) => character.repeat(64);
const context = (basisDigest = digest('a')) => Object.freeze({
  shelfEntryId:'entry-1',
  basis:Object.freeze({ digest:basisDigest }),
});
const assessment = (kind, at, basisDigest = digest('a'), result = 'healthy') =>
  Object.freeze({
    assessmentId:`assessment-${kind}-${at}`,
    assessmentKind:kind,
    careBasisDigest:basisDigest,
    result,
    evidenceDigest:digest(kind === 'custody' ? 'b' : kind === 'presentation' ? 'c' : 'd'),
    assessedAtMs:at,
  });

test('Aftercare cadence is deterministic, bounded, and split between daily and weekly evidence', () => {
  const jitter = stableJitterMs('entry-1');
  assert.equal(stableJitterMs('entry-1'), jitter);
  assert.ok(jitter >= 0 && jitter <= PERIODS.jitterMs);
  const at = 1_000_000;
  const health = projectHealth(context(), {
    assessments:[
      assessment('custody', at),
      assessment('presentation', at),
      assessment('conformance', at),
    ],
    findings:[], cases:[],
  }, at);
  assert.equal(health.state, 'healthy');
  assert.equal(health.nextCustodyDueAtMs, at + PERIODS.custodyMs + jitter);
  assert.equal(health.nextDeepDueAtMs, at + PERIODS.deepMs + jitter);
});

test('a terminal Case from an obsolete Care Basis remains history but cannot color current health', () => {
  const oldBasis = digest('0');
  const currentBasis = digest('a');
  const currentAssessments = [
    assessment('custody', 10, currentBasis),
    assessment('presentation', 10, currentBasis),
    assessment('conformance', 10, currentBasis),
  ];
  const health = projectHealth(context(currentBasis), {
    assessments:currentAssessments,
    findings:[],
    cases:[Object.freeze({
      aftercareCaseId:'old-unresolved', careBasisDigest:oldBasis,
      state:'unresolved', createdAtMs:9,
    })],
  }, 10);
  assert.equal(health.state, 'healthy');
  assert.equal(health.activeCase, null);
});

test('Care Disposition permits repair only when every blocking Finding is repairable', () => {
  assert.equal(dispositionFromAssessments([{ findings:[
    { repairability:'auto_repair' }, { repairability:'auto_repair' },
  ] }]), 'auto_repair');
  assert.equal(dispositionFromAssessments([{ findings:[
    { repairability:'auto_repair' }, { repairability:'attention_required' },
  ] }]), 'attention_required');
  assert.equal(dispositionFromAssessments([{ findings:[
    { repairability:'observe' },
  ] }]), 'observe');
});

test('Aftercare Known Bindings keep a single schema objectKind for current and old custody rows', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/application/aftercare-context-reader.js'), 'utf8');
  assert.match(source, /objectKind:'arca-material-binding'/);
  assert.doesNotMatch(source, /arca-known-old-binding/);
});

test('Aftercare Case closure reclaims Workspace before publishing resolved Case Result', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/planning/aftercare-planners.js'), 'utf8');
  const closure = source.slice(source.indexOf('function createCareCaseClosurePlanner'));
  assert.ok(closure.indexOf("C.workspaceReclaim,'workspace_reclaim'") <
    closure.indexOf("C.caseCommit,'case_commit'"));
  assert.match(closure, /C\.caseCommit[\s\S]*eventId:reclaim,satisfaction:'success'/);
});

test('same-root settled offload paths are absent, not unreadable, once the fingerprint wraps ENOENT', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-old-binding-enoent-'));
  try {
    const finalLocation = path.join(root, 'Exiled (2006)', 'Exiled (2006).mkv');
    const settledAway = path.join(root, 'Exiled (2006)', 'Exiled (2006) - 1080p Remux.mkv');
    fs.mkdirSync(path.dirname(finalLocation), { recursive:true });
    fs.writeFileSync(finalLocation, Buffer.from('final-movie-bytes'));
    const mountScopeId = 'canary-mount';
    const finalIdentity = observedIdentity(finalLocation, mountScopeId,
      computeBoundedMaterialFingerprintSync);
    const raw = {
      oldBindings:[{
        material_key:'a'.repeat(64), role:'offload:original_input',
        mount_scope_id:mountScopeId, endpoint_id:'canary', location:settledAway,
        binding_revision:1, evidence_digest:canonicalDigest({ settledAway }),
      }],
      materials:[{
        material_key:finalIdentity.materialKey, role:'primary_payload',
        location:finalLocation, size_bytes:finalIdentity.sizeBytes,
        fingerprint_algorithm:finalIdentity.fingerprintAlgorithm,
        fingerprint_version:finalIdentity.fingerprintVersion,
        content_fingerprint:finalIdentity.contentFingerprint,
      }],
    };
    const observed = observeKnownOldBindings(raw, computeBoundedMaterialFingerprintSync);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].kind, 'absent');
    const leftoverDir = path.join(root, 'Exiled (2006)', 'leftover-dir');
    fs.mkdirSync(leftoverDir);
    raw.oldBindings[0].location = leftoverDir;
    assert.equal(observeKnownOldBindings(raw, computeBoundedMaterialFingerprintSync)[0].kind, 'unreadable');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Libra product movie NFO without an XML declaration is valid; non-movie NFO stays corrupt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-nfo-valid-'));
  try {
    const movie = path.join(root, 'movie.nfo');
    const declared = path.join(root, 'declared.nfo');
    const series = path.join(root, 'series.nfo');
    fs.writeFileSync(movie, Buffer.from('<movie>\n  <title>放·逐</title>\n  <tmdbid>66717</tmdbid>\n  <year>2006</year>\n</movie>\n'));
    fs.writeFileSync(declared, Buffer.from('<?xml version="1.0" encoding="utf-8"?>\n<movie>\n  <title>放·逐</title>\n</movie>\n'));
    fs.writeFileSync(series, Buffer.from('<tvshow>\n  <title>Not a movie</title>\n</tvshow>\n'));
    assert.equal(validNfo(movie), true);
    assert.equal(validNfo(declared), true);
    assert.equal(validNfo(series), false);
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Aftercare recognizes an exact legacy custody Binding only when a current final member has the same bounded bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-known-old-binding-'));
  try {
    const oldLocation = path.join(root, 'opaque-source', 'old.mkv');
    const finalLocation = path.join(root, 'shelf', 'Movie (2026)', 'Movie (2026).mkv');
    fs.mkdirSync(path.dirname(oldLocation), { recursive:true });
    fs.mkdirSync(path.dirname(finalLocation), { recursive:true });
    fs.writeFileSync(oldLocation, Buffer.from('same-bounded-media'));
    fs.copyFileSync(oldLocation, finalLocation);
    const mountScopeId = 'canary-mount';
    const oldIdentity = observedIdentity(oldLocation, mountScopeId,
      computeBoundedMaterialFingerprintSync);
    const finalIdentity = observedIdentity(finalLocation, mountScopeId,
      computeBoundedMaterialFingerprintSync);
    const raw = {
      shelf:{ target_mount_scope_id:mountScopeId },
      oldBindings:[{
        material_key:oldIdentity.materialKey, role:'offload:original_input',
        mount_scope_id:mountScopeId,
        endpoint_id:'canary', location:oldLocation, binding_revision:1,
        evidence_digest:canonicalDigest({ oldLocation }),
      }],
      materials:[{
        material_key:finalIdentity.materialKey, role:'primary_payload',
        location:finalLocation, size_bytes:finalIdentity.sizeBytes,
        fingerprint_algorithm:finalIdentity.fingerprintAlgorithm,
        fingerprint_version:finalIdentity.fingerprintVersion,
        content_fingerprint:finalIdentity.contentFingerprint,
      }],
    };
    const observed = observeKnownOldBindings(raw,
      computeBoundedMaterialFingerprintSync);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].kind, 'duplicate_of_final');
    assert.equal(observed[0].final.material_key, finalIdentity.materialKey);
    fs.writeFileSync(oldLocation, Buffer.from('changed-media'));
    assert.equal(observeKnownOldBindings(raw,
      computeBoundedMaterialFingerprintSync)[0].kind, 'identity_changed');
  } finally {
    fs.rmSync(root, { recursive:true, force:true });
  }
});

test('Aftercare legacy settlement remains evidence-gated and refuses unknown directory members', () => {
  const projection = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/planning/aftercare-projections.js'), 'utf8');
  const capability = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/capabilities/aftercare-capability-ports.js'), 'utf8');
  assert.match(projection, /observeKnownOldBindings/);
  assert.match(projection, /finalMaterialKey:observed\.final\.material_key/);
  assert.match(capability, /ARCA_AFTERCARE_SETTLEMENT_FINAL_MISMATCH/);
  assert.match(capability, /ARCA_AFTERCARE_SETTLEMENT_UNKNOWN_MEMBER/);
  assert.doesNotMatch(capability, /fs\.rmSync\(handle\.location[^\n]*recursive\s*:\s*true/);
});

test('Aftercare receives the bounded fingerprint port and durable old physical identity tuple', () => {
  const composition = fs.readFileSync(path.join(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const handoffStore = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/persistence/handoff-b-acceptance-store.js'), 'utf8');
  const aftercareStore = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/persistence/aftercare-store.js'), 'utf8');
  assert.match(composition,
    /arcaConstruction\.createPlanningRegistration\([\s\S]*?computeBoundedMaterialFingerprintSync,now/);
  for (const column of [
    'mount_scope_id', 'inode', 'size_bytes', 'fingerprint_algorithm',
    'fingerprint_version', 'content_fingerprint',
  ]) {
    assert.ok(handoffStore.includes(`'${column}'`), column);
    assert.ok(aftercareStore.includes(`'${column}'`), column);
  }
  assert.match(handoffStore, /physicalIdentity:item\.physicalIdentity/);
  assert.match(handoffStore, /mount_scope_id:item\.physicalIdentity\.mountScopeId/);
});

test('Shelf Deregistration settles Aftercare Workspace through a dedicated Capability Work before invalidation', () => {
  const planner = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/planning/aftercare-planners.js'), 'utf8');
  const settlement = planner.slice(planner.indexOf('function createCareDeregistrationSettlementPlanner'));
  assert.match(settlement, /C\.workspaceReclaim,'workspace_reclaim'/);
  assert.doesNotMatch(settlement.slice(0, settlement.indexOf('module.exports')), /C\.caseCommit/);
  const aftercare = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/application/aftercare-process-coordinator.js'), 'utf8');
  assert.ok(aftercare.indexOf("caseWork(c,'care_deregistration_settlement',care)") <
    aftercare.indexOf("store.terminateCase(care.aftercareCaseId,'invalidated')"));
  const deregistration = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/application/shelf-deregistration-coordinator.js'), 'utf8');
  assert.match(deregistration, /aftercareCoordinator\.stopForShelfDeregistration/);
  assert.doesNotMatch(deregistration, /terminateCase/);
});

test('Aftercare Coordinator stays above Planner, Runtime, Governor, Capability and cross-owner repositories', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/application/aftercare-process-coordinator.js'), 'utf8');
  for (const forbidden of [
    '/capabilities/', 'event-runtime', 'resource-governor', '/planning/',
    '/procurement/', '/libra/', 'sqlite', 'ffmpeg', 'dispatcher',
  ]) assert.equal(source.toLowerCase().includes(forbidden), false, forbidden);
});

test('clean schema enforces one non-terminal Aftercare Case per Shelf Entry', () => {
  const ddl = fs.readFileSync(path.join(__dirname,
    '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
  assert.match(ddl,
    /CREATE UNIQUE INDEX "uidx_arca_aftercare_cases_partial_02" ON "arca_aftercare_cases" \("shelf_entry_id"\) WHERE "terminal_at_ms" IS NULL/);
});
