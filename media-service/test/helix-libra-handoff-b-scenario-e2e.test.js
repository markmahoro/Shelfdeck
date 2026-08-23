'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const Database = require('better-sqlite3');
const ffmpeg = require('ffmpeg-static');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { createCleanMediaProbe } = require('../src/clean-media-probe');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { RULES_SCHEMA_REF, SYSTEM_TEMPLATE_ID } =
  require('../src/helix/domains/arca/model/rule-template-contracts');
const { createOutboxDispatcherHost } =
  require('../src/helix/foundation/execution/outbox-dispatcher-host');

const SOURCE_ROOT = process.env.HELIX_LIBRA_HANDOFF_B_E2E_ROOT
  ? path.resolve(process.env.HELIX_LIBRA_HANDOFF_B_E2E_ROOT)
  : null;
const SECRET = 'libra-handoff-b-scenario-e2e-20260812';
const MOVIEPILOT_KEY = 'scenario-moviepilot-key';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestError = null;

function response(status, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  let delivered = false;
  return Object.freeze({
    deferredDeliveryKeys:Object.freeze(['libra.product-offer.available@1->arca']),
    ok: status >= 200 && status <= 299,
    status,
    url: '',
    headers: Object.freeze({
      get(name) {
        if (String(name).toLowerCase() === 'content-length') return String(bytes.length);
        if (String(name).toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    }),
    body: Object.freeze({
      getReader() {
        return Object.freeze({
          async read() {
            if (delivered) return { done:true };
            delivered = true;
            return { done:false, value:Uint8Array.from(bytes) };
          },
          async cancel() { delivered = true; },
        });
      },
    }),
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  });
}

function moviePilotFetch(downloadFile, calls) {
  let requested = false;
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(Object.freeze({ path:url.pathname, method:init.method || 'GET' }));
    if (url.host !== 'moviepilot.test' || url.searchParams.get('token') !== MOVIEPILOT_KEY) {
      return response(401, { detail:'denied' });
    }
    if (url.pathname === '/api/v1/search/title') {
      return response(200, { success:true, data:[{
        meta_info:{ name:'SDT-M05-External-Upgrade', year:'2008' },
        media_info:{ title:'SDT-M05-External-Upgrade', year:'2008', tmdb_id:990001 },
        torrent_info:{ title:'SDT.M05.External.Upgrade.2160p',
          enclosure:'https://tracker.test/sdt-m05.torrent', size:fs.statSync(downloadFile).size },
      }] });
    }
    if (url.pathname === '/api/v1/download/add') {
      requested = true;
      return response(200, { success:true, data:{ download_id:'scenario-external-job-1' } });
    }
    if (url.pathname === '/api/v1/download/') {
      return response(200, requested ? [{
        hash:'scenario-external-job-1', progress:100, state:'completed', content_path:downloadFile,
        media:{ title:'SDT-M05-External-Upgrade', year:2008, tmdbid:990001, type:'电影' },
      }] : []);
    }
    if (url.pathname === '/api/v1/history/download') return response(200, []);
    if (url.pathname === '/api/v1/history/transfer') return response(200, {
      success:true,
      data:{ list:requested ? [{ download_hash:'scenario-external-job-1', status:true,
        dest:'/provider/organized/' + path.basename(downloadFile), type:'电影',
        tmdbid:990001, title:'SDT-M05-External-Upgrade' }] : [], total:requested ? 1 : 0 },
    });
    return response(404, { detail:'not found' });
  };
}

function routingHandle() {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:'scenario-tmdb-routing-handle', integrationId:'scenario-tmdb', integrationType:'tmdb',
    configRevision:1, secretRef:'scenario-tmdb-secret', allowedOperation:'libra.routing.fact.observe@1',
    expiresAtMs:Number.MAX_SAFE_INTEGER };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productHandle(intent, operationId, artifactKind = null) {
  const body = { schemaRef:'helix://contracts/types/IntegrationHandle/v1', schemaVersion:1,
    handleId:canonicalDigest({ schema:'scenario-product-handle@1', operationId, artifactKind }),
    integrationId:intent.integrationId || 'scenario-tmdb', integrationType:'tmdb',
    configRevision:Number.isSafeInteger(intent.configRevision) ? intent.configRevision : 1,
    secretRef:'scenario-tmdb-secret', allowedOperation:operationId, expiresAtMs:4_102_444_800_000 };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productOptions(metadataCalls = null, metadataGate = null) {
  return Object.freeze({
    // These scenarios deliberately stop at an open Handoff B Offer. Arca has
    // its own product-path E2E below and must not make the Libra-only matrix
    // timing or assertions depend on downstream consumption.
    deferredDeliveryKeys:Object.freeze(['libra.product-offer.available@1->arca']),
    routingIntegrationHandleResolver: () => routingHandle(),
    routingProviderObservation: async ({ intent }) => Object.freeze([Object.freeze({
      providerKey:'990001', title:intent.candidateDisplayTitle,
      originalTitle:intent.candidateDisplayTitle, releaseYear:intent.yearHint ?? 2008,
      regionCodes:Object.freeze(['US']), genreCodes:Object.freeze(['18']),
    })]),
    productIntegrationHandleResolver: ({ intent, operationId, artifactKind }) =>
      productHandle(intent, operationId, artifactKind || null),
    currentProductIntegrationHandleResolver: ({ providerKind, operationId, artifactKind }) =>
      productHandle({ integrationId:providerKind + '-main', configRevision:1 }, operationId, artifactKind || null),
    productProviderMetadataFetch: async ({ metadataFetchIntent:intent }) => {
      metadataCalls?.push(Object.freeze({
        libraRunId:intent.libraRunId,
        requestedFields:Object.freeze([...(intent.requestedFields || [])]),
      }));
      if (metadataGate) await metadataGate(intent);
      return Object.freeze({
        providerKind:'tmdb', integrationId:intent.integrationId, configRevision:intent.configRevision,
        descriptiveEntries:Object.freeze([
          { key:'director', value:'Scenario Director' },
          { key:'genre', value:'Drama' },
          { key:'plot', value:'Libra Handoff B scenario evidence' },
          { key:'title', value:'Scenario Movie' },
          { key:'tmdb_movie_id', value:intent.resolvedProviderIdentity.providerKey },
          { key:'year_or_release_date', value:2008 },
        ]),
        providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),
        peopleHints:Object.freeze([Object.freeze({
          displayName:'Scenario Actor', role:'actor',
          providerIdentities:Object.freeze([Object.freeze({
            provider:'tmdb', namespace:'tmdb_person', providerKey:'990101',
          })]),
        })]),
      });
    },
    productProviderArtifactFetch: async ({ artifactKind, resolvedProviderIdentity, integrationHandle }) =>
      Object.freeze({ resultKind:'acquired',
        bytes:Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex'), artifactKind,
        integrationId:integrationHandle.integrationId, configRevision:integrationHandle.configRevision,
        mediaType:'image/jpeg', resolvedProviderIdentity }),
  });
}

function dvPipeline(profileId, inputKinds, inputFormats, outputKind, outputFormat, label) {
  return Object.freeze({ pipelineProfileId:profileId, inputDynamicRangeKinds:Object.freeze(inputKinds),
    inputPixelFormats:Object.freeze(inputFormats), outputCodec:'hevc', outputDynamicRangeKind:outputKind,
    outputPixelFormat:outputFormat, outputColorProfile:outputKind==='sdr'
      ? Object.freeze({range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'})
      : Object.freeze({range:'source',primaries:'source',transfer:'source',matrix:'source'}),
    selfTestDigest:canonicalDigest({ label }) });
}

function d10DeviceSnapshot(deviceId, deviceClass, rateControlModes) {
  const capabilityPayload=Object.freeze({ supportedVideoCodecs:Object.freeze(['hevc']),
    supportedRateControlModes:Object.freeze(rateControlModes), validatedConcurrentSlots:1,
    validatedVideoPipelines:Object.freeze([
      dvPipeline('ordinary_to_hevc@1',['sdr','hdr10_compatible','hlg','unknown'],['yuv420p','yuv420p10le'],
        'unknown','encoder_selected',deviceId+'-ordinary'),
      dvPipeline('pq_bt2020_base_to_sdr_bt709_hevc@1',['dolby_vision'],['yuv420p10le'],
        'sdr','yuv420p',deviceId+'-dv'),
    ]) }),capabilityDigest=canonicalDigest(capabilityPayload),body={deviceId,deviceClass,probeRevision:1,
      capabilitySchemaRef:'platform.compute-device-capability@1',capabilityPayload,capabilityDigest,enabled:true,state:'ready',workerRef:null};
  return Object.freeze({...body,snapshotDigest:canonicalDigest(body)});
}

function d10PlatformRuntime() {
  const gpu=d10DeviceSnapshot('d10-ready-gpu','nvidia_nvenc',['target_size','strict_abr']),
    cpu=d10DeviceSnapshot('d10-ready-cpu','software_cpu',['two_pass_abr','strict_abr']),items=[gpu,cpu],
    refs=items.map((snapshot)=>{const body={deviceId:snapshot.deviceId,deviceClass:snapshot.deviceClass,
      probeRevision:snapshot.probeRevision,capabilityDigest:snapshot.capabilityDigest};return Object.freeze({...body,refDigest:canonicalDigest(body)});});
  return Object.freeze({
    listReadyDeviceRefs(query){const body={queryDigest:query.queryDigest,resultKind:'available',items:Object.freeze(refs)};
      return Object.freeze({...body,resultDigest:canonicalDigest(body)});},
    readDeviceSnapshot(query){const snapshot=items.find((item)=>item.deviceId===query.deviceId),body=snapshot&&
      snapshot.probeRevision===query.expectedProbeRevision&&snapshot.capabilityDigest===query.expectedCapabilityDigest
      ?{queryDigest:query.queryDigest,resultKind:'found',snapshot}:{queryDigest:query.queryDigest,resultKind:'not_found'};
      return Object.freeze({...body,resultDigest:canonicalDigest(body)});},
  });
}

function d10Profile5Probe() {
  const base=createCleanMediaProbe();
  return Object.freeze({ async probe(handle) {
    const observed=await base.probe(handle);
    if(!String(handle.location||'').includes('SDT-D10')||observed.resultKind!=='probed')return observed;
    const value=structuredClone(observed),video=value.videoStreams[0];
    Object.assign(video,{codec:'hevc',codecProfile:'main 10',pixelFormat:'yuv420p10le',bitDepth:10,chroma:'4:2:0',
      colorRange:'limited',colorPrimaries:'unknown',colorTransfer:'unknown',colorMatrix:'unknown',dynamicRangeKind:'dolby_vision',
      dolbyVision:{profile:5,level:6,rpuPresent:true,elPresent:false,blPresent:true,compatibilityId:0,
        baseLayerKind:'non_compatible'}});
    value.payloadDigest=canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='payloadDigest')));
    return Object.freeze(value);
  } });
}

function noCandidateMoviePilotFetch(calls) {
  return async (input,init={})=>{const url=new URL(String(input));calls.push(Object.freeze({path:url.pathname,method:init.method||'GET'}));
    if(url.host!=='moviepilot.test'||url.searchParams.get('token')!==MOVIEPILOT_KEY)return response(401,{detail:'denied'});
    if(url.pathname==='/api/v1/search/title')return response(200,{success:true,data:[]});
    if(url.pathname==='/api/v1/download/'||url.pathname==='/api/v1/history/download')return response(200,[]);
    if(url.pathname==='/api/v1/history/transfer')return response(200,{success:true,data:{list:[],total:0}});
    return response(404,{detail:'not found'});};
}

function temporarySpecProjectionFault(controller) {
  const participantIds = new Set(['run_freshness_read', 'run_lifecycle_read']);
  return (baseUnitOfWork) => Object.freeze({
    execute(participants) {
      return baseUnitOfWork.execute(participants.map((participant) => {
        if (!participantIds.has(participant.participantId)) return participant;
        return Object.freeze({ ...participant, execute(context) {
          let targetsRun = false;
          const wrappedContext = Object.freeze({
            owner:context.owner,
            commitTimeMs:context.commitTimeMs,
            repository(repositoryId) {
              const repository = context.repository(repositoryId);
              return Object.freeze({ invoke(statementId, parameters) {
                if (statementId === 'find_run' && parameters?.libra_run_id) {
                  if (controller.libraRunId === null) {
                    controller.libraRunId = parameters.libra_run_id;
                  }
                  targetsRun = parameters.libra_run_id === controller.libraRunId;
                }
                if (controller.enabled && targetsRun && statementId === 'find_spec') {
                  return null;
                }
                return repository.invoke(statementId, parameters);
              } });
            },
          });
          return participant.execute(wrappedContext);
        } });
      }));
    },
  });
}

function failAfterUnitOfWorkParticipant(controller) {
  return (baseUnitOfWork) => Object.freeze({
    execute(participants) {
      return baseUnitOfWork.execute(participants.map((participant) => {
        const repositoryIds = new Set(participant.repositories.map((item) => item.repositoryId));
        const selected = participant.participantId === controller.participantId &&
          (!controller.repositoryId || repositoryIds.has(controller.repositoryId));
        if (!selected) return participant;
        return Object.freeze({ ...participant, execute(context) {
          const result = participant.execute(context);
          if (controller.enabled) {
            controller.hitCount += 1;
            controller.enabled = false;
            const error = new Error('Injected product Composition Root crash window.');
            error.code = 'HELIX_TEST_CRASH_WINDOW';
            throw error;
          }
          return result;
        } });
      }));
    },
  });
}

function copyLifecycleSample(field, scenarioName) {
  const directory = path.join(field, scenarioName + ' (2008)');
  fs.mkdirSync(directory, { recursive:true });
  fs.copyFileSync(path.join(SOURCE_ROOT, 'SDT-M03-Multi-Movie-Directory',
    'SDT-M03A-H264-Needs-Transcode (2008).mkv'),
  path.join(directory, scenarioName + ' (2008).mkv'));
}

function reality(root) {
  const entries = [];
  const walk = (directory) => {
    for (const item of fs.readdirSync(directory, { withFileTypes:true })
      .sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)))) {
      const location = path.join(directory, item.name);
      if (item.isDirectory()) walk(location);
      else if (item.isFile()) {
        const stat = fs.statSync(location, { bigint:true });
        entries.push(Object.freeze({
          relativePath:path.relative(root, location).replaceAll('\\', '/'),
          sizeBytes:Number(stat.size), mtimeNs:String(stat.mtimeNs), ctimeNs:String(stat.ctimeNs),
        }));
      }
    }
  };
  walk(root);
  return Object.freeze({ count:entries.length, digest:canonicalDigest({ schema:'scenario-source-reality@1', entries }) });
}

function buildPremiumSample(root) {
  const video = path.join(SOURCE_ROOT, 'SDT-M04-4K-Premium (2008)', 'SDT-M04-4K-Premium (2008).mkv');
  const audio = path.join(SOURCE_ROOT, 'SDT-M12-Real-BDMV (2025)', 'BDMV', 'STREAM', '00001.m2ts');
  const targetDirectory = path.join(root, 'SDT-L06-Premium-4K-TrueHD (2025)');
  const target = path.join(targetDirectory, 'SDT-L06-Premium-4K-TrueHD (2025).mkv');
  fs.mkdirSync(targetDirectory, { recursive:true });
  const executed = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-y', '-i', video, '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-shortest', target],
  { windowsHide:true, encoding:'utf8', maxBuffer:1024 * 1024 });
  assert.equal(executed.status, 0, executed.stderr);
  assert.ok(fs.statSync(target).size > 0);
  return target;
}

async function session(host, apiKey) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey } });
  assert.equal(result.statusCode, 204, result.body);
  return result.headers['set-cookie'];
}

