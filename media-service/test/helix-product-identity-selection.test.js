'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createProductIdentitySelectionService } = require('../src/helix/domains/libra/application/product-identity-selection-service');
const { createCapabilityContractValidator } = require('../src/helix/foundation/capability/contract-validator');
const {
  identityObservationFailed,
  observeProductIdentity,
} = require('../src/helix/domains/libra/capabilities/routing-capability-ports');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const hex = (value) => canonicalDigest({ value });
const observationSchema = JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../src/helix/contracts/types/ProductIdentityEvidenceObservation/v1/schema.json'), 'utf8'));
const observationValidator = createCapabilityContractValidator({ schemas: [observationSchema] });

function fixture(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-product-identity-selection-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 100;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const database = new Database(databasePath);
  database.prepare(
    'INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)',
  ).run('subject-1', 'single', 'movie', 'active', 1, hex('continuity'), hex('episode-scope'));
  database.prepare(
    'INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_schema_ref,execution_basis_record_json,execution_basis_digest,run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_policy_ref,recovery_policy_digest,recovery_attempt_ordinal,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).run('run-1', 'subject-1', 1, 'LibraRunExecutionBasis@1', '{}', hex('basis'), hex('scope'), 'active', 1,
    hex('state'), 'normal', hex('priority'), 'LibraRunRecoveryPolicy@1', hex('recovery'), 0, 100);
  database.close();
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const cleanup = () => { kernel.close(); fs.rmSync(root, { recursive:true, force:true }); };
  try {
    const result = run({ databasePath, service:createProductIdentitySelectionService({ schemaManifest, unitOfWork, ...options }) });
    if (result?.then) return result.finally(cleanup);
    cleanup(); return result;
  } catch (error) { cleanup(); throw error; }
}

test('manual Product Identity choice appends one immutable intent and replays the same command', () => fixture(({ databasePath, service }) => {
  const request = { idempotencyKey:'choose-tmdb-1', expectedRunStateRevision:1, expectedIdentityRevision:null,
    tmdbMovieId:'278', candidateSetDigest:hex('candidate-set') };
  const first = service.choose('run-1', request);
  const replay = service.choose('run-1', request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.selectionIntentId, first.selectionIntentId);
  assert.equal(replay.providerKey, '278');
  const current = service.readCurrent('run-1');
  assert.equal(current.provider_key, '278');
  assert.equal(current.selection_kind, 'provider_id');
  const database = new Database(databasePath, { readonly:true });
  assert.equal(database.prepare('SELECT COUNT(*) count FROM libra_product_identity_selection_intents').get().count, 1);
  assert.equal(database.prepare(
    "SELECT COUNT(*) count FROM fx_command_receipts WHERE command_contract='libra.choose-product-identity@1'",
  ).get().count, 1);
  database.close();
}));

