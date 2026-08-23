'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost, createIntegrationSecretStore } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { computeBoundedMaterialFingerprintSync } = require('../../src/helix/integrations/bounded-material-fingerprint');

const RUNS_ROOT = path.resolve('F:\\shelfdeck_test_zone\\runs');
const BASELINE_ROOT = path.resolve('F:\\shelfdeck_test_zone\\test_film');
const CREDENTIAL_RUN = path.resolve('F:\\shelfdeck_test_zone\\runs\\UAT-20260823-040740-0886b2723');
const MOVIES = Object.freeze([
  Object.freeze({ key:'update', directory:'007：大破天幕杀机 (2012)', nfoMode:'copy', posterMode:'copy' }),
  Object.freeze({ key:'rebuild', directory:'香火 (2003)', nfoMode:'damaged', posterMode:'copy' }),
  Object.freeze({ key:'create', directory:'威尼斯惊魂夜 (2023)', nfoMode:'absent', posterMode:'absent' }),
]);

function runRoot() {
  const resolved = path.resolve(process.env.SHELFDECK_FORMATION_UAT_ROOT || '');
  const relative = path.relative(RUNS_ROOT, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('SHELFDECK_FORMATION_UAT_ROOT must be a new child of the F: qualification runs root.');
  }
  return resolved;
}

function firstFile(root, predicate) {
  const found = fs.readdirSync(root, { withFileTypes:true }).filter((item)=>item.isFile()).map((item)=>item.name).find(predicate);
  if (!found) throw new Error('Required source file is absent in ' + root);
  return found;
}

function sourceDescriptor(movie) {
  const root = path.join(BASELINE_ROOT, movie.directory);
  const primary = firstFile(root, (name)=>/\.(mkv|mp4|iso)$/i.test(name));
  const nfo = fs.readdirSync(root).find((name)=>/\.nfo$/i.test(name)) || null;
  const poster = fs.readdirSync(root).find((name)=>/^poster\.(jpg|jpeg|png|webp)$/i.test(name)) || null;
  return Object.freeze({ ...movie, root, primary, nfo, poster });
}

function snapshot(files) {
  return files.map((location)=>{const stat=fs.statSync(location);const bounded=computeBoundedMaterialFingerprintSync(location);return Object.freeze({
    location, sizeBytes:stat.size, mtimeMs:stat.mtimeMs,
    fingerprintAlgorithm:bounded.fingerprintAlgorithm, fingerprintVersion:bounded.fingerprintVersion,
    contentFingerprint:bounded.contentFingerprint,
  });});
}

function buildCanary(fieldRoot) {
  const descriptors = MOVIES.map(sourceDescriptor);
  const sourceFiles = [];
  for (const movie of descriptors) {
    const target = path.join(fieldRoot, movie.directory);
    fs.mkdirSync(target, { recursive:true });
    const primarySource = path.join(movie.root, movie.primary);
    fs.linkSync(primarySource, path.join(target, movie.primary));
    sourceFiles.push(primarySource);
    if (movie.nfoMode === 'copy') {
      fs.copyFileSync(path.join(movie.root, movie.nfo), path.join(target, movie.nfo));
      sourceFiles.push(path.join(movie.root, movie.nfo));
    } else if (movie.nfoMode === 'damaged') {
      fs.writeFileSync(path.join(target, movie.nfo), '<movie><title>香火</title>\n', 'utf8');
      sourceFiles.push(path.join(movie.root, movie.nfo));
    }
    if (movie.posterMode === 'copy') {
      fs.copyFileSync(path.join(movie.root, movie.poster), path.join(target, movie.poster));
      sourceFiles.push(path.join(movie.root, movie.poster));
    }
  }
  return Object.freeze({ descriptors, sourceFiles:Object.freeze([...new Set(sourceFiles)]) });
}

