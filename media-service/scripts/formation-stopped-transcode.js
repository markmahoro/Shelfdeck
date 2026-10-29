'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { validateTerminationSnapshot } = require('../src/helix/foundation/execution/stopped-execution-termination');
const { computeBoundedMaterialFingerprintSync } = require('../src/helix/integrations/bounded-material-fingerprint');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function readStoppedSnapshot(db, eventId) {
  const event = db.prepare('SELECT * FROM fx_workflow_events WHERE event_id=?').get(eventId);
  if (!event) fail('STOPPED_EXECUTION_NOT_FOUND', 'Stopped execution is missing.');
  const attempts = db.prepare('SELECT * FROM fx_event_attempts WHERE event_id=? ORDER BY ordinal').all(eventId);
  const effects = attempts.filter(row => row.state === 'executing').flatMap(row =>
    db.prepare('SELECT * FROM fx_effect_journal WHERE event_attempt_id=?').all(row.event_attempt_id));
  return validateTerminationSnapshot({event, attempts, effects,
    work:db.prepare('SELECT * FROM fx_supporting_works WHERE work_id=?').get(event.work_id),
    plan:db.prepare('SELECT * FROM fx_workflow_plans WHERE plan_id=?').get(event.plan_id),
    workAttempt:db.prepare('SELECT * FROM fx_work_attempts WHERE attempt_id=?').get(event.attempt_id),
    node:db.prepare('SELECT * FROM fx_plan_nodes WHERE plan_id=? AND node_id=?').get(event.plan_id, event.node_id),
    markers:effects.flatMap(row => db.prepare('SELECT * FROM fx_commit_markers WHERE effect_id=?').all(row.effect_id)),
    results:db.prepare('SELECT * FROM fx_event_result_bindings WHERE event_id=?').all(eventId),
  });
}

