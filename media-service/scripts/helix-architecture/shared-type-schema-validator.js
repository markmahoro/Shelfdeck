'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildSharedTypeSchemas,
  schemaDigest
} = require('./shared-type-schema-builder');

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function boundedRelative(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) return false;
  const normalized = normalizePath(path.normalize(value));
  return normalized !== '..' && !normalized.startsWith('../');
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_SHARED_SCHEMA_JSON', `Cannot read JSON: ${error.message}`, { file: normalizePath(filePath) }));
    return null;
  }
}

function validateSchemaNode(node, schemaId, registryIds, findings, location = '#') {
  if (!node || typeof node !== 'object') return;
  if (node.$ref) {
    if (!registryIds.has(node.$ref)) findings.push(finding('UNRESOLVED_SHARED_TYPE_REF', 'Shared type schema has an unresolved $ref.', {
      schemaId, ref: node.$ref, location
    }));
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) findings.push(finding('OPEN_OBJECT_SCHEMA', 'Every object schema must deny undeclared properties.', {
      schemaId, location
    }));
    const properties = node.properties || {};
    for (const required of node.required || []) {
      if (!Object.prototype.hasOwnProperty.call(properties, required)) {
        findings.push(finding('UNKNOWN_REQUIRED_PROPERTY', 'Required property is not declared.', { schemaId, location, property: required }));
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'x-helix-requires-bound-schema') continue;
    if (Array.isArray(value)) value.forEach((item, index) => validateSchemaNode(item, schemaId, registryIds, findings, `${location}/${key}/${index}`));
    else if (value && typeof value === 'object') validateSchemaNode(value, schemaId, registryIds, findings, `${location}/${key}`);
  }
}

function validateExecutionContext(schema, findings) {
  const forbidden = new Set(['task', 'config', 'repository', 'store', 'facade', 'planner', 'runtime', 'governor']);
  const properties = schema && schema.properties || {};
  for (const name of Object.keys(properties)) {
    if (forbidden.has(name.toLowerCase())) findings.push(finding(
      'FORBIDDEN_EXECUTION_CONTEXT_FIELD',
      'CapabilityExecutionContext contains a forbidden authority or legacy payload field.',
      { property: name }
    ));
  }
}

function validateSharedTypeSchemas(options) {
  const contractsRoot = path.resolve(options.contractsRoot);
  const registryPath = path.resolve(options.registryPath || path.join(contractsRoot, 'shared-type-registry.json'));
  const findings = [];
  const registry = readJson(registryPath, findings);
  const expected = buildSharedTypeSchemas();
  if (!registry) return { ok: false, findings };

  if (
    registry.schemaVersion !== 1 || registry.manifestVersion !== 1 || registry.manifestId !== 'helix.shared-type-registry' ||
    registry.kind !== 'shared-type-registry' || registry.owner !== 'contracts' || registry.status !== 'active' ||
    registry.targetCount !== 29 || !Array.isArray(registry.entries) || registry.entries.length !== 29
  ) {
    findings.push(finding('INVALID_SHARED_TYPE_REGISTRY', 'Shared type registry envelope or target count is invalid.', {
      file: normalizePath(registryPath)
    }));
  }

  const entryIds = new Set();
  const schemaIds = new Set();
  const domainRegistry = readJson(path.join(contractsRoot, 'domain-input-type-registry.json'), findings);
  for (const entry of domainRegistry?.entries || []) schemaIds.add(entry.schemaId);
  const paths = new Set();
  for (const entry of registry.entries || []) {
    const valid = entry && typeof entry.id === 'string' && !entryIds.has(entry.id) &&
      entry.version === 1 && ['shared-nominal-handle', 'common-envelope', 'execution-context', 'outcome-envelope'].includes(entry.role) &&
      typeof entry.schemaId === 'string' && !schemaIds.has(entry.schemaId) && boundedRelative(entry.relativePath) && !paths.has(entry.relativePath) &&
      entry.digest && entry.digest.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(entry.digest.value || '') &&
      Array.isArray(entry.ssotRefs) && entry.ssotRefs.length > 0;
    if (!valid) {
      findings.push(finding('INVALID_SHARED_TYPE_ENTRY', 'Shared type entries require unique IDs/schema IDs/paths, role, digest, and SSOT refs.', {
        entryId: entry && entry.id
      }));
      continue;
    }
    entryIds.add(entry.id);
    schemaIds.add(entry.schemaId);
    paths.add(entry.relativePath);
  }

  for (const entry of registry.entries || []) {
    if (!entry || !boundedRelative(entry.relativePath)) continue;
    const schemaPath = path.resolve(contractsRoot, entry.relativePath);
    const schema = readJson(schemaPath, findings);
    if (!schema) continue;
    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema' || schema.$id !== entry.schemaId || schema.$id !== `helix://contracts/types/${entry.id}/v1`) {
      findings.push(finding('INVALID_SHARED_SCHEMA_IDENTITY', 'Shared schema draft, $id, and registry identity must agree.', {
        file: normalizePath(schemaPath), entryId: entry.id
      }));
    }
    if (schemaDigest(schema) !== entry.digest.value) findings.push(finding('SHARED_SCHEMA_DIGEST_MISMATCH', 'Shared schema digest differs from registry.', {
      entryId: entry.id
    }));
    if (!expected[entry.id] || schemaDigest(schema) !== schemaDigest(expected[entry.id])) findings.push(finding(
      'SHARED_SCHEMA_CONTRACT_DRIFT',
      'Committed shared schema differs from the SSOT-derived contract builder.',
      { entryId: entry.id }
    ));
    validateSchemaNode(schema, schema.$id, schemaIds, findings);
    if (entry.role === 'shared-nominal-handle') {
      const required = new Set(schema.required || []);
      if (!required.has('schemaRef') || !required.has('schemaVersion')) findings.push(finding(
        'MISSING_NOMINAL_SCHEMA_IDENTITY',
        'Shared nominal handle values require schemaRef and schemaVersion.',
        { entryId: entry.id }
      ));
    }
    if (entry.id === 'CapabilityExecutionContext') validateExecutionContext(schema, findings);
  }

  for (const name of Object.keys(expected)) {
    if (!entryIds.has(name)) findings.push(finding('MISSING_SHARED_TYPE', 'SSOT-derived shared type is absent from registry.', { entryId: name }));
  }

  return {
    ok: findings.length === 0,
    contractsRoot: normalizePath(contractsRoot),
    typeCount: entryIds.size,
    registryDigest: schemaDigest(registry),
    findings
  };
}

module.exports = Object.freeze({ validateSharedTypeSchemas });
