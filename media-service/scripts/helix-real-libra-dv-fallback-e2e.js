'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const ffmpeg = require('ffmpeg-static');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { createCleanMediaProbe } = require('../src/clean-media-probe');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createOutboxDispatcherHost } = require('../src/helix/foundation/execution/outbox-dispatcher-host');
const { RULES_SCHEMA_REF, SYSTEM_TEMPLATE_ID } =
  require('../src/helix/domains/arca/model/rule-template-contracts');

const TEST_MAX_SIZE_GIB = 1;
const TEST_MAX_SIZE_BYTES = 1024 * 1024 * 1024;
const SCENARIO_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const scenarios = Object.freeze([
  Object.freeze({ id:'dv_p8_gpu', title:'DV P8 GPU Normalization', year:2026,
    sourceEnvironment:'HELIX_DV_P8_SOURCE', expectedProfile:8, platformMode:'actual' }),
  Object.freeze({ id:'dv_p7_cpu_fallback', title:'DV P7 CPU Fallback', year:2011,
    sourceEnvironment:'HELIX_DV_P7_SOURCE', expectedProfile:7, platformMode:'gpu_ready_without_dv_pipeline' }),
]);
let activeRoot = null;

function fail(message, code = 'HELIX_REAL_DV_E2E_INVALID') {
  const error = new Error(message); error.code = code; throw error;
}
function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required.`);
  return path.resolve(value.trim());
}
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function boundedReality(filePath) {
  const handle = fs.openSync(filePath, 'r');
  try {
    const before = fs.fstatSync(handle, { bigint:true });
    if (!before.isFile()) fail('DV source must be a regular file.');
    const sizeBytes = Number(before.size), sampleLength = Math.min(sizeBytes, 262144),
      sampleOffset = Math.floor((sizeBytes - sampleLength) / 2), bytes = Buffer.alloc(sampleLength);
    let readBytes = 0;
    while (readBytes < sampleLength) {
      const read = fs.readSync(handle, bytes, readBytes, sampleLength - readBytes, sampleOffset + readBytes);
      if (read === 0) fail('DV source produced a short bounded fingerprint read.');
      readBytes += read;
    }
    const after = fs.fstatSync(handle, { bigint:true });
    if (after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs ||
        after.ctimeNs !== before.ctimeNs) fail('DV source changed during bounded Reality capture.');
    return Object.freeze({ path:path.resolve(filePath), inode:String(before.ino), sizeBytes,
      mtimeNs:String(before.mtimeNs), ctimeNs:String(before.ctimeNs), sampleOffset, sampleLength,
      middleFingerprint:sha256(bytes) });
  } finally { fs.closeSync(handle); }
}

function runProcess(executable, argv, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, { windowsHide:true, stdio:['ignore', 'ignore', 'pipe'] });
    const chunks = []; let bytes = 0; let timedOut = false; let settled = false;
    const finish = (operation) => { if (settled) return; settled = true; operation(); };
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stderr.on('data', (chunk) => { bytes += chunk.length; if (bytes <= 512 * 1024) chunks.push(Buffer.from(chunk)); });
    child.once('error', (error) => finish(() => { clearTimeout(timer); reject(error); }));
    child.once('close', (code) => finish(() => {
      clearTimeout(timer); const stderr = Buffer.concat(chunks).toString('utf8');
      if (timedOut || code !== 0) return reject(Object.assign(new Error('FFmpeg command failed.'), {
        code:timedOut ? 'HELIX_REAL_DV_FFMPEG_TIMEOUT' : 'HELIX_REAL_DV_FFMPEG_FAILED',
        details:{ exitCode:code, stderr:stderr.slice(-16000), argv },
      }));
      resolve(Object.freeze({ exitCode:code, stderrDigest:canonicalDigest(stderr), stderrBytes:bytes }));
    }));
  });
}

function physicalReadHandle(filePath, label) {
  const stat = fs.statSync(filePath, { bigint:true }), sizeBytes = Number(stat.size);
  const identity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
    materialKey:canonicalDigest({ label, filePath, sizeBytes, inode:String(stat.ino) }), mountScopeId:'dv-e2e-temp',
    inode:String(stat.ino), sizeBytes, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
    contentFingerprint:canonicalDigest({ label, sizeBytes }) };
  return Object.freeze({ schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ label, identity }), identity, ownerDomain:'libra', ownerScope:{ scopeType:'libra_run', scopeId:label },
    bindingRevision:1, endpointId:'dv-e2e-temp-endpoint', location:filePath, mountScopeRevision:1,
    expectedSizeBytes:sizeBytes, expectedMtimeNs:Number(stat.mtimeNs), expectedCtimeNs:Number(stat.ctimeNs),
    fingerprintVerifiedAtMs:Date.now(), readScope:'material_read', expiresAtMs:Number.MAX_SAFE_INTEGER,
    fenceDigest:canonicalDigest({ label, identity, location:filePath }) });
}

async function probeFile(filePath, label) {
  const probe = createCleanMediaProbe();
  return probe.probe(physicalReadHandle(filePath, label));
}

async function prepareFragment(scenario, source, fieldRoot) {
  const movieRoot = path.join(fieldRoot, `${scenario.title} (${scenario.year})`);
  fs.mkdirSync(movieRoot, { recursive:true });
  const base = path.join(activeRoot, `${scenario.id}-base.mkv`),
    target = path.join(movieRoot, `${scenario.title} (${scenario.year}).mkv`);
  await runProcess(ffmpeg, ['-hide_banner','-nostdin','-loglevel','error','-y','-ss','300','-i',source,'-t','30',
    '-map','0:v:0','-map','0:a?','-map','0:s?','-c','copy',base]);
  const baseProbe = await probeFile(base, `${scenario.id}-base`), video = baseProbe.videoStreams?.[0];
  assert.equal(baseProbe.resultKind, 'probed');
  assert.equal(video?.dynamicRangeKind, 'dolby_vision');
  assert.equal(video?.dolbyVision?.profile, scenario.expectedProfile);
  assert.equal(video?.dolbyVision?.blPresent, true);
  assert.equal(video?.dolbyVision?.baseLayerKind, 'pq_bt2020_compatible');
  fs.copyFileSync(base, target);
  fs.truncateSync(target, TEST_MAX_SIZE_BYTES + (64 * 1024 * 1024));
  fs.rmSync(base, { force:true });
  const targetProbe = await probeFile(target, `${scenario.id}-field`);
  assert.equal(targetProbe.videoStreams?.[0]?.dynamicRangeKind, 'dolby_vision');
  assert.equal(targetProbe.videoStreams?.[0]?.dolbyVision?.profile, scenario.expectedProfile);
  assert.ok(fs.statSync(target).size > TEST_MAX_SIZE_BYTES,
    'DV fixture must exceed the bounded one-GiB E2E Shelf limit.');
  fs.writeFileSync(path.join(movieRoot, 'movie.nfo'), `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<movie><title>${scenario.title}</title><year>${scenario.year}</year><uniqueid type="tmdb">99000${scenario.expectedProfile}</uniqueid></movie>\n`, 'utf8');
  return Object.freeze({ target, inputProbe:targetProbe, movieRoot });
}

function integrationHandle(intent, operationId, artifactKind = null) {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ schema:'helix.dv-e2e-integration-handle@1', operationId, artifactKind }),
    integrationId:intent?.integrationId || 'dv-e2e-tmdb', integrationType:'tmdb', configRevision:1,
    secretRef:'dv-e2e-secret', allowedOperation:operationId, expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function providerOptions() {
  return Object.freeze({
    routingIntegrationHandleResolver:(intent) => integrationHandle(intent, 'libra.routing.fact.observe@1'),
    routingProviderObservation:async ({ intent }) => Object.freeze([Object.freeze({ providerKey:'990001',
      title:intent.candidateDisplayTitle, originalTitle:intent.candidateDisplayTitle, releaseYear:intent.yearHint || 2000,
      regionCodes:Object.freeze(['US']), genreCodes:Object.freeze(['18']) })]),
    productIntegrationHandleResolver:({ intent, operationId, artifactKind }) =>
      integrationHandle(intent, operationId, artifactKind || null),
    productProviderMetadataFetch:async ({ metadataFetchIntent:intent }) => Object.freeze({ providerKind:'tmdb',
      integrationId:intent.integrationId, configRevision:intent.configRevision,
      descriptiveEntries:Object.freeze([{key:'director',value:'DV E2E Director'},{key:'genre',value:'Drama'},
        {key:'plot',value:'DV source compatibility evidence'},{key:'title',value:'DV E2E Movie'},
        {key:'tmdb_movie_id',value:intent.resolvedProviderIdentity.providerKey},{key:'year_or_release_date',value:2000}]),
      providerIdentities:Object.freeze([intent.resolvedProviderIdentity]), peopleHints:Object.freeze([Object.freeze({
        displayName:'DV E2E Actor',role:'actor',providerIdentities:Object.freeze([Object.freeze({
          provider:'tmdb',namespace:'tmdb_person',providerKey:'990101',
        })]),
      })]) }),
    productProviderArtifactFetch:async ({ artifactKind, resolvedProviderIdentity, integrationHandle:handle }) => Object.freeze({
      resultKind:'acquired', bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9','hex'), artifactKind,
      integrationId:handle.integrationId, configRevision:handle.configRevision, mediaType:'image/jpeg', resolvedProviderIdentity }),
  });
}

function pipeline(profile, digestLabel) {
  if (profile === 'ordinary_to_hevc@1') return Object.freeze({ pipelineProfileId:profile,
    inputDynamicRangeKinds:Object.freeze(['sdr','hdr10_compatible','hlg','unknown']),
    inputPixelFormats:Object.freeze(['yuv420p','yuv420p10le']), outputCodec:'hevc', outputDynamicRangeKind:'unknown',
    outputPixelFormat:'encoder_selected', outputColorProfile:Object.freeze({range:'source',primaries:'source',transfer:'source',matrix:'source'}),
    selfTestDigest:canonicalDigest(digestLabel) });
  return Object.freeze({ pipelineProfileId:profile, inputDynamicRangeKinds:Object.freeze(['dolby_vision']),
    inputPixelFormats:Object.freeze(['yuv420p10le']), outputCodec:'hevc', outputDynamicRangeKind:'sdr', outputPixelFormat:'yuv420p',
    outputColorProfile:Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'}),
    selfTestDigest:canonicalDigest(digestLabel) });
}

function deviceSnapshot(deviceId, deviceClass, pipelines, modes) {
  const capabilityPayload = Object.freeze({ supportedVideoCodecs:Object.freeze(['hevc']),
    supportedRateControlModes:Object.freeze(modes), validatedConcurrentSlots:1,
    validatedVideoPipelines:Object.freeze(pipelines) }), capabilityDigest = canonicalDigest(capabilityPayload),
    body = { deviceId, deviceClass, probeRevision:1, capabilitySchemaRef:'platform.compute-device-capability@1',
      capabilityPayload, capabilityDigest, enabled:true, state:'ready', workerRef:null };
  return Object.freeze({ ...body, snapshotDigest:canonicalDigest(body) });
}

function controlledFallbackRuntime() {
  const gpu = deviceSnapshot('dv-e2e-ready-gpu', 'nvidia_nvenc', [pipeline('ordinary_to_hevc@1','gpu-sdr')],
    ['target_size','strict_abr','quality_bound']), cpu = deviceSnapshot('dv-e2e-cpu', 'software_cpu',
    [pipeline('ordinary_to_hevc@1','cpu-sdr'),pipeline('pq_bt2020_base_to_sdr_bt709_hevc@1','cpu-dv')],
    ['two_pass_abr','strict_abr','quality_bound']);
  const snapshots = new Map([[gpu.deviceId,gpu],[cpu.deviceId,cpu]]), refs = [gpu,cpu].map((snapshot) => {
    const body={deviceId:snapshot.deviceId,deviceClass:snapshot.deviceClass,probeRevision:snapshot.probeRevision,
      capabilityDigest:snapshot.capabilityDigest}; return Object.freeze({...body,refDigest:canonicalDigest(body)});
  });
  return Object.freeze({
    listReadyDeviceRefs(query) { const body={queryDigest:query.queryDigest,resultKind:'available',items:Object.freeze(refs)};
      return Object.freeze({...body,resultDigest:canonicalDigest(body)}); },
    readDeviceSnapshot(query) { const snapshot=snapshots.get(query.deviceId),body=snapshot&&
      snapshot.probeRevision===query.expectedProbeRevision&&snapshot.capabilityDigest===query.expectedCapabilityDigest
      ?{queryDigest:query.queryDigest,resultKind:'found',snapshot}:{queryDigest:query.queryDigest,resultKind:'not_found'};
      return Object.freeze({...body,resultDigest:canonicalDigest(body)}); },
  });
}

function scenarioHostOptions(scenario, dataDir, adminRoot, workspaceRoot, onError = () => {}) {
  return Object.freeze({
    dataDir,
    adminDistDir:adminRoot,
    secretRoot:`helix-real-dv-${scenario.id}-secret-root-20260813`,
    libraWorkspaceRoot:workspaceRoot,
    ...providerOptions(),
    outboxDispatcherFactory:(options)=>createOutboxDispatcherHost({...options,
      deferredDeliveryKeys:[...(options.deferredDeliveryKeys||[]),'rule_template_published->read-model']}),
    ...(scenario.platformMode==='gpu_ready_without_dv_pipeline'
      ? { platformComputeRuntime:controlledFallbackRuntime() }
      : {}),
    onExecutionRuntimeError:onError,
    onRequestError:onError,
  });
}

async function session(host, apiKey) {
  const response=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':apiKey}});
  assert.equal(response.statusCode,204,response.body);return response.headers['set-cookie'];
}
async function createBoundedTemplate(host,cookie,scenario) {
  const templateId=`${scenario.id}-template`,headers={cookie},copy=await host.inject({method:'POST',
    url:`/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,headers,payload:{idempotencyKey:`${scenario.id}-copy-template`,
      sourceTemplateId:SYSTEM_TEMPLATE_ID,newTemplateId:templateId,name:`${scenario.title} test template`,expectedSourceRevision:1}});
  assert.equal(copy.statusCode,201,copy.body);
  const draftResponse=await host.inject({method:'GET',url:`/v1/admin/rule-templates/${templateId}/draft`,headers});
  assert.equal(draftResponse.statusCode,200,draftResponse.body);
  const rules=structuredClone(draftResponse.json().draft.rules),movie=rules.profileRuleSets.find((item)=>item.contentProfile==='movie'),
    branch=movie.decisionBranches.find((item)=>item.conditionKind==='rating_equals'&&item.rating===1);
  branch.requirements.space.maxSizeGiB=TEST_MAX_SIZE_GIB;branch.requirements.space.maxSizeBytes=TEST_MAX_SIZE_BYTES;
  const unsigned=Object.fromEntries(Object.entries(movie).filter(([key])=>key!=='profileRuleSetDigest'));
  movie.profileRuleSetDigest=canonicalDigest(unsigned);const rulesDigest=canonicalDigest(rules);
  const patched=await host.inject({method:'PATCH',url:`/v1/admin/rule-templates/${templateId}/draft`,headers,payload:{
    idempotencyKey:`${scenario.id}-patch-template`,templateId,expectedDraftRevision:1,basePublishedRevision:1,
    rulesSchemaRef:RULES_SCHEMA_REF,rules,rulesDigest}});assert.equal(patched.statusCode,200,patched.body);
  const preview=await host.inject({method:'POST',url:`/v1/admin/rule-templates/${templateId}/actions/preview`,headers,payload:{
    idempotencyKey:`${scenario.id}-preview-template`,templateId,expectedCurrentRevision:1,expectedDraftRevision:2,
    expectedDraftDigest:rulesDigest}});assert.equal(preview.statusCode,200,preview.body);
  const published=await host.inject({method:'POST',url:`/v1/admin/rule-templates/${templateId}/actions/publish`,headers,payload:{
    idempotencyKey:`${scenario.id}-publish-template`,templateId,expectedCurrentRevision:1,expectedDraftRevision:2,
    expectedDraftDigest:rulesDigest,previewId:preview.json().previewId,previewDigest:preview.json().previewDigest}});
  assert.equal(published.statusCode,200,published.body);assert.equal(published.json().template.currentRevision,2);
  return Object.freeze({templateId,revision:2});
}
async function createShelf(host,cookie,scenario,shelfRoot,template) {
  const response=await host.inject({method:'POST',url:'/v1/admin/shelves',headers:{cookie},payload:{
    idempotencyKey:`${scenario.id}-shelf-create`,shelfId:`${scenario.id}-shelf`,name:`${scenario.title} shelf`,targetRootLocation:shelfRoot,
    ruleTemplateId:template.templateId,expectedTemplateRevision:template.revision,
    placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}}});
  assert.equal(response.statusCode,201,response.body);
}
async function createField(host,cookie,scenario,fieldRoot) {
  const fieldId=`${scenario.id}-field`,policyValue={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,
    excludedMaterialKeys:[]},access={fieldId,revision:1,endpointId:`${fieldId}-endpoint`,rootLocation:fieldRoot,
    mountScopeId:`${fieldId}-mount`,mountScopeRevision:1,accessSchemaRef:'helix://e2e/dv-field-access/v1'};
  const response=await host.inject({method:'POST',url:'/v1/admin/material-fields',headers:{cookie},payload:{
    idempotencyKey:`${fieldId}-create`,fieldId,name:`${scenario.title} field`,contentProfileHint:'movie',
    policy:{extractionPolicyId:`${fieldId}-policy`,revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy:policyValue,policyDigest:canonicalDigest({extractionPolicyId:`${fieldId}-policy`,revision:1,...policyValue})},
    access:{...access,accessDigest:canonicalDigest(access)}}});assert.equal(response.statusCode,201,response.body);return fieldId;
}
async function observe(host,cookie,scenario,fieldId) { const response=await host.inject({method:'POST',
  url:`/v1/admin/material-fields/${fieldId}/actions/observe`,headers:{cookie},payload:{idempotencyKey:`${scenario.id}-observe`,fieldId,
    expectedAccessRevision:1,expectedObservationRevision:0,pageBudget:8}});assert.equal(response.statusCode,202,response.body); }
