'use strict';

// Test-only continuation runner for a canary whose Node process stopped after
// durable Observation/Triage facts were committed. It never creates a new
// Field, Run, Work, Event, Candidate, or Offer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { writeAdminCredentialSecret } = require('../src/admin-credential-secret-store');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { FINGERPRINT_SAMPLE_BYTES } = require('../src/helix/integrations/bounded-material-fingerprint');

function emit(kind, value = {}) {
  process.stdout.write(`${JSON.stringify({ kind, at: new Date().toISOString(), ...value })}\n`);
}
function size(location) { try { return fs.statSync(location).size; } catch { return 0; } }
function grouped(database, table, column) {
  return database.prepare(`SELECT ${column} state,count(*) count FROM ${table} GROUP BY ${column} ORDER BY ${column}`).all();
}
function count(database, table) { return database.prepare(`SELECT count(*) count FROM ${table}`).get().count; }
function sourceReality(root) {
  const pending = [root];
  const facts = [];
  while (pending.length) {
    const directory = pending.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(Buffer.from(left.name, 'utf8'), Buffer.from(right.name, 'utf8')));
    for (const entry of entries) {
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { pending.push(location); continue; }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(location, { bigint: true });
      facts.push([path.relative(root, location).replace(/\\/g, '/'), String(stat.ino), String(stat.size), String(stat.mtimeNs), String(stat.ctimeNs)]);
    }
  }
  facts.sort((left, right) => Buffer.compare(Buffer.from(left[0], 'utf8'), Buffer.from(right[0], 'utf8')));
  return Object.freeze({ regularFileCount: facts.length, digest: canonicalDigest({ schema: 'helix.canary.source-reality@1', facts }) });
}
function snapshot(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const runs = grouped(database, 'proc_procurement_runs', 'state');
    const works = grouped(database, 'fx_supporting_works', 'state');
    return {
      observations: database.prepare('SELECT count(*) count FROM proc_field_observations').get().count,
      materials: database.prepare('SELECT count(*) count FROM proc_field_materials').get().count,
      observationWorkState: database.prepare("SELECT state FROM fx_supporting_works WHERE work_kind='field_observation' ORDER BY created_at_ms DESC LIMIT 1").get()?.state || null,
      runs, runCount: runs.reduce((total, row) => total + row.count, 0), sealedRuns: runs.find((row) => row.state === 'sealed')?.count || 0,
      works,
      plans: count(database, 'fx_workflow_plans'), events: grouped(database, 'fx_workflow_events', 'state'),
      attempts: count(database, 'fx_event_attempts'), results: count(database, 'fx_event_result_bindings'),
      resourceTimings: count(database, 'fx_event_resource_timings'), resourceDefers: count(database, 'fx_resource_defer'),
      structurePages: database.prepare("SELECT count(*) count FROM fx_event_result_bindings WHERE outcome_kind='succeeded' AND result_schema_ref='helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result'").get().count,
      candidates: count(database, 'proc_candidate_packages'),
      offers: database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state='open'").get().count,
      consumedOffers: database.prepare("SELECT count(*) count FROM proc_candidate_deliveries WHERE state!='open'").get().count,
      libraFacts: count(database, 'libra_subjects') + count(database, 'libra_runs') + count(database, 'libra_material_bindings'),
      arcaFacts: count(database, 'arca_shelf_entries') + count(database, 'arca_ondeck_runs') + count(database, 'arca_material_bindings') + count(database, 'arca_deck_fact_revisions'),
      failedWorks: database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE state='failed'").get().count,
      failedEvents: database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE state='failed'").get().count,
      dbBytes: size(databasePath), walBytes: size(`${databasePath}-wal`),
    };
  } finally { database.close(); }
}
function terminal(value) {
  const open = new Set(['admitted', 'ready', 'running', 'blocked']);
  return value.observations > 0 && value.runs.length > 0 && value.runs.every((row) => row.state === 'sealed') && value.works.every((row) => !open.has(row.state));
}
function rotateResumeCredential(dataDir) {
  const secretRoot = `helix-local-canary-resume-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const apiKey = `sd_resume_${crypto.randomBytes(32).toString('base64url')}`;
  const signingSecret = crypto.randomBytes(48).toString('base64url');
  const staging = path.join(dataDir, `.resume-secret-${process.pid}`);
  const target = path.join(dataDir, 'admin-credential-secret.json');
  const backup = path.join(dataDir, `admin-credential-secret.resume-backup-${Date.now()}.json`);
  fs.mkdirSync(staging, { recursive: true });
  try {
    writeAdminCredentialSecret({ dataDir: staging, revision: 1, apiKey, signingSecret, secretRoot });
    fs.renameSync(target, backup);
    fs.renameSync(path.join(staging, 'admin-credential-secret.json'), target);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  }
  return Object.freeze({ secretRoot, backup, apiKeyDigest: canonicalDigest(apiKey) });
}

async function main() {
  const root = path.resolve(process.argv[2] || '');
  const canaryRoot = path.resolve(process.argv[3] || '');
  if (!root || !canaryRoot || !fs.statSync(root).isDirectory() || !fs.statSync(canaryRoot).isDirectory()) {
    throw new Error('Usage: node scripts/helix-local-procurement-canary-resume.js <movie-field-root> <canary-root>');
  }
  const dataDir = path.join(canaryRoot, 'data');
  const adminDistDir = path.join(canaryRoot, 'admin');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath) || !fs.existsSync(path.join(adminDistDir, 'index.html'))) throw new Error('CANARY_RESUME_ROOT_INVALID');
  const sourceBefore = sourceReality(root);
  const fingerprintReads = new Map();
  let logicalReadBytes = 0;
  let readCalls = 0;
  function onFingerprintRead(read) {
    if (read.requestedBytes > FINGERPRINT_SAMPLE_BYTES || read.bytesRead > FINGERPRINT_SAMPLE_BYTES) throw Object.assign(new Error('Physical Material read exceeded 256 KiB.'), { code: 'CANARY_FINGERPRINT_READ_LIMIT_EXCEEDED' });
    const next = (fingerprintReads.get(read.location) || 0) + read.bytesRead;
    fingerprintReads.set(read.location, next);
    logicalReadBytes += read.bytesRead;
    readCalls += 1;
    if (next > FINGERPRINT_SAMPLE_BYTES || logicalReadBytes > fingerprintReads.size * FINGERPRINT_SAMPLE_BYTES) throw Object.assign(new Error('Canary cumulative Physical Material read exceeded N x 256 KiB.'), { code: 'CANARY_FINGERPRINT_TOTAL_LIMIT_EXCEEDED' });
  }
  const credential = rotateResumeCredential(dataDir);
  let runtimeError = null;
  const startedAt = Date.now();
  const hostOptions = { dataDir, adminDistDir, secretRoot: credential.secretRoot, onPhysicalMaterialFingerprintRead: onFingerprintRead, onExecutionRuntimeError(error) { runtimeError = error; emit('runtime_error', { code: error.code || error.name, message: error.message }); } };
  let host = await createCleanServiceHost(hostOptions);
  let closing = false;
  async function close() { if (closing) return; closing = true; await host.close(); }
  process.once('SIGINT', () => close().finally(() => process.exit(130)));
  process.once('SIGTERM', () => close().finally(() => process.exit(143)));
  emit('resume_started', { root, canaryRoot, databasePath, sourceBefore, credentialBackup: credential.backup, preResume: snapshot(databasePath) });
  try {
    let previousAt = Date.now();
    let previousReadBytes = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      const now = Date.now();
      const facts = snapshot(databasePath);
      const memory = process.memoryUsage();
      emit('progress', { ...facts, logicalReadBytes, fingerprintedRegularFiles: fingerprintReads.size, readCalls, fingerprintBytesPerSecond: Math.round((logicalReadBytes - previousReadBytes) / ((now - previousAt) / 1000)), maximumAllowedReadBytes: fingerprintReads.size * FINGERPRINT_SAMPLE_BYTES, rssBytes: memory.rss, heapUsedBytes: memory.heapUsed });
      previousAt = now; previousReadBytes = logicalReadBytes;
      if (runtimeError) throw runtimeError;
      if (facts.failedWorks > 0 || facts.failedEvents > 0) throw Object.assign(new Error('Foundation Work or Event failed during resumed Canary.'), { code: 'CANARY_FOUNDATION_FAILURE' });
      if (facts.consumedOffers > 0 || facts.libraFacts > 0 || facts.arcaFacts > 0) throw Object.assign(new Error('Canary crossed the Handoff A Ready boundary.'), { code: 'CANARY_SCOPE_BOUNDARY_VIOLATION' });
      if (memory.rss > 2 * 1024 * 1024 * 1024) throw Object.assign(new Error('Canary RSS exceeded 2 GiB.'), { code: 'CANARY_RSS_LIMIT_EXCEEDED' });
      if (terminal(facts)) {
        const sourceAfter = sourceReality(root);
        if (sourceAfter.digest !== sourceBefore.digest || sourceAfter.regularFileCount !== sourceBefore.regularFileCount) throw Object.assign(new Error('Movie Field reality changed during resumed read-only Canary.'), { code: 'CANARY_SOURCE_REALITY_CHANGED' });
        const database = new Database(databasePath, { readonly: true });
        const integrity = database.pragma('integrity_check', { simple: true });
        database.close();
        if (integrity !== 'ok') throw Object.assign(new Error('Resumed Canary database integrity_check failed.'), { code: 'CANARY_DATABASE_INTEGRITY_FAILED' });
        emit('complete', { ...facts, sourceAfter, sourceBefore, restarted: true, elapsedMs: Date.now() - startedAt, credentialBackup: credential.backup });
        break;
      }
    }
  } finally { await close(); }
}
main().catch((error) => { emit('fatal', { code: error.code || error.name, message: error.message, stack: error.stack }); process.exitCode = 1; });
