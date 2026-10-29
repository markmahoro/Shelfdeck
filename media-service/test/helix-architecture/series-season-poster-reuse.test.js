'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),sharp=require('sharp');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {artifactRequirement}=require('../../src/helix/contracts/product-artifact-requirement');
const {POLICY,assertPosterSourceProof}=require('../../src/helix/contracts/series-season-poster-source');
const {buildSeriesPresentationSource,buildSeriesPresentationBasis}=require('../../src/helix/contracts/series-presentation-basis');
const {createCleanProductProductionPort}=require('../../src/clean-product-production-port');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');

async function fixture(provider){
  const tuple={provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',seasonNumber:2},
    identity={...tuple,identityAnchorDigest:canonicalDigest(tuple)},calls=[],writes=[];
  const source=buildSeriesPresentationSource({provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',
    seasonIdentityAnchorDigest:identity.identityAnchorDigest,integrationId:'tmdb',configRevision:1,language:'zh-CN',
    sourceRef:'tmdb:tv:1399',title:'Show',originalTitle:'Show',firstAirDate:'2008-01-20',plot:'Whole show',genres:['Drama']});
  const basis=buildSeriesPresentationBasis({seriesPresentationSource:source,contentProfile:'series',sourceKind:'provider',
    providerIdentitySet:{entries:[identity]},evidenceId:'metadata',payloadDigest:'a'.repeat(64)}),
    requirement=artifactRequirement('poster',null,POLICY),draft={providerIdentities:[identity],artifactRequirements:[requirement],seriesPresentationBasis:basis},
    image=await sharp({create:{width:60,height:90,channels:3,background:'#123456'}}).png().toBuffer();
  const port=createCleanProductProductionPort({mediaProbe:{probe(){}},workspaceProductPort:{materializeArtifact(){},
    async acquireArtifact(request){const value=await request.acquireBytes();if(value.resultKind==='not_available')return value;
      writes.push(value.bytes);return {resultKind:'acquired',materialized:{artifactHandle:{artifactKind:'poster',digestHex:digest(value.bytes),artifactHandleId:'poster'}}};}},
    async fetchProviderArtifact(input){calls.push(input);return provider(input,{image,identity});}}),
    handle=port.resolveIntegrationHandle({intent:{sourceKind:'provider',providerKind:'tmdb',integrationId:'tmdb',configRevision:1},
      operationId:'libra.product_artifact.acquire@1',artifactKind:'poster'});
  const request={libraRunId:'run',workspaceId:'workspace',relativePath:'product/poster.jpg',artifactKind:'poster',productMetadataDraft:draft,
    integrationId:'tmdb',configRevision:1,integrationHandle:handle,metadataObservationId:'metadata',metadataObservationDigest:'a'.repeat(64),
    runtimeEffectAuthority:{effectClass:'workspace_write',eventAttemptId:'attempt',idempotencyKey:'key'}};
  return {port,request,calls,writes,identity,basis,image};
}
const acquired=({image,identity})=>({resultKind:'acquired',artifactKind:'poster',bytes:image,mediaType:'image/jpeg',
  integrationId:'tmdb',configRevision:1,resolvedProviderIdentity:identity});

test('missing Season poster acquires the same show poster as normal production and records exact provenance',async()=>{
  const f=await fixture((input,value)=>input.artifactScope.scopeKind==='season'?{resultKind:'not_available',reasonCode:'poster_not_available'}:acquired(value));
  const result=await f.port.acquireProviderArtifact(f.request),proof=assertPosterSourceProof(result.seasonPosterSourceProof);
  assert.equal(result.resultKind,'acquired');assert.deepEqual(f.calls.map(call=>call.artifactScope),[{scopeKind:'season',seasonNumber:2},{scopeKind:'series'}]);
  assert.ok(f.calls.every(call=>call.integrationHandle===f.request.integrationHandle&&call.resolvedProviderIdentity===f.identity));
  assert.equal(proof.sourceKind,'series_provider');assert.equal(proof.seasonResult,'not_available');
  assert.equal(proof.sourceByteDigest,digest(f.image));assert.equal(proof.outputDigest,digest(f.writes[0]));
  assert.equal(proof.basisDigest,f.basis.basisDigest);assert.equal((await sharp(f.writes[0]).metadata()).format,'jpeg');
});

test('available Season poster stays the preferred exact source',async()=>{
  const f=await fixture((input,value)=>acquired(value)),result=await f.port.acquireProviderArtifact(f.request);
  assert.equal(f.calls.length,1);assert.equal(result.seasonPosterSourceProof.sourceKind,'season_provider');
  assert.equal(result.seasonPosterSourceProof.seasonResult,'acquired');
});

async function localSource(t,f){
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),
    {buildReferenceSet}=require('../../src/helix/contracts/series-local-source'),
    {qualifyReferences}=require('../../src/helix/integrations/series-local-source-io'),
    {readBoundedFileSnapshotSync}=require('../../src/helix/integrations/bounded-material-fingerprint'),
    {physicalIdentity}=require('../../src/helix/integrations/series-presentation-io'),
    root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-season-poster-')),show=path.join(root,'Show');
  fs.mkdirSync(show);t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('helix-season-poster-'));fs.rmSync(root,{recursive:true,force:true});});
  const nfo=Buffer.from('<tvshow><title>Show</title><uniqueid type="tmdb">1399</uniqueid></tvshow>'),
    references=[['nfo','tvshow.nfo',nfo],['poster','poster.png',f.image]].map(([artifactKind,name,bytes])=>{
      const location=path.join(show,name);fs.writeFileSync(location,bytes);
      return {artifactKind,endpointId:'field',location,entryDigest:canonicalDigest({artifactKind}),
        physicalIdentity:physicalIdentity(readBoundedFileSnapshotSync(location,1024*1024,{requireStableSnapshot:true}),'mount')};
    }),set=buildReferenceSet({fieldId:'field',accessRevision:1,fieldRoot:root,sourceRoot:show,
      observationDigest:'c'.repeat(64),references}),qualified=qualifyReferences(set,'1399'),
    {basisDigest,...prior}=f.basis,body={...prior,localSource:qualified};
  f.request.productMetadataDraft.seriesPresentationBasis={...body,basisDigest:canonicalDigest(body)};
  return {fs,references,nfo};
}

