'use strict';

/**
 * Read-only diagnostics for Clean Helix execution residual incidents on NAS.
 *
 * This command never changes SQLite or media files. It reports aggregate
 * execution coherence and performs one bounded 256 KiB read from each source
 * Material that belongs to an offloading Arca On-deck Run.
 */

const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(conn, command) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    conn.exec(command, { pty:true }, (error, stream) => {
      if (error) return reject(error);
      stream.on('close', (code) => resolve({ code, output, errorOutput }));
      stream.on('data', (chunk) => { output += chunk.toString(); });
      stream.stderr.on('data', (chunk) => { errorOutput += chunk.toString(); });
    });
  });
}

function remoteCommand() {
  const source = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const database = new Database('/app/data/shelfdeck.db', { readonly:true, fileMustExist:true });
const all = (sql, parameters = []) => database.prepare(sql).all(...parameters);
const get = (sql, parameters = []) => database.prepare(sql).get(...parameters);

function materialLocation(row) {
  if (row.location_kind === 'workspace_handle' && row.workspace_handle_json) {
    const handle = JSON.parse(row.workspace_handle_json);
    return path.resolve('/transcode', handle.workspaceId, ...String(handle.relativePath || '').split('/'));
  }
  return row.location || null;
}

function boundedRead(location) {
  if (!location) return { location:null, status:'missing_location' };
  const started = Date.now();
  let descriptor;
  try {
    const stat = fs.lstatSync(location, { bigint:true });
    if (!stat.isFile() || stat.isSymbolicLink()) return { location, status:'not_regular_file' };
    const sampleLength = Math.min(Number(stat.size), 256 * 1024);
    const sampleOffset = Math.floor((Number(stat.size) - sampleLength) / 2);
    const sample = Buffer.allocUnsafe(sampleLength);
    descriptor = fs.openSync(location, 'r');
    const bytesRead = fs.readSync(descriptor, sample, 0, sampleLength, sampleOffset);
    return { location, status:'ok', sizeBytes:Number(stat.size), bytesRead, elapsedMs:Date.now() - started };
  } catch (error) {
    return { location, status:'error', code:error.code || error.name, elapsedMs:Date.now() - started };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function boundedFingerprint(location) {
  const evidence = boundedRead(location);
  if (evidence.status !== 'ok') return evidence;
  let descriptor;
  try {
    const sampleLength = Math.min(evidence.sizeBytes, 256 * 1024);
    const sampleOffset = Math.floor((evidence.sizeBytes - sampleLength) / 2);
    const sample = Buffer.allocUnsafe(sampleLength);
    descriptor = fs.openSync(location, 'r');
    const bytesRead = fs.readSync(descriptor, sample, 0, sampleLength, sampleOffset);
    return { ...evidence, contentFingerprint:crypto.createHash('sha256').update(sample.subarray(0, bytesRead)).digest('hex') };
  } catch (error) {
    return { location, status:'error', code:error.code || error.name };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

try {
  const residuals = all(
    "SELECT w.owner_domain AS ownerDomain,w.state AS workState,a.state AS attemptState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE w.state IN ('succeeded','failed','cancelled') AND a.state IN ('ready','running','blocked') " +
    "GROUP BY w.owner_domain,w.state,a.state ORDER BY w.owner_domain,w.state,a.state"
  );
  const unsafeResiduals = get(
    "SELECT COUNT(*) AS count FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE w.state='cancelled' AND a.state IN ('ready','running','blocked') AND (" +
      "EXISTS(SELECT 1 FROM fx_workflow_events e WHERE e.attempt_id=a.attempt_id AND e.state NOT IN ('succeeded','skipped','failed','cancelled')) OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_event_attempts ea ON ea.event_id=e.event_id WHERE e.attempt_id=a.attempt_id AND ea.state='executing') OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_event_attempts ea ON ea.event_id=e.event_id JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
        "WHERE e.attempt_id=a.attempt_id AND x.state IN ('intended','effect_observed','reconcile_required')) OR " +
      "EXISTS(SELECT 1 FROM fx_workflow_events e JOIN fx_resource_defer d ON d.event_id=e.event_id WHERE e.attempt_id=a.attempt_id AND d.state='waiting'))"
  );
  const residualChildren = all(
    "SELECT e.capability_ref AS capabilityRef,e.state AS eventState,ea.state AS eventAttemptState," +
      "COALESCE(ea.outcome_kind,'none') AS outcomeKind,COALESCE(x.effect_class,'none') AS effectClass," +
      "COALESCE(x.state,'none') AS effectState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
      "LEFT JOIN fx_workflow_events e ON e.attempt_id=a.attempt_id " +
      "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id " +
      "LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
    "WHERE w.state='cancelled' AND a.state IN ('ready','running','blocked') " +
    "GROUP BY e.capability_ref,e.state,ea.state,ea.outcome_kind,x.effect_class,x.state " +
    "ORDER BY count DESC,e.capability_ref"
  );
  const activeAttempts = all(
    "SELECT w.owner_domain AS ownerDomain,w.state AS workState,a.state AS attemptState,COUNT(*) AS count " +
    "FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id " +
    "WHERE a.state IN ('ready','running','blocked') GROUP BY w.owner_domain,w.state,a.state " +
    "ORDER BY w.owner_domain,w.state,a.state"
  );
  const activeLibraWorks = all(
    "SELECT w.process_type AS processType,w.process_id AS processId,w.work_kind AS workKind," +
      "w.work_id AS workId,w.state AS workState,a.attempt_id AS attemptId,a.state AS attemptState," +
      "r.subject_id AS subjectId,r.state AS libraRunState " +
    "FROM fx_supporting_works w LEFT JOIN fx_work_attempts a ON a.work_id=w.work_id " +
      "LEFT JOIN libra_runs r ON r.libra_run_id=w.process_id " +
    "WHERE w.owner_domain='libra' AND w.state IN ('admitted','ready','running','blocked') " +
    "ORDER BY w.process_type,w.process_id,w.work_kind,w.work_id"
  );
  const arcaExecuting = all(
    "SELECT w.work_id AS workId,w.process_id AS processId,w.work_kind AS workKind,e.event_id AS eventId," +
      "e.capability_ref AS capabilityRef,e.state AS eventState,ea.event_attempt_id AS eventAttemptId," +
      "ea.started_at_ms AS startedAtMs,x.effect_id AS effectId,x.state AS effectState,x.updated_at_ms AS effectUpdatedAtMs " +
    "FROM fx_supporting_works w JOIN fx_workflow_events e ON e.work_id=w.work_id " +
      "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id AND ea.state='executing' " +
      "LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id " +
    "WHERE w.owner_domain='arca' AND w.state IN ('admitted','ready','running','blocked') " +
      "AND e.state NOT IN ('succeeded','skipped','failed','cancelled') ORDER BY w.work_id,e.event_id"
  );
  const offloading = all(
    "SELECT r.on_deck_run_id AS onDeckRunId,c.on_deck_package_id AS packageId,p.subject_id AS subjectId " +
    "FROM arca_ondeck_runs r JOIN arca_ondeck_custodies c ON c.custody_id=r.custody_id " +
      "JOIN libra_product_packages p ON p.on_deck_package_id=c.on_deck_package_id " +
    "WHERE r.state='offloading' ORDER BY r.created_at_ms"
  );
  const materialReads = [];
  const inventoryCandidates = [];
  for (const run of offloading) {
    const materials = all(
      "SELECT ordinal,role,location_kind,location,workspace_handle_json,size_bytes AS expectedSizeBytes,content_fingerprint AS expectedFingerprint " +
      "FROM libra_product_package_materials WHERE on_deck_package_id=? ORDER BY ordinal",
      [run.packageId]
    );
    materialReads.push({ onDeckRunId:run.onDeckRunId, packageId:run.packageId,
      members:materials.map((material) => ({ ordinal:material.ordinal, role:material.role,
        expectedSizeBytes:material.expectedSizeBytes, ...boundedRead(materialLocation(material)) })) });
    const directories = [...new Set(materials.filter((material) => material.location_kind !== 'workspace_handle' && material.location)
      .map((material) => path.dirname(material.location)))];
    const expected = new Map(materials.map((material) => [material.expectedFingerprint, material]));
    const candidates = [];
    for (const directory of directories) {
      let entries = [];
      try { entries = fs.readdirSync(directory, { withFileTypes:true }).filter((entry) => entry.isFile()).slice(0, 256); }
      catch (error) { candidates.push({ directory, status:'error', code:error.code || error.name }); continue; }
      for (const entry of entries) {
        const observed = boundedFingerprint(path.join(directory, entry.name));
        const match = observed.contentFingerprint ? expected.get(observed.contentFingerprint) : null;
        candidates.push({ directory, name:entry.name, status:observed.status, sizeBytes:observed.sizeBytes,
          matchedPackageOrdinal:match ? match.ordinal : null, matchedPackageRole:match ? match.role : null });
      }
    }
    inventoryCandidates.push({ onDeckRunId:run.onDeckRunId, packageId:run.packageId, candidates });
  }
  console.log(JSON.stringify({ generatedAt:new Date().toISOString(), residuals, unsafeResiduals, residualChildren,
    activeAttempts, activeLibraWorks, arcaExecuting, offloading, materialReads, inventoryCandidates }, null, 2));
} finally {
  database.close();
}
`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `docker exec shelfdeck sh -lc ${shellQuote(`echo ${encoded} | base64 -d | node`)}`;
}

function hostStorageCommand() {
  return [
    "stat -f -c 'filesystem=%T' /vol2/1000/shelfdeck_transcode 2>/dev/null || true",
    "find /vol2 -maxdepth 4 -type d \\( -iname '*snapshot*' -o -name '@Recycle' -o -name '#recycle' \\) -print 2>/dev/null | head -100",
    "btrfs subvolume list /vol2 2>/dev/null | head -100 || true",
    "find /vol2/1000/shelfdeck_transcode -maxdepth 2 -mindepth 1 -printf '%y %p %s\\n' 2>/dev/null | head -100",
  ].join('; ');
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This diagnostic is read-only and does not support --apply.');
  const connection = new Client();
  await new Promise((resolve, reject) => {
    connection.on('ready', resolve);
    connection.on('error', reject);
    connection.connect(loadNasSshConfig({ readyTimeout:15000 }));
  });
  try {
    const result = await run(connection, remoteCommand());
    if (result.errorOutput) process.stderr.write(result.errorOutput);
    if (result.code !== 0) throw new Error(`Remote diagnostic exited ${result.code}.`);
    const storage = await run(connection, hostStorageCommand());
    if (storage.errorOutput) process.stderr.write(storage.errorOutput);
    if (storage.code !== 0) throw new Error(`Host storage diagnostic exited ${storage.code}.`);
    const report = JSON.parse(result.output);
    report.hostStorage = storage.output.trim().split(/\r?\n/).filter(Boolean);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    connection.end();
  }
}

main().catch((error) => {
  console.error(`PRODUCTION HELIX DIAGNOSTICS FAILED: ${error.message}`);
  process.exitCode = 1;
});
