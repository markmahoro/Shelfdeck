'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {createJavCorrectionAssetsPreparation}=require('../../src/helix/domains/arca/capabilities/jav-correction-assets-preparation');
const {deriveJavCoverBytes}=require('../../src/helix/integrations/jav-cover-renderer');
const fixture=require('./fixtures/jav-correction');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function values() {
  const c=fixture.context(),controlProjections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),basis=buildJavCorrectionBasis({raw:c.raw,controlProjections}),source=fixture.source(),
    coverBytes=await sharp({create:{width:240,height:120,channels:3,background:'#457395'}}).jpeg().toBuffer();
  source.observation.cover={...source.observation.cover,byteDigest:sha(coverBytes),byteCount:coverBytes.length,width:240,height:120};
  source.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source.observation).filter(([key])=>key!=='observationDigest')));
  const proposal=buildJavCorrectionProposal({basis,...source});
  return {record:{state:'active',correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),shelfEntryId:c.shelfEntryId,
    admissionDigest:fixture.digest('admission'),proof:{basis,proposal}},fresh:{coverBytes,observation:source.observation}};
}
test('correction prepares real NFO and both decodable cover derivatives from one exact confirmed source with byte provenance',async()=>{
  const {record,fresh}=await values(),before=canonicalDigest(record),calls=[],service=createJavCorrectionAssetsPreparation({deriveJavCoverBytes,
    acquireQualifiedCover:async request=>{calls.push(request);return fresh;}}),result=await service.prepare(record);
  assert.equal(result.kind,'prepared_correction_asset_bytes');assert.equal(calls.length,1);assert.equal(result.pictures.length,2);
  assert.match(result.nfo.bytes.toString(),/IPX-178/);assert.equal(result.metadata.libraRunId,undefined);
  for(const picture of result.pictures){assert.equal(picture.derivation.outputDigest,sha(picture.bytes));
    assert.equal(picture.derivation.sourceByteDigest,sha(fresh.coverBytes));assert.equal((await sharp(picture.bytes).metadata()).format,'jpeg');}
  assert.equal(canonicalDigest(record),before);assert.equal(result.evidence.confirmedProposalDigest,record.proof.proposal.proposalDigest);
});
test('critical title, cover or resource changes stop preparation before any derived artifact is accepted',async()=>{
  for(const mutate of [value=>value.observation.resourceKey='another-film',value=>value.observation.cover.byteDigest=fixture.digest('changed-cover'),
    value=>value.observation.descriptiveEntries.find(item=>item.key==='title').value='Different film']) {
    const {record,fresh}=await values();mutate(fresh);const service=createJavCorrectionAssetsPreparation({deriveJavCoverBytes,acquireQualifiedCover:async()=>fresh});
    await assert.rejects(service.prepare(record),{code:'ARCA_JAV_CORRECTION_SOURCE_CHANGED'});
  }
});
test('new optional fields and page evidence stay on the same chosen source without changing confirmed identity or borrowing another site',async()=>{
  const {record,fresh}=await values(),source=structuredClone(fresh.observation);
  source.descriptiveEntries.push({key:'release_date',value:'2024-01-02'});source.pages=[{resourceUrl:source.resourceUrl,byteDigest:fixture.digest('new-page')}];
  source.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source).filter(([key])=>key!=='observationDigest')));
  const result=await createJavCorrectionAssetsPreparation({deriveJavCoverBytes,acquireQualifiedCover:async()=>({...fresh,observation:source})}).prepare(record);
  assert.equal(result.metadata.sourceQualification.observation.siteRef,'javdb');assert.equal(result.metadata.canonicalIdentityDigest,record.proof.proposal.newIdentity.identityDigest);
  assert.match(result.nfo.bytes.toString(),/<premiered>2024-01-02<\/premiered>/);assert.notEqual(result.evidence.actualProposalDigest,result.evidence.confirmedProposalDigest);
});
