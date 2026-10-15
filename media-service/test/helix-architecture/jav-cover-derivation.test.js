'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),crypto=require('node:crypto'),sharp=require('sharp');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavQueryAnchor}=require('../../src/helix/contracts/jav-source-contracts');
const {assertJavCoverDerivation,javCoverDerivationSchema}=require('../../src/helix/contracts/jav-cover-derivation');
const {deriveJavCoverBytes,renderJavPreviewCover}=require('../../src/helix/integrations/jav-cover-renderer');
const Ajv=require('ajv/dist/2020'),validate=new Ajv({strict:false}).compile(javCoverDerivationSchema());
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(width=120,height=80) {
  const bytes=await sharp({create:{width,height,channels:3,background:'#367892'}}).jpeg().toBuffer(),body={schema:'libra.jav-selected-source@1',siteRef:'javdb',
    integrationId:'jav-javdb-main',configRevision:1,authMode:'anonymous',endpointProfileDigest:canonicalDigest('endpoint'),networkRouteDigest:canonicalDigest('route'),
    queryAnchor:buildJavQueryAnchor('jav_code','IPX-177'),resourceKey:'Fixture01',title:'Fixture title',coverDigest:sha(bytes),qualificationDigest:canonicalDigest('qualification')};
  return {bytes,selectedSource:{...body,bindingDigest:canonicalDigest(body)},sourceObservationDigest:canonicalDigest('observation')};
}
test('JAV preview returns a bounded decodable data image from the exact qualified cover without a browser source request',async()=>{
  const source=await fixture(1200,800),result=await renderJavPreviewCover(source.bytes,sha(source.bytes));
  assert.equal(result.sourceCoverDigest,sha(source.bytes));assert.match(result.posterUrl,/^data:image\/jpeg;base64,/);
  const bytes=Buffer.from(result.posterUrl.split(',')[1],'base64'),metadata=await sharp(bytes).metadata();
  assert.ok(bytes.length<=32768);assert.equal(metadata.format,'jpeg');assert.ok(metadata.width<=360&&metadata.height<=240);
  await assert.rejects(()=>renderJavPreviewCover(source.bytes,canonicalDigest('wrong-cover')),{code:'JAV_COVER_DERIVATION_INVALID'});
});
test('explicit JAV renderer produces one-site poster and fanart with durable exact crop and byte evidence',async()=>{
  const source=await fixture();
  for(const artifactKind of ['poster','fanart']) {
    const result=await deriveJavCoverBytes({...source,artifactKind}),metadata=await sharp(result.bytes).metadata();
    assert.equal(validate(result.derivation),true,JSON.stringify(validate.errors));
    assert.equal(result.derivation.sourceByteDigest,sha(source.bytes));assert.equal(result.derivation.outputDigest,sha(result.bytes));
    assert.deepEqual(result.derivation.crop,artifactKind==='poster'?{left:64,top:0,width:56,height:80}:null);
    assert.equal(metadata.width,artifactKind==='poster'?56:120);assert.equal(metadata.height,80);
    const replay=await deriveJavCoverBytes({...source,artifactKind});assert.deepEqual(replay,result);
  }
});
test('JAV derivation refuses changed source bytes, crop drift, foreign binding and unbounded images',async()=>{
  const source=await fixture(),result=await deriveJavCoverBytes({...source,artifactKind:'poster'});
  await assert.rejects(deriveJavCoverBytes({...source,bytes:Buffer.from('changed'),artifactKind:'poster'}),{code:'JAV_COVER_DERIVATION_INVALID'});
  for(const patch of [{crop:{left:0,top:0,width:56,height:80}},{sourceByteDigest:canonicalDigest('other')},{normalizedWidth:1000000}]) {
    const changed={...result.derivation,...patch};changed.derivationDigest=canonicalDigest(Object.fromEntries(Object.entries(changed).filter(([key])=>key!=='derivationDigest')));
    assert.throws(()=>assertJavCoverDerivation(changed),{code:'JAV_COVER_DERIVATION_INVALID'});
  }
});
