'use strict';

const assert=require('node:assert/strict'),test=require('node:test');
const {renderAftercareMovieNfo,compareMovieNfoPresentation}=require('../../src/helix/domains/arca/model/aftercare-nfo');
const {verifyJavCorrectionNfo}=require('../../src/helix/domains/arca/model/jav-correction-metadata');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {missingArtifactCustodyRefreshScope}=require('../../src/helix/domains/arca/model/care-objective');
function input(existingBytes=null) {
  return {existingBytes,metadata:{descriptiveFacts:{entries:[{key:'title',value:'Accepted single-site title'}]}},
    cast:{relations:[{role:'actor',displayName:'Accepted source actor',providerIdentities:[]}]},
    identity:{provider:'jav',providerKey:'IPX-177'}};
}
test('JAV Aftercare recreates a missing or damaged NFO from accepted facts with its unchanged canonical code',()=>{
  for(const existing of [null,Buffer.from('<movie><title>broken')]) {
    const result=renderAftercareMovieNfo(input(existing));
    assert.deepEqual(verifyJavCorrectionNfo(result.bytes,{javCode:'IPX-177',title:'Accepted single-site title'}),
      {javCode:'IPX-177',title:'Accepted single-site title'});
    assert.ok(result.bytes.toString('utf8').includes('Accepted source actor'));
    assert.equal(/<studio>|<releasedate>|<year>/.test(result.bytes.toString('utf8')),false);
    assert.deepEqual(compareMovieNfoPresentation({...input(),existingBytes:result.bytes}),{matches:true,reasonCode:null});
  }
});
test('JAV Aftercare rebuilds an artifact with foreign or conflicting identity without changing the accepted identity',()=>{
  for(const identity of ['<uniqueid type="jav">IPX-178</uniqueid>',
    '<uniqueid type="tmdb">123</uniqueid>',
    '<uniqueid type="jav">IPX-177</uniqueid><uniqueid type="jav">IPX-178</uniqueid>']) {
    const original=Buffer.from('<movie><title>Accepted single-site title</title>'+identity+'</movie>');
    assert.equal(compareMovieNfoPresentation(input(original)).matches,false);
    const result=renderAftercareMovieNfo(input(original));
    assert.equal(result.disposition,'rebuild');
    verifyJavCorrectionNfo(result.bytes,{javCode:'IPX-177',title:'Accepted single-site title'});
    assert.equal(original.toString('utf8').includes(identity),true);
  }
});
test('JAV Aftercare never guesses a canonical number from a CID or normalizes an invalid stored identity',()=>{
  for(const providerKey of ['ipx00177','IPX177','CID=ipx00177','HEYDOUGA-4030','IPX-177 IPX-178']) {
    assert.throws(()=>renderAftercareMovieNfo({...input(),identity:{provider:'jav',providerKey}}),
      {code:'ARCA_AFTERCARE_NFO_IDENTITY_INVALID'});
  }
  const existing=Buffer.from('<movie><title>Accepted single-site title</title><uniqueid type="jav" default="true">IPX-177</uniqueid><actor><name>Accepted source actor</name></actor></movie>');
  const result=renderAftercareMovieNfo(input(existing));
  assert.equal(result.disposition,'update');
  verifyJavCorrectionNfo(result.bytes,{javCode:'IPX-177',title:'Accepted single-site title'});
});
test('a declared missing NFO requires its own Custody proof before Case admission; an unrelated missing artifact cannot authorize it',()=>{
  const context={raw:{entry:{structure_kind:'single'},materials:[{role:'metadata_sidecar',material_key:'nfo-key',location:'fixture.nfo'}]}},
    health={dimensions:{presentation:{findings:[{findingKind:'presentation:nfo_missing'}]},custody:{findings:[]}}},
    missing=key=>({findingKind:'custody:artifact_missing',findingDigest:canonicalDigest({kind:'custody',code:'artifact_missing',
      severity:'critical',repairability:'auto_repair',basis:key})});
  assert.deepEqual(missingArtifactCustodyRefreshScope(context,health),['nfo-key']);
  health.dimensions.custody.findings=[missing('poster-key')];
  assert.deepEqual(missingArtifactCustodyRefreshScope(context,health),['nfo-key']);
  health.dimensions.custody.findings=[missing('nfo-key')];
  assert.deepEqual(missingArtifactCustodyRefreshScope(context,health),[]);
  health.dimensions.custody.findings=[];
  assert.deepEqual(missingArtifactCustodyRefreshScope({raw:{entry:{structure_kind:'single'},materials:[]}},health),[]);
  assert.deepEqual(missingArtifactCustodyRefreshScope({raw:{...context.raw,entry:{structure_kind:'season'}}},health),[]);
});