function readCredential(kind) {
  const runtime = JSON.parse(fs.readFileSync(path.join(CREDENTIAL_RUN, 'private-runtime.json'), 'utf8'));
  const dataDir = path.join(CREDENTIAL_RUN, 'data');
  const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
  try {
    const row = database.prepare(`SELECT i.integration_id,i.integration_type,i.config_revision,i.config_json,
      s.secret_ref,s.secret_kind,s.encrypted_ref,s.revision
      FROM platform_integrations i JOIN platform_secret_refs s ON s.owner_scope_id=i.integration_id
      WHERE i.integration_type=? AND i.state='active' AND s.state='active'`).get(kind);
    if (!row) throw new Error('Reusable ' + kind + ' qualification credential is absent.');
    const config = JSON.parse(row.config_json);
    const bytes = createIntegrationSecretStore({ dataDir, secretRoot:runtime.secretRoot }).read(row.encrypted_ref, {
      integrationId:row.integration_id, secretRef:row.secret_ref, secretKind:row.secret_kind,
      revision:Number(row.revision), envelopeDigest:config.secretEnvelopeDigest,
    });
    const settings = kind === 'douban'
      ? Object.freeze({ userId:String(config.lastTestSummary?.identityProviderKey || '') })
      : (config.settings || {});
    return Object.freeze({ bytes, credentialKind:config.credentialKind, endpoint:config.endpoint, settings });
  } finally { database.close(); }
}

async function session(host, apiKey) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{'x-api-key':apiKey} });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function configureIntegration(host, cookie, kind, credential) {
  const tested = await host.inject({ method:'POST', url:`/v1/admin/settings/integrations/${kind}/actions/test`, headers:{cookie}, payload:{
    kind, idempotencyKey:`formation-uat-${kind}-test`, endpoint:credential.endpoint,
    credential:{kind:credential.credentialKind,value:credential.bytes.toString('utf8')}, settings:credential.settings, timeoutMs:15_000,
  }});
  credential.bytes.fill(0);
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({ method:'PATCH', url:`/v1/admin/settings/integrations/${kind}`, headers:{cookie}, payload:{
    kind, idempotencyKey:`formation-uat-${kind}-save`, expectedConfigRevision:0,
    connectionProofId:tested.json().connectionProofId,
  }});
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().configRevision, 1);
  return saved.json();
}

async function createShelf(host, cookie, root) {
  const response = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{cookie}, payload:{
    idempotencyKey:'formation-uat-shelf-create', shelfId:'formation-uat-shelf', name:'Formation UAT Shelf',
    targetRootLocation:root, ruleTemplateId:'system-beta-recommended', expectedTemplateRevision:1,
    placementPolicy:{ folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo',
      subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy:'reject' },
  }});
  assert.equal(response.statusCode, 201, response.body);
  return response.json().shelf;
}

async function createField(host, cookie, fieldId, root) {
  const policyValue = Object.freeze({ includedDirectories:[], excludedDirectories:[],
    allowedExtensions:['.mkv'], minimumSizeBytes:0,
    excludedMaterialKeys:[] });
  const access = Object.freeze({ fieldId, revision:1, endpointId:'formation-uat-shared-endpoint', rootLocation:root,
    mountScopeId:'formation-uat-shared-mount', mountScopeRevision:1,
    accessSchemaRef:'helix://e2e/formation-uat-field-access/v1' });
  const response = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{cookie}, payload:{
    idempotencyKey:`${fieldId}-create`, fieldId, name:fieldId, contentProfileHint:'movie',
    policy:{ extractionPolicyId:`${fieldId}-policy`, revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
      policyDigest:canonicalDigest({ extractionPolicyId:`${fieldId}-policy`, revision:1, ...policyValue }) },
    access:{...access,accessDigest:canonicalDigest(access)},
  }});
  assert.equal(response.statusCode, 201, response.body);
  const routing = await host.inject({ method:'PATCH', url:`/v1/admin/routing/material-fields/${fieldId}`, headers:{cookie}, payload:{
    idempotencyKey:`${fieldId}-routing`, fieldId, expectedPolicyId:null, expectedRevision:0,
    policy:{ routingPolicyId:`${fieldId}-routing-policy`, mode:'sorting', targets:[{shelfId:'formation-uat-shelf',rank:1,
      matchExpression:{nodeKind:'predicate',factKind:'content_profile',operator:'eq',expectedValue:'movie'}}] },
  }});
  assert.equal(routing.statusCode, 200, routing.body);
}

async function observe(host, cookie, fieldId) {
  const response = await host.inject({ method:'POST', url:`/v1/admin/material-fields/${fieldId}/actions/observe`, headers:{cookie}, payload:{
    idempotencyKey:`${fieldId}-observe`, fieldId, expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:32,
  }});
  assert.equal(response.statusCode, 202, response.body);
}

