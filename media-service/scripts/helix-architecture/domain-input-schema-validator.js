'use strict';

const fs = require('fs');
const path = require('path');
const { buildDomainInputSchemas, schemaDigest } = require('./domain-input-schema-builder');
const { buildDomainInputRegistry, expectedUsages } = require('./domain-input-materializer');

const finding = (code, message, details = {}) => ({ code, message, ...details });
const normalize = (value) => value.split(path.sep).join('/');

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_DOMAIN_INPUT_JSON', `Cannot read JSON: ${error.message}`, { file: normalize(filePath) }));
    return null;
  }
}

function inspectNode(node, schemaId, knownRefs, findings, location = '#') {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object') {
    if (node.additionalProperties !== false) findings.push(finding('OPEN_DOMAIN_INPUT_OBJECT', 'Domain input objects must be closed.', { schemaId, location }));
    for (const forbidden of ['payload', 'path', 'rawPath', 'store', 'repository', 'facade', 'planner', 'runtime', 'config']) {
      if (Object.hasOwn(node.properties || {}, forbidden)) findings.push(finding(
        'FORBIDDEN_DOMAIN_INPUT_FIELD', 'Domain inputs cannot carry raw payloads, paths, or implementation authority.', { schemaId, location, property: forbidden }
      ));
    }
  }
  if (typeof node.$ref === 'string' && !knownRefs.has(node.$ref)) {
    findings.push(finding('UNRESOLVED_DOMAIN_INPUT_REF', 'Domain input schema has an unresolved $ref.', { schemaId, location, ref: node.$ref }));
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) value.forEach((item, index) => inspectNode(item, schemaId, knownRefs, findings, `${location}/${key}/${index}`));
    else if (value && typeof value === 'object') inspectNode(value, schemaId, knownRefs, findings, `${location}/${key}`);
  }
}

