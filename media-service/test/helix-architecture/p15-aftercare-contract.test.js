'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
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

test('Aftercare Case closure reclaims Workspace before publishing resolved Case Result', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../src/helix/domains/arca/planning/aftercare-planners.js'), 'utf8');
  const closure = source.slice(source.indexOf('function createCareCaseClosurePlanner'));
  assert.ok(closure.indexOf("C.workspaceReclaim,'workspace_reclaim'") <
    closure.indexOf("C.caseCommit,'case_commit'"));
  assert.match(closure, /C\.caseCommit[\s\S]*eventId:reclaim,satisfaction:'success'/);
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