async function configureMoviePilot(host, cookie, landingRoot) {
  const tested = await host.inject({ method:'POST',
    url:'/v1/admin/settings/integrations/moviepilot/actions/test', headers:{ cookie }, payload:{
      kind:'moviepilot', idempotencyKey:'scenario-moviepilot-test', endpoint:'https://moviepilot.test',
      credential:{ kind:'api_key', value:MOVIEPILOT_KEY }, settings:{
        providerRequestSaveRoot:'/provider/downloads',providerOrganizedRoot:'/provider/organized',
        shelfDeckVisibleRoot:landingRoot,
      }, timeoutMs:5_000,
    } });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({ method:'PATCH', url:'/v1/admin/settings/integrations/moviepilot',
    headers:{ cookie }, payload:{ kind:'moviepilot', idempotencyKey:'scenario-moviepilot-save',
      expectedConfigRevision:0, connectionProofId:tested.json().connectionProofId } });
  assert.equal(saved.statusCode, 200, saved.body);
}

async function createShelf(host, cookie, shelfRoot, template = { templateId:SYSTEM_TEMPLATE_ID, revision:1 }, collisionPolicy = 'reject') {
  const result = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
    idempotencyKey:'scenario-shelf-create', shelfId:'scenario-shelf', name:'Libra scenario shelf',
    targetRootLocation:shelfRoot, ruleTemplateId:template.templateId, expectedTemplateRevision:template.revision,
    placementPolicy:{ folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}', nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}', posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy },
  } });
  assert.equal(result.statusCode, 201, result.body);
}