async function formation(host,cookie) { const response=await host.inject({method:'GET',url:'/v1/admin/formation',headers:{cookie}});
  assert.equal(response.statusCode,200,response.body);return response.json().items; }
async function waitFor(host,cookie,predicate,runtimeError,timeoutMs=SCENARIO_TIMEOUT_MS) { const deadline=Date.now()+timeoutMs;let items=[];
  while(Date.now()<deadline){if(runtimeError())throw runtimeError();items=await formation(host,cookie);const result=predicate(items);if(result)return result;
    await new Promise((resolve)=>setTimeout(resolve,200));}fail(`DV E2E timed out: ${JSON.stringify(items)}`,'HELIX_REAL_DV_E2E_TIMEOUT'); }
async function rate(host,cookie,scenario,subject) { const response=await host.inject({method:'POST',url:'/v1/admin/perception/records',headers:{cookie},
  payload:{targetType:'subject',targetId:subject.subjectId,expectedRevision:0,rating:1,idempotencyKey:`${scenario.id}-rating`}});
  assert.equal(response.statusCode,202,response.body); }
async function route(host,cookie,scenario,fieldId) { const response=await host.inject({method:'PATCH',
  url:`/v1/admin/routing/material-fields/${fieldId}`,headers:{cookie},payload:{idempotencyKey:`${scenario.id}-routing`,fieldId,
    expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:`${scenario.id}-routing-policy`,mode:'direct',
      targets:[{shelfId:`${scenario.id}-shelf`,rank:1,matchExpression:{nodeKind:'always'}}]}}});assert.equal(response.statusCode,200,response.body); }

