'use strict';

const fs = require('fs');
const path = require('path');
const { extractSsotContracts } = require('./ssot-contract-extractor');
const { buildCapabilityPackages, digestValue } = require('./capability-contract-builder');

const REQUIRED_FILES = [
  'manifest.json', 'inputs.schema.json', 'parameters.schema.json', 'result.schema.json',
  'evidence.schema.json', 'failure.schema.json', 'fence.schema.json', 'resource-demand.schema.json'
];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_CAPABILITY_PACKAGE_JSON', `Cannot read contract file: ${error.message}`, { file: normalizePath(filePath) }));
    return null;
  }
}

function discoverFiles(rootPath) {
  const files = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files.sort();
}

function collectRefs(value, refs = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectRefs(item, refs));
  else if (value && typeof value === 'object') {
    if (typeof value.$ref === 'string' && value.$ref.startsWith('helix://')) refs.add(value.$ref);
    Object.values(value).forEach((item) => collectRefs(item, refs));
  }
  return refs;
}

function validateCapabilityContracts(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const contractsRoot = path.resolve(options.contractsRoot);
  const capabilitiesRoot = path.join(contractsRoot, 'capabilities');
  const configuredSsotPath = process.env.HELIX_SSOT_PATH;
  const ssotPath = configuredSsotPath && fs.existsSync(path.join(repositoryRoot, '.git'))
    ? configuredSsotPath : path.join(repositoryRoot, 'docs', 'helix', 'TOP_DOWN_ARCHITECTURE_CONFIRMATION.md');
  const findings = [];
  let extracted;
  try {
    extracted = extractSsotContracts(fs.readFileSync(ssotPath, 'utf8'));
  } catch (error) {
    return { ok: false, findings: [finding('SSOT_EXTRACTION_FAILED', error.message)] };
  }
  const expectedPackages = buildCapabilityPackages(extracted.capabilities);
  const packageResults = [];
  const referencedTypeRefs = new Set();
  const unresolvedTypeRefs = new Set();
  const knownTypeRefs = new Set();
  for (const registryName of ['shared-type-registry.json', 'result-type-registry.json', 'domain-input-type-registry.json']) {
    const registryPath = path.join(contractsRoot, registryName);
    const registry = fs.existsSync(registryPath) ? readJson(registryPath, findings) : null;
    if (!registry || !Array.isArray(registry.entries)) {
      findings.push(finding('MISSING_TYPE_REGISTRY', 'Capability graph requires every P2 type registry.', { file: normalizePath(registryPath) }));
      continue;
    }
    for (const entry of registry.entries) {
      if (!entry || typeof entry.schemaId !== 'string' || knownTypeRefs.has(entry.schemaId)) findings.push(finding(
        'DUPLICATE_TYPE_SCHEMA_ID', 'Type schema IDs must be unique across all registries.', { schemaId: entry && entry.schemaId }
      ));
      else knownTypeRefs.add(entry.schemaId);
    }
  }

  const allFiles = fs.existsSync(capabilitiesRoot) ? discoverFiles(capabilitiesRoot) : [];
  for (const filePath of allFiles) {
    if (!filePath.endsWith('.json')) findings.push(finding('CAPABILITY_PACKAGE_NON_CONTRACT_FILE', 'Capability package may contain JSON contracts only in P2.', {
      file: normalizePath(filePath)
    }));
  }

  const actualManifestPaths = new Set(allFiles.filter((filePath) => path.basename(filePath) === 'manifest.json').map((filePath) => path.resolve(filePath)));
  if (actualManifestPaths.size !== 111) findings.push(finding('CAPABILITY_PACKAGE_COUNT_MISMATCH', 'Exactly 111 Capability packages are required.', {
    actualCount: actualManifestPaths.size, targetCount: 111
  }));

  for (const expected of expectedPackages) {
    const packagePath = path.join(contractsRoot, expected.relativePath);
    const expectedPaths = new Set(REQUIRED_FILES.map((name) => path.resolve(packagePath, name)));
    const actualFiles = fs.existsSync(packagePath)
      ? fs.readdirSync(packagePath, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.resolve(packagePath, entry.name))
      : [];
    for (const requiredPath of expectedPaths) {
      if (!actualFiles.includes(requiredPath)) findings.push(finding('MISSING_CAPABILITY_CONTRACT_FILE', 'Capability package is missing a required file.', {
        capabilityRef: expected.capabilityRef, file: normalizePath(requiredPath)
      }));
    }
    for (const actualPath of actualFiles) {
      if (!expectedPaths.has(actualPath)) findings.push(finding('UNEXPECTED_CAPABILITY_CONTRACT_FILE', 'Capability package contains an undeclared file.', {
        capabilityRef: expected.capabilityRef, file: normalizePath(actualPath)
      }));
    }

    const committed = {};
    for (const fileName of REQUIRED_FILES) {
      const filePath = path.join(packagePath, fileName);
      if (fs.existsSync(filePath)) committed[fileName] = readJson(filePath, findings);
    }
    if (Object.keys(committed).length !== REQUIRED_FILES.length || Object.values(committed).some((value) => value === null)) continue;

    const committedDigest = digestValue(committed);
    if (committedDigest !== expected.packageDigest) findings.push(finding('CAPABILITY_PACKAGE_CONTRACT_DRIFT', 'Committed package differs from SSOT-derived contract.', {
      capabilityRef: expected.capabilityRef, expectedDigest: expected.packageDigest, actualDigest: committedDigest
    }));
    const manifest = committed['manifest.json'];
    if (manifest.capabilityRef !== expected.capabilityRef || manifest.contractVersion !== 1 ||
        manifest.effectClass !== expected.files['manifest.json'].effectClass || manifest.ownerScope !== expected.files['manifest.json'].ownerScope) {
      findings.push(finding('CAPABILITY_MANIFEST_IDENTITY_MISMATCH', 'Capability identity, version, Owner, or Effect Class differs from SSOT.', {
        capabilityRef: expected.capabilityRef
      }));
    }
    for (const [fileName, value] of Object.entries(committed)) {
      if (fileName === 'manifest.json') continue;
      if (value.$schema !== 'https://json-schema.org/draft/2020-12/schema' || typeof value.$id !== 'string') {
        findings.push(finding('INVALID_CAPABILITY_SCHEMA_IDENTITY', 'Capability schemas require JSON Schema 2020-12 and stable $id.', {
          capabilityRef: expected.capabilityRef, file: fileName
        }));
      }
      for (const ref of collectRefs(value)) {
        if (ref.startsWith('helix://contracts/domain-types/') || ref.startsWith('helix://contracts/types/')) {
          referencedTypeRefs.add(ref);
          if (!knownTypeRefs.has(ref)) {
            unresolvedTypeRefs.add(ref);
            findings.push(finding('UNRESOLVED_CAPABILITY_TYPE_REF', 'Capability schema has an unresolved type $ref.', {
              capabilityRef: expected.capabilityRef, file: fileName, ref
            }));
          }
        }
      }
    }
    packageResults.push({
      capabilityRef: expected.capabilityRef,
      relativePath: expected.relativePath,
      effectClass: manifest.effectClass,
      ownerScope: manifest.ownerScope,
      packageDigest: committedDigest
    });
  }

  const expectedManifestPaths = new Set(expectedPackages.map((item) => path.resolve(contractsRoot, item.relativePath, 'manifest.json')));
  for (const actualPath of actualManifestPaths) {
    if (!expectedManifestPaths.has(actualPath)) findings.push(finding('UNREGISTERED_CAPABILITY_PACKAGE', 'Catalog-external Capability package is not allowed.', {
      file: normalizePath(actualPath)
    }));
  }

  return {
    ok: findings.length === 0,
    packageCount: packageResults.length,
    packageAggregateDigest: digestValue(packageResults),
    referencedTypeRefCount: referencedTypeRefs.size,
    unresolvedTypeRefCount: unresolvedTypeRefs.size,
    unresolvedTypeRefs: [...unresolvedTypeRefs].sort(),
    findings
  };
}

module.exports = Object.freeze({ REQUIRED_FILES, validateCapabilityContracts });
