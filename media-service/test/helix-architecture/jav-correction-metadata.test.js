'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {buildJavCorrectionMetadata,renderJavCorrectionNfo,verifyJavCorrectionNfo}=require('../../src/helix/domains/arca/model/jav-correction-metadata');
const fixture=require('./fixtures/jav-correction');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const schema=buildArcaApplicationSchemas().ArcaJavCorrectionMetadataFact,
  validator=createCapabilityContractValidator({schemas:[schema]});
function values() {
  const c=fixture.context(),controlProjections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',
    ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),
    basis=buildJavCorrectionBasis({raw:c.raw,controlProjections}),source=fixture.source();
  source.observation.descriptiveEntries=[{key:'title',value:'Correct <film> & title'},{key:'studio',value:'Circle & seller'},
    {key:'studio_credit_role',value:'circle'},{key:'genre',value:'A;A;B'},{key:'plot',value:'A <script> & plot'}];
  source.observation.peopleHints=[{displayName:'New & Actor',role:'actor',providerIdentities:[]}];
  source.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source.observation).filter(([key])=>key!=='observationDigest')));
  return {basis,proposal:buildJavCorrectionProposal({basis,...source}),correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),admissionDigest:fixture.digest('admission')};
}
test('Arca correction forms its own metadata Fact with complete new source and role; it never fabricates a Libra Run or mixes old actors',()=>{
  const input=values(),fact=buildJavCorrectionMetadata(input);
  validator.validate(fact.schemaRef,fact);
  assert.equal(fact.schemaRef,'helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1');assert.equal(fact.javCode,'IPX-178');
  assert.equal(fact.libraRunId,undefined);assert.equal(fact.subjectId,undefined);assert.equal(fact.peopleHints[0].displayName,'New & Actor');
  assert.equal(fact.descriptiveFacts.entries.find(row=>row.key==='studio_credit_role').value,'circle');
  assert.equal(fact.sourceQualification.observation.siteRef,'javdb');assert.equal(fact.sourceQualification.observation.observationDigest,input.proposal.sourceQualification.observation.observationDigest);
  assert.equal(fact.factDigest,canonicalDigest(Object.fromEntries(Object.entries(fact).filter(([key])=>key!=='factDigest'))));
});
test('new correction NFO uses the new exact JAV identity, escapes source text and does not inherit old NFO fields or actors',()=>{
  const input=values(),rendered=renderJavCorrectionNfo(input),xml=rendered.bytes.toString('utf8');
  assert.equal(rendered.rendererVersion,'arca.jav-correction-nfo@2');
  assert.match(xml,/<uniqueid type="jav" default="true">IPX-178<\/uniqueid>/);assert.match(xml,/Correct &lt;film&gt; &amp; title/);
  assert.match(xml,/New &amp; Actor/);assert.doesNotMatch(xml,/IPX-177|tmdb|Old Actor|<script>|<premiered>/);
  assert.equal((xml.match(/<genre>A<\/genre>/g)||[]).length,1);
  assert.equal(renderJavCorrectionNfo(input).renderDigest,rendered.renderDigest);
});
test('tampered proposal and observation cannot produce correction metadata or artifacts',()=>{
  const input=values();input.proposal={...input.proposal,newJavCode:'IPX-179'};
  assert.throws(()=>buildJavCorrectionMetadata(input),{code:'ARCA_JAV_CORRECTION_METADATA_INVALID'});
  assert.throws(()=>renderJavCorrectionNfo(input),{code:'ARCA_JAV_CORRECTION_METADATA_INVALID'});
});

test('an empty source cast renders one unknown actor without changing the source observation',()=>{
  const input=values(),source=structuredClone(input.proposal.sourceQualification);
  source.observation.peopleHints=[];
  source.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source.observation).filter(([key])=>key!=='observationDigest')));
  input.proposal=buildJavCorrectionProposal({basis:input.basis,...source});
  const nfo=renderJavCorrectionNfo(input).bytes.toString('utf8');
  assert.match(nfo,/<actor>\s*<name>未知演员<\/name>\s*<\/actor>/);
  assert.deepEqual(buildJavCorrectionMetadata(input).peopleHints,[]);
  assert.deepEqual(input.proposal.sourceQualification.observation.peopleHints,[]);
});

test('independent NFO verification decodes escaped text and rejects wrong, duplicate or inherited identities and titles',()=>{
  const input=values(),bytes=renderJavCorrectionNfo(input).bytes,expected={javCode:'IPX-178',title:'Correct <film> & title'},xml=bytes.toString('utf8');
  assert.deepEqual(verifyJavCorrectionNfo(bytes,expected),expected);
  for(const changed of [xml.replace('IPX-178','IPX-177'),xml.replace('<title>','<title>Wrong '),
    xml.replace('</movie>','<uniqueid type="jav">IPX-178</uniqueid></movie>'),
    xml.replace('</movie>','<uniqueid type="tmdb">123</uniqueid></movie>'),
    xml.replace('</movie>','<tmdbid>123</tmdbid></movie>'),xml.replace('</movie>','<title>Another</title></movie>'),
    xml.replace('</movie>',''),xml.replace('<movie>','<!DOCTYPE movie [<!ENTITY unsafe "x">]><movie>')])
    assert.throws(()=>verifyJavCorrectionNfo(Buffer.from(changed),expected),{code:'ARCA_JAV_CORRECTION_NFO_INVALID'});
});
