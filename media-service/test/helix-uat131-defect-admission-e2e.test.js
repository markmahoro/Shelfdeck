'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { SYSTEM_TEMPLATE_ID } = require('../src/helix/domains/arca/model/rule-template-contracts');

const SECRET = 'uat-131-defect-admission-e2e-20260827';
const MOVIEPILOT_KEY = 'uat-131-moviepilot-key';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const REAL_NFO_MEDIA = process.env.HELIX_UAT208_REAL_MEDIA || null;
if (REAL_NFO_MEDIA) {
  assert.equal(process.env.HELIX_UAT131_SCENARIO, 'actor-only',
    'The real-media NFO lifecycle test requires the actor-only scenario.');
  assert.equal(fs.statSync(REAL_NFO_MEDIA).isFile(), true);
}

function jsonResponse(status, body) {
  const bytes = Buffer.from(JSON.stringify(body), 'utf8');
  let delivered = false;
  return Object.freeze({
    ok: status >= 200 && status < 300,
    status,
    url: '',
    headers: Object.freeze({
      get(name) {
        const normalized = String(name).toLowerCase();
        if (normalized === 'content-length') return String(bytes.length);
        if (normalized === 'content-type') return 'application/json';
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

function noCandidateMoviePilotFetch(calls) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(Object.freeze({ path:url.pathname, method:init.method || 'GET' }));
    if (url.host !== 'moviepilot.test' || url.searchParams.get('token') !== MOVIEPILOT_KEY) {
      return jsonResponse(401, { detail:'denied' });
    }
    if (url.pathname === '/api/v1/search/title') {
      if(process.env.HELIX_UAT251_TECHNICAL_FAILURE==='1' && url.searchParams.get('keyword')!=='ShelfDeck connection test')return jsonResponse(200,{unexpected:'invalid-provider-response'});
      return jsonResponse(200, { success:true, data:[] });
    }
    if (url.pathname === '/api/v1/download/' || url.pathname === '/api/v1/history/download') {
      return jsonResponse(200, []);
    }
    if (url.pathname === '/api/v1/history/transfer') {
      return jsonResponse(200, { success:true, data:{ list:[], total:0 } });
    }
    return jsonResponse(404, { detail:'not found' });
  };
}

function mediaProbe() {
  return Object.freeze({
    async probe(handle) {
      const body = {
        resultKind:'probed',
        sourceHandleDigest:canonicalDigest(handle),
        container:'matroska',
        durationMs:60_000,
        videoStreams:Object.freeze([Object.freeze({
          streamIndex:0,
          codec:'h264',
          dispositionDefault:true,
          width:1920,
          height:1080,
          codecProfile:'high',
          pixelFormat:'yuv420p',
          bitDepth:8,
          chroma:'4:2:0',
          colorRange:'limited',
          colorPrimaries:'bt709',
          colorTransfer:'bt709',
          colorMatrix:'bt709',
          dynamicRangeKind:'sdr',
        })]),
        audioStreams:Object.freeze([]),
        subtitleStreams:Object.freeze([]),
        discTopology:null,
      };
      return Object.freeze({ ...body, payloadDigest:canonicalDigest(body) });
    },
  });
}

function mediaEffectPort() {
  const unexpected = (operation) => async () => {
    throw new Error('UAT-131 must not execute local media operation: ' + operation);
  };
  return Object.freeze({
    executeRemux:unexpected('remux'),
    executeTranscode:unexpected('transcode'),
    verifyTranscodeInput:unexpected('transcode-input'),
    async verifyPlayback() {
      return Object.freeze({
        samplePointsPercent:Object.freeze([5, 50, 95]),
        passedSamplePointsPercent:Object.freeze(process.env.HELIX_UAT251_UNSAFE==='1'?[]:[5, 50, 95]),
        decodeDigest:canonicalDigest({ schema:'uat-131-playback-decode@1', samples:[5, 50, 95] }),
      });
    },
    async close() {},
  });
}

function incompatiblePlatformRuntime() {
  const capabilityPayload = Object.freeze({
    supportedVideoCodecs:Object.freeze(['hevc']),
    supportedRateControlModes:Object.freeze(['target_size', 'strict_abr']),
    validatedConcurrentSlots:1,
    validatedVideoPipelines:Object.freeze([Object.freeze({
      pipelineProfileId:'uat131_intentionally_incompatible@1',
      inputDynamicRangeKinds:Object.freeze(['sdr']),
      inputPixelFormats:Object.freeze(['yuv420p']),
      outputCodec:'hevc',
      outputDynamicRangeKind:'sdr',
      outputPixelFormat:'yuv420p',
      outputColorProfile:Object.freeze({
        range:'limited', primaries:'bt709', transfer:'bt709', matrix:'bt709',
      }),
      selfTestDigest:canonicalDigest({ fixture:'uat131-incompatible-pipeline' }),
    })]),
  });
  const capabilityDigest = canonicalDigest(capabilityPayload);
  const body = {
    deviceId:'uat131-incompatible-device',
    deviceClass:'nvidia_nvenc',
    probeRevision:1,
    capabilitySchemaRef:'platform.compute-device-capability@1',
    capabilityPayload,
    capabilityDigest,
    enabled:true,
    state:'ready',
    workerRef:null,
  };
  const snapshot = Object.freeze({ ...body, snapshotDigest:canonicalDigest(body) });
  const refBody = {
    deviceId:snapshot.deviceId,
    deviceClass:snapshot.deviceClass,
    probeRevision:snapshot.probeRevision,
    capabilityDigest:snapshot.capabilityDigest,
  };
  const ref = Object.freeze({ ...refBody, refDigest:canonicalDigest(refBody) });
  return Object.freeze({
    listReadyDeviceRefs(query) {
      const result = {
        queryDigest:query.queryDigest,
        resultKind:'available',
        items:Object.freeze([ref]),
      };
      return Object.freeze({ ...result, resultDigest:canonicalDigest(result) });
    },
    readDeviceSnapshot(query) {
      const found = query.deviceId === ref.deviceId &&
        query.expectedProbeRevision === ref.probeRevision &&
        query.expectedCapabilityDigest === ref.capabilityDigest;
      const result = found
        ? { queryDigest:query.queryDigest, resultKind:'found', snapshot }
        : { queryDigest:query.queryDigest, resultKind:'not_found' };
      return Object.freeze({ ...result, resultDigest:canonicalDigest(result) });
    },
  });
}

function routingHandle() {
  const body = {
    schemaRef:'helix://contracts/types/IntegrationHandle/v1',
    schemaVersion:1,
    handleId:'uat-131-routing-handle',
    integrationId:'uat-131-tmdb',
    integrationType:'tmdb',
    configRevision:1,
    secretRef:'uat-131-tmdb-secret',
    allowedOperation:'libra.routing.fact.observe@1',
    expiresAtMs:Number.MAX_SAFE_INTEGER,
  };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productHandle(intent, operationId, artifactKind = null) {
  const body = {
    schemaRef:'helix://contracts/types/IntegrationHandle/v1',
    schemaVersion:1,
    handleId:canonicalDigest({ schema:'uat-131-product-handle-id@1', operationId, artifactKind }),
    integrationId:intent.integrationId || 'uat-131-tmdb',
    integrationType:'tmdb',
    configRevision:Number.isSafeInteger(intent.configRevision) ? intent.configRevision : 1,
    secretRef:'uat-131-tmdb-secret',
    allowedOperation:operationId,
    expiresAtMs:4_102_444_800_000,
  };
  return Object.freeze({ ...body, fenceDigest:canonicalDigest(body) });
}

function productOptions(actorAvailable, allowMissingPoster=true) {
  return Object.freeze({
    routingIntegrationHandleResolver:() => routingHandle(),
    routingProviderObservation:async ({ intent }) => Object.freeze([Object.freeze({
      providerKey:'913100',
      title:intent.candidateDisplayTitle,
      originalTitle:intent.candidateDisplayTitle,
      releaseYear:2026,
      regionCodes:Object.freeze(['US']),
      genreCodes:Object.freeze(['18']),
    })]),
    productIntegrationHandleResolver:({ intent, operationId, artifactKind }) =>
      productHandle(intent, operationId, artifactKind || null),
    currentProductIntegrationHandleResolver:({ providerKind, operationId, artifactKind }) =>
      process.env.HELIX_UAT251_NO_METADATA_PROVIDER==='1'&&operationId==='libra.product_metadata.fetch@1'?null:
      productHandle({ integrationId:providerKind + '-main', configRevision:1 },
        operationId, artifactKind || null),
    productProviderMetadataFetch:async ({ metadataFetchIntent:intent }) => Object.freeze({
      providerKind:'tmdb',
      integrationId:intent.integrationId,
      configRevision:intent.configRevision,
      descriptiveEntries:Object.freeze([
        { key:'director', value:'UAT Director' },
        { key:'genre', value:'Drama' },
        { key:'plot', value:'UAT-131 defect admission' },
        { key:'title', value:'UAT131 Movie' },
        { key:'tmdb_movie_id', value:intent.resolvedProviderIdentity.providerKey },
        { key:'year_or_release_date', value:2026 },
      ]),
      providerIdentities:Object.freeze([intent.resolvedProviderIdentity]),
      peopleHints:actorAvailable ? Object.freeze([Object.freeze({
        displayName:'UAT Actor',
        role:'actor',
        providerIdentities:Object.freeze([Object.freeze({
          provider:'tmdb', namespace:'tmdb_person', providerKey:'913101',
        })]),
      })]) : Object.freeze([]),
    }),
    productProviderArtifactFetch:async ({ artifactKind, resolvedProviderIdentity, integrationHandle }) => {
      if(allowMissingPoster&&process.env.HELIX_UAT251_ARTIFACT_NETWORK_FAILURE==='1'&&artifactKind==='poster')
        throw Object.assign(new Error('Fixture provider connection failed.'),{code:'ECONNRESET'});
      if(allowMissingPoster&&process.env.HELIX_UAT251_MISSING_POSTER==='1'&&artifactKind==='poster')return {resultKind:'not_available',reasonCode:'provider_artifact_absent'};
      return Object.freeze({
        resultKind:'acquired',
        bytes:Buffer.from(
          '/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJXgGD//2Q==',
          'base64',
        ),
        artifactKind,
        integrationId:integrationHandle.integrationId,
        configRevision:integrationHandle.configRevision,
        mediaType:'image/jpeg',
        resolvedProviderIdentity,
      });
    },
  });
}

async function session(host, apiKey) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/session', headers:{ 'x-api-key':apiKey },
  });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

async function configureMoviePilot(host, cookie, landingRoot, suffix) {
  const tested = await host.inject({
    method:'POST',
    url:'/v1/admin/settings/integrations/moviepilot/actions/test',
    headers:{ cookie },
    payload:{
      kind:'moviepilot',
      idempotencyKey:'uat-131-moviepilot-test-' + suffix,
      endpoint:'https://moviepilot.test',
      credential:{ kind:'api_key', value:MOVIEPILOT_KEY },
      settings:{
        providerRequestSaveRoot:'/provider/downloads',
        providerOrganizedRoot:'/provider/organized',
        shelfDeckVisibleRoot:landingRoot,
      },
      timeoutMs:5_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const saved = await host.inject({
    method:'PATCH',
    url:'/v1/admin/settings/integrations/moviepilot',
    headers:{ cookie },
    payload:{
      kind:'moviepilot',
      idempotencyKey:'uat-131-moviepilot-save-' + suffix,
      expectedConfigRevision:0,
      connectionProofId:tested.json().connectionProofId,
    },
  });
  assert.equal(saved.statusCode, 200, saved.body);
}

async function createShelf(host, cookie, shelfRoot, suffix) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/shelves', headers:{ cookie }, payload:{
      idempotencyKey:'uat-131-shelf-create-' + suffix,
      shelfId:'uat-131-shelf-' + suffix,
      name:'UAT-131 shelf ' + suffix,
      targetRootLocation:shelfRoot,
      ruleTemplateId:SYSTEM_TEMPLATE_ID,
      expectedTemplateRevision:1,
      placementPolicy:{
        folderTemplate:'{title} ({year})', primaryTemplate:'{stem}{ext}',
        nfoTemplate:'{stem}.nfo', subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',
        posterTemplate:'poster{ext}', fanartTemplate:'fanart{ext}', collisionPolicy:'reject',
      },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function createField(host, cookie, fieldRoot, suffix) {
  const fieldId = 'uat-131-field-' + suffix;
  const policyValue = {
    includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'],
    minimumSizeBytes:0, excludedMaterialKeys:[],
  };
  const access = {
    fieldId, revision:1, endpointId:fieldId + '-endpoint', rootLocation:fieldRoot,
    mountScopeId:fieldId + '-mount', mountScopeRevision:1,
    accessSchemaRef:'helix://fixtures/uat-131-field-access/v1',
  };
  const response = await host.inject({
    method:'POST', url:'/v1/admin/material-fields', headers:{ cookie }, payload:{
      idempotencyKey:fieldId + '-create', fieldId, name:fieldId, contentProfileHint:'movie',
      policy:{
        extractionPolicyId:fieldId + '-policy', revision:1,
        policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',
        policy:policyValue,
        policyDigest:canonicalDigest({ extractionPolicyId:fieldId + '-policy', revision:1,
          ...policyValue }),
      },
      access:{ ...access, accessDigest:canonicalDigest(access) },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return fieldId;
}

async function observe(host, cookie, fieldId) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/material-fields/' + fieldId + '/actions/observe',
    headers:{ cookie }, payload:{
      idempotencyKey:fieldId + '-observe', fieldId,
      expectedAccessRevision:1, expectedObservationRevision:0, pageBudget:8,
    },
  });
  assert.equal(response.statusCode, 202, response.body);
}

async function route(host, cookie, fieldId, shelfId) {
  const response = await host.inject({
    method:'PATCH', url:'/v1/admin/routing/material-fields/' + fieldId,
    headers:{ cookie }, payload:{
      idempotencyKey:fieldId + '-routing', fieldId,
      expectedPolicyId:null, expectedRevision:0,
      policy:{ routingPolicyId:fieldId + '-routing-policy', mode:'direct',
        targets:[{ shelfId, rank:1, matchExpression:{ nodeKind:'always' } }] },
    },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function formation(host, cookie) {
  const response = await host.inject({
    method:'GET', url:'/v1/admin/formation?limit=100', headers:{ cookie },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().items;
}

async function waitFormation(host, cookie, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let items = [];
  while (Date.now() < deadline) {
    items = await formation(host, cookie);
    const found = items.find(predicate);
    if (found) return found;
    await pause(50);
  }
  assert.fail('Formation did not reach UAT-131 state: ' + JSON.stringify(items));
}

async function rateSubject(host, cookie, subjectId, suffix, rating) {
  const response = await host.inject({
    method:'POST', url:'/v1/admin/perception/records', headers:{ cookie }, payload:{
      targetType:'subject', targetId:subjectId, expectedRevision:0, rating,
      idempotencyKey:'uat-131-rating-' + suffix,
    },
  });
  assert.equal(response.statusCode, 202, response.body);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await host.inject({
      method:'GET',
      url:'/v1/admin/perception/records?targetType=subject&targetId=' + encodeURIComponent(subjectId),
      headers:{ cookie },
    });
    assert.equal(current.statusCode, 200, current.body);
    if (current.json().currentRating?.state === 'ready' &&
        current.json().currentRating.rating === rating) return;
    await pause(50);
  }
  assert.fail('UAT-131 rating did not become ready.');
}

async function waitDefectCandidate(host, cookie, runId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await host.inject({
      method:'GET',
      url:'/v1/admin/formation/runs/' + runId + '/defect-admission-candidate',
      headers:{ cookie },
    });
    last = { statusCode:response.statusCode, body:response.body };
    if (response.statusCode === 200 && response.json().eligibility==='eligible') return response.json();
    if (response.statusCode === 200) {await pause(50);continue;}
    assert.ok([400, 409].includes(response.statusCode), response.body);
    await pause(50);
  }
  assert.fail('UAT-131 defect candidate did not become available: ' + JSON.stringify(last));
}

async function admit(host, cookie, runId, candidate, key) {
  const response = await host.inject({
    method:'POST',
    url:'/v1/admin/formation/runs/' + runId + '/actions/admit-with-defects',
    headers:{ cookie },
    payload:{
      idempotencyKey:key,
      expectedRunStateRevision:candidate.frozenRunStateRevision,
      expectedRunStateDigest:candidate.frozenRunStateDigest,
      expectedDefectCandidateDigest:candidate.candidateDigest,
      acknowledged:true,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

async function waitDatabase(databasePath, predicate, timeoutMs = 120_000,
  extraDiagnostic = () => null) {
  const deadline = Date.now() + timeoutMs;
  let observed = null;
  while (Date.now() < deadline) {
    const database = new Database(databasePath, { readonly:true });
    try {
      observed = predicate(database);
      if (observed) return observed;
    } finally {
      database.close();
    }
    await pause(50);
  }
  const database = new Database(databasePath, { readonly:true });
  try {
    observed = durableDiagnostic(database);
  } finally {
    database.close();
  }
  assert.fail('UAT-131 durable state did not converge: ' + JSON.stringify({
    durable:observed,
    extra:extraDiagnostic(),
  }));
}

function durableDiagnostic(database) {
  const runs = database.prepare(`
    SELECT libra_run_id,state,state_revision,state_digest
      FROM libra_runs ORDER BY created_at_ms`).all();
  const works = database.prepare(`
    SELECT owner_domain,work_kind,state,work_id
      FROM fx_supporting_works
     WHERE state <> 'succeeded'
     ORDER BY created_at_ms,work_id`).all();
  const events = database.prepare(`
    SELECT e.owner_domain,e.capability_ref,e.state,e.event_id,
           a.state AS attempt_state,a.failure_class,a.failure_code,a.evidence_digest
      FROM fx_workflow_events e
      LEFT JOIN fx_event_attempts a
        ON a.event_id=e.event_id
       AND a.ordinal=(SELECT max(a2.ordinal) FROM fx_event_attempts a2
                       WHERE a2.event_id=e.event_id)
     WHERE e.state <> 'succeeded'
     ORDER BY e.event_id`).all();
  const deliveryWorks = database.prepare(`
    SELECT w.work_kind,w.state,w.work_id,a.state AS attempt_state,a.failure_code
      FROM fx_supporting_works w
      LEFT JOIN fx_work_attempts a
        ON a.work_id=w.work_id
       AND a.ordinal=(SELECT max(a2.ordinal) FROM fx_work_attempts a2
                       WHERE a2.work_id=w.work_id)
     WHERE w.work_kind IN ('product_conformance','deliverable_promotion')
     ORDER BY w.created_at_ms,w.work_id`).all();
  const count = (table) => Number(database.prepare(
    `SELECT count(*) count FROM ${table}`).get().count);
  return Object.freeze({
    runs,
    works,
    events,
    deliveryWorks,
    counts:Object.freeze({
      packages:count('libra_product_packages'),
      acceptanceAttempts:count('arca_acceptance_attempts'),
      shelfEntries:count('arca_shelf_entries'),
      deckFacts:count('arca_deck_fact_revisions'),
    }),
  });
}

function resultRows(database, capabilityRef) {
  return database.prepare(`
    SELECT e.event_id,e.state,b.result_id,b.result_json,b.result_digest
      FROM fx_workflow_events e
      JOIN fx_event_result_bindings b ON b.event_id=e.event_id
     WHERE e.capability_ref=?
     ORDER BY e.event_id,b.result_id`).all(capabilityRef).map((row) => Object.freeze({
      ...row,
      result:JSON.parse(row.result_json),
    }));
}

function selectionSnapshot(database) {
  const rows = resultRows(database, 'libra.product_output.select@1')
    .filter((row) => row.result.result === 'not_selected');
  assert.equal(rows.length, 1, 'UAT-131 must preserve one original not_selected Result.');
  return Object.freeze({
    eventId:rows[0].event_id,
    resultId:rows[0].result_id,
    resultDigest:rows[0].result_digest,
    resultJson:rows[0].result_json,
    draftDigest:rows[0].result.draftDigest,
  });
}

function sideEffectSnapshot(database) {
  const count = (table) => Number(database.prepare(
    `SELECT count(*) count FROM ${table}`).get().count);
  return Object.freeze({
    packages:count('libra_product_packages'),
    deliveryReceipts:count('libra_delivery_receipts'),
    acceptanceAttempts:count('arca_acceptance_attempts'),
    acceptanceDecisions:count('arca_acceptance_decisions'),
    custodies:count('arca_ondeck_custodies'),
    onDeckRuns:count('arca_ondeck_runs'),
    shelfEntries:count('arca_shelf_entries'),
    inventoryRepresentations:count('arca_inventory_representations'),
    deckFacts:count('arca_deck_fact_revisions'),
    onDeckReceipts:count('arca_ondeck_commit_receipts'),
    offloadCompletions:count('arca_offload_completions'),
    promotionWorks:Number(database.prepare(
      "SELECT count(*) count FROM fx_supporting_works WHERE owner_domain='libra' AND work_kind='deliverable_promotion'"
    ).get().count),
  });
}

function assertCompletedEvidence(database, expectedCodes, finalManifest, originalSelection) {
  const selectionRows = resultRows(database, 'libra.product_output.select@1').filter(row=>row.result.libraRunId===finalManifest.libraRunId);
  if (originalSelection) {
    const selections = selectionRows.filter((row) =>
      row.result_id === originalSelection.resultId);
    assert.equal(selections.length, 1);
    assert.equal(selections[0].result_json, originalSelection.resultJson);
    assert.equal(selections[0].result_digest, originalSelection.resultDigest);
    assert.equal(selections[0].result.draftDigest, originalSelection.draftDigest);
  } else {
    assert.equal(selectionRows.length, 1,JSON.stringify(selectionRows.map(row=>({eventId:row.event_id,work:row.work_id,result:row.result}))));
    assert.equal(selectionRows[0].result.result, 'selected');
  }

  const conformances = resultRows(database, 'libra.product.conformance.verify@1').filter(row=>row.result.libraRunId===finalManifest.libraRunId);
  assert.equal(conformances.length, 1);
  assert.equal(conformances[0].state, 'succeeded');
  assert.equal(conformances[0].result.result, 'failed');
  assert.deepEqual([...conformances[0].result.unmetRequirementCodes]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  expectedCodes);

  const packageRows = database.prepare(
    'SELECT on_deck_package_id,attestation_json FROM libra_product_packages').all();
  assert.equal(packageRows.length, 1);
  const attestation = JSON.parse(packageRows[0].attestation_json);
  assert.equal(attestation.acceptanceKind, 'accepted_with_defects');
  assert.deepEqual(attestation.unmetRequirementCodes, expectedCodes);
  assert.equal(attestation.authorizedDefectManifest.manifestDigest,
    finalManifest.manifestDigest);
  assert.equal(attestation.productConformanceEvidenceId,
    conformances[0].result.verificationId);

  const fact = database.prepare(`
    SELECT fact_digest,fact_json FROM arca_inventory_product_facts
     WHERE fact_kind='authorized_defect_manifest'`).all();
  assert.equal(fact.length, 1);
  assert.equal(fact[0].fact_digest, finalManifest.manifestDigest);
  assert.equal(JSON.parse(fact[0].fact_json).manifestDigest, finalManifest.manifestDigest);

  assert.deepEqual(sideEffectSnapshot(database), {
    packages:1, deliveryReceipts:1, acceptanceAttempts:1, acceptanceDecisions:1,
    custodies:1, onDeckRuns:1, shelfEntries:1, inventoryRepresentations:1,
    deckFacts:1, onDeckReceipts:1, offloadCompletions:1, promotionWorks:1,
  });
  assert.equal(database.prepare(
    "SELECT count(*) count FROM arca_acceptance_decisions WHERE result='accepted'"
  ).get().count, 1);
  assert.equal(database.prepare(
    "SELECT count(*) count FROM libra_runs WHERE state='completed'"
  ).get().count, 1);
}

async function createScenario(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-uat131-' + scenario.name + '-'));
  const paths = Object.freeze({
    root,
    data:path.join(root, 'data'),
    admin:path.join(root, 'admin'),
    field:path.join(root, 'field'),
    shelf:path.join(root, 'shelf'),
    downloads:path.join(root, 'downloads'),
    workspace:path.join(root, 'libra-workspaces'),
    aftercare:path.join(root, 'arca-aftercare-workspaces'),
  });
  [paths.admin, paths.field, paths.shelf, paths.downloads, paths.workspace,
    paths.aftercare].forEach((directory) => fs.mkdirSync(directory, { recursive:true }));
  fs.writeFileSync(path.join(paths.admin, 'index.html'), '<div id="root"></div>');
  const primaryLocation = path.join(paths.field, 'UAT131 Movie (2026).mkv');
  if (REAL_NFO_MEDIA) fs.copyFileSync(REAL_NFO_MEDIA, primaryLocation);
  else fs.writeFileSync(primaryLocation, Buffer.from('uat-131-disposable-movie'));
  if (scenario.name === 'actor-only') fs.writeFileSync(path.join(paths.field, 'UAT131 Movie (2026).nfo'),
    '<movie><title>UAT131 Movie</title><year>2026</year><tmdbid>913100</tmdbid></movie>');
  const initialized = initializeCleanData({
    dataDir:paths.data, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot:SECRET,
  });
  const calls = [];
  const runtimeErrors = [];
  const requestErrors = [];
  const acceptanceStages = [];
  let clockOffset=0;
  const hostOptions = Object.freeze({
    now:()=>Date.now()+clockOffset,
    dataDir:paths.data,
    adminDistDir:paths.admin,
    secretRoot:SECRET,
    libraWorkspaceRoot:paths.workspace,
    aftercareWorkspaceRoot:paths.aftercare,
    ...(REAL_NFO_MEDIA ? {} : {
      mediaProbe:mediaProbe(),
      mediaProductionEffectPort:mediaEffectPort(),
      aftercarePlaybackRunner:async()=>{},
    }),
    ...(scenario.mediaGap
      ? { platformComputeRuntime:incompatiblePlatformRuntime() }
      : {}),
    integrationFetch:noCandidateMoviePilotFetch(calls),
    ...productOptions(scenario.actorAvailable),
    aftercareArtifactFetch:productOptions(scenario.actorAvailable,process.env.HELIX_UAT251_REPAIR_FAIL==='1').productProviderArtifactFetch,
    deferredDeliveryKeys:Object.freeze([]),
    onExecutionRuntimeError(error) {
      runtimeErrors.push(error);
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    onRequestError(error) {
      requestErrors.push(error);
      if (process.env.HELIX_TEST_LOG_RUNTIME_ERROR === '1') console.error(error);
    },
    afterAttemptAcceptedCas() { acceptanceStages.push('attempt_accepted'); },
    afterAcceptedResponsibilityInsert() { acceptanceStages.push('responsibility_inserted'); },
    afterHandoffBControlTransfer() { acceptanceStages.push('control_transferred'); },
    afterHandoffBReceiptInsert() { acceptanceStages.push('receipt_inserted'); },
    afterHandoffBOutboxInsert() { acceptanceStages.push('outbox_inserted'); },
  });
  let host = null;
  let cookie = null;
  async function start() {
    host = await createCleanServiceHost(hostOptions);
    cookie = await session(host, initialized.adminApiKey);
  }
  async function restart() {
    const resumeOffset=clockOffset;clockOffset=0;
    await host.close();
    clockOffset=resumeOffset;
    host = null;
    await start();
  }
  await start();
  t.after(async () => {
    clockOffset=0;
    if (host) await host.close();
    const resolved = path.resolve(root);
    assert.equal(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep), true);
    if (process.env.HELIX_KEEP_TEST_ASSETS !== '1') {
      fs.rmSync(resolved, { recursive:true, force:true, maxRetries:5, retryDelay:100 });
    }
  });
  return Object.freeze({
    paths,
    databasePath:path.join(paths.data, 'shelfdeck.db'),
    calls,
    runtimeErrors,
    requestErrors,
    acceptanceStages,
    advanceClock(ms){clockOffset+=ms;},
    get host() { return host; },
    get cookie() { return cookie; },
    restart,
  });
}

const SCENARIOS = Object.freeze([
  Object.freeze({ name:'actor-only', actorAvailable:false, mediaGap:false,
    expectedCodes:Object.freeze(['metadata_field_unmet']) }),
  Object.freeze({ name:'external-only', actorAvailable:true, mediaGap:true,
    rating:1, expectedCodes:Object.freeze(['video_codec_unmet']) }),
  Object.freeze({ name:'external-multi', actorAvailable:true, mediaGap:true,
    rating:5, expectedCodes:Object.freeze([
      'minimum_raster_unmet', 'primary_audio_unmet', 'video_codec_unmet',
    ]) }),
  Object.freeze({ name:'combined', actorAvailable:false, mediaGap:true,
    expectedCodes:Object.freeze(['metadata_field_unmet', 'video_codec_unmet']) }),
]);

const requestedScenario = process.env.HELIX_UAT131_SCENARIO || null;
const AUTOMATIC_DEFECTS = process.env.HELIX_UAT251_AUTOMATIC === '1';
const ACTIVE_SCENARIOS = requestedScenario
  ? SCENARIOS.filter((scenario) => scenario.name === requestedScenario)
  : SCENARIOS;
if (requestedScenario) assert.equal(ACTIVE_SCENARIOS.length, 1,
  'HELIX_UAT131_SCENARIO must name a frozen UAT-131 scenario.');

test('UAT-131 real Admin HTTP admits exact defects and reaches one On-deck commit', {
  timeout:360_000,
  skip:AUTOMATIC_DEFECTS,
}, async (t) => {
  for (const scenario of ACTIVE_SCENARIOS) await t.test(scenario.name, {
    timeout:180_000,
  }, async (t) => {
    const harness = await createScenario(t, scenario);
    const suffix = scenario.name;
    const shelfId = 'uat-131-shelf-' + suffix;
    await createShelf(harness.host, harness.cookie, harness.paths.shelf, suffix);
    const settlement = await harness.host.inject({ method:'POST',
      url:'/v1/admin/settings/automatic-operation/actions/enable-full',
      headers:{cookie:harness.cookie}, payload:{idempotencyKey:'uat131-settlement-'+suffix,
        expectedRevision:0,coverExclusiveRelatedInput:true} });
    assert.equal(settlement.statusCode,200,settlement.body);
    if (scenario.mediaGap) {
      await configureMoviePilot(harness.host, harness.cookie, harness.paths.downloads, suffix);
    }
    const fieldId = await createField(harness.host, harness.cookie, harness.paths.field, suffix);
    await observe(harness.host, harness.cookie, fieldId);
    const subject = await waitFormation(harness.host, harness.cookie,
      (item) => String(item.displayIdentity || '').includes('UAT131 Movie'));
    if (scenario.mediaGap) {
      await rateSubject(harness.host, harness.cookie, subject.subjectId, suffix,
        scenario.rating || 1);
    }
    await route(harness.host, harness.cookie, fieldId, shelfId);
    const frozen = await waitFormation(harness.host, harness.cookie,
      (item) => item.subjectId === subject.subjectId && item.currentRun?.state === 'frozen',
      120_000);
    const runId = frozen.currentRun.libraRunId;

    if(scenario.mediaGap){
      const response=await harness.host.inject({method:'GET',url:'/v1/admin/formation/runs/'+runId+'/defect-admission-candidate',headers:{cookie:harness.cookie}});
      assert.equal(response.statusCode,200,response.body);
      assert.equal(response.json().eligibility,'ineligible',response.body);
      const db=new Database(harness.databasePath,{readonly:true});try{assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);}finally{db.close();}
      return;
    }
    const firstCandidate = await waitDefectCandidate(
      harness.host, harness.cookie, runId);
    let finalCandidate = firstCandidate;
    if (scenario.name === 'combined') {
      assert.deepEqual(firstCandidate.waivedRequirementCodes, ['metadata_field_unmet']);
      const first = await admit(harness.host, harness.cookie, runId, firstCandidate,
        'uat-131-admit-combined-a');
      assert.equal(first.authorizedDefectManifest.defects.length, 1);
      await waitFormation(harness.host, harness.cookie,
        (item) => item.subjectId === subject.subjectId &&
          item.currentRun?.libraRunId === runId && item.currentRun.state === 'frozen' &&
          item.currentRun.stateRevision > firstCandidate.frozenRunStateRevision,
        120_000);
      finalCandidate = await waitDefectCandidate(harness.host, harness.cookie, runId);
      assert.deepEqual(finalCandidate.waivedRequirementCodes, scenario.expectedCodes);
      assert.notEqual(firstCandidate.candidateDigest, finalCandidate.candidateDigest);
    } else {
      assert.deepEqual(firstCandidate.waivedRequirementCodes, scenario.expectedCodes);
    }

    const before = new Database(harness.databasePath, { readonly:true });
    let originalSelection;
    try {
      originalSelection = scenario.mediaGap ? selectionSnapshot(before) : null;
    } finally {
      before.close();
    }

    if (scenario.name === 'combined') {
      await harness.restart();
      const recovered = await waitDefectCandidate(harness.host, harness.cookie, runId);
      assert.equal(recovered.candidateDigest, finalCandidate.candidateDigest);
      assert.equal(canonicalJson(recovered), canonicalJson(finalCandidate));
      finalCandidate = recovered;
    }

    let frozenNfoObservation = null;
    if (scenario.name === 'actor-only') {
      const observed = new Database(harness.databasePath, {readonly:true});
      try {
        const rows = observed.prepare("SELECT result_json FROM fx_event_result_bindings WHERE json_extract(result_json,'$.sourceKind')='related_nfo' AND json_extract(result_json,'$.producerRef')='libra.product_metadata.fetch@1'").all();
        assert.equal(rows.length,1,'NFO source must be observed before external rewrite');
        frozenNfoObservation = JSON.parse(rows[0].result_json);
        assert.ok(frozenNfoObservation.sourceNfoSemantics?.recordDigest);
      } finally {observed.close();}
      const location = path.join(harness.paths.field, 'UAT131 Movie (2026).nfo');
      fs.writeFileSync(location + '.tmp', '<movie><tmdbid>913100</tmdbid><title><![CDATA[UAT131 Movie]]></title><year>2026</year><dateadded>2026-09-07</dateadded></movie>');
      fs.renameSync(location + '.tmp',location);
      fs.writeFileSync(path.join(harness.paths.field,'independent-version.mp4'),'outside-candidate-media');
      fs.mkdirSync(path.join(harness.paths.field,'unrelated-extras'));
      fs.writeFileSync(path.join(harness.paths.field,'unrelated-extras','notes.txt'),'outside-candidate-notes');
      await harness.restart();
    }
    const admitted = await admit(harness.host, harness.cookie, runId, finalCandidate,
      'uat-131-admit-' + suffix + '-final');
    const finalManifest = admitted.authorizedDefectManifest;
    assert.deepEqual(finalManifest.waivedRequirementCodes, scenario.expectedCodes);

    const terminal = await waitDatabase(harness.databasePath, (database) => {
      const entries = Number(database.prepare(
        'SELECT count(*) count FROM arca_shelf_entries').get().count);
      const completed = Number(database.prepare(
        "SELECT count(*) count FROM libra_runs WHERE state='completed'").get().count);
      const acceptedAcked = Number(database.prepare(
        "SELECT count(*) count FROM fx_outbox WHERE message_kind='arca.product.accepted@1' AND state='fully_acked'"
      ).get().count);
      const failed = database.prepare(`
        SELECT e.capability_ref,e.event_id,a.failure_class,a.failure_code,a.evidence_digest
          FROM fx_workflow_events e
          JOIN fx_event_attempts a ON a.event_id=e.event_id
         WHERE e.state='failed' AND a.state='completed'
         ORDER BY e.event_id,a.ordinal DESC LIMIT 1`).get();
      if (failed) assert.fail('UAT-131 terminal blocker: ' + JSON.stringify({
        failed,
        durable:durableDiagnostic(database),
        runtimeErrors:harness.runtimeErrors.map((error) => ({
          name:error?.name, code:error?.code, message:error?.message, stack:error?.stack,
        })),
        requestErrors:harness.requestErrors.map((error) => ({
          name:error?.name, code:error?.code, message:error?.message, stack:error?.stack,
        })),
        acceptanceStages:harness.acceptanceStages,
      }));
      return entries === 1 && completed === 1 && acceptedAcked === 1
        ? { entries, completed, acceptedAcked } : null;
    }, Number(process.env.HELIX_UAT131_SETTLE_TIMEOUT_MS || 90_000), () => ({
      acceptanceStages:harness.acceptanceStages,
      runtimeErrors:harness.runtimeErrors.map((error) => ({
        name:error?.name, code:error?.code, message:error?.message,
      })),
    }));
    assert.deepEqual(terminal, { entries:1, completed:1, acceptedAcked:1 });
    assert.deepEqual(harness.runtimeErrors, []);

    const database = new Database(harness.databasePath, { readonly:true });
    let stable;
    try {
      assertCompletedEvidence(database, scenario.expectedCodes, finalManifest,
        originalSelection);
      if (frozenNfoObservation) {
        const provenance = JSON.parse(database.prepare('SELECT production_provenance_json FROM libra_product_packages').get().production_provenance_json);
        assert.deepEqual(provenance.sourceNfoObservations,[frozenNfoObservation],
          'Handoff B must carry the original durable NFO witness across restart');
        assert.equal(fs.existsSync(path.join(harness.paths.field,'UAT131 Movie (2026).nfo')),false,
          'Semantically unchanged rewritten source must be settled before On-deck commit');
        assert.equal(fs.readFileSync(path.join(harness.paths.field,'independent-version.mp4'),'utf8'),'outside-candidate-media');
        assert.equal(fs.readFileSync(path.join(harness.paths.field,'unrelated-extras','notes.txt'),'utf8'),'outside-candidate-notes');
        assert.equal(fs.existsSync(harness.paths.field),true);
      }
      stable = sideEffectSnapshot(database);
    } finally {
      database.close();
    }

    if (scenario.name === 'combined') {
      await harness.restart();
      await pause(750);
      const replay = new Database(harness.databasePath, { readonly:true });
      try {
        assert.deepEqual(sideEffectSnapshot(replay), stable);
      } finally {
        replay.close();
      }
      assert.deepEqual(harness.runtimeErrors, []);
    }

    if (scenario.mediaGap) {
      assert.ok(harness.calls.some((item) => item.path === '/api/v1/search/title'));
      assert.equal(harness.calls.some((item) => item.path === '/api/v1/download/add'), false);
    }
  });
});

test('UAT-251 standing authorization automatically admits exact Movie defects and persists the real collection outcome', {
  timeout:360_000,skip:!AUTOMATIC_DEFECTS,
}, async t => {
  for (const scenario of ACTIVE_SCENARIOS) await t.test(scenario.name,{timeout:330_000},async t => {
    const harness=await createScenario(t,scenario),suffix=scenario.name;
    const granted=await harness.host.inject({method:'PATCH',url:'/v1/admin/formation/defect-authorization',
      headers:{cookie:harness.cookie},payload:{enabled:true,expectedRevision:0,idempotencyKey:'uat251-auto-enable',acknowledged:true}});
    assert.equal(granted.statusCode,200,granted.body);
    const authorization=JSON.parse(granted.body).authorization;
    await harness.restart();
    await createShelf(harness.host,harness.cookie,harness.paths.shelf,suffix);
    const settlement=await harness.host.inject({method:'POST',url:'/v1/admin/settings/automatic-operation/actions/enable-full',
      headers:{cookie:harness.cookie},payload:{idempotencyKey:'uat251-source-settlement',expectedRevision:0,coverExclusiveRelatedInput:true}});
    assert.equal(settlement.statusCode,200,settlement.body);
    if(scenario.mediaGap)await configureMoviePilot(harness.host,harness.cookie,harness.paths.downloads,suffix);
    const field=await createField(harness.host,harness.cookie,harness.paths.field,suffix);
    await observe(harness.host,harness.cookie,field);
    const subject=await waitFormation(harness.host,harness.cookie,item=>String(item.displayIdentity||'').includes('UAT131 Movie'));
    if(scenario.mediaGap)await rateSubject(harness.host,harness.cookie,subject.subjectId,suffix,scenario.rating||1);
    await route(harness.host,harness.cookie,field,'uat-131-shelf-'+suffix);
    if(process.env.HELIX_UAT251_NO_METADATA_PROVIDER==='1') {
      for(const [ordinal,offset] of [0,60000,300000,900000,1800000,3600000].entries()) {
        if(ordinal)harness.advanceClock(offset-[0,60000,300000,900000,1800000,3600000][ordinal-1]+100);
        await waitDatabase(harness.databasePath,db=>db.prepare("SELECT evidence_json FROM libra_strategy_availability WHERE check_ordinal=?").get(ordinal),60000,
          ()=>({runtimeErrors:harness.runtimeErrors.map(error=>({code:error.code,message:error.message}))}));
        if(ordinal===0) {await harness.restart();const db=new Database(harness.databasePath,{readonly:true});
          try{assert.equal(db.prepare("SELECT count(*) n FROM libra_runs WHERE state='active'").get().n,1);
            assert.equal(db.prepare('SELECT count(*) n FROM libra_run_outcomes').get().n,0);}finally{db.close();}}
      }
    }
    if(scenario.mediaGap || ['HELIX_UAT251_MISSING_POSTER','HELIX_UAT251_TECHNICAL_FAILURE','HELIX_UAT251_ARTIFACT_NETWORK_FAILURE','HELIX_UAT251_NO_METADATA_PROVIDER'].some(key=>process.env[key]==='1')){
      const outcome=await waitDatabase(harness.databasePath,db=>db.prepare("SELECT outcome_json FROM libra_run_outcomes WHERE subject_id=? AND outcome='unable_to_on_deck'").get(subject.subjectId),180000);
      assert.ok(outcome);
      const db=new Database(harness.databasePath,{readonly:true});try{
        assert.equal(db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,0);
        assert.equal(db.prepare("SELECT count(*) n FROM libra_run_revisions WHERE transition_kind='defect_admitted'").get().n,0);
      }finally{db.close();}
      assert.equal(fs.readFileSync(path.join(harness.paths.field,'UAT131 Movie (2026).mkv'),'utf8'),'uat-131-disposable-movie');
      return;
    }
    if(process.env.HELIX_UAT251_UNSAFE==='1') {
      const first=await waitDatabase(harness.databasePath,db=>{
        const row=db.prepare("SELECT outcome_json,outcome_digest FROM libra_run_outcomes WHERE outcome='unable_to_on_deck'").get();
        return row?{...JSON.parse(row.outcome_json),outcomeDigest:row.outcome_digest}:null;
      },90_000,()=>({runtimeErrors:harness.runtimeErrors.map(error=>({code:error.code,message:error.message}))}));
      assert.equal(first.reasonCode,'processing_failed');
      assert.ok(first.terminalReasons.some(reason=>reason.failureCode==='playback_decode_failed'));
      assert.equal(first.terminalProductEvidence.libraRunId,first.libraRunId);
      assert.ok(first.terminalProductEvidence.reasonCodes.includes('playback_decode_failed'));
      const primary=path.join(harness.paths.field,'UAT131 Movie (2026).mkv');
      assert.equal(fs.readFileSync(primary,'utf8'),'uat-131-disposable-movie');
      let db=new Database(harness.databasePath,{readonly:true});
      try {
        assert.equal(db.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count,0);
        assert.equal(db.prepare('SELECT count(*) count FROM libra_run_outcomes').get().count,1);
        assert.ok(db.prepare('SELECT state FROM fx_material_controls WHERE material_key IN (SELECT material_key FROM libra_run_material_members WHERE run_material_manifest_id=(SELECT run_material_manifest_id FROM libra_runs WHERE libra_run_id=?))')
          .all(first.libraRunId).every(control=>control.state==='released'));
        const workspace=db.prepare('SELECT state FROM libra_workspaces WHERE libra_run_id=?').get(first.libraRunId);
        assert.equal(workspace.state,'reclaimed');
        assert.equal(first.responsibilityReceipt.cleanupScopeId,null);
      }finally{db.close();}
      await harness.restart();
      const base='/v1/admin/formation/runs/'+first.libraRunId;
      const recorded=await harness.host.inject({method:'GET',url:base+'/outcome',headers:{cookie:harness.cookie}});
      assert.equal(recorded.statusCode,200,recorded.body);assert.deepEqual(recorded.json().outcome,first);
      const history=await harness.host.inject({method:'GET',url:'/v1/admin/formation?section=ended&limit=100',headers:{cookie:harness.cookie}});
      assert.equal(history.statusCode,200,history.body);
      assert.ok(history.json().items.some(item=>item.libraRunId===first.libraRunId&&item.label==='无法上架'),history.body);
      const payload={expectedOutcomeDigest:first.outcomeDigest,idempotencyKey:'uat251-explicit-retry'};
      const retry=await harness.host.inject({method:'POST',url:base+'/actions/reprocess',headers:{cookie:harness.cookie},payload});
      assert.equal(retry.statusCode,202,retry.body);
      const replay=await harness.host.inject({method:'POST',url:base+'/actions/reprocess',headers:{cookie:harness.cookie},payload});
      assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().intentId,retry.json().intentId);assert.equal(replay.json().replayed,true);
      await waitDatabase(harness.databasePath,db=>db.prepare("SELECT count(*) count FROM libra_run_outcomes WHERE outcome='unable_to_on_deck'").get().count===2,120_000,
        ()=>({runtimeErrors:harness.runtimeErrors.map(error=>({code:error.code,message:error.message}))}));
      await harness.restart();await pause(1000);
      db=new Database(harness.databasePath,{readonly:true});
      try {
        assert.equal(db.prepare('SELECT count(*) count FROM libra_runs').get().count,2);
        const results=db.prepare('SELECT stable_input_digest,requirements_digest FROM libra_run_outcomes').all();
        assert.deepEqual(results[0],results[1]);
        assert.equal(db.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count,0);
      }finally{db.close();}
      assert.equal(fs.readFileSync(primary,'utf8'),'uat-131-disposable-movie');
      assert.deepEqual(harness.runtimeErrors,[]);
      return;
    }
    const outcome=await waitDatabase(harness.databasePath,database=>{
      const row=database.prepare("SELECT outcome_json,outcome_digest FROM libra_run_outcomes WHERE subject_id=? AND outcome='on_deck_with_defects'").get(subject.subjectId);
      if(!row)return null;
      const value=JSON.parse(row.outcome_json);
      assert.equal(canonicalDigest(value),row.outcome_digest);
      assert.equal(database.prepare('SELECT count(*) count FROM arca_ondeck_commit_receipts WHERE shelf_entry_id=?').get(value.onDeckCommitReceipt.shelfEntryId).count,1);
      assert.deepEqual(value.authorizedDefectManifest.waivedRequirementCodes,scenario.expectedCodes);
      assert.equal(value.authorizedDefectManifest.standingAuthorization.authorizationDigest,authorization.authorizationDigest);
      return value;
    },300_000,()=>({runtimeErrors:harness.runtimeErrors.map(e=>({code:e.code,message:e.message}))}));
    await harness.restart();
    const database=new Database(harness.databasePath,{readonly:true});
    try {
      const rows=database.prepare('SELECT outcome_json FROM libra_run_outcomes WHERE libra_run_id=?').all(outcome.libraRunId);
      assert.equal(rows.length,1);assert.deepEqual(JSON.parse(rows[0].outcome_json),outcome);
      assert.equal(database.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count,1);
    }finally{database.close();}
    if(process.env.HELIX_UAT251_ARCA==='1'||process.env.HELIX_UAT251_ARCA_POSTER==='1') {
      const entryId=outcome.onDeckCommitReceipt.shelfEntryId,base='/v1/admin/care/'+entryId;
      const check=await harness.host.inject({method:'POST',url:base+'/actions/check',headers:{cookie:harness.cookie},payload:{idempotencyKey:'uat251-collection-check'}});
      assert.equal(check.statusCode,202,check.body);
      let preview;
      for(let attempt=0;attempt<100;attempt++) {
        const response=await harness.host.inject({method:'GET',url:base+'/defect-admission-candidate',headers:{cookie:harness.cookie}});
        assert.equal(response.statusCode,200,response.body);preview=response.json();
        if(preview.eligibility!=='evidence_pending')break;
        await pause(100);
      }
      assert.equal(preview.eligibility,'eligible',JSON.stringify(preview));
      assert.ok(preview.acceptedGaps.some(gap=>gap.targetId==='actor'),JSON.stringify(preview));
      if(process.env.HELIX_UAT251_ARCA_POSTER==='1') {
        const initialManifestDigest=outcome.authorizedDefectManifest.manifestDigest;
        assert.ok(preview.acceptedGaps.some(gap=>gap.targetId==='poster'),JSON.stringify(preview));
        assert.equal(preview.authorizationRevision,0);
        assert.equal(preview.repairableGapDigests.length,1,JSON.stringify(preview));
        const payload={expectedInventoryRevision:preview.inventoryRevision,expectedCareBasisDigest:preview.careBasisDigest,
          expectedAuthorizationRevision:preview.authorizationRevision,expectedCandidateDigest:preview.candidateDigest,
          acknowledged:true,idempotencyKey:'uat251-arca-inherited-poster-repair'};
        const repair=await harness.host.inject({method:'POST',url:base+'/actions/repair-accepted-defects',headers:{cookie:harness.cookie},payload});
        assert.equal(repair.statusCode,202,repair.body);
        assert.equal(repair.json().resultKind,'repair_requested',repair.body);
        const caseId=repair.json().aftercareCaseId;
        const replay=await harness.host.inject({method:'POST',url:base+'/actions/repair-accepted-defects',headers:{cookie:harness.cookie},payload});
        assert.equal(replay.statusCode,202,replay.body);assert.equal(replay.json().replayed,true);
        const failed=process.env.HELIX_UAT251_REPAIR_FAIL==='1';
        await waitDatabase(harness.databasePath,db=>{
          const care=db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(caseId);
          return care&&['resolved','unresolved'].includes(care.state)?care:null;
        },90_000,()=>({runtimeErrors:harness.runtimeErrors.map(error=>({code:error.code,message:error.message}))}));
        const db=new Database(harness.databasePath,{readonly:true});
        try {
          assert.equal(db.prepare('SELECT state FROM arca_aftercare_cases WHERE aftercare_case_id=?').get(caseId).state,failed?'unresolved':'resolved');
          assert.equal(db.prepare('SELECT count(*) count FROM arca_shelf_entries').get().count,1);
          const row=db.prepare('SELECT authorization_json FROM arca_defect_admissions WHERE shelf_entry_id=? ORDER BY revision DESC LIMIT 1').get(entryId);
          const authorization=JSON.parse(row.authorization_json);
          assert.equal(authorization.gaps.some(gap=>gap.targetId==='poster'),failed);
          assert.ok(authorization.gaps.some(gap=>gap.targetId==='actor'));
          assert.ok(db.prepare("SELECT fact_digest FROM arca_inventory_product_facts WHERE fact_kind='authorized_defect_manifest'").all()
            .every(fact=>fact.fact_digest===initialManifestDigest));
          assert.equal(db.prepare('SELECT count(*) count FROM arca_aftercare_cases WHERE shelf_entry_id=?').get(entryId).count,1);
        }finally{db.close();}
        await harness.restart();
        const health=await harness.host.inject({method:'GET',url:base,headers:{cookie:harness.cookie}});
        assert.equal(health.json().health.healthState,'healthy',health.body);
        assert.deepEqual(harness.runtimeErrors,[]);
        return;
      }
      const payload={expectedInventoryRevision:preview.inventoryRevision,expectedCareBasisDigest:preview.careBasisDigest,
        expectedAuthorizationRevision:preview.authorizationRevision,expectedCandidateDigest:preview.candidateDigest,acknowledged:true,idempotencyKey:'uat251-arca-accept'};
      const accepted=await harness.host.inject({method:'POST',url:base+'/actions/accept-defects',headers:{cookie:harness.cookie},payload});
      assert.equal(accepted.statusCode,200,accepted.body);
      const replay=await harness.host.inject({method:'POST',url:base+'/actions/accept-defects',headers:{cookie:harness.cookie},payload});
      assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().replayed,true);
      preview=(await harness.host.inject({method:'GET',url:base+'/defect-admission-candidate',headers:{cookie:harness.cookie}})).json();
      const repair=await harness.host.inject({method:'POST',url:base+'/actions/repair-accepted-defects',headers:{cookie:harness.cookie},payload:{...payload,
        expectedCandidateDigest:preview.candidateDigest,expectedAuthorizationRevision:preview.authorizationRevision,idempotencyKey:'uat251-arca-repair'}});
      assert.equal(repair.statusCode,202,repair.body);assert.equal(repair.json().resultKind,'repair_unavailable');
      const health=await harness.host.inject({method:'GET',url:base,headers:{cookie:harness.cookie}});
      assert.equal(health.json().health.state,'healthy',health.body);
    }
    assert.deepEqual(harness.runtimeErrors,[]);
  });
});
