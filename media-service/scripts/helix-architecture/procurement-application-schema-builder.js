'use strict';

const crypto = require('crypto');
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type:'string', minLength:1, ...options });
const id = () => text({ maxLength:256 });
const digest = () => text({ pattern:'^[a-f0-9]{64}$' });
const positive = () => ({ type:'integer', minimum:1 });
const object = (properties, required = Object.keys(properties), options = {}) => ({ type:'object', additionalProperties:false, properties, required, ...options });
const ref = (name) => ({ $ref:typeId(name) });

function triageRuleSnapshot() {
  const payload = object({
    candidateReadinessContractRef:{ const:'helix.procurement.candidate-readiness@1' },
    profileClaimBaselineContractRef:{ const:'helix.procurement.profile-claim-baseline@1' },
    primaryInputManifestContractRef:{ const:'helix.procurement.primary-input-manifest@1' },
    relatedMaterialReferenceContractRef:{ const:'helix.procurement.related-material-reference@1' },
    recallPriority:{ const:true }, maxPrimaryMaterials:{ const:1024 }
  });
  return { $schema:DRAFT, $id:typeId('ProcurementTriageRuleSnapshot'), title:'ProcurementTriageRuleSnapshot@1',
    'x-helix-ssotRefs':['5.3.2','8.6.18'], 'x-helix-maxCanonicalBytes':8*1024,
    ...object({ ruleRef:id(), revision:positive(), ruleSchemaRef:{ const:'procurement.triage-rule.beta@1' },
      rulePayload:payload, ruleDigest:digest(), authorityDigest:digest() }) };
}
function triageRuleRegistry() {
  return { $schema:DRAFT, $id:typeId('ProcurementTriageRuleRegistry'), title:'ProcurementTriageRuleRegistry@1',
    'x-helix-ssotRefs':['5.3.2','8.6.18'], ...object({ registrySchemaRef:{ const:'procurement.triage-rule-registry@1' },
      registryVersion:positive(), activeRuleRef:id(), activeRuleRevision:positive(),
      entries:{ type:'array', minItems:1, items:ref('ProcurementTriageRuleSnapshot') }, registryDigest:digest() }) };
}
function runExecutionBasis() {
  return { $schema:DRAFT, $id:typeId('ProcurementRunExecutionBasis'), title:'ProcurementRunExecutionBasis@1',
    'x-helix-ssotRefs':['6.3.2','8.6.18'], ...object({ procurementRunId:id(), fieldId:id(), fieldStatus:{ const:'active' },
      fieldAccess:object({ revision:positive(), digest:digest() }),
      terminalObservation:object({ revision:positive(), fieldObservationWorkId:id() }),
      extractionPolicy:object({ policyId:id(), revision:positive(), digest:digest() }), triageRule:ref('ProcurementTriageRuleSnapshot'),
      sourceRetryIntentId:id(), selectedFieldMaterialSet:{ $ref:'helix://contracts/domain-types/SelectedFieldMaterialSet/v1' }, basisDigest:digest()
    }, ['procurementRunId','fieldId','fieldStatus','fieldAccess','terminalObservation','extractionPolicy','triageRule','selectedFieldMaterialSet','basisDigest']) };
}
function buildProcurementApplicationSchemas() { return Object.freeze({
  ProcurementRunExecutionBasis:runExecutionBasis(), ProcurementTriageRuleRegistry:triageRuleRegistry(), ProcurementTriageRuleSnapshot:triageRuleSnapshot()
}); }
function canonicalize(value) { if(Array.isArray(value))return value.map(canonicalize); if(value&&typeof value==='object')return Object.keys(value).sort().reduce((out,key)=>{out[key]=canonicalize(value[key]);return out;},{}); return value; }
function schemaDigest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }

module.exports = Object.freeze({ buildProcurementApplicationSchemas, schemaDigest, typeId });