test('manual choice rejects stale Run/Identity fences and idempotency payload reuse', () => fixture(({ service }) => {
  const request = { idempotencyKey:'choose-tmdb-1', expectedRunStateRevision:1, expectedIdentityRevision:null, tmdbMovieId:'278' };
  for(const tmdbMovieId of ['0','-1','1.2','9'.repeat(1000)])assert.throws(()=>service.choose('run-1',{...request,tmdbMovieId}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
  service.choose('run-1', request);
  assert.throws(() => service.choose('run-1', { ...request, tmdbMovieId:'13' }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT');
  assert.throws(() => service.choose('run-1', { ...request, idempotencyKey:'stale-run', expectedRunStateRevision:2 }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_STALE');
  assert.throws(() => service.choose('run-1', { ...request, idempotencyKey:'stale-identity', expectedIdentityRevision:1 }),
    (error) => error?.code === 'LIBRA_IDENTITY_SELECTION_IDENTITY_STALE');
}));

function evidenceIntent(associationKind) {
  const aliases = [{ value:'Expected Movie', sourceKind:associationKind === 'manual_selection' ? 'manual_selection' : 'related_nfo' }]
    .map((item) => ({ ...item, aliasDigest:canonicalDigest(item) }));
  const body = { intentId:'identity-intent-1', libraRunId:'run-1', subjectId:'subject-1',
    runExecutionBasisDigest:hex('basis'), contentProfile:'movie', sourceKind:'provider_exact', aliases,
    yearHint:2000, integrationId:'tmdb-main', configRevision:1, provider:'tmdb', namespace:'tmdb_movie',
    providerKey:'278', associationKind, associationEvidenceDigest:hex(associationKind) };
  return { ...body, intentDigest:canonicalDigest(body) };
}

test('NFO exact-ID evidence rejects a real TMDB object whose alias/year do not prove the association', async () => {
  const result = await observeProductIdentity({ observeRoutingProvider:async () => [{
    providerKey:'278', title:'Different Movie', originalTitle:'Different Movie', releaseYear:1999,
  }] }, evidenceIntent('nfo_claim'), { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(result.result, 'conflicting');
  assert.equal(result.reasonCode, 'provider_identity_conflicting');
  assert.equal(result.verifiedIdentity, null);
});

test('manual Selection Intent still performs exact TMDB observation before resolving', async () => {
  let calls = 0;
  const result = await observeProductIdentity({ observeRoutingProvider:async ({ operationId }) => {
    calls += 1;
    assert.equal(operationId, 'libra.product_identity.evidence.observe@1');
    return [{ providerKey:'278', title:'The Shawshank Redemption', originalTitle:'The Shawshank Redemption', releaseYear:1994 }];
  } }, evidenceIntent('manual_selection'), { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(calls, 1);
  assert.equal(result.result, 'resolved');
  assert.equal(result.verifiedIdentity.providerKey, '278');
});

test('NFKC-collapsing CJK titles cannot overflow the 32-alias Product Identity contract', async () => {
  const titleFullwidth = '007：大破天幕杀机';
  const titleAscii = titleFullwidth.normalize('NFKC');
  assert.notEqual(titleFullwidth, titleAscii);
  const extra = Array.from({ length: 32 }, (_item, index) => ({
    value: 'Skyfall alias ' + String(index).padStart(2, '0'), sourceKind: 'alternative_title',
  }));
  const intent = {
    ...evidenceIntent('nfo_claim'),
    providerKey: '37724',
    yearHint: 2012,
    aliases: [{ value: titleFullwidth, sourceKind: 'candidate',
      aliasDigest: canonicalDigest({ value: titleFullwidth, sourceKind: 'candidate' }) }],
  };
  const observation = await observeProductIdentity({ observeRoutingProvider: async () => [{
    providerKey: '37724', title: titleFullwidth, originalTitle: 'Skyfall', releaseYear: 2012,
    aliases: [{ value: titleAscii, sourceKind: 'localized' }, ...extra],
  }] }, intent, { integrationId: 'tmdb-main', configRevision: 1 });
  assert.equal(observation.result, 'resolved');
  assert.ok(observation.verifiedIdentity.aliases.length <= 32);
  assert.equal(new Set(observation.verifiedIdentity.aliases.map((item) => item.value)).size,
    observation.verifiedIdentity.aliases.length);
  observationValidator.validate('helix://contracts/types/ProductIdentityEvidenceObservation/v1', observation);
});

test('TMDB timeout wrapped by a Secret lease is a retryable timeout Outcome', () => {
  const error = Object.assign(new Error('Secret-backed invocation failed.'), {
    code: 'P5_SECRET_LEASE_INVOCATION_FAILED',
    details: { causeCode: 'PLATFORM_INTEGRATION_TIMEOUT' },
  });
  const outcome = identityObservationFailed(error);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.failureClass, 'timeout');
  assert.equal(outcome.code, 'PLATFORM_INTEGRATION_TIMEOUT');
  assert.equal(outcome.retryDirective, 'contract_policy');
  const network = Object.assign(new Error('Secret-backed invocation failed.'), {
    code: 'P5_SECRET_LEASE_INVOCATION_FAILED',
    details: { causeCode: 'PLATFORM_INTEGRATION_NETWORK_FAILED', networkCode:'ECONNRESET', stage:'json_request',
      url:'https://example.test/?api_key=synthetic-secret' },
  });
  assert.equal(identityObservationFailed(network).failureClass, 'integration');
  assert.deepEqual(identityObservationFailed(network).evidence.diagnostics, {causeCode:'PLATFORM_INTEGRATION_NETWORK_FAILED',networkCode:'ECONNRESET',stage:'json_request'});
  assert.equal(JSON.stringify(identityObservationFailed(network)).includes('synthetic-secret'), false);
  assert.throws(() => identityObservationFailed(Object.assign(new Error('schema'), {
    code: 'P4_CAPABILITY_SCHEMA_REJECTED',
  })), (thrown) => thrown.code === 'P4_CAPABILITY_SCHEMA_REJECTED');
});

test('provider-local alias provenance is normalized before Product Identity evidence leaves Libra', async () => {
  const result = await observeProductIdentity({ observeRoutingProvider:async () => [{
    providerKey:'278', title:'Expected Movie', originalTitle:'Expected Movie', releaseYear:2000,
    aliases:[
      { value:'Expected Movie', sourceKind:'localized' },
      { value:'The Expected Movie', sourceKind:'alternative_title' },
    ],
  }] }, { ...evidenceIntent('manual_selection'), yearHint:2000,
    aliases:[{ value:'Expected Movie', sourceKind:'candidate', aliasDigest:canonicalDigest({ value:'Expected Movie', sourceKind:'candidate' })}],
  }, { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(result.result, 'resolved');
  assert.deepEqual(result.verifiedIdentity.aliases.map((item) => item.sourceKind), ['provider', 'provider']);
});

test('technical release suffix after a year is removed before TMDB identity search', async () => {
  let searchedTitle;
  const base = evidenceIntent('manual_selection');
  const alias = { value:'看不见的朋友 (2023) - 1080p H.264 CHDWEB', sourceKind:'candidate' };
  const intent = {
    ...base,
    sourceKind:'candidate',
    aliases:[{ ...alias, aliasDigest:canonicalDigest(alias) }],
    yearHint:2023,
  };
  const result = await observeProductIdentity({ observeRoutingProvider:async ({ intent:providerIntent }) => {
    searchedTitle = providerIntent.candidateDisplayTitle;
    return [{ providerKey:'1140983', title:'看不见的朋友', originalTitle:'Hello Ghost!', releaseYear:2023 }];
  } }, intent, { integrationId:'tmdb-main', configRevision:1 });
  assert.equal(searchedTitle, '看不见的朋友');
  assert.equal(result.result, 'resolved');
});


test('UAT-217 established Subject identity is freshly checked and rejects Provider drift', async()=>{
  for(const candidate of [
    {providerKey:'278',title:'Expected Movie',releaseYear:2000},
    {providerKey:'278',title:'Another Movie',releaseYear:2000},
    {providerKey:'278',title:'Expected Movie',releaseYear:2001},
    {providerKey:'999',title:'Expected Movie',releaseYear:2000},
  ]){
    let calls=0;
    const result=await observeProductIdentity({observeRoutingProvider:async()=>{calls++;return [candidate];}},
      evidenceIntent('subject_identity'),{integrationId:'tmdb-main',configRevision:1});
    assert.equal(calls,1);
    if(candidate.providerKey==='278'&&candidate.title==='Expected Movie'&&candidate.releaseYear===2000){
      assert.equal(result.result,'resolved');assert.equal(result.verifiedIdentity.providerKey,'278');
    }else{assert.notEqual(result.result,'resolved');assert.equal(result.verifiedIdentity,null);}
  }
});


test('UAT-272 premiere year resolves My Prince Edward while retaining the provider primary year', async () => {
  const intent={...evidenceIntent('nfo_claim'),sourceKind:'provider_search',yearHint:2019,aliases:[{value:'金都 (2019)',sourceKind:'candidate'}]};
  const raw={providerKey:'639445',title:'金都',originalTitle:'金都',releaseYear:2020,releaseYears:[2019,2020,2021]};
  const observe=async candidates=>observeProductIdentity({observeRoutingProvider:async()=>candidates},intent,{});
  const resolved=await observe([raw]);
  assert.equal(resolved.result,'resolved');assert.equal(resolved.verifiedIdentity.releaseYear,2020);
  observationValidator.validate(observationSchema.$id,resolved);
  const conflict=await observe([{...raw,releaseYears:[2020]}]);
  assert.equal(conflict.result,'conflicting');assert.equal(conflict.candidates[0].providerKey,'639445');assert.equal(conflict.verifiedIdentity,null);
  observationValidator.validate(observationSchema.$id,conflict);
  assert.equal((await observe([raw,{...raw,providerKey:'99'}])).result,'ambiguous');
  assert.equal((await observe([{...raw,title:'Another Movie',originalTitle:'Another Movie'}])).result,'not_found');
  const exact=await observeProductIdentity({observeRoutingProvider:async()=>[raw]}, {...intent,sourceKind:'provider_exact',providerKey:'639445'},{});
  assert.equal(exact.result,'resolved');
});

test('UAT-273 preview is bounded, exact and read-only before formal selection', () => {
  let calls=0;
  return fixture(async ({databasePath,service})=>{
    const db=new Database(databasePath,{readonly:true});
    const snapshot=()=>JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>[name,db.prepare('SELECT * FROM '+name).all()]));
    const before=snapshot();
    const result=await service.preview('run-1','639445');
    assert.equal(result.displayTitle,'金都');assert.equal(result.tmdbMovieId,'639445');
    assert.equal(db.prepare('SELECT count(*) count FROM libra_product_identity_selection_intents').get().count,0);
    assert.equal(db.prepare('SELECT count(*) count FROM fx_command_receipts').get().count,0);
    assert.equal(snapshot(),before);db.close();
    for(const id of ['0','-1','1.5','abc','https://x/123','9'.repeat(1000)])await assert.rejects(service.preview('run-1',id),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
    await assert.rejects(service.preview('missing','1'),{code:'LIBRA_RUN_NOT_FOUND'});
    assert.equal(calls,1);
    await assert.rejects(service.preview('run-1','99'),{code:'LIBRA_IDENTITY_PREVIEW_NOT_FOUND'});
  },{resolveRoutingIntegrationHandle:()=>({integrationId:'tmdb-main'}),observeRoutingProvider:async request=>{
    calls++;assert.equal(request.operationId,'libra.product_identity.evidence.observe@1');assert.equal(request.intent.yearHint,null);
    return request.intent.strongProviderAnchor.providerKey==='639445'?[{providerKey:'639445',title:'金都',originalTitle:'金都',releaseYear:2020,posterUrl:null}]:[];
  }});
});


test('UAT-273 Admin preview dispatch preserves authentication and does not invoke choose', async()=>{
  const {createCleanFacades}=require('../src/helix/composition/create-clean-facades');
  const {createAdminHttpAdapter}=require('../src/helix/composition/admin-http-adapter');
  let authenticated=0, previews=0, choices=0;
  const sessionTokens={authenticate(){authenticated++;return {actorId:'admin'};}};
  const facades=createCleanFacades({sessionTokens,readiness:{state:'ready'},productIdentitySelection:{
    async preview(run,query){previews++;assert.equal(run,'run-1');assert.deepEqual(query,{tmdbMovieId:'639445'});return {tmdbMovieId:query.tmdbMovieId,displayTitle:'金都'};},
    choose(){choices++;}
  }});
  const adapter=createAdminHttpAdapter({facades,sessionTokens});
  const response=await adapter.dispatch({method:'GET',path:'/v1/admin/formation/runs/run-1/product-identity-preview',query:{tmdbMovieId:'639445'},correlationId:'preview-test'});
  assert.equal(response.status,200);assert.equal(response.body.tmdbMovieId,'639445');
  assert.deepEqual([authenticated,previews,choices],[1,1,0]);
  await assert.rejects(adapter.dispatch({method:'GET',path:'/v1/admin/formation/runs/run-1/product-identity-preview',body:{tmdbMovieId:'1'}}),{code:'GET_SIDE_EFFECT_INPUT_REJECTED'});
  assert.equal(previews,1);
});

test('Series manual selection binds the frozen Season and rejects profile or scope changes', async () => {
  const season = {claimKind:'explicit_number',seasonNumber:2};
  const snapshot = {run:{libraRunId:'run-1',executionBasisDigest:hex('basis')},
    spec:{contentProfile:'series',structureKind:'season'},candidateIdentityClaim:{contentProfile:'series',claimKind:'series_season',seasonClaim:{...season,claimDigest:canonicalDigest(season)}}};
  let observed;
  await fixture(async ({databasePath,service}) => {
    const db = new Database(databasePath);
    db.prepare("UPDATE libra_subjects SET content_profile='series', structure_kind='season' WHERE subject_id='subject-1'").run();
    const request = {idempotencyKey:'series-choice',expectedRunStateRevision:1,expectedIdentityRevision:null,tmdbSeriesId:'1399'};
    for (const extra of [{seasonNumber:3},{episodeNumbers:[1,2]},{episodeScope:{}},{tmdbMovieId:'1399'}])
      assert.throws(()=>service.choose('run-1',{...request,...extra}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
    assert.throws(()=>service.choose('run-1',{...request,tmdbSeriesId:undefined}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
    const preview = await service.preview('run-1',{tmdbSeriesId:'1399'});
    assert.equal(preview.seasonNumber,2);assert.equal(preview.tmdbSeriesId,'1399');
    assert.equal(observed.intent.contentProfile,'series');assert.equal(observed.intent.seasonNumber,2);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,0);
    const receipt = service.choose('run-1',request);
    assert.equal(receipt.namespace,'tmdb_series');assert.equal(receipt.seasonNumber,2);
    assert.equal(service.choose('run-1',request).replayed,true);
    assert.equal(service.readCurrent('run-1').namespace,'tmdb_series');
    assert.throws(()=>service.choose('run-1',{...request,expectedRunStateRevision:2}),{code:'LIBRA_IDENTITY_SELECTION_STALE'});
    snapshot.run.executionBasisDigest=hex('changed');
    assert.throws(()=>service.choose('run-1',{...request,idempotencyKey:'changed'}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
    snapshot.run.executionBasisDigest=hex('basis');
    await assert.rejects(service.preview('run-1',{tmdbMovieId:'1399'}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
    assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,1);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,0);
    db.close();
  }, {movieProductionReader:{readRunSnapshot:()=>snapshot},resolveRoutingIntegrationHandle:()=>({integrationId:'tmdb-main'}),
    observeRoutingProvider:async request=>{observed=request;return [{namespace:'tmdb_series',providerKey:'1399',seasonNumber:2,title:'Example Series',releaseYear:2011}];}});
});
