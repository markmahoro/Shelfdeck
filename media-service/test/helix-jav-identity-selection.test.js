'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createProductIdentitySelectionService } = require('../src/helix/domains/libra/application/product-identity-selection-service');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const generated = path.resolve(__dirname,'../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const hex = value => canonicalDigest({value});

async function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-identity-')),databasePath=path.join(root,'test.db');
  let clock=1000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>clock++});
  const database=new Database(databasePath),calls=[],revisions=new Map(),results=new Map();
  database.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)')
    .run('subject-1','single','jav','active',1,hex('continuity'),hex('scope'));
  database.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,execution_basis_schema_ref,execution_basis_record_json,execution_basis_digest,run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,recovery_policy_ref,recovery_policy_digest,recovery_attempt_ordinal,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('run-1','subject-1',1,'LibraRunExecutionBasis@1','{}',hex('basis'),hex('scope'),'active',1,hex('state'),'normal',hex('priority'),'LibraRunRecoveryPolicy@1',hex('recovery'),0,1000);
  const options={schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel}),now:()=>clock,
    resolveJavSourceHandle({siteRef,operationId}) {
      if(revisions.get(siteRef)===null)return null;
      return {integrationType:'jav_source',integrationId:'jav-'+siteRef+'-main',configRevision:revisions.get(siteRef)||1,
        siteRef,authMode:'anonymous',allowedOperation:operationId,endpointProfileDigest:hex(siteRef),networkRouteDigest:hex('direct')};
    },
    async observeJavSource(request) {
      calls.push(request);const result=results.get(request.siteRef);
      if(typeof result==='function')return result(request);
      if(result instanceof Error)throw result;
      return observation(request,result || 'qualified');
    }};
  const makeService=()=>createProductIdentitySelectionService(options);
  options.observeJavSourceForPreview=async request=>{
    const value=await options.observeJavSource(request);
    return {observation:value,...(value.result==='qualified'?{sourceCoverDigest:value.cover.byteDigest,
      posterUrl:'data:image/jpeg;base64,/9j/2Q=='}:{})};
  };
  try { await run({database,calls,revisions,results,service:makeService(),makeService,setClock:value=>{clock=value;}}); }
  finally {
    database.close();kernel.close();
    assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-jav-identity-'));
    fs.rmSync(root,{recursive:true,force:true});
  }
}
function observation(request,result='qualified',extra={}) {
  const source=request.integrationHandle,code=request.input.queryAnchor.javCode;
  const identity={provider:'jav',namespace:'jav_code',providerKey:code,seasonNumber:null};
  const body={schema:'integration.jav-source-observation@1',siteRef:request.siteRef,endpointProfileDigest:source.endpointProfileDigest,
    networkRouteDigest:source.networkRouteDigest,queryAnchorDigest:request.input.queryAnchor.anchorDigest,result,pages:[],
    ...(result==='qualified'?{resourceKey:request.input.resourceKey||'native-key',resourceUrl:'https://javdb.com/v/native-key',
      resolvedProviderIdentity:{...identity,identityAnchorDigest:canonicalDigest(identity)},descriptiveEntries:[{key:'title',value:'Sample title'}],peopleHints:[],
      cover:{locator:'https://c0.jdbstatic.com/sample.jpg',byteDigest:hex('image'),byteCount:1000,format:'jpeg',width:800,height:538}}:{}),...extra};
  return {...body,observationDigest:canonicalDigest(body)};
}
function confirmation(preview,key='confirm-1') {
  return {javCode:preview.javCode,previewId:preview.previewId,candidateSetDigest:preview.candidateSetDigest,
    expectedRunStateRevision:preview.expectedRunStateRevision,expectedIdentityRevision:0,
    expectedSelectionIntentRevision:preview.expectedSelectionIntentRevision,idempotencyKey:key};
}

test('JAV preview is read-only, single-site qualified and confirmation freezes exact server evidence',()=>fixture(async ctx=>{
  const preview=await ctx.service.preview('run-1',{javCode:'ipx00177'});
  assert.equal(preview.javCode,'IPX-00177');assert.equal(preview.result,'qualified');assert.equal(ctx.calls.length,1);
  assert.match(preview.posterUrl,/^data:image\/jpeg;base64,/);
  assert.equal(ctx.database.prepare('SELECT count(*) n FROM libra_product_identity_selection_intents').get().n,0);
  const receipt=ctx.service.choose('run-1',confirmation(preview),{actorId:'configured-admin'});
  assert.equal(receipt.provider,'jav');assert.equal(ctx.calls.length,1);
  const row=ctx.service.readCurrent('run-1'),record=JSON.parse(row.selection_record_json);
  assert.equal(record.actorRef,'configured-admin');assert.equal(record.qualificationObservation.cover.byteDigest,hex('image'));
  assert.equal(record.expectedSelectionIntentRevision,0);assert.equal(record.expectedIdentityRevision,0);
  assert.equal(receipt.selectionRecordDigest,canonicalDigest(record));
  assert.equal(ctx.database.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,0);
}));

