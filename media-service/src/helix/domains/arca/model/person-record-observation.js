'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
// Reserve room for the receipt identity and revisions within Foundation's 16 KiB limit.
const PERSON_PROOF_BATCH_BYTES=12*1024;
const personProofBatchFits=observations=>Buffer.byteLength(canonicalJson(observations),'utf8')<=PERSON_PROOF_BATCH_BYTES;
const {relationEvidenceDigest}=require('./on-deck-person-evidence');
function personRecordQuery(row, libraryKind) {
  const providerIdentities=row.provider_identity_json?JSON.parse(row.provider_identity_json):[];
  return Object.freeze({libraryKind,personId:row.person_id||null,providerIdentities,evidenceDigest:relationEvidenceDigest({
    shelfEntryId:row.shelf_entry_id,inventoryRevision:Number(row.evidence_inventory_revision??row.inventory_revision),relationId:row.relation_id,
    relationDigest:row.relation_digest,originEvidenceDigest:row.origin_evidence_digest,
    displayName:row.display_name,displayNameNormalized:row.display_name_normalized,role:row.role,providerIdentities})});
}
function assertPersonRecordObservation(row,observation,libraryKind) {
  const proof=observation.proof,{proofDigest,...basis}=proof;
  if(observation.relationId!==row.relation_id||observation.previousRelationDigest!==row.relation_digest||
    proof.schema!=='people.media-cast-reference-proof@1'||proof.kind!=='resolved'||!proof.personId||
    proof.personId===row.person_id||!Number.isSafeInteger(proof.personRevision)||proof.personRevision<1||
    !/^[a-f0-9]{64}$/.test(proof.personFactDigest)||proof.inputDigest!==canonicalDigest(personRecordQuery(row,libraryKind))||
    canonicalDigest(basis)!==proofDigest||!['formal_merge','exact_provider_identity','accepted_origin_evidence'].includes(proof.reasonCode))
    throw Object.assign(new Error('Person record observation does not match the exact current relation.'),{code:'ARCA_PERSON_RECORD_PROOF_INVALID'});
}
module.exports=Object.freeze({personRecordQuery,assertPersonRecordObservation,personProofBatchFits});
