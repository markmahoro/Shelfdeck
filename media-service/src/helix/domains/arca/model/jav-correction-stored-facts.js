'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
function record(value,schema,extra,removed) {
  const {factDigest,...body}=value;
  if(factDigest!==canonicalDigest(body))throw new TypeError('Correction source Fact digest is invalid.');
  const stored={...Object.fromEntries(Object.entries(body).filter(([key])=>!removed.includes(key))),schemaRef:'helix://contracts/application-types/'+schema+'/v1',
    sourceFactDigest:factDigest,...extra},result={...stored,recordDigest:canonicalDigest(stored)};
  if(Buffer.byteLength(canonicalJson(result))>65536)throw Object.assign(new TypeError('Correction stored Fact exceeds its exact record bound.'),{code:'ARCA_JAV_CORRECTION_FACT_RECORD_BUDGET'});
  return Object.freeze(result);
}
function metadataRecord(metadata,verified) {
  if(canonicalDigest(metadata.sourceQualification)!==canonicalDigest(verified.qualification)||metadata.correctionId!==verified.correctionId||metadata.admissionDigest!==verified.admissionDigest)
    throw new TypeError('Metadata Record must bind the exact verified correction source.');
  const q=verified.qualification;
  return record(metadata,'ArcaJavCorrectionMetadataRecord',{sourceQualificationReference:{sourceVerifiedPayloadDigest:verified.payloadDigest,
    sourceSnapshotDigest:canonicalDigest(q.sourceSnapshot),sourceOrdinal:q.sourceOrdinal,siteRef:q.observation.siteRef,
    resourceKey:q.observation.resourceKey,resourceUrl:q.observation.resourceUrl,observationDigest:q.observation.observationDigest},
    peopleHintsReference:{hintCount:metadata.peopleHints.length,hintsDigest:canonicalDigest(metadata.peopleHints)}},['sourceQualification','peopleHints']);
}
function castRecord(cast) {return record(cast,'ArcaJavCorrectionCastRecord',{},['relations']);}
function restoreMetadataRecord(stored,verified) {
  const fail=()=>{throw Object.assign(new TypeError('Correction Metadata Record differs from its exact verified source.'),
    {code:'ARCA_JAV_CORRECTION_METADATA_RECORD_INTEGRITY'});},
    {recordDigest,sourceFactDigest,sourceQualificationReference,peopleHintsReference,...recordBody}=stored,
    reference=sourceQualificationReference,q=verified?.qualification,observation=q?.observation;
  if(stored.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionMetadataRecord/v1'||
    recordDigest!==canonicalDigest({...recordBody,sourceFactDigest,sourceQualificationReference,peopleHintsReference})||
    verified?.schemaRef!=='helix://contracts/types/JavCorrectionSourceVerified/v1'||verified.producerRef!=='arca.jav_correction.source.verify@1'||
    verified.correctionId!==stored.correctionId||verified.admissionDigest!==stored.admissionDigest||!q||!reference||
    reference.sourceVerifiedPayloadDigest!==verified.payloadDigest||reference.sourceSnapshotDigest!==canonicalDigest(q.sourceSnapshot)||
    reference.sourceOrdinal!==q.sourceOrdinal||['siteRef','resourceKey','resourceUrl','observationDigest'].some(key=>reference[key]!==observation?.[key])||
    peopleHintsReference?.hintCount!==observation?.peopleHints?.length||peopleHintsReference?.hintsDigest!==canonicalDigest(observation?.peopleHints))fail();
  const fields={correctionId:verified.correctionId,admissionDigest:verified.admissionDigest,scopeDigest:verified.scopeDigest,
    confirmedProposalDigest:verified.confirmedProposalDigest,actualProposalDigest:verified.actualProposalDigest,
    qualification:q,byteExpectations:verified.byteExpectations};
  if(verified.payloadDigest!==canonicalDigest(fields))fail();
  const body={...recordBody,schemaRef:'helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1',
    sourceQualification:q,peopleHints:observation.peopleHints},value={...body,factDigest:canonicalDigest(body)};
  if(value.factDigest!==sourceFactDigest)fail();
  return Object.freeze(value);
}
function restoreCastRecord(stored,rows) {
  const fail=()=>{throw Object.assign(new TypeError('Correction Cast Record differs from its immutable origin Inventory relations.'),{code:'ARCA_JAV_CORRECTION_CAST_RECORD_INTEGRITY'});},
    {recordDigest,sourceFactDigest,...recordBody}=stored;
  if(recordDigest!==canonicalDigest({...recordBody,sourceFactDigest})||stored.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionCastRecord/v1'||
      !Array.isArray(rows)||rows.length!==stored.relationCount||rows.length>64)fail();
  const relations=rows.map(row=>{
    if(row.shelf_entry_id!==stored.shelfEntryId)fail();
    const body={relationId:row.relation_id,personId:row.person_id,displayName:row.display_name,displayNameNormalized:row.display_name_normalized,
      role:row.role,source:row.relation_source,providerIdentities:row.provider_identity_json===null?[]:JSON.parse(row.provider_identity_json),
      originEvidenceDigest:row.origin_evidence_digest,confidenceClass:row.confidence_class},relation={...body,relationDigest:canonicalDigest(body)};
    if(row.relation_digest!==canonicalDigest(relation))fail();return relation;
  }).sort((a,b)=>{const compare=(a,b)=>a<b?-1:a>b?1:0;return compare(a.role,b.role)||compare(a.displayNameNormalized,b.displayNameNormalized)||compare(a.relationId,b.relationId);});
  if(canonicalDigest(relations)!==stored.relationsDigest||new Set(relations.map(row=>row.relationId)).size!==relations.length)fail();
  const body={...recordBody,schemaRef:'helix://contracts/application-types/ArcaJavCorrectionCastFact/v1',relations},value={...body,factDigest:canonicalDigest(body)};
  if(value.factDigest!==sourceFactDigest)fail();return Object.freeze(value);
}
module.exports=Object.freeze({metadataRecord,castRecord,restoreMetadataRecord,restoreCastRecord});