function counts(database) {
  return Object.freeze({
    subjects:database.prepare('SELECT COUNT(*) count FROM libra_subjects').get().count,
    activeRuns:database.prepare("SELECT COUNT(*) count FROM libra_runs WHERE state IN ('active','suspended','frozen')").get().count,
    totalRuns:database.prepare('SELECT COUNT(*) count FROM libra_runs').get().count,
    candidates:database.prepare('SELECT COUNT(*) count FROM proc_candidate_packages').get().count,
    currentControls:database.prepare("SELECT COUNT(*) count FROM fx_material_controls WHERE state='controlled'").get().count,
    entries:database.prepare("SELECT COUNT(*) count FROM arca_shelf_entries WHERE status='active'").get().count,
    openWorks:database.prepare("SELECT COUNT(*) count FROM fx_supporting_works WHERE state NOT IN ('succeeded','failed','cancelled')").get().count,
    activeAcquisitions:database.prepare("SELECT COUNT(*) count FROM perception_acquisitions WHERE state='active'").get().count,
  });
}

async function waitFor(databasePath, predicate, timeoutMs, runtimeErrors) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    const database = new Database(databasePath, { readonly:true });
    try { value = counts(database); } finally { database.close(); }
    if (predicate(value)) return value;
    if (runtimeErrors.length) throw runtimeErrors.at(-1);
    await new Promise((resolve)=>setTimeout(resolve, 500));
  }
  throw new Error('Qualification did not converge: ' + JSON.stringify(value));
}

function evidence(databasePath, roots) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const formation = database.prepare(`SELECT subject_id,display_identity,classification,attention_state,target_shelf_name,
      next_action_label,current_libra_run_id,my_rating,my_rating_source FROM libra_formation_projections ORDER BY display_identity`).all();
    const artifactRows = database.prepare(`SELECT p.display_identity,e.capability_ref,e.event_id,r.result_json,n.parameters_json
      FROM libra_formation_projections p JOIN libra_runs lr ON lr.subject_id=p.subject_id
      JOIN fx_supporting_works w ON w.process_id=lr.libra_run_id
      JOIN fx_workflow_events e ON e.work_id=w.work_id LEFT JOIN fx_event_result_bindings r ON r.event_id=e.event_id
      JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      WHERE e.capability_ref IN ('libra.product_sidecar.render@1','libra.product_artifact.acquire@1')
      ORDER BY p.display_identity,e.capability_ref`).all().map((row)=>{
        const result = row.result_json ? JSON.parse(row.result_json) : null;
        const parameters = JSON.parse(row.parameters_json);
        const providerRevision = result?.artifactHandle?.provenanceRef?.objectType === 'metadata_observation'
          ? /^([^@]+)@(\d+)$/.exec(result.artifactHandle.provenanceRef.objectId || '')
          : null;
        return Object.freeze({ displayIdentity:row.display_identity, capabilityRef:row.capability_ref,
          resultKind:result?.resultKind || null, artifactKind:result?.artifactKind || result?.artifactHandle?.artifactKind || parameters.artifactKind || null,
          provenanceType:result?.provenanceRef?.objectType || result?.artifactHandle?.provenanceRef?.objectType || null,
          integrationId:parameters.integrationId || providerRevision?.[1] || null,
          configRevision:parameters.configRevision || (providerRevision ? Number(providerRevision[2]) : null),
          failureCode:database.prepare('SELECT failure_code FROM fx_event_attempts WHERE event_id=? ORDER BY ordinal DESC LIMIT 1').get(row.event_id)?.failure_code || null,
        });
      });
    const sidecars = artifactRows.filter((item)=>item.capabilityRef==='libra.product_sidecar.render@1');
    const workspaces = database.prepare('SELECT workspace_id,libra_run_id FROM libra_workspaces').all();
    const outputNfos = workspaces.map((item)=>{
      const location = path.join(roots.workspace, item.workspace_id, 'product', 'movie.nfo');
      if (!fs.existsSync(location)) return null;
      const subject = database.prepare('SELECT subject_id FROM libra_runs WHERE libra_run_id=?').get(item.libra_run_id);
      const projection = formation.find((row)=>row.subject_id===subject?.subject_id);
      const bytes = fs.readFileSync(location);
      return Object.freeze({ displayIdentity:projection?.display_identity || item.libra_run_id, location,
        sizeBytes:bytes.length, digest:crypto.createHash('sha256').update(bytes).digest('hex'), xml:bytes.toString('utf8') });
    }).filter(Boolean);
    return Object.freeze({ formation, artifactRows, sidecars, outputNfos,
      ratingResolutions:database.prepare(`SELECT h.current_revision,r.result_kind,r.reason_code,r.result_json
        FROM perception_resolution_heads h JOIN perception_resolution_revisions r
          ON r.resolution_id=h.current_resolution_id AND r.revision=h.current_revision
        WHERE h.query_contract='perception.rating.resolve@1' ORDER BY h.query_input_digest`).all().map((item)=>{
          const result=JSON.parse(item.result_json);return Object.freeze({revision:Number(item.current_revision),
            resultKind:item.result_kind,reasonCode:item.reason_code,rating:result.rating??null,sourceKind:result.sourceKind??null});}),
      fieldIds:database.prepare(`SELECT f.field_id,f.status,a.endpoint_id,a.mount_scope_id,a.root_location
        FROM proc_material_fields f JOIN proc_field_access_revisions a
          ON a.field_id=f.field_id AND a.revision=f.current_access_revision ORDER BY f.field_id`).all(),
      physicalBindingCount:database.prepare('SELECT COUNT(DISTINCT material_key) count FROM proc_field_materials').get().count,
      candidateCount:database.prepare('SELECT COUNT(*) count FROM proc_candidate_packages').get().count,
      subjectCount:database.prepare('SELECT COUNT(*) count FROM libra_subjects').get().count,
      runCount:database.prepare('SELECT COUNT(*) count FROM libra_runs').get().count,
      handleInvalidCount:database.prepare("SELECT COUNT(*) count FROM fx_event_attempts WHERE failure_code='PLATFORM_INTEGRATION_HANDLE_INVALID'").get().count,
      revisionMismatchCount:database.prepare("SELECT COUNT(*) count FROM fx_event_attempts WHERE failure_code LIKE '%REVISION%MISMATCH%'").get().count,
    });
  } finally { database.close(); }
}

