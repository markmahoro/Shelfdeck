'use strict';

/**
 * Read-only production diagnostics for the currently visible Formation work.
 *
 * This command reads exact business/execution facts and container processes.
 * It never changes SQLite, media files, Workspace files, or container state.
 */

const path = require('node:path');
const { Client } = require(path.join(__dirname, '..', 'tools', 'node_modules', 'ssh2'));
const { loadNasSshConfig } = require(path.join(__dirname, '..', 'tools', 'nas-ssh-config'));

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function run(connection, command) {
  return new Promise((resolve, reject) => {
    let output = '';
    let errorOutput = '';
    connection.exec(command, { pty:true }, (error, stream) => {
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
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { computeBoundedMaterialFingerprintSync } = require('/app/src/helix/integrations/bounded-material-fingerprint');
const database = new Database('/app/data/shelfdeck.db', { readonly:true, fileMustExist:true });
const all = (sql, parameters = []) => database.prepare(sql).all(...parameters);
const one = (sql, parameters = []) => database.prepare(sql).get(...parameters);
const parse = (value) => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
const pick = (value) => {
  const result = value?.result && typeof value.result === 'object' ? value.result : value;
  if (!result || typeof result !== 'object') return null;
  const handle = result.outputHandle || result.productMediaHandle || result.artifactHandle || null;
  return {
    result:result.result || null,
    resultKind:result.resultKind || null,
    candidateKind:result.candidateKind || null,
    reasonCode:result.reasonCode || null,
    reasonCodes:result.reasonCodes || null,
    unmetRequirementCodes:result.unmetRequirementCodes || null,
    executionDeviceClass:result.executionDeviceRef?.deviceClass || result.deviceSnapshot?.deviceClass || null,
    relativePath:handle?.relativePath || handle?.workspaceHandle?.relativePath || null,
  };
};
const nfoSignature = (location) => {
  if (!location || !/\.nfo$/i.test(location) || !fs.existsSync(location)) return null;
  const text = fs.readFileSync(location, 'utf8');
  const tags = [...text.matchAll(/<([a-zA-Z][a-zA-Z0-9_-]*)(?:\s[^>]*)?>/g)].map((match) => match[1].toLowerCase());
  const value = (name) => text.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([^<]{0,500})</' + name + '>', 'i'))?.[1]?.trim() || null;
  return { bytes:Buffer.byteLength(text), topTags:[...new Set(tags)].slice(0,80),
    generator:value('generator'),dateAdded:value('dateadded'),lockData:value('lockdata') };
};
try {
  const projections = all("SELECT subject_id,display_identity,classification,next_action_label,next_action_state,current_libra_run_id,current_package_id,current_offer_id,updated_at_ms FROM libra_formation_projections WHERE classification='in_progress' AND (current_libra_run_id IS NOT NULL OR current_package_id IS NOT NULL) ORDER BY added_at_ms DESC LIMIT 25");
  const subjects = projections.map((row) => row.subject_id);
  const subjectMarks = subjects.map(() => '?').join(',') || "''";
  const runs = subjects.length ? all('SELECT libra_run_id,subject_id,state,state_revision,package_revision_head,created_at_ms,terminal_at_ms FROM libra_runs WHERE subject_id IN (' + subjectMarks + ') ORDER BY subject_id,created_at_ms', subjects) : [];
  const packages = subjects.length ? all('SELECT on_deck_package_id,offer_id,libra_run_id,subject_id,state,published_at_ms FROM libra_product_packages WHERE subject_id IN (' + subjectMarks + ') ORDER BY subject_id,published_at_ms', subjects) : [];
  const packageIds = packages.map((row) => row.on_deck_package_id);
  const packageMarks = packageIds.map(() => '?').join(',') || "''";
  const packageMaterials = packageIds.length ? all('SELECT on_deck_package_id,material_key,role,size_bytes,content_fingerprint,location,workspace_handle_json FROM libra_product_package_materials WHERE on_deck_package_id IN (' + packageMarks + ')', packageIds) : [];
  const offloadMaterials = packageIds.length ? all('SELECT on_deck_package_id,material_key,context_role,disposition_kind,location,size_bytes,content_fingerprint,settlement_expectation FROM libra_offload_context_materials WHERE on_deck_package_id IN (' + packageMarks + ')', packageIds) : [];
  const custodies = packageIds.length ? all('SELECT custody_id,on_deck_package_id,state,accepted_at_ms FROM arca_ondeck_custodies WHERE on_deck_package_id IN (' + packageMarks + ')', packageIds) : [];
  const custodyIds = custodies.map((row) => row.custody_id);
  const custodyMarks = custodyIds.map(() => '?').join(',') || "''";
  const onDeckRuns = custodyIds.length ? all('SELECT on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms FROM arca_ondeck_runs WHERE custody_id IN (' + custodyMarks + ')', custodyIds) : [];
  const onDeckIds = onDeckRuns.map((row) => row.on_deck_run_id);
  const onDeckMarks = onDeckIds.map(() => '?').join(',') || "''";
  const finalDecisions = onDeckIds.length ? all('SELECT on_deck_run_id,target_location,decision_json FROM arca_final_inventory_decisions WHERE on_deck_run_id IN (' + onDeckMarks + ')', onDeckIds) : [];
  const processIds = [...new Set([...runs.map((row) => row.libra_run_id), ...onDeckRuns.map((row) => row.on_deck_run_id)])];
  const processMarks = processIds.map(() => '?').join(',') || "''";
  const works = processIds.length ? all('SELECT work_id,owner_domain,process_type,process_id,work_kind,state,created_at_ms,updated_at_ms FROM fx_supporting_works WHERE process_id IN (' + processMarks + ') ORDER BY process_id,created_at_ms', processIds) : [];
  const workIds = works.map((row) => row.work_id);
  const workMarks = workIds.map(() => '?').join(',') || "''";
  const attempts = workIds.length ? all('SELECT attempt_id,work_id,ordinal,state,started_at_ms,finished_at_ms,failure_code FROM fx_work_attempts WHERE work_id IN (' + workMarks + ') ORDER BY work_id,ordinal', workIds) : [];
  const events = workIds.length ? all('SELECT e.event_id,e.work_id,e.attempt_id,e.capability_ref,e.state,e.ready_at_ms,e.retry_at_ms,e.current_progress_revision,' +
    'ea.event_attempt_id,ea.state AS event_attempt_state,ea.outcome_kind,ea.failure_class,ea.failure_code,ea.started_at_ms,ea.finished_at_ms,' +
    'p.mode AS progress_mode,p.current_value,p.total_value,p.unit,p.rate,p.eta_ms,p.progress_bucket,p.sampled_at_ms,' +
    'b.outcome_kind AS result_outcome_kind,b.result_json,b.committed_at_ms AS result_committed_at_ms,' +
    'x.effect_class,x.state AS effect_state,x.updated_at_ms AS effect_updated_at_ms ' +
    'FROM fx_workflow_events e ' +
    "LEFT JOIN fx_event_attempts ea ON ea.event_id=e.event_id AND (ea.state='executing' OR ea.ordinal=(SELECT MAX(ea2.ordinal) FROM fx_event_attempts ea2 WHERE ea2.event_id=e.event_id)) " +
    'LEFT JOIN fx_event_progress p ON p.event_id=e.event_id AND p.revision=e.current_progress_revision ' +
    'LEFT JOIN fx_event_result_bindings b ON b.event_id=e.event_id ' +
    'LEFT JOIN fx_effect_journal x ON x.event_attempt_id=ea.event_attempt_id ' +
    'WHERE e.work_id IN (' + workMarks + ') ORDER BY e.work_id,e.event_id', workIds) : [];
  const workspaces = runs.length ? all('SELECT workspace_id,libra_run_id,state,current_revision,created_at_ms FROM libra_workspaces WHERE libra_run_id IN (' + runs.map(() => '?').join(',') + ')', runs.map((row) => row.libra_run_id)) : [];
  const workspaceIds = workspaces.map((row) => row.workspace_id);
  const workspaceMarks = workspaceIds.map(() => '?').join(',') || "''";
  const workspaceRefs = workspaceIds.length ? all("SELECT workspace_id,libra_run_id,reference_id,reference_state,workspace_handle_json,committed_at_ms FROM libra_workspace_material_refs WHERE workspace_id IN (" + workspaceMarks + ") AND reference_state IN ('working','product_staging') ORDER BY workspace_id,committed_at_ms", workspaceIds) : [];
  const items = projections.map((projection) => {
    const subjectRuns = runs.filter((row) => row.subject_id === projection.subject_id);
    const subjectPackages = packages.filter((row) => row.subject_id === projection.subject_id);
    const subjectCustodies = custodies.filter((row) => subjectPackages.some((pkg) => pkg.on_deck_package_id === row.on_deck_package_id));
    const subjectOffloadMaterials = offloadMaterials.filter((row) => subjectPackages.some((pkg) => pkg.on_deck_package_id === row.on_deck_package_id));
    const subjectOnDeckRuns = onDeckRuns.filter((row) => subjectCustodies.some((custody) => custody.custody_id === row.custody_id));
    const subjectFinalDecisions = finalDecisions.filter((row) => subjectOnDeckRuns.some((run) => run.on_deck_run_id === row.on_deck_run_id)).map((row) => {
      const decision = parse(row.decision_json);
      return { onDeckRunId:row.on_deck_run_id,targetLocation:row.target_location,members:(decision?.members || []).map((member) => {
        const expected = packageMaterials.find((material) => subjectPackages.some((pkg) => pkg.on_deck_package_id === material.on_deck_package_id) && material.material_key === member.sourceMaterialKey);
        const workspaceHandle = parse(expected?.workspace_handle_json);
        const expectedLocation = workspaceHandle?.workspaceId && workspaceHandle?.relativePath
          ? path.resolve('/transcode', workspaceHandle.workspaceId, ...workspaceHandle.relativePath.split('/'))
          : expected?.location || null;
        let observed = null;
        try { const value=computeBoundedMaterialFingerprintSync(member.targetLocation); observed={ exists:true,sizeBytes:Number(value.stat.size),
          modifiedAtMs:Number(value.stat.mtimeMs),contentFingerprint:value.contentFingerprint }; }
        catch (error) { observed={ exists:false,errorCode:error.code || error.details?.causeCode || error.name }; }
        return { sourceMaterialKey:member.sourceMaterialKey,role:member.role,targetLocation:member.targetLocation,
          expectedSizeBytes:member.sizeBytes,expectedFingerprint:expected?.content_fingerprint || null,
          expectedLocation,nfoSignatures:{ expected:nfoSignature(expectedLocation),observed:nfoSignature(member.targetLocation) },observed };
      }) };
    });
    const ids = new Set([...subjectRuns.map((row) => row.libra_run_id), ...subjectOnDeckRuns.map((row) => row.on_deck_run_id)]);
    const subjectWorks = works.filter((row) => ids.has(row.process_id));
    const subjectWorkIds = new Set(subjectWorks.map((row) => row.work_id));
    const subjectAttempts = attempts.filter((row) => subjectWorkIds.has(row.work_id));
    const subjectEvents = events.filter((row) => subjectWorkIds.has(row.work_id)).map((row) => ({
      ...Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'result_json')),
      result:pick(parse(row.result_json)),
    }));
    const subjectWorkspaces = workspaces.filter((row) => subjectRuns.some((run) => run.libra_run_id === row.libra_run_id));
    const subjectWorkspaceIds = new Set(subjectWorkspaces.map((row) => row.workspace_id));
    const refs = workspaceRefs.filter((row) => subjectWorkspaceIds.has(row.workspace_id)).map((row) => {
      const handle = parse(row.workspace_handle_json);
      const relativePath = handle?.relativePath || null;
      const location = handle?.workspaceId && relativePath ? path.resolve('/transcode', handle.workspaceId, ...relativePath.split('/')) : null;
      let file = null;
      if (location) {
        try { const stat=fs.statSync(location); file={ location,exists:true,sizeBytes:stat.size,modifiedAtMs:Math.trunc(stat.mtimeMs) }; }
        catch (error) { file={ location,exists:false,errorCode:error.code || error.name }; }
      }
      return { workspaceId:row.workspace_id,referenceId:row.reference_id,referenceState:row.reference_state,committedAtMs:row.committed_at_ms,file };
    });
    return { projection, runs:subjectRuns, packages:subjectPackages, custodies:subjectCustodies, onDeckRuns:subjectOnDeckRuns,
      finalDecisions:subjectFinalDecisions,offloadMaterials:subjectOffloadMaterials,
      works:subjectWorks, attempts:subjectAttempts, events:subjectEvents, workspaces:subjectWorkspaces, workspaceRefs:refs };
  });
  let processes = '';
  try { processes = execFileSync('sh', ['-lc', "ps -eo pid,etimes,args | grep -E '[f]fmpeg|[f]fprobe' || true"], { encoding:'utf8' }).trim(); }
  catch (error) { processes = 'process_read_failed:' + (error.code || error.name); }
  const nowMs = Date.now();
  const compactItems = items.map((item) => ({
    projection:item.projection,
    runs:item.runs,
    packages:item.packages,
    custodies:item.custodies,
    onDeckRuns:item.onDeckRuns,
    finalDecisions:item.finalDecisions,
    offloadMaterials:item.offloadMaterials,
    activeWorks:item.works.filter((row) => !['succeeded','failed','cancelled'].includes(row.state))
      .map((row) => ({ ...row, ageMs:nowMs-Number(row.updated_at_ms) })),
    activeAttempts:item.attempts.filter((row) => ['ready','running','blocked'].includes(row.state))
      .map((row) => ({ ...row, ageMs:nowMs-Number(row.started_at_ms || nowMs) })),
    relevantEvents:item.events.filter((row) => !['succeeded','skipped','cancelled'].includes(row.state) ||
      ['shared.material.media.probe@1','libra.product_media.verify@1','libra.transcode.input.verify@1','libra.media.transcode@1'].includes(row.capability_ref))
      .map((row) => ({ eventId:row.event_id, workId:row.work_id, capabilityRef:row.capability_ref,
        state:row.state, eventAttemptState:row.event_attempt_state, outcomeKind:row.outcome_kind,
        failureClass:row.failure_class, failureCode:row.failure_code, result:row.result,
        progress:row.progress_mode ? { mode:row.progress_mode,currentValue:row.current_value,totalValue:row.total_value,
          unit:row.unit,rate:row.rate,etaMs:row.eta_ms,bucket:row.progress_bucket,sampledAtMs:row.sampled_at_ms } : null,
        effectClass:row.effect_class,effectState:row.effect_state,
        ageMs:nowMs-Number(row.sampled_at_ms || row.started_at_ms || row.ready_at_ms || nowMs) })),
    workspaces:item.workspaces,
    workspaceRefs:item.workspaceRefs.filter((row) => row.referenceState !== 'released')
      .map((row) => ({ referenceState:row.referenceState,file:row.file })),
  }));
  console.log(JSON.stringify({ generatedAt:new Date(nowMs).toISOString(), items:compactItems, processes:processes.split(/\\r?\\n/).filter(Boolean),
    activeAttemptCount:one("SELECT COUNT(*) AS count FROM fx_work_attempts WHERE state IN ('ready','running','blocked')"),
    integrity:one('PRAGMA integrity_check') }, null, 2));
} finally { database.close(); }
`;
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return `docker exec shelfdeck sh -lc ${shellQuote(`echo ${encoded} | base64 -d | node`)}`;
}

async function main() {
  if (process.argv.includes('--apply')) throw new Error('This diagnostic is read-only.');
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
    process.stdout.write(result.output);
  } finally {
    connection.end();
  }
}

main().catch((error) => {
  console.error(`FORMATION ACTIVE DIAGNOSTICS FAILED: ${error.message}`);
  process.exitCode = 1;
});
