'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const {buildJavCorrectionBasis,buildJavCorrectionProposal}=require('../../src/helix/domains/arca/model/jav-identity-correction');
const {buildJavCorrectionMetadata}=require('../../src/helix/domains/arca/model/jav-correction-metadata');
const {castQueries,buildJavCorrectionCast}=require('../../src/helix/domains/arca/model/jav-correction-cast');
const {metadataRecord,castRecord,restoreMetadataRecord,restoreCastRecord}=require('../../src/helix/domains/arca/model/jav-correction-stored-facts');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const fixture=require('./fixtures/jav-correction');
test('large valid optional cast and full source metadata retain every name and proof without exceeding Inventory fact record limits',()=>{
  const c=fixture.context(),projections=c.raw.materials.map(row=>({materialKey:row.material_key,resultKind:'available',controlState:'controlled',ownerDomain:'arca',
    ownerScopeType:'shelf_entry',ownerScopeId:c.shelfEntryId,controlRevision:1,projectionDigest:fixture.digest('control')})),basis=buildJavCorrectionBasis({raw:c.raw,controlProjections:projections}),q=fixture.source();
  q.observation.peopleHints=Array.from({length:64},(_,i)=>({displayName:String(i)+':'+('Name'.repeat(150)),role:'actor',providerIdentities:[]}));
  q.observation.observationDigest=canonicalDigest(Object.fromEntries(Object.entries(q.observation).filter(([key])=>key!=='observationDigest')));
  const input={correctionId:'arca-jav-correction-'+fixture.digest('case').slice(0,40),admissionDigest:fixture.digest('admission'),basis,
    proposal:buildJavCorrectionProposal({basis,...q})},metadata=buildJavCorrectionMetadata(input),
    cast=buildJavCorrectionCast({...input,resolutions:castQueries(metadata).map(query=>({relationId:query.relationId,inputDigest:query.inputDigest,
      result:{kind:'unresolved',reasonCode:'no_deterministic_person'}}))}),
    sourceFields={correctionId:input.correctionId,admissionDigest:input.admissionDigest,scopeDigest:fixture.digest('scope'),
      confirmedProposalDigest:input.proposal.proposalDigest,actualProposalDigest:input.proposal.proposalDigest,qualification:q,
      byteExpectations:['metadata','nfo','poster','fanart'].map(kind=>({kind,byteDigest:fixture.digest(kind),sizeBytes:100}))},
    verified={schemaRef:'helix://contracts/types/JavCorrectionSourceVerified/v1',producerRef:'arca.jav_correction.source.verify@1',
      ...sourceFields,payloadDigest:canonicalDigest(sourceFields)},
    records=[metadataRecord(metadata,verified),castRecord(cast)],validator=createCapabilityContractValidator({schemas:Object.values(buildArcaApplicationSchemas())});
  assert.ok(Buffer.byteLength(canonicalJson(metadata))>65536);assert.ok(Buffer.byteLength(canonicalJson(cast))>65536);
  for(const record of records){validator.validate(record.schemaRef,record);assert.ok(Buffer.byteLength(canonicalJson(record))<=65536);}
  assert.equal(records[0].peopleHintsReference.hintCount,64);assert.equal(records[0].peopleHintsReference.hintsDigest,canonicalDigest(q.observation.peopleHints));
  assert.equal(records[0].sourceQualificationReference.observationDigest,q.observation.observationDigest);
  assert.deepEqual(restoreMetadataRecord(records[0],verified),metadata);
  for(const mutate of [value=>{value.correctionId='foreign-correction';},value=>{value.admissionDigest=fixture.digest('foreign');},
    value=>{value.qualification.observation.peopleHints[0].displayName='Foreign actor';},
    value=>{value.qualification.observation.cover.byteDigest=fixture.digest('foreign-cover');}]) {
    const changed=structuredClone(verified);mutate(changed);
    assert.throws(()=>restoreMetadataRecord(records[0],changed),{code:'ARCA_JAV_CORRECTION_METADATA_RECORD_INTEGRITY'});
  }
  assert.throws(()=>restoreMetadataRecord({...records[0],recordDigest:fixture.digest('bad-record')},verified),
    {code:'ARCA_JAV_CORRECTION_METADATA_RECORD_INTEGRITY'});
  assert.equal(records[1].relationCount,64);assert.equal(records[1].referenceProofs.length,64);assert.equal(cast.relations.length,64);
  assert.equal(records[1].relationsDigest,canonicalDigest(cast.relations));assert.equal(records[1].sourceFactDigest,cast.factDigest);
  assert.equal(new Set(cast.relations.map(relation=>relation.displayName)).size,64);
  const rows=cast.relations.map(relation=>({shelf_entry_id:cast.shelfEntryId,relation_id:relation.relationId,person_id:relation.personId,
    display_name:relation.displayName,display_name_normalized:relation.displayNameNormalized,role:relation.role,relation_source:relation.source,
    provider_identity_json:null,origin_evidence_digest:relation.originEvidenceDigest,confidence_class:relation.confidenceClass,relation_digest:canonicalDigest(relation)}));
  assert.deepEqual(restoreCastRecord(records[1],rows),cast);
  const changed=structuredClone(rows);changed[0].display_name='Old Actor';assert.throws(()=>restoreCastRecord(records[1],changed),{code:'ARCA_JAV_CORRECTION_CAST_RECORD_INTEGRITY'});
  assert.throws(()=>restoreCastRecord(records[1],rows.slice(1)),{code:'ARCA_JAV_CORRECTION_CAST_RECORD_INTEGRITY'});
  assert.throws(()=>metadataRecord(metadata,{...verified,payloadDigest:fixture.digest('foreign'),qualification:{...q,sourceOrdinal:1}}));
  assert.throws(()=>castRecord({...cast,factDigest:fixture.digest('forged')}));
});