async function main() {
  const root = runRoot();
  if (fs.existsSync(root) && fs.readdirSync(root).some((name)=>name!=='tmp')) {
    throw new Error('Qualification root already contains non-temporary evidence.');
  }
  const roots = Object.freeze({ data:path.join(root,'data'), field:path.join(root,'field'), shelf:path.join(root,'shelf'),
    workspace:path.join(root,'workspace'), tmp:path.join(root,'tmp'), evidence:path.join(root,'evidence') });
  for (const value of Object.values(roots).filter((item)=>item!==roots.data)) fs.mkdirSync(value, { recursive:true });
  const canary = buildCanary(roots.field);
  const sourceBefore = snapshot(canary.sourceFiles);
  const secretRoot = crypto.randomBytes(32).toString('base64url');
  const initialized = initializeCleanData({ dataDir:roots.data, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot });
  fs.writeFileSync(path.join(root,'private-runtime.json'), JSON.stringify({adminApiKey:initialized.adminApiKey,secretRoot},null,2));
  const runtimeErrors = [];
  const hostOptions = { dataDir:roots.data, adminDistDir:path.resolve(__dirname,'../../dist/admin'), secretRoot,
    libraWorkspaceRoot:roots.workspace, integrationReservedRoots:[roots.field,roots.shelf],
    onExecutionRuntimeError(error){runtimeErrors.push(error);} };
  const databasePath = path.join(roots.data,'shelfdeck.db');
  let host = await createCleanServiceHost(hostOptions);
  let first;
  try {
    const cookie = await session(host, initialized.adminApiKey);
    const tmdb = await configureIntegration(host,cookie,'tmdb',readCredential('tmdb'));
    const douban = await configureIntegration(host,cookie,'douban',readCredential('douban'));
    assert.equal(tmdb.state,'active');assert.equal(douban.state,'active');
    const sync = await host.inject({method:'POST',url:'/v1/admin/perception/actions/sync',headers:{cookie},payload:{idempotencyKey:'formation-uat-douban-sync'}});
    assert.equal(sync.statusCode,202,sync.body);
    await createShelf(host,cookie,roots.shelf);
    await createField(host,cookie,'formation-uat-field-a',roots.field);
    await observe(host,cookie,'formation-uat-field-a');
    await waitFor(databasePath,(value)=>value.subjects>=1,120_000,runtimeErrors);
    await createField(host,cookie,'formation-uat-field-b',roots.field);
    await observe(host,cookie,'formation-uat-field-b');
    first = await waitFor(databasePath,(value)=>value.subjects===3&&value.openWorks===0&&value.activeAcquisitions===0,420_000,runtimeErrors);
  } finally { await host.close(); }
  const firstEvidence = evidence(databasePath,roots);
  assert.equal(firstEvidence.subjectCount,3,'same-root Fields must produce exactly three Subjects');
  assert.equal(firstEvidence.runCount,3,'same-root Fields must produce exactly one Run per movie');
  assert.equal(firstEvidence.candidateCount,3,'same-root Fields must produce exactly one Candidate per movie');
  assert.equal(firstEvidence.handleInvalidCount,0);
  assert.equal(firstEvidence.revisionMismatchCount,0);
  assert.equal(firstEvidence.ratingResolutions.length,3);
  assert.equal(firstEvidence.ratingResolutions.every((item)=>item.resultKind==='found'||Boolean(item.reasonCode)),true);
  const byTitle = (fragment)=>firstEvidence.sidecars.find((item)=>item.displayIdentity.includes(fragment));
  assert.equal(byTitle('007：大破天幕杀机')?.provenanceType,'related_nfo_update');
  assert.equal(byTitle('香火')?.provenanceType,'product_metadata_draft_rebuild');
  assert.equal(byTitle('威尼斯惊魂夜')?.provenanceType,'product_metadata_draft_create');
  const poster007 = firstEvidence.artifactRows.find((item)=>item.displayIdentity.includes('007：大破天幕杀机')&&item.artifactKind==='poster');
  const posterVenice = firstEvidence.artifactRows.find((item)=>item.displayIdentity.includes('威尼斯惊魂夜')&&item.artifactKind==='poster');
  assert.equal(poster007?.provenanceType,'related_material_reference');
  assert.equal(posterVenice?.resultKind,'acquired');
  assert.equal(posterVenice?.configRevision,1);
  const nfo007 = firstEvidence.outputNfos.find((item)=>item.displayIdentity.includes('007：大破天幕杀机'));
  assert.ok(nfo007?.xml.includes('tt1074638'));
  assert.ok(nfo007?.xml.includes('<actor>'));
  assert.ok(nfo007?.xml.includes('<uniqueid type="tmdb">37724</uniqueid>') || nfo007?.xml.includes('<uniqueid type="tmdb" default="true">37724</uniqueid>'));
  assert.equal(firstEvidence.formation.some((item)=>item.display_identity.includes('007：大破天幕杀机')&&item.attention_state==='attention_required'),false);
  runtimeErrors.length=0;
  host=await createCleanServiceHost(hostOptions);
  let restarted;
  try { restarted=await waitFor(databasePath,(value)=>value.openWorks===0&&value.activeAcquisitions===0,120_000,runtimeErrors); } finally { await host.close(); }
  const restartedEvidence=evidence(databasePath,roots);
  assert.equal(restartedEvidence.subjectCount,firstEvidence.subjectCount);
  assert.equal(restartedEvidence.runCount,firstEvidence.runCount);
  assert.equal(restartedEvidence.handleInvalidCount,0);
  const sourceAfter=snapshot(canary.sourceFiles);
  assert.deepEqual(sourceAfter,sourceBefore);
  const safeEvidence={ schema:'shelfdeck.formation-uat-074-083-qualification@1',result:'PASS',createdAt:new Date().toISOString(),
    movies:MOVIES.map((item)=>item.directory),first,restarted,sourceBefore,sourceAfter,
    facts:JSON.parse(JSON.stringify(firstEvidence,(key,value)=>key==='xml'?undefined:value)),
    restartFacts:JSON.parse(JSON.stringify(restartedEvidence,(key,value)=>key==='xml'?undefined:value)) };
  fs.writeFileSync(path.join(roots.evidence,'formation-uat-074-083-facts.json'),JSON.stringify(safeEvidence,null,2)+'\n');
  process.stdout.write(JSON.stringify({result:'PASS',root,subjects:firstEvidence.subjectCount,runs:firstEvidence.runCount,
    nfoDispositions:firstEvidence.sidecars.map((item)=>item.provenanceType),handleInvalid:firstEvidence.handleInvalidCount,restartStable:true})+'\n');
}

main().catch((error)=>{process.stderr.write(`${error.code||error.name}: ${error.message}\n${error.stack||''}\n`);process.exitCode=1;});