test('same-show qualified local poster is reused read-only before another Provider query',async t=>{
  const f=await fixture(()=>({resultKind:'not_available',reasonCode:'poster_not_available'})),local=await localSource(t,f),
    result=await f.port.acquireProviderArtifact(f.request);
  assert.equal(f.calls.length,1);assert.equal(result.seasonPosterSourceProof.sourceKind,'series_local');
  assert.equal(result.seasonPosterSourceProof.sourceByteDigest,digest(f.image));
  assert.deepEqual(local.fs.readFileSync(local.references[0].location),local.nfo);
  assert.deepEqual(local.fs.readFileSync(local.references[1].location),f.image);
});

test('a changed qualified show source cannot silently switch sources after absence was confirmed',async t=>{
  const f=await fixture(()=>({resultKind:'not_available',reasonCode:'poster_not_available'})),local=await localSource(t,f);
  local.fs.writeFileSync(local.references[0].location,'<tvshow><title>Foreign</title></tvshow>');
  await assert.rejects(f.port.acquireProviderArtifact(f.request),{code:'SERIES_LOCAL_SOURCE_CHANGED'});
  assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
});

test('only genuine image absence proceeds to the same show; transport and protocol errors remain failures',async()=>{
  for(const code of ['PLATFORM_INTEGRATION_HTTP_FAILED','PLATFORM_INTEGRATION_NETWORK_FAILED']){
    const f=await fixture(()=>{throw Object.assign(new Error('Provider unavailable'),{code});});
    await assert.rejects(f.port.acquireProviderArtifact(f.request),{code});assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
  }
  const invalid=await fixture(()=>({resultKind:'not_available',reasonCode:'wrong_scope'}));
  await assert.rejects(invalid.port.acquireProviderArtifact(invalid.request),{code:'SERIES_SEASON_POSTER_SOURCE_INVALID'});
  assert.equal(invalid.calls.length,1);assert.equal(invalid.writes.length,0);
});

test('missing Season and show posters remain unavailable rather than creating a fabricated Artifact',async()=>{
  const f=await fixture(()=>({resultKind:'not_available',reasonCode:'poster_not_available'})),result=await f.port.acquireProviderArtifact(f.request);
  assert.equal(result.resultKind,'not_available');assert.equal(result.artifactHandle,null);assert.equal(f.calls.length,2);assert.equal(f.writes.length,0);
  assert.equal(result.seasonPosterSourceProof,undefined);
});

test('same-show reuse rejects a foreign identity and a forged or changed source proof',async()=>{
  const f=await fixture((input,value)=>input.artifactScope.scopeKind==='season'?{resultKind:'not_available',reasonCode:'poster_not_available'}:
    {...acquired(value),resolvedProviderIdentity:{...value.identity,providerKey:'999'}});
  await assert.rejects(f.port.acquireProviderArtifact(f.request),{code:'CLEAN_PRODUCT_PROVIDER_IDENTITY_MISMATCH'});assert.equal(f.writes.length,0);
  const good=await fixture((input,value)=>acquired(value)),result=await good.port.acquireProviderArtifact(good.request);
  assert.throws(()=>assertPosterSourceProof({...result.seasonPosterSourceProof,sourceKind:'series_provider'}),{code:'SERIES_SEASON_POSTER_SOURCE_INVALID'});
  assert.throws(()=>artifactRequirement('fanart',null,POLICY));
});