// Read-only physical observation. Administrative termination retains every byte;
// this never invokes FFmpeg, registers a product, removes partials or follows links.
function observeStoppedTranscode(db, workspaceRoot, snapshot) {
  if (snapshot.event.capability_ref !== 'libra.media.transcode@1' || snapshot.work.owner_domain !== 'libra' ||
      snapshot.work.process_type !== 'libra_run') fail('RESET_EXECUTION_KIND_UNSUPPORTED', 'Only a frozen Libra transcode can be terminated here.');
  const bindings = JSON.parse(snapshot.node.input_bindings_json).bindings;
  if (!Array.isArray(bindings) || bindings.length !== 5 || bindings.some(row => row.bindingKind !== 'literal') ||
      new Set(bindings.map(row => row.portName)).size !== 5)
    fail('RESET_EXECUTION_INPUT_UNPROVEN', 'Transcode does not have the complete frozen literal input set.');
  const inputs = Object.fromEntries(bindings.map(row => [row.portName, row.value]));
  const attempt = snapshot.attempts.find(row => row.state === 'executing');
  if (canonicalDigest(inputs) !== attempt.input_snapshot_digest)
    fail('RESET_EXECUTION_INPUT_UNPROVEN', 'Frozen transcode input differs from its executed Attempt.');
  const target = inputs.workspaceMediaOutputTarget;
  const {targetDigest, ...targetValue} = target || {};
  if (!target || canonicalDigest(targetValue) !== targetDigest || target.libraRunId !== snapshot.work.process_id ||
      !/^[a-f0-9]{64}$/.test(target.workspaceId) || target.outputRole !== 'product_media' ||
      inputs.encodeIntent?.intentDigest !== target.productionIntentDigest ||
      typeof target.targetRelativePath !== 'string' ||
      !/^[^\\:]+$/.test(target.targetRelativePath) || path.posix.isAbsolute(target.targetRelativePath) ||
      target.targetRelativePath.split('/').some(part => !part || part === '.' || part === '..'))
    fail('RESET_EXECUTION_TARGET_UNPROVEN', 'Transcode output is not one exact private Workspace target.');
  const workspace = db.prepare('SELECT * FROM libra_workspaces WHERE workspace_id=?').get(target.workspaceId);
  const registry = db.prepare('SELECT * FROM fx_workspace_registry WHERE workspace_id=?').get(target.workspaceId);
  const root = db.prepare('SELECT * FROM platform_workspace_roots WHERE root_id=?').get(target.rootSnapshot?.rootId);
  if (!workspace || !registry || !root || workspace.libra_run_id !== target.libraRunId || workspace.state !== 'active' ||
      registry.owner_domain !== 'libra' || registry.process_type !== 'libra_run' || registry.process_id !== target.libraRunId ||
      registry.state !== 'active' || registry.root_handle_ref !== workspace.root_handle_ref ||
      workspace.root_handle_ref !== target.rootSnapshot.rootHandleRef ||
      workspace.workspace_scope_digest !== target.workspaceScopeDigest ||
      workspace.current_revision !== target.expectedWorkspaceRevision || workspace.state_digest !== target.expectedWorkspaceStateDigest ||
      workspace.platform_workspace_snapshot_digest !== target.rootSnapshot.snapshotDigest ||
      path.resolve(root.resolved_root) !== path.resolve(workspaceRoot) || root.state !== 'active' ||
      root.owner_scope !== 'libra' || root.root_handle_ref !== target.rootSnapshot.rootHandleRef ||
      root.snapshot_digest !== target.rootSnapshot.snapshotDigest)
    fail('RESET_EXECUTION_WORKSPACE_UNPROVEN', 'Stopped transcode has no current registered private Workspace.');
  const registered = db.prepare('SELECT * FROM fx_workspace_materials WHERE workspace_id=? AND relative_path=?')
    .get(target.workspaceId, target.targetRelativePath);
  if (registered) fail('RESET_EXECUTION_OUTPUT_REGISTERED', 'Registered transcode output requires its existing completion proof.');
  const absoluteRoot = path.resolve(workspaceRoot), directory = path.resolve(absoluteRoot, target.workspaceId);
  const location = path.resolve(directory, ...target.targetRelativePath.split('/'));
  if (!location.startsWith(directory + path.sep)) fail('RESET_EXECUTION_TARGET_UNPROVEN', 'Output escaped its private Workspace.');
  const directories = [absoluteRoot, directory];
  for (const part of target.targetRelativePath.split('/').slice(0,-1)) directories.push(path.join(directories.at(-1), part));
  let absentParent = false;
  for (const candidate of directories) {
    let stat;
    try { stat = fs.lstatSync(candidate); } catch (error) { if (error.code === 'ENOENT') { absentParent = true; break; } throw error; }
    const normalizePath = value => process.platform === 'win32' ? value.toLowerCase() : value;
    if (!stat.isDirectory() || stat.isSymbolicLink() || normalizePath(fs.realpathSync.native(candidate)) !== normalizePath(candidate))
      fail('RESET_EXECUTION_WORKSPACE_UNSAFE', 'Workspace contains an alias, link or non-directory.');
  }
  const basename = path.basename(location), temporary = basename + '.partial-' + snapshot.effects[0].effect_id.slice(0,16);
  const names = absentParent ? [] : fs.readdirSync(path.dirname(location)).filter(name => name === basename || name.startsWith(temporary));
  if (names.length > 32) fail('RESET_EXECUTION_REALITY_UNBOUNDED', 'Too many files belong to this private output attempt.');
  const files = names.sort().map(name => {
    const filename = path.join(path.dirname(location), name);
    const stat = fs.lstatSync(filename, {bigint:true});
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n)
      fail('RESET_EXECUTION_WORKSPACE_UNSAFE', 'Output is not an isolated regular file.');
    const observation = computeBoundedMaterialFingerprintSync(filename, {requireStableSnapshot:true});
    return {relativePath:path.posix.join(path.posix.dirname(target.targetRelativePath), name),
      inode:String(observation.stat.ino), bytes:Number(observation.stat.size),
      mtimeNs:String(observation.stat.mtimeNs), ctimeNs:String(observation.stat.ctimeNs),
      fingerprint:observation.contentFingerprint};
  });
  const reality = {schema:'shelfdeck.stopped-transcode-reality@1', disposition:'retained_private_workspace',
    workspaceId:target.workspaceId, targetDigest, rootDigest:canonicalDigest(root),
    workspaceDigest:canonicalDigest(workspace), registryDigest:canonicalDigest(registry), files};
  if (Buffer.byteLength(canonicalJson(reality)) > 8192)
    fail('RESET_EXECUTION_REALITY_UNBOUNDED', 'Private output evidence exceeds the bounded termination receipt.');
  return reality;
}

function inspectStoppedTranscodes(db, workspaceRoot, runs, executingEvents) {
  const selected = new Set(runs.map(row => row.libra_run_id)), terminations = [];
  if (!workspaceRoot) return terminations;
  for (const event of executingEvents) {
    try {
      const snapshot = readStoppedSnapshot(db, event.event_id);
      if (!selected.has(snapshot.work.process_id)) continue;
      const reality = observeStoppedTranscode(db, workspaceRoot, snapshot);
      terminations.push({eventId:event.event_id, effectId:snapshot.effects[0].effect_id,
        snapshotDigest:snapshot.snapshotDigest, realityDigest:canonicalDigest(reality), reality});
    } catch (error) {
      // The ordinary unresolved-execution blockers remain. Never classify an
      // unsupported, corrupt or unobservable effect as administratively safe.
      if (!error.code) throw error;
    }
  }
  return terminations;
}

module.exports = Object.freeze({readStoppedSnapshot, observeStoppedTranscode, inspectStoppedTranscodes});
