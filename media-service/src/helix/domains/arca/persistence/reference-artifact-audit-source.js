'use strict';
const {createReferenceAuditSource}=require('../../../foundation/persistence/reference-audit-source');
function createArcaArtifactAuditSource(options){return createReferenceAuditSource({...options,owner:'arca',sourceId:'arca_frozen',
  partitions:[{table:'arca_us_actor_refresh_intents',key:'intent_id',json:'payload_json',schemaRef:'helix://contracts/domain-types/UsAdultActorRefreshIntent/v1',schemaColumn:'payload_schema_ref',digestColumn:'payload_digest',selfDigestProperty:'intentDigest',
    child:{table:'arca_us_actor_refresh_pages',parentKey:'intent_id',key:'page_ordinal',json:'page_json',schemaRef:'helix://contracts/domain-types/PeopleReferenceLibraryPage/v1',schemaColumn:'page_schema_ref',digestColumn:'page_digest',selfDigestProperty:'pageDigest',countProperty:'pageCount'}},
    {table:'arca_shelf_entries',key:'shelf_entry_id',child:{table:'arca_inventory_representations',parentKey:'shelf_entry_id',key:'revision',
      fact:{table:'arca_inventory_product_facts',parentKey:'shelf_entry_id',revisionKey:'inventory_revision',json:'fact_json',schemaColumn:'fact_schema_ref',digestColumn:'fact_digest'}}}],
  epochs:[{table:'arca_us_actor_refresh_intents',columns:['created_at_ms']},{table:'arca_us_actor_refresh_pages',columns:['page_ordinal']},
    {table:'arca_inventory_representations',columns:['revision','committed_at_ms']},{table:'arca_inventory_product_facts',columns:['inventory_revision','committed_at_ms']}]
});}
module.exports=Object.freeze({createArcaArtifactAuditSource});