async function createD10Template(host,cookie) {
  const templateId='d10-bounded-template',headers={cookie};
  let result=await host.inject({method:'POST',url:`/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,headers,payload:{
    idempotencyKey:'d10-copy-template',sourceTemplateId:SYSTEM_TEMPLATE_ID,newTemplateId:templateId,
    name:'D10 one GiB test template',expectedSourceRevision:1}});assert.equal(result.statusCode,201,result.body);
  result=await host.inject({method:'GET',url:`/v1/admin/rule-templates/${templateId}/draft`,headers});assert.equal(result.statusCode,200,result.body);
  const rules=structuredClone(result.json().draft.rules),movie=rules.profileRuleSets.find((item)=>item.contentProfile==='movie'),
    branch=movie.decisionBranches.find((item)=>item.conditionKind==='rating_equals'&&item.rating===1);
  branch.requirements.space.maxSizeGiB=1;branch.requirements.space.maxSizeBytes=1024*1024*1024;
  movie.profileRuleSetDigest=canonicalDigest(Object.fromEntries(Object.entries(movie).filter(([key])=>key!=='profileRuleSetDigest')));
  const rulesDigest=canonicalDigest(rules);
  result=await host.inject({method:'PATCH',url:`/v1/admin/rule-templates/${templateId}/draft`,headers,payload:{
    idempotencyKey:'d10-patch-template',templateId,expectedDraftRevision:1,basePublishedRevision:1,
    rulesSchemaRef:RULES_SCHEMA_REF,rules,rulesDigest}});assert.equal(result.statusCode,200,result.body);
  const preview=await host.inject({method:'POST',url:`/v1/admin/rule-templates/${templateId}/actions/preview`,headers,payload:{
    idempotencyKey:'d10-preview-template',templateId,expectedCurrentRevision:1,expectedDraftRevision:2,expectedDraftDigest:rulesDigest}});
  assert.equal(preview.statusCode,200,preview.body);
  result=await host.inject({method:'POST',url:`/v1/admin/rule-templates/${templateId}/actions/publish`,headers,payload:{
    idempotencyKey:'d10-publish-template',templateId,expectedCurrentRevision:1,expectedDraftRevision:2,expectedDraftDigest:rulesDigest,
    previewId:preview.json().previewId,previewDigest:preview.json().previewDigest}});assert.equal(result.statusCode,200,result.body);
  return Object.freeze({templateId,revision:2});
}

async function createField(host, cookie, fieldId, fieldRoot) {
  const allowedExtensions = ['.avi','.bdmv','.bup','.clpi','.ifo','.iso','.m2ts','.m4v','.mkv','.mov','.mp4','.mpls','.ts','.vob','.wmv'];
  const policyValue = { includedDirectories:[], excludedDirectories:[], allowedExtensions,
    minimumSizeBytes:0, excludedMaterialKeys:[] };
  const access = { fieldId, revision:1, endpointId:fieldId + '-endpoint', rootLocation:fieldRoot,
    mountScopeId:fieldId + '-mount', mountScopeRevision:1,
    accessSchemaRef:'helix://fixtures/libra-handoff-b-scenario-access/v1' };
  const result = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
    idempotencyKey:fieldId + '-create', fieldId, name:fieldId, contentProfileHint:'movie',
    policy:{ extractionPolicyId:fieldId + '-policy', revision:1,
      policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
      policyDigest:canonicalDigest({ extractionPolicyId:fieldId + '-policy', revision:1, ...policyValue }) },
    access:{ ...access, accessDigest:canonicalDigest(access) },
  } });
  assert.equal(result.statusCode, 201, result.body);
}

async function observe(host, cookie, fieldId) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/material-fields/' + fieldId + '/actions/observe',
    headers:{ cookie }, payload:{ idempotencyKey:fieldId + '-observe', fieldId,
      expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:256 } });
  assert.equal(result.statusCode, 202,
    result.body + (lastRequestError ? '\n' + lastRequestError.stack : ''));
}

async function formation(host, cookie) {
  const response = await host.inject({ method:'GET', url:'/v1/admin/formation?limit=100', headers:{ cookie } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items;
}

async function waitRating(host, cookie, subjectId, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let current = null;
  while (Date.now() < deadline) {
    const result = await host.inject({ method:'GET',
      url:'/v1/admin/perception/records?targetType=subject&targetId=' + encodeURIComponent(subjectId),
      headers:{ cookie } });
    assert.equal(result.statusCode, 200, result.body);
    current = result.json().currentRating;
    if (current && predicate(current)) return current;
    await pause(100);
  }
  assert.fail('Rating did not reach the expected state: ' + JSON.stringify(current));
}

async function waitFor(host, cookie, predicate, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    items = await formation(host, cookie);
    if (predicate(items)) return items;
    await pause(100);
  }
  assert.fail('Formation did not reach the expected scenario state: ' + JSON.stringify(items));
}

async function waitDatabase(databasePath, predicate, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let observed = null;
  while (Date.now() < deadline) {
    const database = new Database(databasePath, { readonly:true });
    try {
      observed = predicate(database);
      if (observed) return observed;
    } finally { database.close(); }
    await pause(100);
  }
  assert.fail('Database did not reach the expected durable state: ' + JSON.stringify(observed));
}

async function waitForFile(location, child, errorPath, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(location)) return JSON.parse(fs.readFileSync(location, 'utf8'));
    if (fs.existsSync(errorPath)) assert.fail('Crash worker failed: ' + fs.readFileSync(errorPath, 'utf8'));
    if (child.exitCode !== null) assert.fail('Crash worker exited before reaching its boundary: ' + child.exitCode);
    await pause(50);
  }
  assert.fail('Crash worker did not reach its physical Effect boundary.');
}

async function terminateProcess(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGKILL');
  const result = await exited;
  assert.ok(result.signal === 'SIGKILL' || result.code !== 0,
    'Recovery fixture must simulate ungraceful process loss.');
}

function byScenario(items, scenarioId) {
  const matches = items.filter((item) => String(item.displayIdentity || '').includes(scenarioId));
  assert.equal(matches.length, 1, scenarioId + ' must resolve to exactly one Subject.');
  return matches[0];
}

async function rate(host, cookie, subject, rating, expectedRevision = 0, idempotencyKey = null) {
  const result = await host.inject({ method:'POST', url:'/v1/admin/perception/records', headers:{ cookie }, payload:{
    targetType:'subject', targetId:subject.subjectId, expectedRevision, rating,
    idempotencyKey:idempotencyKey || 'scenario-rating-' + rating + '-' + subject.subjectId,
  } });
  assert.equal(result.statusCode, 202,
    result.body + (lastRequestError ? '\n' + lastRequestError.stack : ''));
}

async function route(host, cookie, fieldId) {
  const result = await host.inject({ method:'PATCH', url:'/v1/admin/routing/material-fields/' + fieldId,
    headers:{ cookie }, payload:{ idempotencyKey:fieldId + '-routing', fieldId,
      expectedPolicyId:null, expectedRevision:0, policy:{ routingPolicyId:fieldId + '-routing-policy',
        mode:'direct', targets:[{ shelfId:'scenario-shelf', rank:1, matchExpression:{ nodeKind:'always' } }] } } });
  assert.equal(result.statusCode, 200, result.body);
}

async function expedite(host, cookie, run, idempotencyKey) {
  const result = await host.inject({ method:'POST',
    url:'/v1/admin/formation/runs/' + run.libraRunId + '/actions/expedite',
    headers:{ cookie }, payload:{ idempotencyKey,
      expectedRunStateRevision:run.stateRevision,
      expectedRunStateDigest:run.stateDigest } });
  assert.equal(result.statusCode, 200, result.body);
  return result.json();
}

const REQUIRED_SCENARIOS = Object.freeze([
  'SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G08','SDT-G09','SDT-L06',
]);
const CONTENT_AUDIT_SCENARIOS = Object.freeze([
  ...REQUIRED_SCENARIOS,
  'SDT-D02',
  'SDT-M08',
  'SDT-G01',
  'SDT-G06',
]);

function itemByScenario(items, scenarioId) {
  return items.find((item) => String(item.displayIdentity || '').includes(scenarioId)) || null;
}

function isOfferReady(item) {
  return item?.productionStage === 'handoff_b_ready' && item?.handoffB?.state === 'published' && item?.handoffB?.offerId;
}

async function waitForOrTimeout(host, cookie, predicate, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    items = await formation(host, cookie);
    if (predicate(items)) return Object.freeze({ hit:true, items });
    await pause(50);
  }
  return Object.freeze({ hit:false, items });
}

function runtimeSnapshot(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    return Object.freeze({
      fieldObservations:Number(database.prepare(
        "SELECT count(*) count FROM fx_supporting_works WHERE process_type='material_field' AND work_kind='field_observation'").get().count),
      executingMediaEffects:Number(database.prepare(`
        SELECT count(*) count FROM fx_workflow_events
         WHERE state='executing'
           AND capability_ref IN ('libra.media.remux@1','libra.media.transcode@1','libra.workspace.material.import@1')`).get().count),
      nonterminalWorks:Number(database.prepare(`
        SELECT count(*) count FROM fx_supporting_works
         WHERE owner_domain='libra' AND state NOT IN ('succeeded','failed','cancelled','superseded')`).get().count),
      nonterminalEvents:Number(database.prepare(`
        SELECT count(*) count FROM fx_workflow_events
         WHERE owner_domain='libra' AND state NOT IN ('succeeded','failed','cancelled','superseded')`).get().count),
    });
  } finally { database.close(); }
}

function offerMap(evidence) {
  return Object.freeze(Object.fromEntries(REQUIRED_SCENARIOS.map((id) => {
    const row = evidence.rows.find((item) => String(item.display_identity || '').includes(id));
    return [id, row?.offer_id || null];
  })));
}

function productEvidence(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const rows = database.prepare(`
      SELECT s.subject_id,i.display_identity,r.libra_run_id,r.state,r.priority_class,
             p.on_deck_package_id,p.offer_id,p.package_digest
        FROM libra_subjects s
        JOIN libra_runs r ON r.subject_id=s.subject_id
        LEFT JOIN libra_product_identity_revisions i
          ON i.subject_id=s.subject_id
         AND i.revision=(
           SELECT MAX(revision) FROM libra_product_identity_revisions
            WHERE subject_id=s.subject_id)
        LEFT JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
       WHERE r.state='active'
       ORDER BY i.display_identity`).all();
    const capabilityCounts = Object.fromEntries(database.prepare(`
      SELECT capability_ref,count(*) count FROM fx_workflow_events
       WHERE owner_domain='libra' GROUP BY capability_ref ORDER BY capability_ref`).all()
      .map((row) => [row.capability_ref, Number(row.count)]));
    return Object.freeze({
      rows:Object.freeze(rows), capabilityCounts:Object.freeze(capabilityCounts),
      packages:Number(database.prepare('SELECT count(*) count FROM libra_product_packages').get().count),
      consumedOffers:Number(database.prepare('SELECT count(*) count FROM libra_delivery_receipts').get().count),
      failedWorks:Number(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().count),
      failedEvents:Number(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().count),
      arcaEntries:Number(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count),
    });
  } finally { database.close(); }
}

test('P14 real bytes cover the Libra main production paths through open Handoff B Offers', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:420_000,
}, async (t) => {
  assert.equal(fs.statSync(SOURCE_ROOT).isDirectory(), true);
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-scenarios-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const supplemental = path.join(root, 'supplemental-field');
  const downloads = path.join(root, 'moviepilot-downloads');
  [admin, shelf, supplemental, downloads].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const premium = buildPremiumSample(supplemental);
  const external = path.join(downloads, 'SDT-M05-External-Upgrade.2025.2160p.mkv');
  fs.copyFileSync(premium, external);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(external, old, old);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const calls = [];
  let runtimeError = null;
  lastRequestError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), integrationFetch:moviePilotFetch(external, calls),
    ...productOptions(),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await configureMoviePilot(host, cookie, downloads);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-main-field', SOURCE_ROOT);
  await createField(host, cookie, 'p14-premium-field', supplemental);
  await observe(host, cookie, 'p14-main-field');
  await observe(host, cookie, 'p14-premium-field');

  const subjects = await waitFor(host, cookie, (items) =>
    ['SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G02','SDT-G08','SDT-G09','SDT-L06']
      .every((id) => items.some((item) => String(item.displayIdentity || '').includes(id))));
  await rate(host, cookie, byScenario(subjects, 'SDT-M03A'), 1);
  await rate(host, cookie, byScenario(subjects, 'SDT-M03B'), 2);
  await rate(host, cookie, byScenario(subjects, 'SDT-G02'), 3);
  await rate(host, cookie, byScenario(subjects, 'SDT-M02'), 4);
  await rate(host, cookie, byScenario(subjects, 'SDT-L06'), 5);
  await rate(host, cookie, byScenario(subjects, 'SDT-M05'), 5);
  await route(host, cookie, 'p14-main-field');
  await route(host, cookie, 'p14-premium-field');

  const required = REQUIRED_SCENARIOS;
  await waitFor(host, cookie, (items) => required.every((id) => isOfferReady(itemByScenario(items, id))), 330_000);
  assert.ifError(runtimeError);

  const evidence = productEvidence(path.join(dataDir, 'shelfdeck.db'));
  for (const id of required) {
    const rows = evidence.rows.filter((row) => String(row.display_identity || '').includes(id));
    assert.equal(rows.length, 1, id + ' must have exactly one active Run.');
    assert.ok(rows[0].offer_id, id + ' must have one open Handoff B Offer.');
  }
  assert.ok((evidence.capabilityCounts['libra.media.transcode@1'] || 0) >= 2);
  assert.ok((evidence.capabilityCounts['libra.media.remux@1'] || 0) >= 4);
  assert.ok((evidence.capabilityCounts['libra.external_material.package.verify@1'] || 0) >= 1);
  assert.equal(evidence.failedWorks, 0);
  assert.equal(evidence.failedEvents, 0);
  assert.equal(evidence.consumedOffers, 0);
  assert.equal(evidence.arcaEntries, 0);
  assert.ok(calls.some((item) => item.path === '/api/v1/download/add' && item.method === 'POST'));
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
  t.diagnostic('Libra main-path evidence: ' + JSON.stringify(evidence));
});

test('P14 one-movie product path accepts Handoff B and atomically establishes an Arca Shelf Entry', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const fixturePrefix = 'SDT-M01-Standalone-H264 (2008)';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-arca-ondeck-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const source = path.join(root, 'material-field');
  const shelf = path.join(root, 'shelf');
  [admin, source, shelf].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const sourceItems = fs.readdirSync(SOURCE_ROOT, { withFileTypes:true })
    .filter((item) => item.isFile() && item.name.startsWith(fixturePrefix));
  assert.ok(sourceItems.some((item) => item.name.endsWith('.mkv')));
  assert.ok(sourceItems.some((item) => item.name.endsWith('-poster.jpg')));
  for (const item of sourceItems) fs.copyFileSync(path.join(SOURCE_ROOT, item.name), path.join(source, item.name));
  const sourceBefore = reality(source);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  const hostOptions = Object.freeze({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), ...productOptions(),
    deferredDeliveryKeys:Object.freeze([]),
    onExecutionRuntimeError(error) {
      if (!runtimeError && process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
      runtimeError = error;
    },
  });
  let host = await createCleanServiceHost(hostOptions);
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'arca-ondeck-field', source);
  await observe(host, cookie, 'arca-ondeck-field');
  await waitFor(host, cookie, (items) => items.some((item) => String(item.displayIdentity || '').includes('SDT-M01')));
  await route(host, cookie, 'arca-ondeck-field');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const terminal = await waitDatabase(databasePath, (database) => {
    const entryCount = Number(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count);
    const failedWorks = Number(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'").get().count);
    const failedEvents = Number(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'").get().count);
    const completedRuns = Number(database.prepare("SELECT count(*) count FROM libra_runs WHERE state='completed'").get().count);
    const acceptedAcked = Number(database.prepare("SELECT count(*) count FROM fx_outbox WHERE message_kind='arca.product.accepted@1' AND state='fully_acked'").get().count);
    return failedWorks || failedEvents ||
      (entryCount === 1 && completedRuns === 1 && acceptedAcked === 1)
      ? { entryCount, failedWorks, failedEvents, completedRuns, acceptedAcked }
      : null;
  }, 180_000);
  assert.deepEqual(terminal, {
    entryCount:1,
    failedWorks:0,
    failedEvents:0,
    completedRuns:1,
    acceptedAcked:1,
  });
  assert.ifError(runtimeError);

  const database = new Database(databasePath, { readonly:true });
  let entryId;
  try {
    const one = (table) => Number(database.prepare(`SELECT count(*) count FROM ${table}`).get().count);
    assert.equal(one('arca_acceptance_attempts'), 1);
    assert.equal(one('arca_acceptance_decisions'), 1);
    assert.equal(one('arca_ondeck_custodies'), 1);
    assert.equal(one('arca_ondeck_runs'), 1);
    assert.equal(one('arca_shelf_entries'), 1);
    assert.equal(one('arca_inventory_representations'), 1);
    assert.equal(one('arca_deck_fact_revisions'), 1);
    assert.equal(one('arca_offload_completions'), 1);
    assert.equal(one('libra_delivery_receipts'), 1);
    assert.equal(Number(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state!='succeeded'").get().count), 0);
    assert.equal(Number(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state!='succeeded'").get().count), 0);
    const capabilityCounts = Object.fromEntries(database.prepare("SELECT capability_ref,count(*) count FROM fx_workflow_events WHERE owner_domain='arca' GROUP BY capability_ref").all()
      .map((row) => [row.capability_ref, Number(row.count)]));
    for (const capability of [
      'arca.acceptance.identity.verify@1','arca.acceptance.metadata.verify@1','arca.acceptance.structure.verify@1',
      'arca.acceptance.mandatory_media.verify@1','arca.acceptance.space.verify@1','arca.acceptance.inventory_feasibility.observe@1',
      'arca.acceptance.accept.commit@1','arca.inventory.target_slot.prepare@1','arca.inventory.product.stage@1',
      'arca.inventory.staged.verify@1','arca.inventory.final_product.verify@1','arca.inventory.placement.switch@1',
      'arca.ondeck.fulfillment.verify@1','arca.ondeck.commit@1',
    ]) assert.equal(capabilityCounts[capability], 1, capability);
    entryId = database.prepare('SELECT shelf_entry_id FROM arca_shelf_entries').get().shelf_entry_id;
  } finally { database.close(); }

  const collection = await host.inject({ method:'GET', url:'/v1/admin/collection', headers:{ cookie } });
  assert.equal(collection.statusCode, 200, collection.body);
  assert.equal(collection.json().items.length, 1);
  assert.match(collection.json().items[0].displayIdentity,
    /SDT-M01|Scenario Movie|Big Buck Bunny/);
  assert.equal(collection.json().items[0].hasPoster, true);
  const poster = await host.inject({ method:'GET', url:'/v1/admin/collection/' + entryId + '/poster', headers:{ cookie } });
  assert.equal(poster.statusCode, 200, poster.body);
  assert.match(String(poster.headers['content-type'] || ''), /^image\//);
  await waitDatabase(databasePath, (database) => {
    const rows = database.prepare(
      'SELECT assessment_kind,result FROM arca_aftercare_assessments WHERE shelf_entry_id=?',
    ).all(entryId);
    return rows.length >= 3 &&
      ['custody','presentation','conformance'].every((kind) =>
        rows.some((row) => row.assessment_kind === kind && row.result === 'healthy'));
  });
  const nfoLocations = (() => {
    const found = [];
    const pending = [shelf];
    while (pending.length) {
      const directory = pending.pop();
      for (const item of fs.readdirSync(directory, { withFileTypes:true })) {
        const location = path.join(directory, item.name);
        if (item.isDirectory()) pending.push(location);
        else if (item.isFile() && item.name.toLowerCase().endsWith('.nfo')) found.push(location);
      }
    }
    return found;
  })();
  assert.ok(nfoLocations.length > 0, 'The established Inventory must contain an NFO before the repair scenario.');
  const beforeRepair = new Database(databasePath, { readonly:true });
  let oldNfoMaterialKeys;
  try {
    oldNfoMaterialKeys = beforeRepair.prepare(
      "SELECT material_key FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=1 AND role='metadata_sidecar' AND lower(location) LIKE '%.nfo' ORDER BY material_key",
    ).all(entryId).map((row) => row.material_key);
  } finally { beforeRepair.close(); }
  assert.equal(oldNfoMaterialKeys.length, nfoLocations.length,
    'Every pre-repair NFO must be represented by an exact Inventory Material.');
  for (const nfoLocation of nfoLocations) fs.unlinkSync(nfoLocation);
  const check = await host.inject({ method:'POST',
    url:'/v1/admin/care/' + entryId + '/actions/check', headers:{ cookie },
    payload:{ idempotencyKey:'repair-missing-nfo' } });
  assert.equal(check.statusCode, 202, check.body);
  const repaired = await waitDatabase(databasePath, (database) => {
    const entry = database.prepare(
      'SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryId);
    const one = database.prepare(
      "SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=? AND state='resolved'",
    ).get(entryId);
    const failedWorks = database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'",
    ).get().count;
    const failedEvents = database.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'",
    ).get().count;
    return failedWorks || failedEvents ||
      (Number(entry?.current_inventory_revision) === 2 && Number(one.count) === 1)
      ? { inventoryRevision:Number(entry?.current_inventory_revision || 0),
        resolvedCases:Number(one.count), failedWorks:Number(failedWorks),
        failedEvents:Number(failedEvents) }
      : null;
  }, 180_000);
  assert.deepEqual(repaired, {
    inventoryRevision:2,
    resolvedCases:1,
    failedWorks:0,
    failedEvents:0,
  });
  const repairedNfoLocations = [];
  for (const directory of fs.readdirSync(shelf, { withFileTypes:true })) {
    if (!directory.isDirectory()) continue;
    for (const item of fs.readdirSync(path.join(shelf, directory.name), { withFileTypes:true })) {
      if (item.isFile() && item.name.toLowerCase().endsWith('.nfo'))
        repairedNfoLocations.push(path.join(shelf, directory.name, item.name));
    }
  }
  assert.equal(repairedNfoLocations.length, 1, 'Aftercare must rematerialize one canonical NFO.');
  const care = await host.inject({ method:'GET', url:'/v1/admin/care/' + entryId, headers:{ cookie } });
  assert.equal(care.statusCode, 200, care.body);
  assert.equal(care.json().health.state, 'healthy');
  assert.equal(care.json().history.commits.length, 1);
  const afterRepair = new Database(databasePath, { readonly:true });
  try {
    for (const oldNfoMaterialKey of oldNfoMaterialKeys) {
      const oldControl = afterRepair.prepare(
        'SELECT state,owner_domain,owner_scope_id FROM fx_material_controls WHERE material_key=?',
      ).get(oldNfoMaterialKey);
      assert.equal(oldControl.state, 'released');
      assert.equal(oldControl.owner_domain, null);
    }
    const currentNfo = afterRepair.prepare(
      "SELECT material_key FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=2 AND role='metadata_sidecar'",
    ).get(entryId);
    assert.ok(currentNfo?.material_key);
    assert.equal(oldNfoMaterialKeys.includes(currentNfo.material_key), false);
    const newControl = afterRepair.prepare(
      'SELECT state,owner_domain,owner_scope_type,owner_scope_id FROM fx_material_controls WHERE material_key=?',
    ).get(currentNfo.material_key);
    assert.deepEqual(newControl, {
      state:'controlled', owner_domain:'arca',
      owner_scope_type:'shelf_entry', owner_scope_id:entryId,
    });
  } finally { afterRepair.close(); }
  const posterLocations = [];
  const posterPending = [shelf];
  while (posterPending.length) {
    const directory = posterPending.pop();
    for (const item of fs.readdirSync(directory, { withFileTypes:true })) {
      const location = path.join(directory, item.name);
      if (item.isDirectory()) posterPending.push(location);
      else if (item.isFile() && /(^|[-_. ])poster\.(jpg|jpeg|png|webp)$/i.test(item.name))
        posterLocations.push(location);
    }
  }
  assert.ok(posterLocations.length > 0,
    'The established Inventory must contain a Poster before the repair scenario.');
  const beforePosterRepair = new Database(databasePath, { readonly:true });
  let oldPosterMaterialKeys;
  try {
    oldPosterMaterialKeys = beforePosterRepair.prepare(
      "SELECT material_key FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=2 AND role='poster' ORDER BY material_key",
    ).all(entryId).map((row) => row.material_key);
  } finally { beforePosterRepair.close(); }
  assert.equal(oldPosterMaterialKeys.length, posterLocations.length,
    'Every pre-repair Poster must be represented by an exact Inventory Material.');
  for (const posterLocation of posterLocations) fs.unlinkSync(posterLocation);
  const posterCheck = await host.inject({ method:'POST',
    url:'/v1/admin/care/' + entryId + '/actions/check', headers:{ cookie },
    payload:{ idempotencyKey:'repair-missing-poster' } });
  assert.equal(posterCheck.statusCode, 202, posterCheck.body);
  const posterRepaired = await waitDatabase(databasePath, (database) => {
    const entry = database.prepare(
      'SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryId);
    const resolved = database.prepare(
      "SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=? AND state='resolved'",
    ).get(entryId);
    const failedWorks = database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'",
    ).get().count;
    const failedEvents = database.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'",
    ).get().count;
    return failedWorks || failedEvents ||
      (Number(entry?.current_inventory_revision) === 3 && Number(resolved.count) === 2)
      ? { inventoryRevision:Number(entry?.current_inventory_revision || 0),
        resolvedCases:Number(resolved.count), failedWorks:Number(failedWorks),
        failedEvents:Number(failedEvents) }
      : null;
  }, 180_000);
  assert.deepEqual(posterRepaired, {
    inventoryRevision:3,
    resolvedCases:2,
    failedWorks:0,
    failedEvents:0,
  });
  const afterPosterRepair = new Database(databasePath, { readonly:true });
  try {
    for (const oldPosterMaterialKey of oldPosterMaterialKeys) {
      const oldControl = afterPosterRepair.prepare(
        'SELECT state,owner_domain,owner_scope_id FROM fx_material_controls WHERE material_key=?',
      ).get(oldPosterMaterialKey);
      assert.equal(oldControl.state, 'released');
      assert.equal(oldControl.owner_domain, null);
    }
    const currentPosters = afterPosterRepair.prepare(
      "SELECT material_key,location FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=3 AND role='poster'",
    ).all(entryId);
    assert.equal(currentPosters.length, 1);
    assert.equal(oldPosterMaterialKeys.includes(currentPosters[0].material_key), false);
    assert.equal(fs.existsSync(currentPosters[0].location), true);
    const newControl = afterPosterRepair.prepare(
      'SELECT state,owner_domain,owner_scope_type,owner_scope_id FROM fx_material_controls WHERE material_key=?',
    ).get(currentPosters[0].material_key);
    assert.deepEqual(newControl, {
      state:'controlled', owner_domain:'arca',
      owner_scope_type:'shelf_entry', owner_scope_id:entryId,
    });
  } finally { afterPosterRepair.close(); }
  const finalCare = await host.inject({ method:'GET', url:'/v1/admin/care/' + entryId,
    headers:{ cookie } });
  assert.equal(finalCare.statusCode, 200, finalCare.body);
  assert.equal(finalCare.json().health.state, 'healthy');
  assert.equal(finalCare.json().history.commits.length, 2);
  assert.deepEqual(reality(source), sourceBefore);
  assert.equal(fs.readdirSync(shelf).some((item) => item.startsWith('.shelfdeck-stage-')), false);

  // A published Shelf Placement revision is an exact Aftercare Basis change.
  // Existing Inventory must migrate through the Care chain instead of being
  // rewritten by the Shelf administration command itself.
  const migratedShelf = path.join(root, 'migrated-shelf');
  fs.mkdirSync(migratedShelf, { recursive:true });
  const placementValue = Object.freeze({
    folderTemplate:'{title} ({year})', collisionPolicy:'reject',
  });
  const placementDraft = Object.freeze({
    shelfId:'scenario-shelf', expectedPlacementRevision:1,
    target:Object.freeze({
      endpointId:'scenario-shelf-migrated-endpoint',
      rootLocation:migratedShelf,
      mountScopeId:'scenario-shelf-migrated-mount',
      mountScopeRevision:2,
    }),
    placement:Object.freeze({
      schemaRef:'helix://contracts/policies/ArcaShelfPlacementPolicy/v1',
      value:placementValue,
      digest:canonicalDigest(placementValue),
    }),
  });
  const placementPreview = await host.inject({
    method:'POST',
    url:'/v1/admin/shelves/scenario-shelf/placement/actions/preview',
    headers:{ cookie },
    payload:{ idempotencyKey:'aftercare-placement-preview', ...placementDraft },
  });
  assert.equal(placementPreview.statusCode, 200, placementPreview.body);
  const placementRevision = await host.inject({
    method:'PATCH', url:'/v1/admin/shelves/scenario-shelf/placement', headers:{ cookie },
    payload:{
      idempotencyKey:'aftercare-placement-publish', ...placementDraft,
      expectedCurrentTargetDigest:placementPreview.json().currentTargetDigest,
      previewId:placementPreview.json().previewId,
      previewDigest:placementPreview.json().previewDigest,
    },
  });
  assert.equal(placementRevision.statusCode, 200, placementRevision.body);
  assert.equal(placementRevision.json().shelf.currentPlacementRevision, 2);
  const migrated = await waitDatabase(databasePath, (database) => {
    const entry = database.prepare(
      'SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryId);
    const resolved = database.prepare(
      "SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=? AND state='resolved'",
    ).get(entryId);
    const failedWorks = Number(database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'",
    ).get().count);
    const failedEvents = Number(database.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'",
    ).get().count);
    return failedWorks || failedEvents ||
      (Number(entry?.current_inventory_revision) === 4 && Number(resolved.count) === 3)
      ? Object.freeze({ inventoryRevision:Number(entry?.current_inventory_revision || 0),
        resolvedCases:Number(resolved.count), failedWorks, failedEvents })
      : null;
  }, 180_000);
  assert.deepEqual(migrated, {
    inventoryRevision:4, resolvedCases:3, failedWorks:0, failedEvents:0,
  });
  const migrationEvidence = new Database(databasePath, { readonly:true });
  try {
    const locations = migrationEvidence.prepare(
      'SELECT endpoint_id,location FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=4 ORDER BY ordinal',
    ).all(entryId);
    assert.ok(locations.length >= 3);
    for (const item of locations) {
      assert.equal(item.endpoint_id, 'scenario-shelf-migrated-endpoint');
      assert.equal(path.resolve(item.location).startsWith(path.resolve(migratedShelf) + path.sep), true);
      assert.equal(fs.existsSync(item.location), true);
    }
  } finally { migrationEvidence.close(); }
  assert.equal(reality(shelf).count, 0,
    'Superseded Placement material must be settled only after verified migration.');
  assert.ok(reality(migratedShelf).count >= 3);
  const migratedCare = await host.inject({ method:'GET', url:'/v1/admin/care/' + entryId,
    headers:{ cookie } });
  assert.equal(migratedCare.statusCode, 200, migratedCare.body);
  assert.equal(migratedCare.json().health.state, 'healthy');
  assert.equal(migratedCare.json().basis.placementRevision, 2);
  assert.equal(migratedCare.json().history.commits.length, 3);

  await host.close();
  host = await createCleanServiceHost(hostOptions);
  await pause(1_500);
  assert.ifError(runtimeError);
  const restarted = new Database(databasePath, { readonly:true });
  let currentPrimaryLocation;
  let currentNfoLocation;
  let renderCountBeforeBlockedRepair;
  try {
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count, 1);
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_ondeck_runs').get().count, 1);
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_ondeck_commit_receipts').get().count, 1);
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_offload_completions').get().count, 1);
    assert.equal(restarted.prepare("SELECT count(*) count FROM arca_aftercare_cases WHERE state='resolved'").get().count, 3);
    assert.equal(restarted.prepare('SELECT current_inventory_revision FROM arca_shelf_entries').get().current_inventory_revision, 4);
    currentPrimaryLocation = restarted.prepare(
      "SELECT location FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=4 AND role='primary_payload'",
    ).get(entryId).location;
    currentNfoLocation = restarted.prepare(
      "SELECT location FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=4 AND role='metadata_sidecar' AND lower(location) LIKE '%.nfo'",
    ).get(entryId).location;
    renderCountBeforeBlockedRepair = Number(restarted.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='arca.aftercare.text_artifact.render@1' AND state='succeeded'",
    ).get().count);
  } finally { restarted.close(); }

  // One unrepairable Primary gap fences the whole Care action.  A repairable
  // NFO gap in the same fresh Basis must not be partially fixed first.
  fs.unlinkSync(currentPrimaryLocation);
  fs.unlinkSync(currentNfoLocation);
  const blockedCheck = await host.inject({ method:'POST',
    url:'/v1/admin/care/' + entryId + '/actions/check', headers:{ cookie },
    payload:{ idempotencyKey:'primary-missing-blocks-partial-repair' } });
  assert.equal(blockedCheck.statusCode, 202, blockedCheck.body);
  await waitDatabase(databasePath, (database) => {
    const findings = database.prepare(`SELECT finding_kind FROM arca_aftercare_findings
      WHERE state='open' ORDER BY created_at_ms DESC`).all().map((row) => row.finding_kind);
    return findings.includes('custody:primary_missing') && findings.includes('custody:artifact_missing')
      ? true : null;
  }, 60_000);
  const attention = await host.inject({ method:'GET', url:'/v1/admin/care/' + entryId,
    headers:{ cookie } });
  assert.equal(attention.statusCode, 200, attention.body);
  assert.equal(attention.json().health.state, 'attention_required');
  const blockedEvidence = new Database(databasePath, { readonly:true });
  try {
    assert.equal(blockedEvidence.prepare(
      'SELECT current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryId).current_inventory_revision, 4);
    assert.equal(blockedEvidence.prepare(
      "SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=? AND state='resolved'",
    ).get(entryId).count, 3);
    assert.equal(blockedEvidence.prepare(
      "SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=? AND state='active'",
    ).get(entryId).count, 0);
    assert.equal(Number(blockedEvidence.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE capability_ref='arca.aftercare.text_artifact.render@1' AND state='succeeded'",
    ).get().count), renderCountBeforeBlockedRepair,
    'An unrepairable Primary gap must block the otherwise repairable NFO effect.');
  } finally { blockedEvidence.close(); }
  assert.equal(fs.existsSync(currentNfoLocation), false);

  // The clean default Policy is disabled. Enabling a deterministic retention
  // rule must create a Review Candidate through Automation Work, while the
  // later direct exit still starts from Review and does not fabricate another
  // Candidate.
  const defaultOffdeckPolicy = await host.inject({ method:'GET',
    url:'/v1/admin/offdeck/policies', headers:{ cookie } });
  assert.equal(defaultOffdeckPolicy.statusCode, 200, defaultOffdeckPolicy.body);
  assert.equal(defaultOffdeckPolicy.json().status, 'disabled');
  const disabledEvaluation = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/actions/evaluate', headers:{ cookie },
    payload:{ idempotencyKey:'evaluate-disabled-offdeck-policy' } });
  assert.equal(disabledEvaluation.statusCode, 202, disabledEvaluation.body);
  assert.equal(disabledEvaluation.json().matchedCount, 0);
  const publishedOffdeckPolicy = await host.inject({ method:'PATCH',
    url:'/v1/admin/offdeck/policies', headers:{ cookie }, payload:{
      expectedRevision:1, idempotencyKey:'enable-offdeck-policy', status:'active',
      duplicateScheduleEnabled:false, entryRules:[{ ruleId:'retention-now',
        shelfScope:'all', condition:{ kind:'retention_age', parameters:{ minimumAgeDays:0 } } }],
    } });
  assert.equal(publishedOffdeckPolicy.statusCode, 200, publishedOffdeckPolicy.body);
  assert.equal(publishedOffdeckPolicy.json().revision, 2);
  const enabledEvaluation = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/actions/evaluate', headers:{ cookie },
    payload:{ idempotencyKey:'evaluate-active-offdeck-policy' } });
  assert.equal(enabledEvaluation.statusCode, 202, enabledEvaluation.body);
  assert.equal(enabledEvaluation.json().matchedCount, 1);
  const policyCandidate = await waitDatabase(databasePath, (database) =>
    database.prepare("SELECT candidate_id,candidate_kind,state FROM arca_offdeck_review_candidates WHERE shelf_entry_id=? AND state='open'").get(entryId) || null,
  60_000);
  assert.equal(policyCandidate.candidate_kind, 'entry');

  // A direct user Off-deck intent must reuse the formal Review and
  // Authorization chain. The current Primary and NFO are already absent, so
  // this also proves exact authorized-identity absence is a valid terminal
  // outcome while the remaining Inventory members are physically deleted.
  const sentinelLocation = path.join(migratedShelf, 'not-in-offdeck-scope.keep');
  fs.writeFileSync(sentinelLocation, 'must remain outside the immutable destruction scope', 'utf8');
  const scopeBefore = new Database(databasePath, { readonly:true });
  let currentInventoryLocations;
  try {
    currentInventoryLocations = scopeBefore.prepare(
      'SELECT material_key,location FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=4 ORDER BY ordinal',
    ).all(entryId);
  } finally { scopeBefore.close(); }
  assert.ok(currentInventoryLocations.length >= 3);
  const reviewResponse = await host.inject({ method:'POST', url:'/v1/admin/offdeck/reviews',
    headers:{ cookie }, payload:{ shelfEntryId:entryId, originKind:'direct_intent',
      actorId:'admin-e2e', idempotencyKey:'direct-offdeck-after-aftercare' } });
  assert.equal(reviewResponse.statusCode, 201, reviewResponse.body);
  assert.equal(reviewResponse.json().state, 'open');
  assert.equal(reviewResponse.json().originKind, 'direct_intent');
  assert.equal(reviewResponse.json().scopes.length, 1);
  const reviewId = reviewResponse.json().reviewId;
  const confirmResponse = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/reviews/' + reviewId + '/actions/confirm-selection',
    headers:{ cookie }, payload:{ actorId:'admin-e2e', idempotencyKey:'confirm-direct-offdeck' } });
  assert.equal(confirmResponse.statusCode, 200, confirmResponse.body);
  assert.equal(confirmResponse.json().state, 'selection_confirmed');
  assert.equal(confirmResponse.json().selection.highVolume, false);
  const authorizationResponse = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/authorizations', headers:{ cookie },
    payload:{ reviewId, actorId:'admin-e2e', idempotencyKey:'authorize-direct-offdeck' } });
  assert.equal(authorizationResponse.statusCode, 202, authorizationResponse.body);
  assert.equal(authorizationResponse.json().cases.length, 1);
  const offdeckCaseId = authorizationResponse.json().cases[0];
  const offdeckTerminal = await waitDatabase(databasePath, (database) => {
    const entry = database.prepare(
      'SELECT status,current_deck_fact_revision FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryId);
    const currentCase = database.prepare(
      'SELECT state FROM arca_offdeck_cases WHERE offdeck_case_id=?',
    ).get(offdeckCaseId);
    const failedWorks = Number(database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'",
    ).get().count);
    const failedEvents = Number(database.prepare(
      "SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'",
    ).get().count);
    return failedWorks || failedEvents || currentCase?.state === 'blocked' ||
      (entry?.status === 'offdecked' && currentCase?.state === 'completed')
      ? { entryStatus:entry?.status, deckRevision:Number(entry?.current_deck_fact_revision || 0),
        caseState:currentCase?.state, failedWorks, failedEvents }
      : null;
  }, 120_000);
  assert.deepEqual(offdeckTerminal, { entryStatus:'offdecked', deckRevision:2,
    caseState:'completed', failedWorks:0, failedEvents:0 });
  for (const item of currentInventoryLocations) assert.equal(fs.existsSync(item.location), false,
    'Authorized Inventory member must reach an exact terminal destruction outcome: ' + item.material_key);
  assert.equal(fs.readFileSync(sentinelLocation, 'utf8'),
    'must remain outside the immutable destruction scope');
  const offdeckEvidence = new Database(databasePath, { readonly:true });
  try {
    assert.equal(Number(offdeckEvidence.prepare(
      'SELECT count(*) count FROM arca_offdeck_deletion_evidence WHERE destruction_scope_id=(SELECT destruction_scope_id FROM arca_offdeck_authorizations WHERE authorization_id=(SELECT current_authorization_id FROM arca_offdeck_cases WHERE offdeck_case_id=?))',
    ).get(offdeckCaseId).count), currentInventoryLocations.length);
    assert.equal(Number(offdeckEvidence.prepare(
      "SELECT count(*) count FROM fx_material_controls WHERE owner_scope_id=? AND state='controlled'",
    ).get(entryId).count), 0);
    const primaryCount = Number(offdeckEvidence.prepare(
      "SELECT count(*) count FROM arca_offdeck_scope_materials WHERE destruction_scope_id=(SELECT destruction_scope_id FROM arca_offdeck_authorizations WHERE authorization_id=(SELECT current_authorization_id FROM arca_offdeck_cases WHERE offdeck_case_id=?)) AND delete_condition='exclusive_primary'",
    ).get(offdeckCaseId).count);
    const relatedCount = currentInventoryLocations.length - primaryCount;
    assert.equal(Number(offdeckEvidence.prepare(
      "SELECT count(*) count FROM fx_workflow_events e JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE e.owner_domain='arca' AND w.process_type='arca_offdeck_case' AND e.state='succeeded'",
    ).get().count), primaryCount + relatedCount * 2 + 3);
  } finally { offdeckEvidence.close(); }
});

test('P14 Off-deck high-volume review requires a separate escalation and closes ten Entries independently', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:360_000,
}, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-arca-offdeck-volume-'));
  const dataDir = path.join(root, 'data'), admin = path.join(root, 'admin');
  const source = path.join(root, 'material-field'), shelf = path.join(root, 'shelf');
  [admin, source, shelf].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const seedVideo = path.join(SOURCE_ROOT, 'SDT-M01-Standalone-H264 (2008).mkv');
  assert.equal(fs.existsSync(seedVideo), true);
  for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
    fs.copyFileSync(seedVideo, path.join(source,
      `SDT-OFFDECK-${String(ordinal).padStart(2, '0')} (2008).mkv`));
  }
  const sourceBefore = reality(source);
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  const baseProductOptions = productOptions();
  const uniqueProductOptions = Object.freeze({ ...baseProductOptions,
    async productProviderMetadataFetch(request) {
      const value = await baseProductOptions.productProviderMetadataFetch(request);
      const title = 'Scenario ' + request.metadataFetchIntent.libraRunId.slice(-12);
      return Object.freeze({ ...value, descriptiveEntries:Object.freeze(
        value.descriptiveEntries.map((entry) => entry.key === 'title'
          ? Object.freeze({ ...entry, value:title }) : entry)),
      });
    },
  });
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin,
    secretRoot:SECRET, libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    ...uniqueProductOptions, deferredDeliveryKeys:Object.freeze([]),
    onExecutionRuntimeError(error) {
      if (!runtimeError && process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
      runtimeError ||= error;
    },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root,
      { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'offdeck-volume-field', source);
  await observe(host, cookie, 'offdeck-volume-field');
  await waitFor(host, cookie, (items) => items.length >= 10, 180_000);
  await route(host, cookie, 'offdeck-volume-field');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const entryIds = await waitDatabase(databasePath, (database) => {
    const rows = database.prepare("SELECT shelf_entry_id FROM arca_shelf_entries WHERE status='active' ORDER BY shelf_entry_id").all();
    return rows.length === 10 ? rows.map((row) => row.shelf_entry_id) : null;
  }, 240_000);
  assert.ifError(runtimeError);
  assert.equal(entryIds.length, 10);
  const sentinel = path.join(shelf, 'not-in-any-offdeck-scope.keep');
  fs.writeFileSync(sentinel, 'outside every immutable destruction scope', 'utf8');

  const cancellableReview = await host.inject({ method:'POST', url:'/v1/admin/offdeck/reviews',
    headers:{ cookie }, payload:{ shelfEntryId:entryIds[0], originKind:'direct_intent', actorId:'admin-e2e',
      idempotencyKey:'offdeck-cancel-before-authorization' } });
  assert.equal(cancellableReview.statusCode, 201, cancellableReview.body);
  const cancelledReview = await host.inject({ method:'DELETE',
    url:'/v1/admin/offdeck/reviews/' + cancellableReview.json().reviewId, headers:{ cookie },
    payload:{ idempotencyKey:'cancel-offdeck-before-authorization' } });
  assert.equal(cancelledReview.statusCode, 200, cancelledReview.body);
  assert.equal(cancelledReview.json().state, 'cancelled');
  const afterCancellation = new Database(databasePath, { readonly:true });
  try {
    assert.equal(Number(afterCancellation.prepare(
      "SELECT count(*) n FROM arca_offdeck_reservations WHERE shelf_entry_id=? AND state='active'",
    ).get(entryIds[0]).n), 0);
    assert.equal(afterCancellation.prepare(
      'SELECT status FROM arca_shelf_entries WHERE shelf_entry_id=?',
    ).get(entryIds[0]).status, 'active');
  } finally { afterCancellation.close(); }

  const review = await host.inject({ method:'POST', url:'/v1/admin/offdeck/reviews',
    headers:{ cookie }, payload:{ shelfEntryIds:entryIds, originKind:'batch', actorId:'admin-e2e',
      idempotencyKey:'offdeck-high-volume-ten-entries' } });
  assert.equal(review.statusCode, 201, review.body);
  const reviewId = review.json().reviewId;
  let preparedReview = review.json();
  for (let attempt = 0; preparedReview.state === 'preparing' && attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const refreshed = await host.inject({ method:'GET',
      url:'/v1/admin/offdeck/reviews/' + reviewId, headers:{ cookie } });
    assert.equal(refreshed.statusCode, 200, refreshed.body);
    preparedReview = refreshed.json();
  }
  assert.equal(preparedReview.state, 'open');
  const confirmation = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/reviews/' + reviewId + '/actions/confirm-selection',
    headers:{ cookie }, payload:{ actorId:'admin-e2e', idempotencyKey:'offdeck-volume-selection' } });
  assert.equal(confirmation.statusCode, 200, confirmation.body);
  assert.equal(confirmation.json().state, 'awaiting_escalation');
  assert.equal(confirmation.json().selection.entryCount, 10);
  assert.equal(confirmation.json().selection.highVolume, true);

  const premature = await host.inject({ method:'POST', url:'/v1/admin/offdeck/authorizations',
    headers:{ cookie }, payload:{ reviewId, actorId:'admin-e2e',
      idempotencyKey:'offdeck-volume-authorization-too-early' } });
  assert.notEqual(premature.statusCode, 202, premature.body);
  assert.equal(premature.json().error.code, 'ARCA_OFFDECK_AUTHORIZATION_NOT_READY');

  const escalation = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/reviews/' + reviewId + '/actions/confirm-high-volume',
    headers:{ cookie }, payload:{ actorId:'admin-e2e', idempotencyKey:'offdeck-volume-escalation' } });
  assert.equal(escalation.statusCode, 200, escalation.body);
  assert.equal(escalation.json().state, 'selection_confirmed');
  assert.ok(escalation.json().escalation?.escalationReceiptId);
  const authorizationResponse = await host.inject({ method:'POST',
    url:'/v1/admin/offdeck/authorizations', headers:{ cookie },
    payload:{ reviewId, actorId:'admin-e2e', idempotencyKey:'offdeck-volume-authorization' } });
  assert.equal(authorizationResponse.statusCode, 202, authorizationResponse.body);
  assert.equal(authorizationResponse.json().cases.length, 10);
  assert.deepEqual(authorizationResponse.json().blocked, []);

  const terminal = await waitDatabase(databasePath, (database) => {
    const completed = Number(database.prepare("SELECT count(*) n FROM arca_offdeck_cases WHERE state='completed'").get().n);
    const offdecked = Number(database.prepare("SELECT count(*) n FROM arca_shelf_entries WHERE status='offdecked'").get().n);
    const failedWorks = Number(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'").get().n);
    const failedEvents = Number(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'").get().n);
    const nonterminalWorks = Number(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='arca' AND state NOT IN ('succeeded','failed','cancelled','superseded')").get().n);
    const nonterminalEvents = Number(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='arca' AND state NOT IN ('succeeded','failed','cancelled','superseded')").get().n);
    return failedWorks || failedEvents || (completed === 10 && offdecked === 10 && nonterminalWorks === 0 && nonterminalEvents === 0)
      ? { completed, offdecked, failedWorks, failedEvents, nonterminalWorks, nonterminalEvents } : null;
  }, 180_000);
  assert.deepEqual(terminal, { completed:10, offdecked:10, failedWorks:0, failedEvents:0,
    nonterminalWorks:0, nonterminalEvents:0 });
  assert.ifError(runtimeError);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside every immutable destruction scope');
  assert.deepEqual(reality(source), sourceBefore);
  const finalDatabase = new Database(databasePath, { readonly:true });
  try {
    assert.equal(Number(finalDatabase.prepare(
      "SELECT count(*) n FROM fx_material_controls WHERE owner_domain='arca' AND state='controlled'",
    ).get().n), 0);
    assert.equal(Number(finalDatabase.prepare(
      "SELECT count(*) n FROM arca_offdeck_authorization_batches",
    ).get().n), 1);
    assert.equal(Number(finalDatabase.prepare(
      "SELECT count(*) n FROM arca_offdeck_escalation_receipts",
    ).get().n), 1);
    assert.equal(Number(finalDatabase.prepare(
      "SELECT count(*) n FROM arca_offdeck_authorizations",
    ).get().n), 10);
  } finally { finalDatabase.close(); }
});

test('P14 insufficient Shelf space rejects Handoff B without Arca custody, Control, or Shelf Entry', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const fixturePrefix = 'SDT-M01-Standalone-H264 (2008)';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-arca-rejection-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const source = path.join(root, 'material-field');
  const shelf = path.join(root, 'shelf');
  [admin, source, shelf].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  for (const item of fs.readdirSync(SOURCE_ROOT, { withFileTypes:true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(fixturePrefix))) {
    fs.copyFileSync(path.join(SOURCE_ROOT, item.name), path.join(source, item.name));
  }
  const sourceBefore = reality(source);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  const hostOptions = Object.freeze({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    ...productOptions(),
    deferredDeliveryKeys:Object.freeze([]),
    arcaStatfsSync:() => Object.freeze({ bavail:0n, bsize:4096n }),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
  });
  let host = await createCleanServiceHost(hostOptions);
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'arca-rejection-field', source);
  await observe(host, cookie, 'arca-rejection-field');
  await waitFor(host, cookie, (items) => items.some((item) => String(item.displayIdentity || '').includes('SDT-M01')));
  await route(host, cookie, 'arca-rejection-field');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const terminal = await waitDatabase(databasePath, (database) => {
    const receipt = database.prepare("SELECT result,rejection_digest,closure_digest FROM libra_delivery_receipts WHERE result='rejected'").get();
    const rejectedAcked = Number(database.prepare("SELECT count(*) count FROM fx_outbox WHERE message_kind='arca_product_rejected' AND state='fully_acked'").get().count);
    const failedWorks = Number(database.prepare("SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='arca' AND state='failed'").get().count);
    const failedEvents = Number(database.prepare("SELECT count(*) count FROM fx_workflow_events WHERE owner_domain='arca' AND state='failed'").get().count);
    return failedWorks || failedEvents || (receipt && rejectedAcked === 1)
      ? { receipt, rejectedAcked, failedWorks, failedEvents }
      : null;
  }, 180_000);
  assert.equal(terminal.receipt?.result, 'rejected');
  assert.ok(terminal.receipt?.rejection_digest);
  assert.ok(terminal.receipt?.closure_digest);
  assert.equal(terminal.rejectedAcked, 1);
  assert.equal(terminal.failedWorks, 0);
  assert.equal(terminal.failedEvents, 0);
  assert.ifError(runtimeError);
  const database = new Database(databasePath, { readonly:true });
  try {
    const count = (table) => Number(database.prepare(`SELECT count(*) count FROM ${table}`).get().count);
    assert.equal(count('arca_acceptance_attempts'), 1);
    assert.equal(count('arca_acceptance_decisions'), 1);
    assert.equal(count('arca_ondeck_custodies'), 0);
    assert.equal(count('arca_ondeck_runs'), 0);
    assert.equal(count('arca_shelf_entries'), 0);
    assert.equal(count('arca_deck_fact_revisions'), 0);
    assert.equal(database.prepare("SELECT state FROM libra_runs").get().state, 'active');
    assert.equal(Number(database.prepare("SELECT count(*) count FROM fx_material_controls WHERE owner_domain='arca'").get().count), 0);
  } finally { database.close(); }
  assert.deepEqual(reality(source), sourceBefore);
  assert.deepEqual(fs.readdirSync(shelf), []);
  await host.close();
  host = await createCleanServiceHost(hostOptions);
  await pause(1_500);
  assert.ifError(runtimeError);
  const restarted = new Database(databasePath, { readonly:true });
  try {
    assert.equal(restarted.prepare("SELECT count(*) count FROM libra_delivery_receipts WHERE result='rejected'").get().count, 1);
    assert.equal(restarted.prepare("SELECT count(*) count FROM fx_outbox WHERE message_kind='arca_product_rejected' AND state='fully_acked'").get().count, 1);
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_ondeck_runs').get().count, 0);
    assert.equal(restarted.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count, 0);
  } finally { restarted.close(); }
});

test('P14 restart and lost wake continue legal Libra Runs to open Handoff B Offers', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:420_000,
}, async (t) => {
  assert.equal(fs.statSync(SOURCE_ROOT).isDirectory(), true);
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-restart-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const supplemental = path.join(root, 'supplemental-field');
  const downloads = path.join(root, 'moviepilot-downloads');
  [admin, shelf, supplemental, downloads].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const premium = buildPremiumSample(supplemental);
  const external = path.join(downloads, 'SDT-M05-External-Upgrade.2025.2160p.mkv');
  fs.copyFileSync(premium, external);
  const old = new Date(Date.now() - 120_000);
  fs.utimesSync(external, old, old);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const calls = [];
  const integrationFetch = moviePilotFetch(external, calls);
  let runtimeError = null;
  lastRequestError = null;
  const hostOptions = () => Object.freeze({
    dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), integrationFetch,
    ...productOptions(),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    onRequestError(error) { lastRequestError = error; },
  });
  let host = await createCleanServiceHost(hostOptions());
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await configureMoviePilot(host, cookie, downloads);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-restart-main', SOURCE_ROOT);
  await createField(host, cookie, 'p14-restart-premium', supplemental);
  await observe(host, cookie, 'p14-restart-main');
  await observe(host, cookie, 'p14-restart-premium');

  const subjects = await waitFor(host, cookie, (items) =>
    ['SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G02','SDT-G08','SDT-G09','SDT-L06']
      .every((id) => items.some((item) => String(item.displayIdentity || '').includes(id))));
  await rate(host, cookie, byScenario(subjects, 'SDT-M03A'), 1);
  await rate(host, cookie, byScenario(subjects, 'SDT-M03B'), 2);
  await rate(host, cookie, byScenario(subjects, 'SDT-G02'), 3);
  await rate(host, cookie, byScenario(subjects, 'SDT-M02'), 4);
  await rate(host, cookie, byScenario(subjects, 'SDT-L06'), 5);
  await rate(host, cookie, byScenario(subjects, 'SDT-M05'), 5);
  await route(host, cookie, 'p14-restart-main');
  await route(host, cookie, 'p14-restart-premium');

  const interrupt = await waitForOrTimeout(host, cookie, (items) => {
    const producing = REQUIRED_SCENARIOS.filter((id) => itemByScenario(items, id)?.productionStage === 'production');
    const ready = REQUIRED_SCENARIOS.filter((id) => isOfferReady(itemByScenario(items, id)));
    if (producing.length < 1 || ready.length === REQUIRED_SCENARIOS.length) return false;
    return runtimeSnapshot(path.join(dataDir, 'shelfdeck.db')).executingMediaEffects === 0;
  }, 90_000);
  assert.ifError(runtimeError);
  assert.equal(interrupt.hit, true, 'Restart fixture must interrupt at least one required Run still in production.');

  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const before = productEvidence(databasePath);
  const beforeOffers = offerMap(before);
  const beforeRuntime = runtimeSnapshot(databasePath);
  const downloadAddsBefore = calls.filter((item) => item.path === '/api/v1/download/add').length;
  assert.ok(beforeRuntime.nonterminalWorks + beforeRuntime.nonterminalEvents > 0
    || REQUIRED_SCENARIOS.some((id) => !beforeOffers[id]),
  'Lost-wake fixture must leave unfinished Libra Work or unpublished required Offers.');

  await host.close();
  host = await createCleanServiceHost(hostOptions());
  const restartedCookie = await session(host, initialized.adminApiKey);
  const recovered = await waitFor(host, restartedCookie, (items) =>
    REQUIRED_SCENARIOS.every((id) => isOfferReady(itemByScenario(items, id))), 330_000);
  assert.ifError(runtimeError);

  const after = productEvidence(databasePath);
  const afterOffers = offerMap(after);
  const afterRuntime = runtimeSnapshot(databasePath);
  for (const id of REQUIRED_SCENARIOS) {
    const rows = after.rows.filter((row) => String(row.display_identity || '').includes(id));
    assert.equal(rows.length, 1, id + ' must have exactly one active Run after restart.');
    assert.ok(rows[0].offer_id, id + ' must have one open Handoff B Offer after restart.');
    if (beforeOffers[id]) assert.equal(afterOffers[id], beforeOffers[id], id + ' must keep the same Offer across restart.');
  }
  assert.equal(afterRuntime.fieldObservations, beforeRuntime.fieldObservations);
  assert.equal(afterRuntime.fieldObservations, 2);
  assert.equal(after.failedWorks, 0);
  assert.equal(after.failedEvents, 0);
  assert.equal(after.consumedOffers, 0);
  assert.equal(after.arcaEntries, 0);
  assert.ok((after.capabilityCounts['libra.media.transcode@1'] || 0) >= 2);
  assert.ok((after.capabilityCounts['libra.media.remux@1'] || 0) >= 4);
  assert.ok((after.capabilityCounts['libra.external_material.package.verify@1'] || 0) >= 1);
  const downloadAddsAfter = calls.filter((item) => item.path === '/api/v1/download/add').length;
  assert.ok(downloadAddsAfter >= 1);
  assert.ok(downloadAddsAfter <= Math.max(1, downloadAddsBefore),
    'Restart must not issue a second MoviePilot download after a lost wake.');
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
  t.diagnostic('Libra restart/lost-wake evidence: ' + JSON.stringify({
    interruptedReady: REQUIRED_SCENARIOS.filter((id) => beforeOffers[id]).length,
    beforeRuntime, afterRuntime, downloadAddsBefore, downloadAddsAfter,
    recovered: recovered.length, packages: after.packages,
  }));
});

function runCaps(database, libraRunId) {
  return Object.fromEntries(database.prepare(`
    SELECT e.capability_ref, count(*) count
      FROM fx_workflow_events e
      JOIN fx_supporting_works w ON w.work_id=e.work_id
     WHERE w.process_id=?
     GROUP BY e.capability_ref`).all(libraRunId).map((row) => [row.capability_ref, Number(row.count)]));
}

function selectedMediaVerification(database, libraRunId) {
  const resultRows = database.prepare(`
    SELECT e.capability_ref, r.result_json, r.committed_at_ms
      FROM fx_event_result_bindings r
      JOIN fx_workflow_events e ON e.event_id=r.event_id
      JOIN fx_supporting_works w ON w.work_id=e.work_id
     WHERE w.process_id=?
       AND e.capability_ref IN ('libra.product_media.verify@1','libra.product_output.select@1')
     ORDER BY r.committed_at_ms, r.result_id`).all(libraRunId);
  const selections = resultRows
    .filter((row) => row.capability_ref === 'libra.product_output.select@1')
    .map((row) => JSON.parse(row.result_json))
    .filter((result) => result.result === 'selected');
  assert.equal(selections.length, 1,
    libraRunId + ' must have exactly one selected Product Output across all attempts.');
  const verifications = resultRows
    .filter((row) => row.capability_ref === 'libra.product_media.verify@1')
    .map((row) => JSON.parse(row.result_json));
  const selected = verifications.find((result) =>
    result.verificationId === selections[0].selectedVerificationId);
  assert.ok(selected,
    libraRunId + ' selected Product Verification must be durable and reconstructable.');
  assert.equal(selected.result, 'passed');
  assert.equal(selected.spaceSummary.withinLimit, true);
  return selected;
}

function auditRequiredPackages(databasePath) {
  const database = new Database(databasePath, { readonly:true });
  try {
    const rows = database.prepare(`
      SELECT r.libra_run_id, r.subject_id, r.state, r.priority_class, p.on_deck_package_id, p.offer_id,
             p.product_structure_json, p.offload_context_digest, p.related_disposition_set_digest,
             p.attestation_digest, p.package_digest, i.display_identity
        FROM libra_runs r
        JOIN libra_product_packages p ON p.libra_run_id=r.libra_run_id
        LEFT JOIN libra_product_identity_revisions i
          ON i.subject_id=r.subject_id
         AND i.revision=(SELECT MAX(revision) FROM libra_product_identity_revisions x WHERE x.subject_id=r.subject_id)
       WHERE r.state='active'`).all();
    const audited = {};
    for (const id of REQUIRED_SCENARIOS) {
      const row = rows.find((item) => String(item.display_identity || '').includes(id));
      assert.ok(row, id + ' must have an active published Package.');
      const structure = JSON.parse(row.product_structure_json);
      assert.equal(structure.structureKind, 'single', id);
      assert.ok(row.offer_id, id);
      assert.ok(row.offload_context_digest, id + ' must carry Off-load Context.');
      assert.ok(row.related_disposition_set_digest, id + ' must carry Related disposition mapping.');
      assert.ok(row.attestation_digest, id + ' must carry Delivery Attestation.');
      const facts = database.prepare(`
        SELECT fact_kind FROM libra_product_fact_revisions WHERE libra_run_id=?`).all(row.libra_run_id)
        .map((item) => item.fact_kind);
      for (const kind of ['resolved_identity', 'product_metadata', 'media_cast']) {
        assert.ok(facts.includes(kind), id + ' missing ' + kind);
      }
      const metadata = JSON.parse(database.prepare(`
        SELECT fact_json FROM libra_product_fact_revisions
         WHERE libra_run_id=? AND fact_kind='product_metadata'`).get(row.libra_run_id).fact_json);
      const keys = new Set((metadata.descriptiveFacts?.entries || []).map((item) => item.key));
      for (const key of ['title', 'year_or_release_date', 'plot', 'genre', 'director']) {
        assert.ok(keys.has(key), id + ' metadata missing ' + key);
      }
      const mediaCast = JSON.parse(database.prepare(`
        SELECT fact_json FROM libra_product_fact_revisions
         WHERE libra_run_id=? AND fact_kind='media_cast'`).get(row.libra_run_id).fact_json);
      const hasActor = keys.has('actor') ||
        (mediaCast.relations || []).some((item) => item.role === 'actor' && item.displayName);
      assert.ok(hasActor, id + ' must keep an actor in Metadata or Media-Cast.');
      const artifacts = database.prepare(`
        SELECT artifact_kind, materialization_state FROM libra_product_package_artifact_refs
         WHERE on_deck_package_id=?`).all(row.on_deck_package_id);
      assert.ok(artifacts.some((item) => item.artifact_kind === 'nfo' && item.materialization_state === 'included_product'), id + ' nfo');
      assert.ok(artifacts.some((item) => item.artifact_kind === 'poster' && item.materialization_state === 'included_product'), id + ' poster');
      const caps = runCaps(database, row.libra_run_id);
      const mediaVerification = selectedMediaVerification(database, row.libra_run_id);
      const selectionPlans = database.prepare(`
        SELECT n.input_bindings_json
          FROM fx_plan_nodes n
          JOIN fx_workflow_events e
            ON e.plan_id=n.plan_id AND e.node_id=n.node_id
          JOIN fx_supporting_works w ON w.work_id=e.work_id
         WHERE w.process_id=?
           AND n.capability_ref='libra.product_output.select@1'`).all(row.libra_run_id);
      assert.ok(selectionPlans.length >= 1,
        id + ' must execute at least one Plan-frozen Product Output Selection.');
      for (const selectionPlan of selectionPlans) {
        const bindingSet = JSON.parse(selectionPlan.input_bindings_json);
        const binding = bindingSet.bindings.find((item) =>
          item.portName === 'productOutputSelectionInput');
        assert.ok(binding, id + ' Selection Plan lacks its typed input binding.');
        assert.ok(['projected_event_result', 'projected_event_results']
          .includes(binding.bindingKind), id + ' Selection Plan uses an invalid binding kind.');
        const ranked = binding.parameters?.rankedCandidates;
        assert.ok(Array.isArray(ranked) && ranked.length >= 1 && ranked.length <= 32,
          id + ' Selection rank must be frozen in the immutable Plan.');
        assert.deepEqual(ranked.map((item) => item.rank),
          ranked.map((_item, index) => index + 1),
          id + ' Selection rank must be a closed sequence.');
        assert.equal(new Set(ranked.map((item) => item.candidateId)).size, ranked.length,
          id + ' Selection Plan cannot repeat a Candidate identity.');
      }
      const primary = database.prepare(`
        SELECT location_kind, role FROM libra_product_package_materials
         WHERE on_deck_package_id=? AND role='primary_payload'`).all(row.on_deck_package_id);
      assert.equal(primary.length, 1, id + ' must have exactly one Primary.');
      audited[id] = Object.freeze({
        libraRunId: row.libra_run_id, offerId: row.offer_id, caps,
        primaryKind: primary[0].location_kind, mediaVerification,
      });
    }
    const m01 = audited['SDT-M01'];
    assert.equal(m01.caps['libra.media.transcode@1'] || 0, 0);
    assert.equal(m01.caps['libra.media.remux@1'] || 0, 0);
    assert.equal(m01.primaryKind, 'domain_binding');
    assert.equal(m01.mediaVerification.qualitySummary.videoCodec, 'h264');
    assert.equal(m01.mediaVerification.spaceSummary.maxSizeBytes, null);
    const m01Roles = database.prepare(`
      SELECT DISTINCT role FROM libra_product_package_materials
       WHERE on_deck_package_id=(SELECT on_deck_package_id FROM libra_product_packages WHERE libra_run_id=?)`)
      .all(m01.libraRunId).map((item) => item.role);
    for (const role of ['primary_payload', 'poster', 'metadata_sidecar', 'subtitle', 'fanart']) {
      assert.ok(m01Roles.includes(role), 'D05 M01 missing ' + role);
    }
    assert.ok((audited['SDT-M03A'].caps['libra.media.transcode@1'] || 0) >= 1);
    assert.equal(audited['SDT-M03B'].caps['libra.media.transcode@1'] || 0, 0);
    const g02 = rows.find((item) => String(item.display_identity || '').includes('SDT-G02'));
    assert.ok(g02, 'L04 G02 must publish a 3-star Package.');
    assert.ok((runCaps(database, g02.libra_run_id)['libra.media.transcode@1'] || 0) >= 1);
    const g02Verification = selectedMediaVerification(database, g02.libra_run_id);
    assert.equal(audited['SDT-M02'].caps['libra.media.transcode@1'] || 0, 0);
    assert.equal(audited['SDT-L06'].caps['libra.media.transcode@1'] || 0, 0);
    assert.equal(audited['SDT-L06'].caps['libra.media.remux@1'] || 0, 0);
    assert.equal(audited['SDT-L06'].caps['libra.workspace.material.import@1'] || 0, 0);
    assert.ok((audited['SDT-M05'].caps['libra.workspace.material.import@1'] || 0) >= 1);
    assert.equal(audited['SDT-M05'].caps['libra.media.transcode@1'] || 0, 0);
    assert.ok((audited['SDT-M06'].caps['libra.media.remux@1'] || 0) >= 1);
    assert.ok((audited['SDT-M07'].caps['libra.media.remux@1'] || 0) >= 1);
    assert.ok((audited['SDT-G08'].caps['libra.media.remux@1'] || 0) >= 1);
    assert.ok((audited['SDT-G09'].caps['libra.media.remux@1'] || 0) >= 1);
    const ratedProducts = Object.freeze([
      Object.freeze({ id:'SDT-M03A', maxSizeBytes:2 * 1024 ** 3 }),
      Object.freeze({ id:'SDT-M03B', maxSizeBytes:4 * 1024 ** 3 }),
      Object.freeze({ id:'SDT-M02', maxSizeBytes:14 * 1024 ** 3 }),
      Object.freeze({ id:'SDT-L06', maxSizeBytes:50 * 1024 ** 3 }),
      Object.freeze({ id:'SDT-M05', maxSizeBytes:50 * 1024 ** 3 }),
    ]);
    for (const expected of ratedProducts) {
      const verification = audited[expected.id].mediaVerification;
      assert.equal(verification.qualitySummary.videoCodec, 'hevc', expected.id);
      assert.equal(verification.spaceSummary.maxSizeBytes, expected.maxSizeBytes, expected.id);
      assert.ok(verification.spaceSummary.actualSizeBytes <= expected.maxSizeBytes, expected.id);
    }
    assert.equal(g02Verification.qualitySummary.videoCodec, 'hevc');
    assert.equal(g02Verification.spaceSummary.maxSizeBytes, 8 * 1024 ** 3);
    assert.ok(g02Verification.spaceSummary.actualSizeBytes <= 8 * 1024 ** 3);
    for (const id of ['SDT-L06', 'SDT-M05']) {
      const quality = audited[id].mediaVerification.qualitySummary;
      assert.equal(quality.displayRasterClass, '4k', id);
      assert.equal(quality.systemUpscaleDetected, false, id);
      assert.ok(quality.primaryAudioClasses.some((audioClass) =>
        ['truehd', 'truehd_atmos', 'dts_hd_ma', 'dts_x', 'eac3_atmos'].includes(audioClass)),
      id + ' must preserve an accepted premium primary audio class.');
    }
    for (const id of ['SDT-M06', 'SDT-M07', 'SDT-G08', 'SDT-G09']) {
      const verification = audited[id].mediaVerification;
      assert.equal(verification.qualitySummary.container, 'matroska', id);
      assert.equal(verification.qualitySummary.fileExtension, 'mkv', id);
    }
    const m08 = rows.find((item) => String(item.display_identity || '').includes('SDT-M08'));
    assert.ok(m08, 'D03 M08 must publish with generated NFO.');
    const m08Artifacts = database.prepare(`
      SELECT artifact_kind, materialization_state FROM libra_product_package_artifact_refs
       WHERE on_deck_package_id=?`).all(m08.on_deck_package_id);
    assert.ok(m08Artifacts.some((item) => item.artifact_kind === 'nfo' &&
      item.materialization_state === 'included_product'), 'D03 M08 must include generated NFO.');
    assert.ok(m08Artifacts.some((item) => item.artifact_kind === 'poster' &&
      item.materialization_state === 'included_product'), 'D03 M08 must include acquired poster.');
    const d02 = rows.find((item) => String(item.display_identity || '').includes('SDT-D02'));
    assert.ok(d02, 'D02 incomplete NFO must publish a Product Package.');
    const d02Metadata = JSON.parse(database.prepare(`
      SELECT fact_json FROM libra_product_fact_revisions
       WHERE libra_run_id=? AND fact_kind='product_metadata'`).get(d02.libra_run_id).fact_json);
    const d02Fields = new Map(d02Metadata.descriptiveFacts.entries.map((item) => [item.key, item.value]));
    const d02Provenance = new Map(d02Metadata.fieldProvenance.map((item) => [item.fieldPath, item.sourceKind]));
    assert.equal(d02Fields.get('title'), 'SDT-D02 User Preserved Title');
    assert.equal(d02Provenance.get('title'), 'related_nfo');
    assert.equal(d02Fields.get('plot'), 'Libra Handoff B scenario evidence');
    assert.equal(d02Provenance.get('plot'), 'provider');
    const d02Primary = database.prepare(`
      SELECT location_kind FROM libra_product_package_materials
       WHERE on_deck_package_id=? AND role='primary_payload'`).get(d02.on_deck_package_id);
    audited['SDT-D02'] = Object.freeze({
      libraRunId:d02.libra_run_id,
      offerId:d02.offer_id,
      caps:runCaps(database, d02.libra_run_id),
      primaryKind:d02Primary.location_kind,
    });
    const g01 = rows.find((item) => String(item.display_identity || '').includes('SDT-G01'));
    assert.ok(g01, 'D04 G01 must publish after replacing stale Related.');
    const g06 = rows.find((item) => String(item.display_identity || '').includes('SDT-G06'));
    assert.ok(g06, 'D07 G06 must publish with a current Related disposition.');
    return Object.freeze(audited);
  } finally { database.close(); }
}

test('P14 matrix audits packages then supersedes a Run after rating change', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:420_000,
}, async (t) => {
  assert.equal(fs.statSync(SOURCE_ROOT).isDirectory(), true);
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-matrix-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const supplemental = path.join(root, 'supplemental-field');
  const downloads = path.join(root, 'moviepilot-downloads');
  [admin, shelf, supplemental, downloads].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const premium = buildPremiumSample(supplemental);
  const d02Directory = path.join(supplemental, 'SDT-D02-Incomplete-NFO (2008)');
  fs.mkdirSync(d02Directory, { recursive:true });
  fs.copyFileSync(path.join(SOURCE_ROOT, 'SDT-M08-Missing-NFO (2008)',
    'SDT-M08-Missing-NFO (2008).mkv'), path.join(d02Directory, 'SDT-D02-Incomplete-NFO (2008).mkv'));
  fs.writeFileSync(path.join(d02Directory, 'movie.nfo'),
    '<movie><title>SDT-D02 User Preserved Title</title></movie>');
  fs.copyFileSync(path.join(SOURCE_ROOT, 'SDT-M08-Missing-NFO (2008)', 'poster.jpg'),
    path.join(d02Directory, 'poster.jpg'));
  const external = path.join(downloads, 'SDT-M05-External-Upgrade.2025.2160p.mkv');
  fs.copyFileSync(premium, external);
  fs.utimesSync(external, new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const calls = [];
  const metadataCalls = [];
  let runtimeError = null;
  lastRequestError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), integrationFetch:moviePilotFetch(external, calls),
    ...productOptions(metadataCalls),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await configureMoviePilot(host, cookie, downloads);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-matrix-main', SOURCE_ROOT);
  await createField(host, cookie, 'p14-matrix-premium', supplemental);
  await observe(host, cookie, 'p14-matrix-main');
  await observe(host, cookie, 'p14-matrix-premium');
  const subjects = await waitFor(host, cookie, (items) =>
    ['SDT-M01','SDT-M02','SDT-M03A','SDT-M03B','SDT-M05','SDT-M06','SDT-M07','SDT-G02','SDT-G08','SDT-G09','SDT-L06']
      .every((id) => items.some((item) => String(item.displayIdentity || '').includes(id))));
  await rate(host, cookie, byScenario(subjects, 'SDT-M03A'), 1);
  await rate(host, cookie, byScenario(subjects, 'SDT-M03B'), 2);
  await rate(host, cookie, byScenario(subjects, 'SDT-G02'), 3);
  await rate(host, cookie, byScenario(subjects, 'SDT-M02'), 4);
  await rate(host, cookie, byScenario(subjects, 'SDT-L06'), 5);
  await rate(host, cookie, byScenario(subjects, 'SDT-M05'), 5);
  await route(host, cookie, 'p14-matrix-main');
  await route(host, cookie, 'p14-matrix-premium');
  await waitFor(host, cookie, (items) => CONTENT_AUDIT_SCENARIOS
    .every((id) => isOfferReady(itemByScenario(items, id))), 330_000);
  assert.ifError(runtimeError);

  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const audited = auditRequiredPackages(databasePath);
  const d02Call = metadataCalls.find((item) =>
    item.libraRunId === audited['SDT-D02'].libraRunId);
  assert.ok(d02Call, 'D02 must use Provider only after the incomplete NFO.');
  assert.equal(d02Call.requestedFields.includes('title'), false,
    'D02 Provider Gap fill must not request the NFO title again.');
  assert.ok(d02Call.requestedFields.includes('plot'));
  const l06RunId = audited['SDT-L06'].libraRunId;
  const m01Before = itemByScenario(await formation(host, cookie), 'SDT-M01');
  assert.ok(m01Before.currentRun);

  await rate(host, cookie, m01Before, 1);
  await waitFor(host, cookie, (items) => {
    const item = itemByScenario(items, 'SDT-M01');
    return item?.currentRun?.libraRunId
      && item.currentRun.libraRunId !== m01Before.currentRun.libraRunId
      && isOfferReady(item);
  }, 180_000);
  assert.ifError(runtimeError);

  const after = productEvidence(databasePath);
  const m01Rows = after.rows.filter((row) => String(row.display_identity || '').includes('SDT-M01'));
  assert.equal(m01Rows.length, 1);
  assert.notEqual(m01Rows[0].libra_run_id, m01Before.currentRun.libraRunId);
  assert.ok(m01Rows[0].offer_id);
  assert.notEqual(m01Rows[0].offer_id, audited['SDT-M01'].offerId);
  const semanticRunId = m01Rows[0].libra_run_id;
  await rate(host, cookie, itemByScenario(await formation(host, cookie), 'SDT-M01'), 1, 1,
    'scenario-rating-semantic-replay-' + semanticRunId);
  await waitRating(host, cookie, m01Rows[0].subject_id,
    (current) => current.state === 'ready' && current.rating === 1 && current.expectedRevision === 2);
  await waitFor(host, cookie, (items) =>
    itemByScenario(items, 'SDT-M01')?.currentRun?.libraRunId === semanticRunId, 120_000);
  assert.ifError(runtimeError);
  const superseded = new Database(databasePath, { readonly:true });
  try {
    const old = superseded.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?')
      .get(m01Before.currentRun.libraRunId);
    assert.equal(old.state, 'superseded');
    const l06 = superseded.prepare('SELECT libra_run_id FROM libra_runs WHERE libra_run_id=? AND state=\'active\'')
      .get(l06RunId);
    assert.ok(l06, 'S01: unchanged L06 must keep its original active Run.');
    assert.ok((runCaps(superseded, m01Rows[0].libra_run_id)['libra.media.transcode@1'] || 0) >= 1);
    const semanticRuns = superseded.prepare(
      'SELECT count(*) n FROM libra_runs WHERE subject_id=(SELECT subject_id FROM libra_runs WHERE libra_run_id=?)')
      .get(semanticRunId);
    assert.equal(semanticRuns.n, 2,
      'S02: a same-value rating revision must not create a third Libra Run.');
    const semanticHead = superseded.prepare(
      'SELECT state,state_revision,latest_freshness_assessment_id FROM libra_runs WHERE libra_run_id=?')
      .get(semanticRunId);
    assert.equal(semanticHead.state, 'active');
    assert.ok(semanticHead.state_revision >= 2);
    assert.ok(semanticHead.latest_freshness_assessment_id,
      'S02: semantic replay must append durable freshness Evidence.');
    const semanticRevision = superseded.prepare(
      "SELECT transition_kind FROM libra_run_revisions WHERE libra_run_id=? ORDER BY state_revision DESC LIMIT 1")
      .get(semanticRunId);
    assert.equal(semanticRevision.transition_kind, 'freshness_confirmed');
    assert.equal(superseded.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n, 0);
    assert.equal(superseded.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n, 0);
    const activeCount = superseded.prepare("SELECT count(*) n FROM libra_runs WHERE state='active'").get().n;
    assert.ok(activeCount >= 20, 'Parallel Runs must remain isolated after one Subject replacement.');
  } finally { superseded.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
  t.diagnostic('Libra matrix evidence: ' + JSON.stringify({
    audited: Object.fromEntries(Object.entries(audited).map(([id, value]) => [id, {
      primaryKind: value.primaryKind,
      remux: value.caps['libra.media.remux@1'] || 0,
      transcode: value.caps['libra.media.transcode@1'] || 0,
      imported: value.caps['libra.workspace.material.import@1'] || 0,
    }])),
    m01Replacement: { oldRun: m01Before.currentRun.libraRunId, newRun: m01Rows[0].libra_run_id },
  }));
});

test('P14 S08 expedites before Offer and carries the intent into a legal replacement Run', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-expedited-replacement-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  const scenarioDirectory = path.join(field, 'SDT-S08-Expedited-Replacement (2008)');
  fs.mkdirSync(scenarioDirectory, { recursive:true });
  fs.copyFileSync(path.join(SOURCE_ROOT, 'SDT-M03-Multi-Movie-Directory',
    'SDT-M03A-H264-Needs-Transcode (2008).mkv'),
  path.join(scenarioDirectory, 'SDT-S08-Expedited-Replacement (2008).mkv'));

  let enterGate;
  let releaseGate;
  let gatedRunId = null;
  const entered = new Promise((resolve) => { enterGate = resolve; });
  const released = new Promise((resolve) => { releaseGate = resolve; });
  const metadataGate = async (intent) => {
    if (gatedRunId !== null) return;
    gatedRunId = intent.libraRunId;
    enterGate();
    await released;
  };
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    ...productOptions(null, metadataGate),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    releaseGate?.();
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1')
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-s08-field', field);
  await observe(host, cookie, 'p14-s08-field');
  const subjects = await waitFor(host, cookie, (items) =>
    items.some((item) => String(item.displayIdentity || '').includes('SDT-S08')));
  const subject = byScenario(subjects, 'SDT-S08');
  await route(host, cookie, 'p14-s08-field');
  let gateTimeout;
  try {
    await Promise.race([entered, new Promise((_, reject) => {
      gateTimeout = setTimeout(() => reject(
        new Error('S08 Metadata gate was never reached.')), 120_000);
    })]);
  } finally { clearTimeout(gateTimeout); }
  let item = byScenario(await formation(host, cookie), 'SDT-S08');
  assert.ok(item.currentRun);
  assert.equal(item.handoffB, null);
  const oldRun = Object.freeze({ ...item.currentRun });
  assert.equal(gatedRunId, oldRun.libraRunId);
  const prioritized = await expedite(host, cookie, oldRun, 'scenario-s08-expedite');
  assert.equal(prioritized.priorityClass, 'expedited');
  await waitFor(host, cookie, (items) =>
    byScenario(items, 'SDT-S08')?.currentRun?.priorityClass === 'expedited');

  await rate(host, cookie, subject, 1, 0, 'scenario-s08-rating-change');
  const replacementItems = await waitFor(host, cookie, (items) => {
    const current = byScenario(items, 'SDT-S08')?.currentRun;
    return current?.libraRunId !== oldRun.libraRunId && current?.priorityClass === 'expedited';
  });
  item = byScenario(replacementItems, 'SDT-S08');
  const replacementRunId = item.currentRun.libraRunId;
  releaseGate();
  await waitFor(host, cookie, (items) => isOfferReady(itemByScenario(items, 'SDT-S08')));
  assert.ifError(runtimeError);

  const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
  try {
    const old = database.prepare(
      'SELECT state,priority_class,priority_intent_digest FROM libra_runs WHERE libra_run_id=?')
      .get(oldRun.libraRunId);
    const replacement = database.prepare(
      'SELECT state,priority_class,priority_intent_digest FROM libra_runs WHERE libra_run_id=?')
      .get(replacementRunId);
    assert.equal(old.state, 'superseded');
    assert.equal(old.priority_class, 'expedited');
    assert.equal(replacement.state, 'active');
    assert.equal(replacement.priority_class, 'expedited');
    assert.equal(replacement.priority_intent_digest, old.priority_intent_digest,
      'S08 replacement must inherit the exact expedited Intent.');
    assert.equal(database.prepare(
      'SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?').get(oldRun.libraRunId).n, 0,
    'S08 old Run must not publish after replacement.');
    assert.equal(database.prepare(
      'SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?').get(replacementRunId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

test('P14 S04-S05 suspend on a temporarily unavailable Spec projection and resume the same Run', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-s04-s05-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, 'SDT-S05-Same-Basis-Recovery');
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const controller = { enabled:true, libraRunId:null };
  let clockOffsetMs = 0;
  let runtimeError = null;
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    now:() => Date.now() + clockOffsetMs,
    unitOfWorkDecorator:temporarySpecProjectionFault(controller),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host?.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  let cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-s05-field', field);
  await observe(host, cookie, 'p14-s05-field');
  await waitFor(host, cookie, (items) => items.some((item) =>
    String(item.displayIdentity || '').includes('SDT-S05')));
  await route(host, cookie, 'p14-s05-field');
  let item = itemByScenario(await waitFor(host, cookie, (items) =>
    itemByScenario(items, 'SDT-S05')?.currentRun?.state === 'suspended'), 'SDT-S05');
  const suspendedRunId = item.currentRun.libraRunId;
  assert.equal(suspendedRunId, controller.libraRunId);
  assert.equal(item.handoffB, null);
  let database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM libra_run_revisions WHERE libra_run_id=? AND transition_kind='suspended'")
      .get(suspendedRunId).n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref IN ('libra.media.remux@1','libra.media.transcode@1','libra.external_material.request@1')")
      .get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_workspaces WHERE libra_run_id=?')
      .get(suspendedRunId).n, 0, 'S04 must suspend before Workspace or heavy effects are issued.');
  } finally { database.close(); }

  await host.close();
  host = null;
  controller.enabled = false;
  clockOffsetMs = 61_000;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    now:() => Date.now() + clockOffsetMs,
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  cookie = await session(host, initialized.adminApiKey);
  item = itemByScenario(await waitFor(host, cookie, (items) =>
    isOfferReady(itemByScenario(items, 'SDT-S05'))), 'SDT-S05');
  assert.equal(item.currentRun.libraRunId, suspendedRunId,
    'S05 must resume the same Run when the original comparable Basis is unchanged.');
  assert.ifError(runtimeError);
  database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
  try {
    const run = database.prepare('SELECT state,state_revision FROM libra_runs WHERE libra_run_id=?')
      .get(suspendedRunId);
    assert.equal(run.state, 'active');
    assert.ok(run.state_revision >= 3);
    assert.equal(database.prepare("SELECT count(*) n FROM libra_run_revisions WHERE libra_run_id=? AND transition_kind='resumed'")
      .get(suspendedRunId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_runs').get().n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?')
      .get(suspendedRunId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

test('P14 S04-S06 replace a suspended Run when a new rating changes its comparable Basis', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-s04-s06-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, 'SDT-S06-Changed-Basis-Replacement');
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const controller = { enabled:true, libraRunId:null };
  let runtimeError = null;
  const host = await createCleanServiceHost({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    unitOfWorkDecorator:temporarySpecProjectionFault(controller),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-s06-field', field);
  await observe(host, cookie, 'p14-s06-field');
  const subjects = await waitFor(host, cookie, (items) => items.some((item) =>
    String(item.displayIdentity || '').includes('SDT-S06')));
  const subject = byScenario(subjects, 'SDT-S06');
  await route(host, cookie, 'p14-s06-field');
  const suspended = itemByScenario(await waitFor(host, cookie, (items) =>
    itemByScenario(items, 'SDT-S06')?.currentRun?.state === 'suspended'), 'SDT-S06');
  const oldRunId = suspended.currentRun.libraRunId;
  assert.equal(oldRunId, controller.libraRunId);
  controller.enabled = false;
  await rate(host, cookie, subject, 1, 0, 'scenario-s06-rating-change');
  const replaced = itemByScenario(await waitFor(host, cookie, (items) => {
    const value = itemByScenario(items, 'SDT-S06');
    return value?.currentRun?.libraRunId !== oldRunId && isOfferReady(value);
  }), 'SDT-S06');
  const replacementRunId = replaced.currentRun.libraRunId;
  assert.ifError(runtimeError);
  const database = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
  try {
    const old = database.prepare('SELECT state,superseded_by_run_id FROM libra_runs WHERE libra_run_id=?')
      .get(oldRunId);
    const replacement = database.prepare('SELECT state,supersedes_run_id FROM libra_runs WHERE libra_run_id=?')
      .get(replacementRunId);
    assert.equal(old.state, 'superseded');
    assert.equal(old.superseded_by_run_id, replacementRunId);
    assert.equal(replacement.state, 'active');
    assert.equal(replacement.supersedes_run_id, oldRunId);
    const transitions = database.prepare(
      'SELECT transition_kind FROM libra_run_revisions WHERE libra_run_id=? ORDER BY state_revision')
      .all(oldRunId).map((row) => row.transition_kind);
    assert.deepEqual(transitions.slice(-2), ['suspended', 'superseded']);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?')
      .get(oldRunId).n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?')
      .get(replacementRunId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

test('P14 R01 insufficient Workspace space leaves no partial Workspace and recovers on restart', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-r01-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  const workspaceRoot = path.join(root, 'libra-workspaces');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, 'SDT-R01-Workspace-Space');
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  let spaceChecks = 0;
  let host = await createCleanServiceHost({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:workspaceRoot,
    workspaceStatfsSync:() => {
      spaceChecks += 1;
      return Object.freeze({ bavail:0n, bsize:4096n });
    },
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host?.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  let cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-r01-field', field);
  await observe(host, cookie, 'p14-r01-field');
  const subjects = await waitFor(host, cookie, (items) => items.some((item) =>
    String(item.displayIdentity || '').includes('SDT-R01')));
  const subject = byScenario(subjects, 'SDT-R01');
  await rate(host, cookie, subject, 1, 0, 'scenario-r01-stable-rating');
  await waitRating(host, cookie, subject.subjectId, (current) => current.rating === 1);
  await route(host, cookie, 'p14-r01-field');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const spaceDeadline = Date.now() + 120_000;
  while (spaceChecks === 0 && Date.now() < spaceDeadline) await pause(100);
  assert.ok(spaceChecks > 0, 'R01 did not reach the formal Workspace space probe.');
  assert.ifError(runtimeError);
  const stableRun = await waitDatabase(databasePath, (value) => value.prepare(`
    SELECT r.libra_run_id
      FROM libra_runs r
      JOIN libra_subject_decision_heads h ON h.subject_id=r.subject_id
      JOIN libra_acceptance_specs s ON s.acceptance_spec_id=h.current_acceptance_spec_id
     WHERE r.subject_id=? AND r.state='active'
       AND r.acceptance_spec_id=h.current_acceptance_spec_id
       AND json_extract(s.spec_json,'$.requirements.space.maxSizeGiB')=2`).get(subject.subjectId) || null);
  const blocked = itemByScenario(await waitFor(host, cookie, (items) =>
    itemByScenario(items, 'SDT-R01')?.currentRun?.libraRunId === stableRun.libra_run_id), 'SDT-R01');
  const runId = blocked.currentRun.libraRunId;
  let database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM libra_runs WHERE state='active'").get().n, 1);
    assert.equal(database.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(runId).state, 'active');
    assert.equal(database.prepare('SELECT count(*) n FROM libra_workspaces').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_workspace_revisions').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM fx_artifact_registry').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref IN ('shared.artifact.nfo.render@1','shared.artifact.poster.acquire@1','libra.media.remux@1','libra.media.transcode@1')")
      .get().n, 0);
  } finally { database.close(); }
  assert.equal(reality(workspaceRoot).count, 0,
    'R01 must not write any Workspace file while admission space is insufficient.');

  await host.close();
  host = null;
  runtimeError = null;
  host = await createCleanServiceHost({
    dataDir,
    adminDistDir:admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:workspaceRoot,
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  cookie = await session(host, initialized.adminApiKey);
  const ready = itemByScenario(await waitFor(host, cookie, (items) =>
    isOfferReady(itemByScenario(items, 'SDT-R01'))), 'SDT-R01');
  assert.equal(ready.currentRun.libraRunId, runId);
  assert.ifError(runtimeError);
  database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM libra_runs WHERE subject_id=? AND state='active'")
      .get(subject.subjectId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_workspaces WHERE libra_run_id=?').get(runId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?').get(runId).n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

async function verifyWorkspaceCrashRecovery(t, options) {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-' + options.scenarioId.toLowerCase() + '-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  const workspaceRoot = path.join(root, 'libra-workspaces');
  const signalPath = path.join(root, 'crash-boundary.json');
  const errorPath = path.join(root, 'crash-worker-error.json');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, options.displayName);
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let host = null;
  let child = null;
  let runtimeError = null;
  t.after(async () => {
    if (child?.exitCode === null) await terminateProcess(child);
    await host?.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1')
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });

  let spaceChecks = 0;
  host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:workspaceRoot, workspaceStatfsSync:() => {
      spaceChecks += 1;
      return Object.freeze({ bavail:0n, bsize:4096n });
    }, ...productOptions(), onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; } });
  let cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, options.fieldId, field);
  await observe(host, cookie, options.fieldId);
  const subjects = await waitFor(host, cookie, (items) => itemByScenario(items, options.scenarioId) !== null);
  const subject = byScenario(subjects, options.scenarioId);
  await rate(host, cookie, subject, 1, 0, options.scenarioId.toLowerCase() + '-rating');
  await waitRating(host, cookie, subject.subjectId, (current) => current.rating === 1);
  await route(host, cookie, options.fieldId);
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const blocked = await waitDatabase(databasePath, (database) => database.prepare(`
    SELECT r.libra_run_id
      FROM libra_runs r
      JOIN libra_subject_decision_heads h ON h.subject_id=r.subject_id
      JOIN libra_acceptance_specs s ON s.acceptance_spec_id=h.current_acceptance_spec_id
     WHERE r.subject_id=? AND r.state='active' AND r.acceptance_spec_id=h.current_acceptance_spec_id
       AND json_extract(s.spec_json,'$.requirements.space.maxSizeGiB')=2`).get(subject.subjectId) || null);
  assert.ok(spaceChecks > 0);
  assert.ifError(runtimeError);
  await host.close();
  host = null;

  const configPath = path.join(root, 'crash-worker-config.json');
  fs.writeFileSync(configPath, JSON.stringify({ mode:options.mode, dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:workspaceRoot, signalPath, errorPath }), 'utf8');
  child = spawn(process.execPath, [path.join(__dirname, 'fixtures', 'helix-libra-workspace-crash-worker.js'), configPath], {
    cwd:path.resolve(__dirname, '..'), stdio:'ignore', windowsHide:true,
  });
  const boundary = await waitForFile(signalPath, child, errorPath);
  assert.equal(boundary.boundary, options.mode);
  assert.equal(fs.existsSync(boundary.payload.target), true);
  const physicalBytes = fs.readFileSync(boundary.payload.target);
  const physicalDigest = crypto.createHash('sha256').update(physicalBytes).digest('hex');
  const physicalTarget = path.resolve(boundary.payload.target);
  await terminateProcess(child);
  child = null;

  let database = new Database(databasePath, { readonly:true });
  try {
    const event = database.prepare(`SELECT e.event_id,e.state,a.event_attempt_id,a.state attempt_state,j.state effect_state
      FROM fx_workflow_events e JOIN fx_event_attempts a ON a.event_id=e.event_id
      JOIN fx_effect_journal j ON j.event_attempt_id=a.event_attempt_id
     WHERE e.capability_ref='libra.media.transcode@1' AND e.state='executing'`).get();
    assert.ok(event, options.scenarioId + ' must leave one recoverable Transcode Event.');
    assert.equal(event.attempt_state, 'executing');
    assert.equal(event.effect_state, 'intended');
    const lower = database.prepare("SELECT state,count(*) n FROM fx_effect_journal WHERE effect_class='libra_workspace_media_materialize' GROUP BY state").all();
    assert.deepEqual(lower, [], 'Media Adapter must not create a second private Effect Journal.');
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workspace_materials WHERE lower(relative_path) LIKE '%.mkv'").get().n,
      options.mode === 'after_physical' ? 0 : 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 0);
  } finally { database.close(); }

  runtimeError = null;
  host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:workspaceRoot, ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; } });
  cookie = await session(host, initialized.adminApiKey);
  const ready = itemByScenario(await waitFor(host, cookie, (items) =>
    isOfferReady(itemByScenario(items, options.scenarioId))), options.scenarioId);
  assert.equal(ready.currentRun.libraRunId, blocked.libra_run_id);
  assert.ifError(runtimeError);
  assert.equal(path.resolve(physicalTarget), physicalTarget);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(physicalTarget)).digest('hex'), physicalDigest);
  database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM fx_effect_journal WHERE effect_class='libra_workspace_media_materialize'").get().n, 0);
    assert.equal(database.prepare(`SELECT count(*) n FROM fx_effect_journal j JOIN fx_event_attempts a ON a.event_attempt_id=j.event_attempt_id
      JOIN fx_workflow_events e ON e.event_id=a.event_id
      WHERE e.capability_ref='libra.media.transcode@1' AND j.effect_class='workspace_write' AND j.state='committed'`).get().n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workspace_materials WHERE lower(relative_path) LIKE '%.mkv'").get().n, 1);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages WHERE libra_run_id=?').get(blocked.libra_run_id).n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
}

test('P14 R02 process loss after media bytes uses the same Workspace target and Effect', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => verifyWorkspaceCrashRecovery(t, {
  scenarioId:'SDT-R02', displayName:'SDT-R02-Workspace-Effect-Crash', fieldId:'p14-r02-field', mode:'after_physical',
}));

test('P14 R04 process loss after Workspace commit reuses bytes before Product Verification', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => verifyWorkspaceCrashRecovery(t, {
  scenarioId:'SDT-R04', displayName:'SDT-R04-Workspace-Commit-Crash', fieldId:'p14-r04-field', mode:'after_media_commit',
}));

test('P14 R05 Product Fact commit crash rolls back all Fact rows and recovers exactly once', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-r05-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, 'SDT-R05-Fact-Commit-Crash');
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const controller = { enabled:true, hitCount:0,
    participantId:'libra_product_fact_owner_write',
    repositoryId:'libra_product_fact_product_metadata_writes' };
  let runtimeError = null;
  let host = await createCleanServiceHost({
    dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    unitOfWorkDecorator:failAfterUnitOfWorkParticipant(controller),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host?.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  let cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-r05-field', field);
  await observe(host, cookie, 'p14-r05-field');
  await waitFor(host, cookie, (items) => itemByScenario(items, 'SDT-R05') !== null);
  await route(host, cookie, 'p14-r05-field');
  const hitDeadline = Date.now() + 120_000;
  while (controller.hitCount === 0 && Date.now() < hitDeadline) await pause(100);
  assert.equal(controller.hitCount, 1, 'R05 did not reach the Product Metadata Fact commit crash window.');
  await pause(200);
  assert.equal(runtimeError?.code, 'HELIX_TEST_CRASH_WINDOW');
  await host.close();
  host = null;
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  let database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='product_metadata'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM libra_product_fact_source_refs s LEFT JOIN libra_product_fact_revisions f ON f.product_fact_id=s.product_fact_id WHERE f.product_fact_id IS NULL").get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 0);
  } finally { database.close(); }

  runtimeError = null;
  host = await createCleanServiceHost({
    dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  cookie = await session(host, initialized.adminApiKey);
  await waitFor(host, cookie, (items) => isOfferReady(itemByScenario(items, 'SDT-R05')));
  assert.ifError(runtimeError);
  database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT count(*) n FROM libra_product_fact_revisions WHERE fact_kind='product_metadata'").get().n, 1);
    assert.ok(database.prepare("SELECT count(*) n FROM libra_product_fact_source_refs s JOIN libra_product_fact_revisions f ON f.product_fact_id=s.product_fact_id WHERE f.fact_kind='product_metadata'").get().n > 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

test('P14 R06 Promotion crash rolls back Package, Control, Result, and Outbox then replays once', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:240_000,
}, async (t) => {
  const sourceBefore = reality(SOURCE_ROOT);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-r06-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  copyLifecycleSample(field, 'SDT-R06-Promotion-Crash');
  const initialized = initializeCleanData({ dataDir,
    confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  const controller = { enabled:true, hitCount:0,
    participantId:'libra_deliverable_promotion_foundation',
    repositoryId:'libra_deliverable_promotion_foundation' };
  let runtimeError = null;
  let host = await createCleanServiceHost({
    dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    unitOfWorkDecorator:failAfterUnitOfWorkParticipant(controller),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host?.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  let cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-r06-field', field);
  await observe(host, cookie, 'p14-r06-field');
  await waitFor(host, cookie, (items) => itemByScenario(items, 'SDT-R06') !== null);
  await route(host, cookie, 'p14-r06-field');
  const hitDeadline = Date.now() + 120_000;
  while (controller.hitCount === 0 && Date.now() < hitDeadline) await pause(100);
  assert.equal(controller.hitCount, 1, 'R06 did not reach the Promotion commit crash window.');
  await pause(200);
  assert.equal(runtimeError?.code, 'HELIX_TEST_CRASH_WINDOW');
  await host.close();
  host = null;
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  let database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_package_materials').get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_outbox WHERE producer_domain='libra' AND aggregate_type='on_deck_package'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_commit_markers WHERE owner_domain='libra' AND scope_type='on_deck_package'").get().n, 0);
    assert.equal(database.prepare('SELECT max(package_revision_head) n FROM libra_runs').get().n, 0);
  } finally { database.close(); }

  runtimeError = null;
  host = await createCleanServiceHost({
    dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'),
    ...productOptions(),
    onExecutionRuntimeError(error) { runtimeError = error; },
    onRequestError(error) { lastRequestError = error; },
  });
  cookie = await session(host, initialized.adminApiKey);
  await waitFor(host, cookie, (items) => isOfferReady(itemByScenario(items, 'SDT-R06')));
  assert.ifError(runtimeError);
  database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n, 1);
    assert.ok(database.prepare('SELECT count(*) n FROM libra_product_package_materials').get().n >= 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_outbox WHERE producer_domain='libra' AND aggregate_type='on_deck_package'").get().n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_commit_markers WHERE owner_domain='libra' AND scope_type='on_deck_package'").get().n, 1);
    assert.equal(database.prepare('SELECT max(package_revision_head) n FROM libra_runs').get().n, 1);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_supporting_works WHERE owner_domain='libra' AND state='failed'").get().n, 0);
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().n, 0);
  } finally { database.close(); }
  assert.deepEqual(reality(SOURCE_ROOT), sourceBefore);
});

test('P14 5-star without MoviePilot does not invent an Offer', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:120_000,
}, async (t) => {
  const source = path.join(SOURCE_ROOT, 'SDT-M05-External-Upgrade (2008)');
  assert.equal(fs.statSync(source).isDirectory(), true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-libra-s07-'));
  const dataDir = path.join(root, 'data');
  const admin = path.join(root, 'admin');
  const shelf = path.join(root, 'shelf');
  const field = path.join(root, 'field');
  [admin, shelf, field].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(admin, 'index.html'), '<div id="root"></div>');
  fs.cpSync(source, path.join(field, 'SDT-M05-External-Upgrade (2008)'), { recursive:true });
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET });
  let runtimeError = null;
  lastRequestError = null;
  const host = await createCleanServiceHost({ dataDir, adminDistDir:admin, secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root, 'libra-workspaces'), ...productOptions(),
    onExecutionRuntimeError(error) {
      runtimeError = error;
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    onRequestError(error) { lastRequestError = error; },
  });
  t.after(async () => {
    await host.close();
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') fs.rmSync(root, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
  });
  const cookie = await session(host, initialized.adminApiKey);
  await createShelf(host, cookie, shelf);
  await createField(host, cookie, 'p14-s07-field', field);
  await observe(host, cookie, 'p14-s07-field');
  const subjects = await waitFor(host, cookie, (items) => items.some((item) =>
    String(item.displayIdentity || '').includes('SDT-M05')), 60_000);
  await rate(host, cookie, byScenario(subjects, 'SDT-M05'), 5);
  await route(host, cookie, 'p14-s07-field');
  await pause(8_000);
  assert.ifError(runtimeError);
  const items = await formation(host, cookie);
  const item = itemByScenario(items, 'SDT-M05');
  assert.ok(item);
  assert.notEqual(item.productionStage, 'handoff_b_ready');
  assert.equal(item.handoffB, null);
  const evidence = productEvidence(path.join(dataDir, 'shelfdeck.db'));
  assert.equal(evidence.packages, 0);
  assert.equal(evidence.consumedOffers, 0);
  assert.equal(evidence.arcaEntries, 0);
  t.diagnostic('S07 waiting without MoviePilot: ' + JSON.stringify({
    productionStage: item.productionStage, runState: item.currentRun?.state, packages: evidence.packages,
  }));
});

test('D10 DV without a compatible base layer exhausts local strategies then freezes on terminal external not-found Evidence', {
  skip:SOURCE_ROOT === null ? 'Set HELIX_LIBRA_HANDOFF_B_E2E_ROOT to the isolated P14 Material Field.' : false,
  timeout:180_000,
}, async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-libra-d10-')),dataDir=path.join(root,'data'),
    admin=path.join(root,'admin'),shelf=path.join(root,'shelf'),field=path.join(root,'field'),downloads=path.join(root,'downloads');
  [admin,shelf,field,downloads].forEach((directory)=>fs.mkdirSync(directory,{recursive:true}));
  fs.writeFileSync(path.join(admin,'index.html'),'<div id="root"></div>');
  copyLifecycleSample(field,'SDT-D10-DV-P5-No-Compatible-BL');
  fs.truncateSync(path.join(field,'SDT-D10-DV-P5-No-Compatible-BL (2008)',
    'SDT-D10-DV-P5-No-Compatible-BL (2008).mkv'),(1024*1024*1024)+(64*1024*1024));
  const fieldBefore=reality(field),initialized=initializeCleanData({dataDir,confirmation:'INITIALIZE_HELIX_CLEAN_V1',secretRoot:SECRET}),
    calls=[];let runtimeError=null;lastRequestError=null;
  const host=await createCleanServiceHost({dataDir,adminDistDir:admin,secretRoot:SECRET,
    libraWorkspaceRoot:path.join(root,'libra-workspaces'),mediaProbe:d10Profile5Probe(),platformComputeRuntime:d10PlatformRuntime(),
    integrationFetch:noCandidateMoviePilotFetch(calls),...productOptions(),
    outboxDispatcherFactory:(options)=>createOutboxDispatcherHost({...options,
      deferredDeliveryKeys:[...(options.deferredDeliveryKeys||[]),'rule_template_published->read-model']}),
    onExecutionRuntimeError(error){runtimeError=error;},onRequestError(error){lastRequestError=error;}});
  t.after(async()=>{await host.close();if(process.env.HELIX_KEEP_TEST_ASSETS!=='1')fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
  const cookie=await session(host,initialized.adminApiKey),template=await createD10Template(host,cookie);
  await createShelf(host,cookie,shelf,template);await configureMoviePilot(host,cookie,downloads);
  await createField(host,cookie,'p14-d10-field',field);await observe(host,cookie,'p14-d10-field');
  const subjects=await waitFor(host,cookie,(items)=>items.some((item)=>String(item.displayIdentity||'').includes('SDT-D10')),60_000),
    subject=byScenario(subjects,'SDT-D10');
  await rate(host,cookie,subject,1);await route(host,cookie,'p14-d10-field');
  const frozenItems=await waitFor(host,cookie,(items)=>itemByScenario(items,'SDT-D10')?.currentRun?.state==='frozen',120_000),
    frozen=itemByScenario(frozenItems,'SDT-D10');assert.ifError(runtimeError);assert.equal(frozen.handoffB,null);
  const databasePath=path.join(dataDir,'shelfdeck.db'),database=new Database(databasePath,{readonly:true});
  try {
    const assessments=database.prepare(`SELECT n.input_bindings_json,b.result_json FROM fx_workflow_events e
      JOIN fx_plan_nodes n ON n.plan_id=e.plan_id AND n.node_id=e.node_id
      JOIN fx_event_result_bindings b ON b.event_id=e.event_id
      WHERE e.capability_ref='libra.transcode.input.verify@1' ORDER BY e.event_id`).all().map((row)=>{
        const bindings=JSON.parse(row.input_bindings_json).bindings,result=JSON.parse(row.result_json),
          device=bindings.find((item)=>item.portName==='mediaExecutionDeviceSnapshot').value;
        return {deviceClass:device.deviceClass,deviceState:device.state,disposition:result.disposition,reasonCodes:result.reasonCodes};});
    assert.deepEqual(new Set(assessments.map((item)=>item.deviceClass)),new Set(['nvidia_nvenc','software_cpu']));
    assert.ok(assessments.every((item)=>item.deviceState==='ready'&&item.disposition==='strategy_rejected'&&
      item.reasonCodes.includes('dolby_vision_base_layer_unsupported')));
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE capability_ref='libra.media.transcode@1'").get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_product_packages').get().n,0);
    assert.equal(database.prepare('SELECT count(*) n FROM libra_delivery_receipts').get().n,0);
    const revision=database.prepare("SELECT transition_evidence_json FROM libra_run_revisions WHERE state='frozen' ORDER BY state_revision DESC LIMIT 1").get(),
      evidence=JSON.parse(revision.transition_evidence_json),blocker=evidence.blockedWorks[0];
    assert.equal(evidence.blockerKind,'product_unachievable');assert.equal(blocker.failureClass,'business_unachievable');
    assert.equal(blocker.failureCode,'no_available_candidate');
    const failedWorks=database.prepare(`SELECT w.work_id,a.failure_code FROM fx_supporting_works w
      JOIN fx_work_attempts a ON a.work_id=w.work_id
      WHERE w.owner_domain='libra' AND w.state='failed' ORDER BY a.ordinal DESC`).all();
    assert.equal(failedWorks.length,1);assert.equal(failedWorks[0].failure_code,'media_device_strategies_exhausted');
    assert.equal(database.prepare("SELECT count(*) n FROM fx_workflow_events WHERE owner_domain='libra' AND state='failed'").get().n,0);
    t.diagnostic('D10 fail-closed evidence: '+JSON.stringify({root,assessments,blocker,failedWorks,calls}));
  } finally {database.close();}
  assert.deepEqual(reality(field),fieldBefore);
});
