'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {failureDiagnostics} = require('../src/helix/contracts/failure-diagnostics');
const {createFailureEvidenceStore} = require('../src/helix/integrations/failure-evidence-store');
const {settlementPreconditionFailureOutcome} = require('../src/helix/domains/arca/capabilities/on-deck-capability-ports');
test('unknown materials remain distinguishable and bounded without copying arbitrary error details',()=>{
  const make=name=>settlementPreconditionFailureOutcome({code:'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',message:'Unknown member',
    details:{sourceDirectory:'/media/movie',unknownNames:[name],apiKey:'SECRET'}});
  assert.notDeepEqual(make('extra.torrent').evidence,make('another.mkv').evidence);
  assert.equal(JSON.stringify(make('extra.torrent')).includes('SECRET'),false);
  const bounded=failureDiagnostics({details:{unknownNames:Array(100).fill('x'.repeat(1000))}});
  assert.equal(bounded.unknownNames.length,16);
  assert.equal(bounded.unknownMemberCount,100);
  assert.equal(bounded.truncated,true);
});
test('network diagnostics retain safe cause codes but never transport messages or URLs',()=>{
  const diagnostics=failureDiagnostics({message:'https://secret@proxy/?token=SECRET',cause:{code:'ENOTFOUND'}});
  assert.deepEqual(diagnostics,{networkCode:'ENOTFOUND'});
  assert.deepEqual(failureDiagnostics({cause:{code:'SECRET'}}),{});
});
test('failure evidence survives reopening and rejects corruption and path traversal',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-diagnostics-'));
  try {
    const store=createFailureEvidenceStore(root),value={errorCode:'X',diagnostics:{networkCode:'ECONNRESET'}};
    const digest=store.write(value);
    assert.equal(store.write(value),digest);
    assert.deepEqual(createFailureEvidenceStore(root).read(digest),value);
    assert.throws(()=>store.read('../escape'),/digest/);
    fs.writeFileSync(path.join(root,digest+'.json'),'{}');
    assert.throws(()=>store.read(digest),/mismatch/);
    assert.throws(()=>store.write({text:'x'.repeat(17000)}),/bounded/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('playback timeout diagnostics retain bounded timing and sample facts without process arguments',()=>{
  const result=failureDiagnostics({code:'LIBRA_MEDIA_FFMPEG_TIMEOUT',details:{
    reasonCode:'process_timeout',stage:'playback_decode',samplePointPercent:50,
    elapsedMs:30021,timeoutMs:30000,stallTimeoutMs:600000,stderrBytes:42,
    stderr:'SECRET',argv:['https://secret@host'],source:'/private/movie.mp4'}});
  assert.deepEqual(result,{reasonCode:'process_timeout',stage:'playback_decode',elapsedMs:30021,
    timeoutMs:30000,stallTimeoutMs:600000,stderrBytes:42,samplePointPercent:50});
  assert.deepEqual(failureDiagnostics({code:'LIBRA_MEDIA_FFMPEG_TIMEOUT',details:{
    elapsedMs:Infinity,timeoutMs:-1,stderrBytes:'SECRET',samplePointPercent:101}}),{});
});

test('TMDB adapter reports sanitized transport cause at its actual request boundary', async()=>{
  const {createTmdbProviderAdapter}=require('../src/helix/integrations/tmdb-provider-adapter');
  const adapter=createTmdbProviderAdapter({integrationQueryPort:{query(){}},integrationHandleResolverPort:{resolve(){}},
    secretLeaseResolverPort:{resolve(){}},secretLeaseConsumer:{consumeAsync(){}},
    fetchImpl:async()=>{throw Object.assign(new Error('https://proxy/?token=SECRET'),{cause:{code:'ENOTFOUND'}});}});
  await assert.rejects(()=>adapter.testCandidate({endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_api_key',
    secretBytes:Buffer.from('SECRET'),timeoutMs:1000,settings:{}}),error=>{
      assert.equal(error.code,'PLATFORM_INTEGRATION_NETWORK_FAILED');
      assert.deepEqual(error.details,{stage:'json_request',networkCode:'ENOTFOUND'});
      assert.equal(JSON.stringify(error).includes('SECRET'),false);return true;});
});
