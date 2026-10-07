'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {canonicalContentIdentity}=require('../../src/helix/domains/arca/model/canonical-content-identity');
const {aftercareProviderIdentity}=require('../../src/helix/domains/arca/model/aftercare-provider-identity');
const {createAftercareCapabilityPorts}=require('../../src/helix/domains/arca/capabilities/aftercare-capability-ports');
const {CAPABILITY_REFS:C}=require('../../src/helix/domains/arca/model/aftercare-contract');
const {createTmdbProviderAdapter}=require('../../src/helix/integrations/tmdb-provider-adapter');
function fixture() {
  const identity={structureKind:'season',contentProfile:'series',identityKind:'tmdb_series_season',identityDigest:canonicalDigest('first-batch'),
    providerIdentities:[{provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:2}]};
  const stable={providerId:'tmdb',providerObjectId:'1399',identityDigest:identity.identityDigest};
  const context={shelfEntryId:'entry',basis:{digest:canonicalDigest('basis')},raw:{entry:{structure_kind:'season',shelf_id:'shelf',
    canonical_identity_key:canonicalContentIdentity('shelf',identity).canonicalIdentityKey},identity:{identity_kind:'tmdb_series_season',
    provider:'tmdb',provider_key:'1399',identity_digest:identity.identityDigest},shelf:{status:'active'},reservations:[],
    facts:[{fact_kind:'resolved_identity',value:identity},{fact_kind:'resolved_identity',value:{resolvedProductIdentity:{...structuredClone(identity),identityDigest:canonicalDigest('second-batch')}}}]}};
  return {context,stable};
}
test('Series Aftercare reconstructs one Season anchor from all accepted batches',()=>{
  const f=fixture(),anchor={provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:2};
  const result=aftercareProviderIdentity(f.context,f.stable);
  assert.deepEqual(result,{...anchor,identityAnchorDigest:canonicalDigest(anchor)});
  f.context.raw.facts.reverse();assert.deepEqual(aftercareProviderIdentity(f.context,f.stable),result);
});
test('Movie Aftercare retains its namespace and original identity digest',()=>{
  const f=fixture();f.context.raw.entry.structure_kind='single';f.context.raw.identity.identity_kind='tmdb_movie';
  f.context.raw.facts=[];
  assert.deepEqual(aftercareProviderIdentity(f.context,f.stable),{provider:'tmdb',providerKey:'1399',namespace:'tmdb_movie',
    seasonNumber:null,identityAnchorDigest:f.stable.identityDigest});
});
const mutations={
  missing:f=>{f.context.raw.facts=[];},
  wrong_season:f=>{f.context.raw.facts[0].value.providerIdentities[0].seasonNumber=3;},
  wrong_series:f=>{f.context.raw.facts[0].value.providerIdentities[0].providerKey='550';},
  movie_fact:f=>{f.context.raw.facts[0].value.structureKind='single';},
  missing_anchor:f=>{f.context.raw.facts[0].value.providerIdentities=[];},
  duplicate_anchor:f=>{f.context.raw.facts[0].value.providerIdentities.push({...f.context.raw.facts[0].value.providerIdentities[0]});},
  stale_key:f=>{f.stable.providerObjectId='550';},
  stale_digest:f=>{f.stable.identityDigest=canonicalDigest('stale');},
  wrong_kind:f=>{f.context.raw.identity.identity_kind='tmdb_movie';},
};
for(const [name,mutate] of Object.entries(mutations))test('Series Aftercare refuses '+name,()=>{
  const f=fixture();mutate(f);assert.throws(()=>aftercareProviderIdentity(f.context,f.stable),{code:'ARCA_AFTERCARE_PROVIDER_INPUT_STALE'});
});

for(const scenario of ['series','movie','wrong_season','wrong_response'])test('Artifact Capability preserves exact Provider scope: '+scenario,async t=>{
  const f=fixture(),root=fs.mkdtempSync(path.join(os.tmpdir(),'series-care-provider-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  if(scenario==='movie'){f.context.raw.entry.structure_kind='single';f.context.raw.identity.identity_kind='tmdb_movie';}
  if(scenario==='wrong_season')mutations.wrong_season(f);
  const care={aftercareCaseId:'case',state:'active',careBasisDigest:f.context.basis.digest},calls=[];
  const ports=createAftercareCapabilityPorts({
    schemaManifest:require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),
    unitOfWork:{execute(){throw new Error('No database write is expected.');}},aftercareWorkspaceRoot:root,
    computeBoundedMaterialFingerprintSync(){throw new Error('No formal media read is expected.');},
    contextReader:{read:()=>f.context,store:{history:()=>({cases:[care],findings:[],commits:[]})}},
    async fetchAftercareArtifact(request){calls.push(request);return scenario==='wrong_response'
      ?{resultKind:'acquired',artifactKind:'poster',integrationId:'tmdb-main',configRevision:1,
        resolvedProviderIdentity:{...request.resolvedProviderIdentity,namespace:'tmdb_movie'},bytes:Buffer.from('wrong')}
      :{resultKind:'not_available',reasonCode:'poster_not_available'};}});
  const execution={ownerScope:{processId:'entry'},eventId:'event',eventAttemptId:'attempt',idempotencyKey:'key',
    namedInputs:{stableProviderIdentity:f.stable,integrationHandle:{allowedOperation:C.binaryAcquire,integrationId:'tmdb-main',configRevision:1}}};
  const result=await ports[C.binaryAcquire].execute(execution);
  if(['wrong_season','wrong_response'].includes(scenario)) {
    assert.equal(result.kind,'failed');assert.equal(result.evidence.writeStarted,false);
    assert.equal(result.evidence.errorCode,scenario==='wrong_season'?'ARCA_AFTERCARE_PROVIDER_INPUT_STALE':'ARCA_AFTERCARE_PROVIDER_RESPONSE_STALE');
    assert.equal(calls.length,scenario==='wrong_season'?0:1);
  }else {
    assert.equal(result.kind,'succeeded');assert.equal(result.result.resultKind,'not_available');
    assert.equal(calls[0].resolvedProviderIdentity.namespace,scenario==='series'?'tmdb_series':'tmdb_movie');
    assert.equal(calls[0].resolvedProviderIdentity.seasonNumber,scenario==='series'?2:null);
  }
  assert.deepEqual(fs.readdirSync(root),[]);
});

for(const kind of ['series','movie'])test('TMDB Adapter requests the '+kind+' image endpoint for the Arca identity',async()=>{
  const f=fixture(),calls=[],handle={integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,
    allowedOperation:C.binaryAcquire,fenceDigest:'f'.repeat(64)};
  if(kind==='movie'){f.context.raw.entry.structure_kind='single';f.context.raw.identity.identity_kind='tmdb_movie';}
  const adapter=createTmdbProviderAdapter({
    integrationQueryPort:{query:()=>({state:'active',integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,
      endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:()=>handle},secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},
    secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-secret'))},
    fetchImpl:async url=>{calls.push(new URL(url).pathname);return new Response(JSON.stringify({id:1399,posters:[],backdrops:[]}));}});
  const result=await adapter.artifactPort.execute({operationId:C.binaryAcquire,integrationHandle:handle,timeoutMs:1000,
    input:{artifactKind:'poster',resolvedProviderIdentity:aftercareProviderIdentity(f.context,f.stable)}});
  assert.equal(result.resultKind,'not_available');
  assert.deepEqual(calls,[kind==='series'?'/3/tv/1399/images':'/3/movie/1399/images']);
});
