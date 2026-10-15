'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {buildJavCorrectionMetadata}=require('../../src/helix/domains/arca/model/jav-correction-metadata');
const {buildJavCorrectionCast,castQueries}=require('../../src/helix/domains/arca/model/jav-correction-cast');
const {createJavCorrectionCastPreparation}=require('../../src/helix/domains/arca/application/jav-correction-cast-preparation');
const {createMediaCastReferenceQuery}=require('../../src/helix/domains/people/application/media-cast-reference-query');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const fixture=require('./fixtures/jav-correction');
function values() {
  const c=fixture.context(),controlProjections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',
    ownerDomain:'arca',ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),
    basis=buildJavCorrectionBasis({raw:c.raw,controlProjections}),source=fixture.source();
  source.observation.peopleHints=[{displayName:'Known Actor',role:'actor',providerIdentities:[]},
    {displayName:'Unknown Actor',role:'actor',providerIdentities:[]},
    {displayName:'Another Actor',role:'actor',providerIdentities:[]}];
  source.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source.observation).filter(([key])=>key!=='observationDigest')));
  return {basis,proposal:buildJavCorrectionProposal({basis,...source}),correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),admissionDigest:fixture.digest('admission')};
}
function prepare(input,calls=[]) {
  const knownDigest=castQueries(buildJavCorrectionMetadata(input)).find(query=>query.hint.displayName==='Known Actor')?.input.evidenceDigest,
    people=createMediaCastReferenceQuery({findActivePersonByProviderIdentity(){throw new Error('Current JAV source has no exact actor provider identities');},
      findUserAcceptedRegistrationPerson(evidenceDigest){calls.push(evidenceDigest);return evidenceDigest===knownDigest?
        {personId:'person-known',status:'active',currentRevision:3,revision:{factDigest:fixture.digest('known-person')}}:null;}}),
    contractValidator=createCapabilityContractValidator({schemas:Object.values(buildArcaApplicationSchemas())});
  return createJavCorrectionCastPreparation({contractValidator,resolveMediaCastReference:input=>people.resolve(input)}).prepare(input);
}
test('new source cast uses only exact individually accepted public People evidence and retains unresolved source names',()=>{
  const input=values(),calls=[],value=prepare(input,calls),known=value.relations.find(item=>item.displayName==='Known Actor'),
    unknown=value.relations.find(item=>item.displayName==='Unknown Actor'),ambiguous=value.relations.find(item=>item.displayName==='Another Actor');
  assert.equal(known.personId,'person-known');assert.equal(known.confidenceClass,'accepted_origin_evidence');
  assert.equal(unknown.personId,null);assert.equal(ambiguous.personId,null);assert.equal(value.relationCount,3);
  assert.equal(value.referenceProofs.find(item=>item.relationId===ambiguous.relationId).reasonCode,'no_deterministic_person');
  assert.ok(value.relations.every(item=>item.source==='jav:javdb'&&item.originEvidenceDigest!==input.proposal.sourceQualification.observation.observationDigest));
  assert.equal(new Set(calls).size,3);assert.equal(new Set(value.relations.map(item=>item.originEvidenceDigest)).size,3);
  assert.equal(value.subjectId,undefined);assert.equal(value.libraRunId,undefined);assert.equal(value.aftercareCaseId,undefined);
});
test('correction cast conserves exact query proofs and rejects foreign query, unchanged shortcut and forged proof',()=>{
  const input=values(),metadata=buildJavCorrectionMetadata(input),queries=castQueries(metadata),
    resolutions=queries.map(query=>({relationId:query.relationId,inputDigest:query.inputDigest,result:{kind:'unresolved',reasonCode:'no_deterministic_person'}}));
  assert.equal(buildJavCorrectionCast({...input,resolutions}).relationCount,3);
  for(const mutate of [rows=>{rows[0].inputDigest=fixture.digest('foreign');},rows=>{rows[0].relationId='foreign';},
    rows=>{rows[0].result={kind:'unchanged',personId:'old-person'};},rows=>{rows[0].result={schema:'people.media-cast-reference-proof@1',kind:'resolved',
      personId:'forged',personRevision:1,personFactDigest:fixture.digest('fact'),reasonCode:'exact_provider_identity',inputDigest:rows[0].inputDigest,proofDigest:fixture.digest('forged')};}]) {
    const changed=structuredClone(resolutions);mutate(changed);assert.throws(()=>buildJavCorrectionCast({...input,resolutions:changed}),{code:'ARCA_JAV_CORRECTION_CAST_INVALID'});
  }
});
test('source without cast remains valid and People transport failures are explicit rather than guessed associations',()=>{
  const input=values(),observation=input.proposal.sourceQualification.observation,source={...input.proposal.sourceQualification,
    observation:{...observation,peopleHints:[]}};
  source.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(source.observation).filter(([key])=>key!=='observationDigest')));
  const minimal={...input,proposal:buildJavCorrectionProposal({basis:input.basis,...source})};
  assert.equal(prepare(minimal).relationCount,0);
  const contractValidator=createCapabilityContractValidator({schemas:Object.values(buildArcaApplicationSchemas())});
  assert.throws(()=>createJavCorrectionCastPreparation({contractValidator,resolveMediaCastReference(){throw new Error('People query unavailable');}}).prepare(input),/People query unavailable/);
});