test('JAV fallback discards incomplete-site fields and stops after one fully qualified source',()=>fixture(async ctx=>{
  ctx.results.set('javdb','cover_missing');
  const preview=await ctx.service.preview('run-1',{javCode:'IPX-177'});
  assert.deepEqual(ctx.calls.map(call=>call.siteRef),['javdb','javmenu']);assert.equal(preview.siteRef,'javmenu');
  assert.deepEqual(preview.attempts.map(attempt=>attempt.result),['cover_missing','qualified']);
  assert.equal(preview.displayTitle,'Sample title');
  ctx.service.choose('run-1',confirmation(preview));
  const record=JSON.parse(ctx.service.readCurrent('run-1').selection_record_json);
  assert.equal(record.selectedSourceOrdinal,1);assert.equal(record.qualificationObservation.siteRef,'javmenu');
}));

test('JAV chooses explicit per-code-class routes and skips unconfigured sources',()=>fixture(async ctx=>{
  for(const [code,site] of [['FC2-718323','fc2_official'],['HEYDOUGA-4030-2113','heydouga_official'],
    ['259LUXU-1022','avwiki'],['GETCHU-4052694','dl_getchu'],['GYUTTO-242158','gyutto'],['T38-071','javdb'],['N1230','javmenu']]) {
    ctx.calls.length=0;const preview=await ctx.service.preview('run-1',{javCode:code});assert.equal(preview.siteRef,site);assert.equal(ctx.calls.length,1);
  }
  ctx.revisions.set('javdb',null);ctx.calls.length=0;
  assert.equal((await ctx.service.preview('run-1',{javCode:'IPX-177'})).siteRef,'javmenu');
}));

test('JAV temporary source failures retry the same site within a bounded budget before fallback',()=>fixture(async ctx=>{
  ctx.results.set('javdb',Object.assign(new Error('temporary'),{code:'JAV_SOURCE_UNAVAILABLE'}));
  const preview=await ctx.service.preview('run-1',{javCode:'IPX-177'});
  assert.deepEqual(ctx.calls.map(call=>call.siteRef),['javdb','javdb','javmenu']);
  assert.deepEqual(preview.attempts.map(attempt=>attempt.result),['unavailable','unavailable','qualified']);
  assert.ok(ctx.calls.every(call=>call.timeoutMs<=30000));
  ctx.calls.length=0;ctx.results.set('javdb',Object.assign(new Error('denied'),{code:'JAV_SOURCE_ACCESS_DENIED'}));
  assert.equal((await ctx.service.preview('run-1',{javCode:'IPX-177'})).siteRef,'javmenu');
  assert.deepEqual(ctx.calls.map(call=>call.siteRef),['javdb','javmenu']);
}));

test('same-code resource ambiguity stays unresolved until an exact resource is observed',()=>fixture(async ctx=>{
  ctx.results.set('javdb',request=>observation(request,request.input.resourceKey?'qualified':'ambiguous',
    request.input.resourceKey?{}:{candidates:[{siteRef:'javdb',resourceKey:'one',javCode:'IPX-177'},{siteRef:'javdb',resourceKey:'two',javCode:'IPX-177'}]}));
  const ambiguous=await ctx.service.preview('run-1',{javCode:'IPX-177'});
  assert.equal(ambiguous.result,'ambiguous');assert.equal(ctx.calls.length,1);assert.equal(ambiguous.previewId,undefined);
  const exact=await ctx.service.preview('run-1',{javCode:'IPX-177',siteRef:'javdb',resourceKey:'two'});
  ctx.service.choose('run-1',confirmation(exact));assert.equal(JSON.parse(ctx.service.readCurrent('run-1').selection_record_json).resourceKey,'two');
}));

test('a newer JAV selection fences older previews, while an unconfirmed number can still change',()=>fixture(async ctx=>{
  const old=await ctx.service.preview('run-1',{javCode:'IPX-177'}),newer=await ctx.service.preview('run-1',{javCode:'IPX-178'});
  ctx.service.choose('run-1',confirmation(newer));
  assert.throws(()=>ctx.service.choose('run-1',confirmation(old,'older')),{code:'LIBRA_IDENTITY_SELECTION_HEAD_STALE'});
  const latest=await ctx.service.preview('run-1',{javCode:'IPX-179'});
  assert.equal(ctx.service.choose('run-1',confirmation(latest,'latest')).intentRevision,2);
  assert.equal(ctx.service.readCurrent('run-1').provider_key,'IPX-179');
}));