function inspectExecution(databasePath,workspaceRoot,subjectId) {
  const database=new Database(databasePath,{readonly:true});
  try {
    const run=database.prepare(`SELECT r.libra_run_id,p.on_deck_package_id,p.offer_id FROM libra_runs r
      JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id WHERE r.subject_id=? AND r.state='active'`).get(subjectId);
    assert.ok(run?.offer_id);
    const assessments=database.prepare(`SELECT e.event_id,e.state,n.input_bindings_json,b.result_json FROM fx_workflow_events e
      JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      JOIN fx_event_result_bindings b ON b.event_id=e.event_id WHERE w.process_id=? AND e.capability_ref='libra.transcode.input.verify@1'
      ORDER BY e.ready_at_ms,e.event_id`).all(run.libra_run_id).map((row)=>{const bindings=JSON.parse(row.input_bindings_json).bindings,
        device=bindings.find((item)=>item.portName==='mediaExecutionDeviceSnapshot').value,
        intent=bindings.find((item)=>item.portName==='encodeIntent').value,result=JSON.parse(row.result_json);
        return Object.freeze({eventId:row.event_id,state:row.state,deviceId:device.deviceId,deviceClass:device.deviceClass,
          deviceState:device.state,pipelineProfileId:intent.video.pipelineProfileId,intentDigest:intent.intentDigest,
          previousIntentDigest:intent.previousIntentDigest||null,disposition:result.disposition,reasonCodes:result.reasonCodes,
          sampleCount:result.sampleCount,passedSampleCount:result.passedSampleCount,preflightDigest:result.preflightDigest});});
    const transcodes=database.prepare(`SELECT e.event_id,n.input_bindings_json,b.result_json FROM fx_workflow_events e
      JOIN fx_supporting_works w ON w.work_id=e.work_id JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      JOIN fx_event_result_bindings b ON b.event_id=e.event_id WHERE w.process_id=? AND e.capability_ref='libra.media.transcode@1'`).all(run.libra_run_id)
      .map((row)=>{const bindings=JSON.parse(row.input_bindings_json).bindings,device=bindings.find((item)=>item.portName==='mediaExecutionDeviceSnapshot').value,
        intent=bindings.find((item)=>item.portName==='encodeIntent').value,result=JSON.parse(row.result_json);
        return Object.freeze({eventId:row.event_id,deviceId:device.deviceId,deviceClass:device.deviceClass,intentDigest:intent.intentDigest,
          relativePath:result.workspaceMaterialHandle.relativePath,workspaceId:result.workspaceMaterialHandle.workspaceId,
          workspaceMediaHandleId:result.workspaceMediaHandleId,outputSizeBytes:result.workspaceMaterialHandle.sizeBytes,
          productionVideoProfile:result.productionVideoProfile});});
    assert.ok(transcodes.length>=1);const verificationRows=database.prepare(`SELECT b.result_json FROM fx_event_result_bindings b
      JOIN fx_workflow_events e ON e.event_id=b.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id
      WHERE w.process_id=? AND e.capability_ref='libra.product_media.verify@1'`).all(run.libra_run_id).map((row)=>JSON.parse(row.result_json)),
      verification=verificationRows.find((item)=>item.result==='passed'&&item.workspaceMediaHandleId&&
        item.dynamicRangeSummary?.conversionOperation==='tone_map_to_sdr_bt709');
    assert.ok(verification);const selected=transcodes.find((item)=>item.workspaceMediaHandleId===verification.workspaceMediaHandleId);
    assert.ok(selected);const outputPath=path.join(workspaceRoot,selected.workspaceId,...selected.relativePath.split('/'));
    const counts={works:Number(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='libra' AND process_id=?").get(run.libra_run_id).n),
      plans:Number(database.prepare(`SELECT count(*) n FROM fx_workflow_plans p
        JOIN fx_work_attempts a ON a.attempt_id=p.attempt_id
        JOIN fx_supporting_works w ON w.work_id=a.work_id WHERE w.process_id=?`).get(run.libra_run_id).n),
      events:Number(database.prepare("SELECT count(*) n FROM fx_workflow_events e JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=?").get(run.libra_run_id).n),
      attempts:Number(database.prepare("SELECT count(*) n FROM fx_event_attempts a JOIN fx_workflow_events e ON e.event_id=a.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=?").get(run.libra_run_id).n),
      permits:Number(database.prepare("SELECT count(*) n FROM fx_event_resource_timings t JOIN fx_event_attempts a ON a.event_attempt_id=t.event_attempt_id JOIN fx_workflow_events e ON e.event_id=a.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=?").get(run.libra_run_id).n),
      results:Number(database.prepare("SELECT count(*) n FROM fx_event_result_bindings b JOIN fx_workflow_events e ON e.event_id=b.event_id JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE w.process_id=?").get(run.libra_run_id).n),
      failedWorks:Number(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().n),
      failedEvents:Number(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().n),
      consumedOffers:Number(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n),
      arcaEntries:Number(database.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n)};
    return Object.freeze({run,assessments:Object.freeze(assessments),transcodes:Object.freeze(transcodes),
      selectedTranscode:selected,verification,outputPath,counts});
  } finally { database.close(); }
}

function executionIdentity(execution) {
  return Object.freeze({
    runId:execution.run.libra_run_id,
    packageId:execution.run.on_deck_package_id,
    offerId:execution.run.offer_id,
    assessmentEventIds:Object.freeze(execution.assessments.map((item)=>item.eventId).sort()),
    transcodeEventIds:Object.freeze(execution.transcodes.map((item)=>item.eventId).sort()),
    selectedWorkspaceMediaHandleId:execution.verification.workspaceMediaHandleId,
    counts:execution.counts,
  });
}

function assertScenarioExecution(scenario, execution) {
  assert.equal(execution.counts.failedWorks,0);assert.equal(execution.counts.failedEvents,0);
  assert.equal(execution.counts.consumedOffers,0);assert.equal(execution.counts.arcaEntries,0);
  if(scenario.platformMode==='actual'){
    assert.equal(execution.selectedTranscode.deviceClass,'nvidia_nvenc');
    assert.equal(execution.assessments[0].deviceClass,'nvidia_nvenc');assert.equal(execution.assessments[0].disposition,'compatible');
    assert.equal(execution.assessments.some((item)=>item.deviceClass==='software_cpu'),false);
  }else{
    assert.equal(execution.assessments[0].deviceClass,'nvidia_nvenc');assert.equal(execution.assessments[0].deviceState,'ready');
    assert.equal(execution.assessments[0].disposition,'strategy_rejected');
    assert.ok(execution.assessments[0].reasonCodes.includes('required_pipeline_profile_unavailable'));
    const cpuAssessment=execution.assessments.find((item)=>item.deviceClass==='software_cpu');assert.ok(cpuAssessment);
    assert.equal(cpuAssessment.disposition,'compatible');assert.equal(execution.selectedTranscode.deviceClass,'software_cpu');
    assert.equal(execution.transcodes.filter((item)=>item.deviceClass==='nvidia_nvenc').length,0);
    assert.equal(cpuAssessment.previousIntentDigest,execution.assessments[0].intentDigest);
  }
  assert.equal(execution.verification.result,'passed');
  assert.equal(execution.verification.dynamicRangeSummary.outputDynamicRangeKind,'sdr');
  assert.equal(execution.verification.dynamicRangeSummary.outputPixelFormat,'yuv420p');
  assert.deepEqual(execution.verification.dynamicRangeSummary.outputColorProfile,
    {range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'});
  assert.equal(execution.verification.dynamicRangeSummary.dolbyVisionMetadataPresent,false);
  assert.deepEqual(execution.verification.decodeSummary.passedSamplePointsPercent,[5,50,95]);
}

async function verifyDurableRestart(scenario, databasePath, dataDir, adminRoot, workspaceRoot, subjectId, before) {
  let restartError=null;
  const host=await createCleanServiceHost(scenarioHostOptions(scenario,dataDir,adminRoot,workspaceRoot,
    (error)=>{ restartError=restartError||error; }));
  try {
    await new Promise((resolve)=>setTimeout(resolve,2000));
    if(restartError)throw restartError;
  } finally { await host.close(); }
  const after=inspectExecution(databasePath,workspaceRoot,subjectId);
  assert.deepEqual(executionIdentity(after),executionIdentity(before),
    'Restart must not duplicate Assessment, Transcode, Package, or Offer facts.');
  return Object.freeze({ restarted:true, before:executionIdentity(before), after:executionIdentity(after) });
}

async function contactSheet(outputPath,outputProbe,root) {
  const durationSeconds=Math.max(1,Number(outputProbe.durationMs||1)/1000),frames=[];
  for(const point of [5,50,95]){const target=path.join(root,`frame-${point}.jpg`),seconds=(durationSeconds*point/100).toFixed(3);
    await runProcess(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-y','-ss',seconds,'-i',outputPath,'-frames:v','1',
      '-vf','scale=640:-2',target],60_000);frames.push(target);}
  const sheet=path.join(root,'contact-sheet.jpg');
  await runProcess(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-y','-i',frames[0],'-i',frames[1],'-i',frames[2],
    '-filter_complex','[0:v][1:v][2:v]hstack=inputs=3','-frames:v','1',sheet],60_000);return sheet;
}

async function runScenario(scenario) {
  const startedAtMs=Date.now(),source=requiredEnvironment(scenario.sourceEnvironment),sourceBefore=boundedReality(source);
  activeRoot=fs.mkdtempSync(path.join(os.tmpdir(),`helix-real-dv-${scenario.id}-`));
  const dataDir=path.join(activeRoot,'data'),adminRoot=path.join(activeRoot,'admin'),fieldRoot=path.join(activeRoot,'material-field'),
    shelfRoot=path.join(activeRoot,'shelf'),workspaceRoot=path.join(activeRoot,'libra-workspaces'),databasePath=path.join(dataDir,'shelfdeck.db');
  [adminRoot,fieldRoot,shelfRoot,workspaceRoot].forEach((item)=>fs.mkdirSync(item,{recursive:true}));
  fs.writeFileSync(path.join(adminRoot,'index.html'),'<div id="root"></div>','utf8');
  fs.writeFileSync(path.join(activeRoot,'source-before.json'),JSON.stringify(sourceBefore,null,2),'utf8');
  process.stdout.write(JSON.stringify({type:'dv_prepare_start',scenario:scenario.id,root:activeRoot,sourceBefore})+'\n');
  const fragment=await prepareFragment(scenario,source,fieldRoot),initialized=initializeCleanData({dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:`helix-real-dv-${scenario.id}-secret-root-20260813`});
  let runtimeError=null,requestError=null,host=null,monitor=null;
  try {
    host=await createCleanServiceHost(scenarioHostOptions(scenario,dataDir,adminRoot,workspaceRoot,
      (error)=>{ runtimeError=runtimeError||error; }));
    const cookie=await session(host,initialized.adminApiKey),template=await createBoundedTemplate(host,cookie,scenario);
    await createShelf(host,cookie,scenario,shelfRoot,template);const fieldId=await createField(host,cookie,scenario,fieldRoot);
    await observe(host,cookie,scenario,fieldId);
    const subject=await waitFor(host,cookie,(items)=>items.find((item)=>String(item.displayIdentity||'').includes(scenario.title)),
      ()=>runtimeError||requestError);
    await rate(host,cookie,scenario,subject);await route(host,cookie,scenario,fieldId);
    monitor=setInterval(()=>{try{const db=new Database(databasePath,{readonly:true});const snapshot={type:'dv_progress',scenario:scenario.id,
      elapsedMs:Date.now()-startedAtMs,works:db.prepare("SELECT state,count(*) n FROM fx_supporting_works GROUP BY state").all(),
      events:db.prepare("SELECT state,count(*) n FROM fx_workflow_events GROUP BY state").all(),rssBytes:process.memoryUsage().rss};db.close();
      process.stdout.write(JSON.stringify(snapshot)+'\n');}catch(error){process.stderr.write(JSON.stringify({type:'monitor_error',message:error.message})+'\n');}},30_000);
    monitor.unref?.();
    await waitFor(host,cookie,(items)=>{const item=items.find((entry)=>entry.subjectId===subject.subjectId);
      return item?.productionStage==='handoff_b_ready'&&item?.handoffB?.state==='published'&&item.handoffB.offerId?item:false;},()=>runtimeError||requestError);
    const execution=inspectExecution(databasePath,workspaceRoot,subject.subjectId);assertScenarioExecution(scenario,execution);
    await host.close();host=null;
    const recovery=await verifyDurableRestart(scenario,databasePath,dataDir,adminRoot,workspaceRoot,subject.subjectId,execution);
    const outputProbe=await probeFile(execution.outputPath,`${scenario.id}-output`),sheet=await contactSheet(execution.outputPath,outputProbe,activeRoot),
      sourceAfter=boundedReality(source);assert.deepEqual(sourceAfter,sourceBefore);
    const report=Object.freeze({schema:'helix.real-libra-dv-source-compatibility@1',result:'passed',scenario:scenario.id,
      root:activeRoot,databasePath,sourceBefore,sourceAfter,input:{fragmentPath:fragment.target,sizeBytes:fs.statSync(fragment.target).size,
        profile:fragment.inputProbe.videoStreams[0].dolbyVision.profile,dynamicRangeKind:fragment.inputProbe.videoStreams[0].dynamicRangeKind},
      execution,recovery,output:{path:execution.outputPath,sizeBytes:fs.statSync(execution.outputPath).size,
        dynamicRangeKind:outputProbe.videoStreams[0].dynamicRangeKind,pixelFormat:outputProbe.videoStreams[0].pixelFormat,
        colorRange:outputProbe.videoStreams[0].colorRange,colorPrimaries:outputProbe.videoStreams[0].colorPrimaries,
        colorTransfer:outputProbe.videoStreams[0].colorTransfer,colorMatrix:outputProbe.videoStreams[0].colorMatrix,
        dolbyVision:outputProbe.videoStreams[0].dolbyVision||null,contactSheet:sheet},elapsedMs:Date.now()-startedAtMs});
    fs.writeFileSync(path.join(activeRoot,'report.json'),JSON.stringify(report,null,2),'utf8');
    process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
  } finally { if(monitor)clearInterval(monitor);if(host)await host.close(); }
}

async function recoverExistingScenario(scenario, root) {
  activeRoot=path.resolve(root);
  const dataDir=path.join(activeRoot,'data'),adminRoot=path.join(activeRoot,'admin'),fieldRoot=path.join(activeRoot,'material-field'),
    workspaceRoot=path.join(activeRoot,'libra-workspaces'),databasePath=path.join(dataDir,'shelfdeck.db'),
    sourceBeforePath=path.join(activeRoot,'source-before.json');
  if(!fs.existsSync(databasePath)||!fs.existsSync(sourceBeforePath))
    fail('Recovery requires the retained database and source-before.json.','HELIX_REAL_DV_RECOVERY_EVIDENCE_MISSING');
  const source=requiredEnvironment(scenario.sourceEnvironment),sourceBefore=JSON.parse(fs.readFileSync(sourceBeforePath,'utf8')),
    subjectDatabase=new Database(databasePath,{readonly:true});
  let subjectId;
  try {
    const rows=subjectDatabase.prepare("SELECT subject_id FROM libra_runs WHERE state='active'").all();
    assert.equal(rows.length,1);subjectId=rows[0].subject_id;
  } finally { subjectDatabase.close(); }
  const execution=inspectExecution(databasePath,workspaceRoot,subjectId);assertScenarioExecution(scenario,execution);
  const recovery=await verifyDurableRestart(scenario,databasePath,dataDir,adminRoot,workspaceRoot,subjectId,execution),
    outputProbe=await probeFile(execution.outputPath,`${scenario.id}-recovered-output`),
    sheet=await contactSheet(execution.outputPath,outputProbe,activeRoot),sourceAfter=boundedReality(source);
  assert.deepEqual(sourceAfter,sourceBefore);
  const fragmentPath=path.join(fieldRoot,`${scenario.title} (${scenario.year})`,`${scenario.title} (${scenario.year}).mkv`),
    fragmentProbe=await probeFile(fragmentPath,`${scenario.id}-recovered-input`),
    report=Object.freeze({schema:'helix.real-libra-dv-source-compatibility@1',result:'passed',scenario:scenario.id,
      recoveredFromDurableFacts:true,root:activeRoot,databasePath,sourceBefore,sourceAfter,
      input:{fragmentPath,sizeBytes:fs.statSync(fragmentPath).size,profile:fragmentProbe.videoStreams[0].dolbyVision.profile,
        dynamicRangeKind:fragmentProbe.videoStreams[0].dynamicRangeKind},execution,recovery,
      output:{path:execution.outputPath,sizeBytes:fs.statSync(execution.outputPath).size,
        dynamicRangeKind:outputProbe.videoStreams[0].dynamicRangeKind,pixelFormat:outputProbe.videoStreams[0].pixelFormat,
        colorRange:outputProbe.videoStreams[0].colorRange,colorPrimaries:outputProbe.videoStreams[0].colorPrimaries,
        colorTransfer:outputProbe.videoStreams[0].colorTransfer,colorMatrix:outputProbe.videoStreams[0].colorMatrix,
        dolbyVision:outputProbe.videoStreams[0].dolbyVision||null,contactSheet:sheet}});
  fs.writeFileSync(path.join(activeRoot,'report.json'),JSON.stringify(report,null,2),'utf8');
  process.stdout.write(JSON.stringify(report,null,2)+'\n');return report;
}

async function main() {
  const selected=String(process.env.HELIX_DV_SCENARIOS||'dv_p8_gpu,dv_p7_cpu_fallback').split(',').map((item)=>item.trim()).filter(Boolean),
    chosen=scenarios.filter((item)=>selected.includes(item.id));
  if(chosen.length!==selected.length)fail('HELIX_DV_SCENARIOS contains an unknown scenario.');
  const recoveryRoot=String(process.env.HELIX_DV_RECOVER_ROOT||'').trim();
  if(recoveryRoot&&chosen.length!==1)fail('HELIX_DV_RECOVER_ROOT requires exactly one selected scenario.');
  const reports=[];for(const scenario of chosen)reports.push(recoveryRoot
    ? await recoverExistingScenario(scenario,recoveryRoot)
    : await runScenario(scenario));
  process.stdout.write(JSON.stringify({schema:'helix.real-libra-dv-source-compatibility-suite@1',result:'passed',
    scenarios:reports.map((item)=>({scenario:item.scenario,root:item.root,databasePath:item.databasePath,elapsedMs:item.elapsedMs,
      offerId:item.execution.run.offer_id,contactSheet:item.output.contactSheet}))},null,2)+'\n');
}

main().catch((error)=>{process.stderr.write(JSON.stringify({result:'failed',code:error.code||'HELIX_REAL_DV_E2E_FAILED',
  message:error.message,details:error.details||null,root:activeRoot,stack:error.stack},null,2)+'\n');process.exitCode=1;});
