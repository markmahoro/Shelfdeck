'use strict';
const {restoreMetadataRecord}=require('../model/jav-correction-stored-facts');
function readJavAftercareVerifiedSource(raw,reader) {
  const metadata=raw.facts.find(item=>item.fact_kind==='product_metadata')?.value;
  if(metadata?.schemaRef!=='helix://contracts/application-types/ArcaJavCorrectionMetadataRecord/v1')return null;
  const fail=()=>{throw Object.assign(new TypeError('Current Arca Metadata requires its exact durable source Result.'),
    {code:'ARCA_JAV_CORRECTION_METADATA_RECORD_INTEGRITY'});};
  if(!reader?.listWorks||!reader?.read)fail();
  const works=reader.listWorks({ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:metadata.correctionId,workKind:'jav_correction_assets'});
  if(works.length>8)fail();
  const matches=works.flatMap(work=>reader.read(work.work_id).filter(row=>row.outcomeKind==='succeeded'&&
    row.capabilityRef==='arca.jav_correction.source.verify@1'&&row.result?.payloadDigest===metadata.sourceQualificationReference.sourceVerifiedPayloadDigest));
  if(matches.length!==1)fail();
  restoreMetadataRecord(metadata,matches[0].result);
  return matches[0].result;
}
module.exports=Object.freeze({readJavAftercareVerifiedSource});
