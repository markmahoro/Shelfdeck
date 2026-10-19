'use strict';
const {createReferenceAuditSource}=require('../../../foundation/persistence/reference-audit-source');
function createLibraArtifactAuditSource(options){return createReferenceAuditSource({...options,owner:'libra',sourceId:'libra_frozen',
  partitions:[{table:'libra_us_adult_analysis_bases',key:'analysis_id',json:'basis_json',schemaRef:'helix://contracts/domain-types/UsAdultAnalysisBasis/v1',schemaColumn:'basis_schema_ref',digestColumn:'basis_digest',digestProperty:'basisDigest',selfDigestProperty:'basisDigest',digestExcludedProperties:['analysisId'],
    child:{table:'libra_us_adult_reference_pages',parentKey:'analysis_id',key:'page_ordinal',json:'page_json',schemaRef:'helix://contracts/domain-types/PeopleReferenceLibraryPage/v1',schemaColumn:'page_schema_ref',digestColumn:'page_payload_digest',selfDigestProperty:'pageDigest',countProperty:'pageCount'}},
    {table:'libra_us_adult_actor_choice_intents',key:'intent_id',json:'record_json',schemaRef:'helix://contracts/domain-types/UsAdultActorChoiceRecord/v1',schemaColumn:'record_schema_ref',digestColumn:'record_digest',digestProperty:'recordDigest',selfDigestProperty:'recordDigest'}],
  epochs:[{table:'libra_us_adult_analysis_bases',columns:['created_at_ms']},{table:'libra_us_adult_reference_pages',columns:['page_ordinal']},
    {table:'libra_us_adult_actor_choice_intents',columns:['created_at_ms','choice_revision']}]
});}
module.exports=Object.freeze({createLibraArtifactAuditSource});