function validateDomainInputSchemas(options) {
  const contractsRoot = path.resolve(options.contractsRoot);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const registry = readJson(path.join(contractsRoot, 'domain-input-type-registry.json'), findings);
  if (!registry) return { ok: false, findings };
  const expectedSchemas = buildDomainInputSchemas();
  const expectedRegistry = buildDomainInputRegistry({ contractsRoot, repositoryRoot });
  if (schemaDigest(registry) !== schemaDigest(expectedRegistry)) findings.push(finding(
    'DOMAIN_INPUT_REGISTRY_DRIFT', 'Domain input registry differs from SSOT Catalog usage and the schema builder.'
  ));

  const sharedRegistry = readJson(path.join(contractsRoot, 'shared-type-registry.json'), findings);
  const resultRegistry = readJson(path.join(contractsRoot, 'result-type-registry.json'), findings);
  const knownRefs = new Set([
    ...(sharedRegistry && sharedRegistry.entries || []).map((entry) => entry.schemaId),
    ...(resultRegistry && resultRegistry.entries || []).map((entry) => entry.schemaId),
    ...(registry.entries || []).map((entry) => entry.schemaId)
  ]);
  const ids = new Set();
  for (const entry of registry.entries || []) {
    if (!entry || ids.has(entry.id)) {
      findings.push(finding('DUPLICATE_DOMAIN_INPUT_ENTRY', 'Domain input registry IDs must be unique.', { entryId: entry && entry.id }));
      continue;
    }
    ids.add(entry.id);
    const schema = readJson(path.join(contractsRoot, entry.relativePath || ''), findings);
    if (!schema) continue;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || schema.$id !== entry.schemaId) findings.push(finding(
      'INVALID_DOMAIN_INPUT_IDENTITY', 'Domain input draft and identity must match the registry.', { entryId: entry.id }
    ));
    if (!expectedSchemas[entry.id] || schemaDigest(schema) !== entry.digest.value || schemaDigest(schema) !== schemaDigest(expectedSchemas[entry.id])) {
      findings.push(finding('DOMAIN_INPUT_CONTRACT_DRIFT', 'Committed domain input differs from the SSOT-derived contract.', { entryId: entry.id }));
    }
    const exactIdentityFields = {
      PeopleCandidateAcceptanceDecision: ['decisionId', 'expectedCandidateRevision', 'candidatePayloadDigest', 'decisionDigest'],
      DirectPersonRegistrationDecision: ['decisionId', 'newPersonId', 'decisionDigest'],
      PeopleReferenceMaintenanceDecision: ['decisionId', 'personId', 'expectedPersonRevision', 'expectedReferenceRevision', 'decisionDigest'],
      PersonReferenceProjection: ['projectionContract', 'projectionRevision', 'personId', 'personRevision', 'projectionDigest'],
      MetadataFetchIntent: ['intentId', 'sourceKind', 'resolvedIdentityDigest', 'intentDigest'],
      MetadataObservationSet: ['setId', 'resolvedIdentityDigest', 'setDigest'],
      OnDeckPersonEvidenceProjectionItem: ['projectionItemId', 'shelfEntryId', 'inventoryRevision', 'relationId', 'projectionRevision', 'projectionItemDigest'],
      PerceptionResolutionQuery: ['queryContract', 'queryVersion', 'querySchemaRef', 'queryInputDigest'],
      PerceptionResolutionRecordSet: ['queryInputDigest', 'recordSetDigest'],
      PerceptionResolutionRuleSnapshot: ['ruleContract', 'ruleVersion', 'ruleDigest'],
      SelectedFieldMaterialSet: ['procurementRunId', 'fieldId', 'members', 'selectionDigest'],
      CandidateDraft: ['draftId', 'candidatePackageId', 'expectedPackageRevision', 'procurementRunId', 'candidateDraftDigest'],
      ProcurementTriageRuleSnapshot: ['ruleRef', 'revision', 'ruleSchemaRef', 'ruleDigest', 'authorityDigest'],
      TriageIdentityResolutionInput: ['procurementRunId', 'runBasisDigest', 'structureEvidencePayloadDigest', 'unit', 'inputDigest'],
      TriageManifestBuildInput: ['procurementRunId', 'runBasisDigest', 'selectedFieldMaterialSet', 'unit', 'inputDigest'],
      TriageMaterialProbeBatch: ['procurementRunId', 'runBasisDigest', 'selectionDigest', 'batchOrdinal', 'members', 'batchDigest'],
      TriageStructureInspectionInput: ['selectedFieldMaterialSet', 'probeBatches', 'playabilityPages', 'materialFieldContext', 'pageRequest', 'inputDigest'],
      CandidateDeliveryQuery: ['queryContract', 'offerId', 'candidatePackageId', 'packageRevision', 'packageDigest', 'acceptanceBasisDigest', 'queryDigest'],
      CandidateDeliveryReadResult: ['queryDigest', 'resultKind', 'resultDigest'],
      CandidateDeliverySnapshot: ['snapshotContract', 'deliverySnapshotDigest'],
      SubjectContinuityResolutionDecision: ['decisionId', 'decisionDigest'],
      AcceptedIntakePayload: ['intakeDecisionId', 'decisionRevision', 'payloadDigest'],
      IntakeRejectionDecision: ['intakeDecisionId', 'decisionRevision', 'offerId', 'candidatePackageId', 'decisionDigest'],
      ArcaAcceptanceRejectionDecision: ['acceptanceDecisionId', 'acceptanceAttemptId', 'offerId', 'onDeckPackageId', 'decisionDigest'],
      StructuredRejection: ['handoffKind', 'offerId', 'deliverableId', 'rejectionCode', 'rejectionDigest']
    };
    const identityFields = exactIdentityFields[entry.id] || ['schemaRef', 'schemaVersion', 'revision', 'digest'];
    for (const field of identityFields) {
      const requiredSets = schema.oneOf
        ? (schema.oneOf || []).map((branch) => branch.required || [])
        : [schema.required || []];
      if (requiredSets.length === 0 || requiredSets.some((required) => !required.includes(field))) {
        findings.push(finding('MISSING_DOMAIN_INPUT_IDENTITY_FIELD', 'Domain input identity is incomplete.', {
          entryId: entry.id, field
        }));
      }
    }
    if (schema['x-helix-role'] === 'bounded-contract' && !(schema.required || []).includes('typedParameters')) findings.push(finding(
      'UNBOUNDED_INTENT_PARAMETERS', 'Bounded intent/requirement contracts require typedParameters.', { entryId: entry.id }
    ));
    inspectNode(schema, schema.$id, knownRefs, findings);
  }

  const usages = expectedUsages(repositoryRoot);
  for (const name of usages.keys()) {
    if (!ids.has(name)) findings.push(finding('MISSING_DOMAIN_INPUT_TYPE', 'Catalog input reference has no schema.', { entryId: name }));
  }
  const facadeOnlyTypes = new Set(['DirectPersonRegistrationDecision', 'CandidateDeliveryQuery', 'CandidateDeliveryReadResult']);
  for (const name of ids) {
    if (!usages.has(name) && !facadeOnlyTypes.has(name)) findings.push(finding('UNUSED_DOMAIN_INPUT_TYPE', 'Domain input schema is not referenced by the Catalog.', { entryId: name }));
  }

  return {
    ok: findings.length === 0,
    typeCount: ids.size,
    boundedContractCount: (registry.entries || []).filter((entry) => entry.role === 'bounded-contract').length,
    acceptedDtoCount: (registry.entries || []).filter((entry) => entry.role === 'accepted-business-dto').length,
    registryDigest: schemaDigest(registry),
    findings
  };
}

module.exports = Object.freeze({ validateDomainInputSchemas });
