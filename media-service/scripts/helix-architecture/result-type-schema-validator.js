'use strict';

const fs = require('fs');
const path = require('path');
const { buildResultTypeSchemas, schemaDigest } = require('./result-type-schema-builder');
const { buildResultTypeRegistry, readResultSourceEntries } = require('./result-type-materializer');

const normalize = (value) => value.split(path.sep).join('/');
const finding = (code, message, details = {}) => ({ code, message, ...details });

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_RESULT_TYPE_JSON', `Cannot read JSON: ${error.message}`, { file: normalize(filePath) }));
    return null;
  }
}

function collectRefs(node, refs = new Set()) {
  if (!node || typeof node !== 'object') return refs;
  if (typeof node.$ref === 'string') refs.add(node.$ref);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((item) => collectRefs(item, refs));
    else if (value && typeof value === 'object') collectRefs(value, refs);
  }
  return refs;
}

function validateObjectClosure(node, schemaId, findings, location = '#') {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'object' && node.additionalProperties !== false) {
    findings.push(finding('OPEN_RESULT_OBJECT_SCHEMA', 'Every Result object schema must deny undeclared properties.', { schemaId, location }));
  }
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) value.forEach((item, index) => validateObjectClosure(item, schemaId, findings, `${location}/${key}/${index}`));
    else if (value && typeof value === 'object') validateObjectClosure(value, schemaId, findings, `${location}/${key}`);
  }
}

function validateResultTypeSchemas(options) {
  const contractsRoot = path.resolve(options.contractsRoot);
  const findings = [];
  const registryPath = path.join(contractsRoot, 'result-type-registry.json');
  const registry = readJson(registryPath, findings);
  if (!registry) return { ok: false, findings };
  const expectedSchemas = buildResultTypeSchemas();
  const expectedRegistry = buildResultTypeRegistry(contractsRoot);
  if (schemaDigest(registry) !== schemaDigest(expectedRegistry)) {
    findings.push(finding('RESULT_TYPE_REGISTRY_DRIFT', 'Result registry differs from its SSOT-derived builder.'));
  }

  const sourceEntries = readResultSourceEntries(contractsRoot);
  const nominalOutputs = new Set(sourceEntries.filter((entry) => entry.kind === 'nominal-result').map((entry) => entry.id));
  const directOutputs = new Set(sourceEntries.filter((entry) => entry.kind === 'direct-handle-result').map((entry) => entry.id));
  const outcomeOutputs = new Set(sourceEntries.filter((entry) => entry.kind === 'outcome-envelope').map((entry) => entry.id));
  if (sourceEntries.length !== 96 || nominalOutputs.size !== 86 || directOutputs.size !== 9 || outcomeOutputs.size !== 1) {
    findings.push(finding('RESULT_SOURCE_COUNT_DRIFT', 'SSOT result source map must remain 86 nominal + 9 direct + 1 Outcome.'));
  }

  const sharedRegistry = readJson(path.join(contractsRoot, 'shared-type-registry.json'), findings);
  const knownSchemaIds = new Set([
    ...(sharedRegistry && sharedRegistry.entries || []).map((entry) => entry.schemaId),
    ...(registry.entries || []).map((entry) => entry.schemaId)
  ]);
  const registryNames = new Set();
  for (const entry of registry.entries || []) {
    if (!entry || registryNames.has(entry.id)) {
      findings.push(finding('DUPLICATE_RESULT_TYPE_ENTRY', 'Result type IDs must be unique.', { entryId: entry && entry.id }));
      continue;
    }
    registryNames.add(entry.id);
    const schemaPath = path.join(contractsRoot, entry.relativePath || '');
    const schema = readJson(schemaPath, findings);
    if (!schema) continue;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || schema.$id !== entry.schemaId) {
      findings.push(finding('INVALID_RESULT_SCHEMA_IDENTITY', 'Result schema draft and identity must match the registry.', { entryId: entry.id }));
    }
    if (schemaDigest(schema) !== entry.digest.value || !expectedSchemas[entry.id] || schemaDigest(schema) !== schemaDigest(expectedSchemas[entry.id])) {
      findings.push(finding('RESULT_SCHEMA_CONTRACT_DRIFT', 'Committed Result schema differs from the SSOT-derived contract.', { entryId: entry.id }));
    }
    validateObjectClosure(schema, schema.$id, findings);
    for (const ref of collectRefs(schema)) {
      if (!knownSchemaIds.has(ref)) findings.push(finding('UNRESOLVED_RESULT_TYPE_REF', 'Result schema has an unresolved $ref.', {
        entryId: entry.id, ref
      }));
    }
    const resultKind = schema.properties && schema.properties.kind;
    for (const forbidden of ['deferred', 'failed', 'fence_rejected']) {
      const declared = resultKind && (resultKind.const === forbidden || Array.isArray(resultKind.enum) && resultKind.enum.includes(forbidden));
      if (declared) findings.push(finding(
        'OUTCOME_VARIANT_IN_RESULT', 'Runtime Outcome variants must not appear as a business Result kind.', { entryId: entry.id, variant: forbidden }
      ));
    }
  }
  for (const name of nominalOutputs) {
    if (!registryNames.has(name)) findings.push(finding('MISSING_CATALOG_RESULT_TYPE', 'Catalog nominal Result is absent.', { entryId: name }));
  }
  for (const helper of ['OnDeckCommitReceipt', 'OffloadCompletionFact', 'PeopleCandidateDraft', 'PrimaryInputManifest']) {
    if (!registryNames.has(helper)) findings.push(finding('MISSING_RESULT_HELPER_TYPE', 'SSOT Result helper is absent.', { entryId: helper }));
  }

  return {
    ok: findings.length === 0,
    catalogResultCount: nominalOutputs.size + directOutputs.size,
    nominalResultCount: nominalOutputs.size,
    directResultCount: directOutputs.size,
    helperCount: 4,
    registryDigest: schemaDigest(registry),
    findings
  };
}

module.exports = Object.freeze({ validateResultTypeSchemas });