test('late JAV responses cannot produce a preview after a concurrent choice changes the head',()=>fixture(async ctx=>{
  const first=await ctx.service.preview('run-1',{javCode:'IPX-177'});
  let release;ctx.results.set('javdb',async request=>{await new Promise(resolve=>{release=resolve;});return observation(request);});
  const pending=ctx.service.preview('run-1',{javCode:'IPX-178'});
  ctx.service.choose('run-1',confirmation(first));release();
  await assert.rejects(pending,{code:'LIBRA_IDENTITY_SELECTION_HEAD_STALE'});
}));

test('JAV confirmation rejects tampering, expired proof, source edits and a changed Run',()=>fixture(async ctx=>{
  const preview=await ctx.service.preview('run-1',{javCode:'IPX-177'}),body=confirmation(preview);
  assert.throws(()=>ctx.service.choose('run-1',{...body,javCode:'IPX-178'}),{code:'LIBRA_JAV_PREVIEW_MISMATCH'});
  assert.throws(()=>ctx.service.choose('run-1',{...body,title:'forged'}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
  ctx.revisions.set('javdb',2);assert.throws(()=>ctx.service.choose('run-1',body),{code:'LIBRA_JAV_SOURCE_CONFIG_STALE'});
  ctx.revisions.set('javdb',1);ctx.database.prepare('UPDATE libra_runs SET state_revision=2').run();
  assert.throws(()=>ctx.service.choose('run-1',body),{code:'LIBRA_IDENTITY_SELECTION_STALE'});
  ctx.setClock(700000);assert.throws(()=>ctx.service.choose('run-1',body),{code:'LIBRA_JAV_PREVIEW_EXPIRED'});
}));

test('JAV replay survives restart and confirmation lock without needing the old preview',()=>fixture(async ctx=>{
  const preview=await ctx.service.preview('run-1',{javCode:'IPX-177'}),body=confirmation(preview);
  const first=ctx.service.choose('run-1',body);
  ctx.database.prepare('INSERT INTO libra_product_identity_revisions(subject_id,revision,identity_kind,identity_digest) VALUES(?,?,?,?)')
    .run('subject-1',1,'jav_code',hex('identity'));
  ctx.setClock(700000);const restarted=ctx.makeService();
  assert.equal(restarted.choose('run-1',body).selectionIntentId,first.selectionIntentId);
  assert.throws(()=>restarted.choose('run-1',{...body,javCode:'IPX-178'}),{code:'LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT'});
  await assert.rejects(restarted.preview('run-1',{javCode:'IPX-178'}),{code:'LIBRA_JAV_IDENTITY_LOCKED'});
  assert.throws(()=>ctx.service.choose('run-1',{...body,idempotencyKey:'swap'}),{code:'LIBRA_JAV_IDENTITY_LOCKED'});
}));

test('JAV durable selection validates both its index and exact source proof before Work can read it',()=>fixture(async ctx=>{
  const preview=await ctx.service.preview('run-1',{javCode:'IPX-177'});ctx.service.choose('run-1',confirmation(preview));
  const record=JSON.parse(ctx.service.readCurrent('run-1').selection_record_json);
  record.qualificationObservation.cover.byteDigest=hex('substituted');
  ctx.database.prepare('UPDATE libra_product_identity_selection_intents SET selection_record_json=?').run(JSON.stringify(record));
  assert.throws(()=>ctx.service.readCurrent('run-1'),{code:'LIBRA_JAV_SELECTION_RECORD_INVALID'});
}));

test('JAV invalid provider fences cannot become business fallback and invalid numbers never reach a source',()=>fixture(async ctx=>{
  ctx.results.set('javdb',request=>observation(request,'qualified',{resolvedProviderIdentity:{provider:'jav',namespace:'jav_code',providerKey:'IPX-999'}}));
  await assert.rejects(ctx.service.preview('run-1',{javCode:'IPX-177'}),{code:'LIBRA_JAV_SOURCE_OBSERVATION_INVALID'});assert.equal(ctx.calls.length,1);
  ctx.calls.length=0;
  for(const javCode of ['HEYDOUGA-4030','T38-01','CID:hjmo00214','IPX-177 and IPX-178'])
    await assert.rejects(ctx.service.preview('run-1',{javCode}),{code:'LIBRA_IDENTITY_SELECTION_INPUT'});
  assert.equal(ctx.calls.length,0);
}));
