'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INVENTORY_STATUSES = Object.freeze({
  'capability-inventory': new Set(['planned', 'contracted', 'implemented', 'verified']),
  'result-family-inventory': new Set(['planned', 'contracted', 'implemented', 'verified']),
  'table-inventory': new Set(['planned', 'contracted', 'implemented', 'verified']),
  'route-inventory': new Set(['planned', 'contracted', 'implemented', 'verified']),
  'transaction-inventory': new Set(['planned', 'contracted', 'implemented', 'verified']),
  'ui-surface-inventory': new Set(['planned', 'contracted', 'implemented', 'verified'])
});
const REUSE_STATUSES = new Set(['pending_function_audit', 'rejected', 'approved_for_extraction', 'extracted', 'verified']);
const REUSE_DISPOSITIONS = new Set(['retain_recontract', 'merge', 'split', 'remove_legacy_semantics']);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function isBoundedRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0 || path.isAbsolute(value)) return false;
  const normalized = normalizePath(path.normalize(value));
  return normalized !== '..' && !normalized.startsWith('../');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function canonicalDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function readJson(filePath, findings) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_MANIFEST_JSON', `Cannot read manifest: ${error.message}`, {
      file: normalizePath(filePath)
    }));
    return null;
  }
}

function hasStrings(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === 'string' && item.length > 0);
}

function validateEnvelope(manifest, expected, owners, filePath, findings) {
  if (!manifest) return false;
  const valid = manifest.schemaVersion === 1 &&
    Number.isInteger(manifest.manifestVersion) && manifest.manifestVersion > 0 &&
    manifest.manifestId === expected.manifestId && manifest.kind === expected.kind &&
    typeof manifest.owner === 'string' && owners.has(manifest.owner) &&
    hasStrings(manifest.ssotRefs) &&
    Number.isInteger(manifest.targetCount) && manifest.targetCount === expected.targetCount &&
    (Array.isArray(manifest.entries) || hasStrings(manifest.entryFiles)) &&
    (manifest.status === 'framework_only' || manifest.status === 'active');
  if (!valid) {
    findings.push(finding(
      'INVALID_MANIFEST_ENVELOPE',
      'Manifest identity, version, owner, SSOT refs, target count, status, or entries are invalid.',
      { file: normalizePath(filePath), manifestId: expected.manifestId }
    ));
    return false;
  }

  if (expected.targetSegments) {
    const segmentTotal = Object.values(expected.targetSegments).reduce((total, value) => total + value, 0);
    if (canonicalDigest(manifest.targetSegments) !== canonicalDigest(expected.targetSegments) || segmentTotal !== expected.targetCount) {
      findings.push(finding('INVALID_TARGET_SEGMENTS', 'Manifest target segments must match the registry and total.', {
        file: normalizePath(filePath), manifestId: manifest.manifestId
      }));
    }
  }
  if (!manifest.entryFiles && manifest.kind !== 'legacy-reuse-ledger' && (manifest.entries.length > manifest.targetCount || (manifest.status === 'active' && manifest.entries.length !== manifest.targetCount))) {
    findings.push(finding('MANIFEST_TARGET_COUNT_MISMATCH', 'Active manifests must reach their target; framework manifests cannot exceed it.', {
      file: normalizePath(filePath), manifestId: manifest.manifestId,
      actualCount: manifest.entries.length, targetCount: manifest.targetCount
    }));
  }
  return true;
}

function validateInventoryEntries(manifest, owners, filePath, findings) {
  const allowedStatuses = INVENTORY_STATUSES[manifest.kind];
  const ids = new Set();
  for (const entry of manifest.entries) {
    const contractDigest = entry && entry.contractDigest;
    const valid = entry && typeof entry.id === 'string' && entry.id.length > 0 && !ids.has(entry.id) &&
      Number.isInteger(entry.version) && entry.version > 0 && owners.has(entry.owner) &&
      allowedStatuses && allowedStatuses.has(entry.status) && hasStrings(entry.ssotRefs) &&
      entry.sourceLocator && entry.targetLocator && entry.contract &&
      contractDigest && contractDigest.algorithm === 'sha256' && /^[a-f0-9]{64}$/.test(contractDigest.value || '');
    if (!valid) {
      findings.push(finding('INVALID_INVENTORY_ENTRY', 'Inventory entries require stable ID/version, resolved owner, legal status, locators, contract, and digest.', {
        file: normalizePath(filePath), manifestId: manifest.manifestId, entryId: entry && entry.id
      }));
      continue;
    }
    ids.add(entry.id);
    if (canonicalDigest(entry.contract) !== contractDigest.value) {
      findings.push(finding('INVENTORY_CONTRACT_DIGEST_MISMATCH', 'Entry contract digest does not match canonical content.', {
        file: normalizePath(filePath), manifestId: manifest.manifestId, entryId: entry.id
      }));
    }
  }
}

function readBaselineSource(repositoryRoot, locator, findings, entryId) {
  if (!isBoundedRelativePath(locator.path) || !/^[a-f0-9]{40}$/.test(locator.baselineCommit || '')) {
    findings.push(finding('INVALID_REUSE_SOURCE_LOCATOR', 'Reuse source locator requires an exact baseline commit and bounded repository path.', { entryId }));
    return null;
  }
  try {
    return childProcess.execFileSync(
      'git',
      ['show', `${locator.baselineCommit}:${normalizePath(locator.path)}`],
      { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    findings.push(finding('UNRESOLVED_REUSE_SOURCE', 'Cannot resolve reuse source from the recorded baseline.', {
      entryId, path: locator.path, baselineCommit: locator.baselineCommit
    }));
    return null;
  }
}

function validateAssessment(template, entryId, findings) {
  const valid = template && template.typedInput && template.typedOutput &&
    typeof template.effectClass === 'string' && typeof template.fence === 'string' &&
    typeof template.resourceDemand === 'string' && typeof template.idempotency === 'string' &&
    typeof template.crashWindow === 'string' && template.testEvidence &&
    typeof template.reuseAuthorization === 'string';
  if (!valid) findings.push(finding('INVALID_REUSE_ASSESSMENT', 'Reuse assessment must cover typed I/O, Effect, Fence, Resource, idempotency, crash window, tests, and authorization.', { entryId }));
  return valid;
}

function validateReuseLedger(manifest, owners, repositoryRoot, filePath, findings) {
  if (!manifest.assessmentTemplates || typeof manifest.assessmentTemplates !== 'object') {
    findings.push(finding('INVALID_REUSE_LEDGER', 'Reuse ledger requires assessment templates.', { file: normalizePath(filePath) }));
    return;
  }
  const ids = new Set();
  const refs = new Set();
  const dispositionCounts = Object.fromEntries([...REUSE_DISPOSITIONS].map((value) => [value, 0]));
  for (const entry of manifest.entries) {
    const valid = entry && typeof entry.id === 'string' && entry.id.length > 0 && !ids.has(entry.id) &&
      Number.isInteger(entry.version) && entry.version > 0 && owners.has(entry.owner) &&
      REUSE_STATUSES.has(entry.status) && hasStrings(entry.ssotRefs) &&
      typeof entry.historicalCapabilityRef === 'string' && entry.historicalCapabilityRef.length > 0 && !refs.has(entry.historicalCapabilityRef) &&
      REUSE_DISPOSITIONS.has(entry.architectureDisposition) &&
      entry.sourceLocator && entry.sourceDigest && entry.sourceDigest.algorithm === 'sha256' &&
      /^[a-f0-9]{64}$/.test(entry.sourceDigest.value || '') && entry.targetLocator &&
      typeof entry.assessmentRef === 'string' && entry.wholeExecutorReuseAuthorized === false;
    if (!valid) {
      findings.push(finding('INVALID_REUSE_ENTRY', 'Reuse entries require unique IDs/refs, version, resolved record owner, legal status/disposition, locators, source digest, assessment, and whole-executor denial.', {
        file: normalizePath(filePath), entryId: entry && entry.id
      }));
      continue;
    }
    ids.add(entry.id);
    refs.add(entry.historicalCapabilityRef);
    dispositionCounts[entry.architectureDisposition] += 1;
    const assessment = manifest.assessmentTemplates[entry.assessmentRef];
    validateAssessment(assessment, entry.id, findings);

    if (entry.sourceLocator.baselineCommit !== manifest.baselineCommit) {
      findings.push(finding('REUSE_BASELINE_MISMATCH', 'Every reuse locator must use the ledger baseline commit.', { entryId: entry.id }));
    }
    const source = readBaselineSource(repositoryRoot, entry.sourceLocator, findings, entry.id);
    if (source !== null) {
      const digest = crypto.createHash('sha256').update(source).digest('hex');
      const line = source.split(/\r?\n/)[entry.sourceLocator.line - 1] || '';
      if (digest !== entry.sourceDigest.value || !line.includes(entry.sourceLocator.token) || entry.sourceLocator.token !== entry.historicalCapabilityRef) {
        findings.push(finding('REUSE_SOURCE_EVIDENCE_MISMATCH', 'Baseline source digest, line token, and historical ref must agree.', {
          entryId: entry.id, path: entry.sourceLocator.path
        }));
      }
    }

    const pending = entry.status === 'pending_function_audit';
    if (pending) {
      if (entry.targetLocator.status !== 'unassigned' || !assessment || assessment.reuseAuthorization !== 'not_authorized') {
        findings.push(finding('PENDING_REUSE_PREMATURELY_AUTHORIZED', 'Pending historical registrations must remain unassigned and unauthorized.', { entryId: entry.id }));
      }
    } else if (entry.status !== 'rejected') {
      if (!owners.has(entry.targetLocator.owner) || !isBoundedRelativePath(entry.targetLocator.path) || !assessment || assessment.reuseAuthorization !== 'authorized') {
        findings.push(finding('UNRESOLVED_REUSE_TARGET', 'Approved reuse requires a resolved clean owner, bounded target, and explicit authorization.', { entryId: entry.id }));
      }
    }
  }
  if (canonicalDigest(dispositionCounts) !== canonicalDigest(manifest.dispositionTargets)) {
    findings.push(finding('REUSE_DISPOSITION_COUNT_MISMATCH', 'Reuse disposition totals must match the accepted conservation audit.', {
      actual: dispositionCounts, target: manifest.dispositionTargets
    }));
  }
}

function loadReuseEntries(manifest, manifestDirectory, findings) {
  const entries = [];
  const paths = new Set();
  for (const relativePath of manifest.entryFiles || []) {
    if (!isBoundedRelativePath(relativePath) || paths.has(relativePath)) {
      findings.push(finding('INVALID_REUSE_ENTRY_FILE', 'Reuse entry files must be unique bounded paths.', { relativePath }));
      continue;
    }
    paths.add(relativePath);
    const filePath = path.join(manifestDirectory, relativePath);
    const shard = readJson(filePath, findings);
    if (!shard || shard.schemaVersion !== 1 || shard.ledgerId !== manifest.manifestId || !Array.isArray(shard.entries)) {
      findings.push(finding('INVALID_REUSE_ENTRY_FILE', 'Reuse entry shard must identify its ledger and contain entries.', {
        file: normalizePath(filePath)
      }));
      continue;
    }
    entries.push(...shard.entries);
  }
  return entries;
}

function loadInventoryEntries(manifest, manifestDirectory, findings) {
  if (!manifest.entryFiles) return manifest.entries || [];
  const entries = [];
  const paths = new Set();
  for (const relativePath of manifest.entryFiles) {
    if (!isBoundedRelativePath(relativePath) || paths.has(relativePath)) {
      findings.push(finding('INVALID_INVENTORY_ENTRY_FILE', 'Inventory entry files must be unique bounded paths.', {
        manifestId: manifest.manifestId, relativePath
      }));
      continue;
    }
    paths.add(relativePath);
    const filePath = path.join(manifestDirectory, relativePath);
    const shard = readJson(filePath, findings);
    if (!shard || shard.schemaVersion !== 1 || shard.manifestId !== manifest.manifestId || !Array.isArray(shard.entries)) {
      findings.push(finding('INVALID_INVENTORY_ENTRY_FILE', 'Inventory shard must identify its manifest and contain entries.', {
        file: normalizePath(filePath), manifestId: manifest.manifestId
      }));
      continue;
    }
    entries.push(...shard.entries);
  }
  return entries;
}

function discoverPackageMarkers(rootPath) {
  const markers = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name === 'package.boundary.json') markers.push(absolute);
    }
  }
  return markers.sort();
}

function discoverJsonFiles(rootPath) {
  const files = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.json')) files.push(absolute);
    }
  }
  return files.sort();
}

function validateManifestSet(options) {
  const rootPath = path.resolve(options.rootPath);
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const manifestDirectory = path.join(rootPath, 'contracts', 'manifests');
  const findings = [];
  const ownerPath = path.join(manifestDirectory, 'owner-registry.json');
  const registryPath = path.join(manifestDirectory, 'manifest-registry.json');
  const ownerRegistry = readJson(ownerPath, findings);
  const registry = readJson(registryPath, findings);

  const owners = new Set();
  if (!ownerRegistry || ownerRegistry.schemaVersion !== 1 || ownerRegistry.kind !== 'owner-registry' || !Array.isArray(ownerRegistry.owners)) {
    findings.push(finding('INVALID_OWNER_REGISTRY', 'Owner registry is missing or invalid.', { file: normalizePath(ownerPath) }));
  } else {
    for (const owner of ownerRegistry.owners) {
      if (!owner || typeof owner.id !== 'string' || owners.has(owner.id) || !['business-domain', 'engineering'].includes(owner.class)) {
        findings.push(finding('INVALID_OWNER', 'Owner IDs must be unique and classified.', { file: normalizePath(ownerPath), ownerId: owner && owner.id }));
      } else owners.add(owner.id);
    }
    if (!owners.has(ownerRegistry.owner)) findings.push(finding('UNRESOLVED_MANIFEST_OWNER', 'Owner registry owner must resolve within itself.', { file: normalizePath(ownerPath) }));
  }

  const manifestResults = [];
  if (!registry || registry.schemaVersion !== 1 || registry.kind !== 'manifest-registry' || !Array.isArray(registry.manifests) || !owners.has(registry.owner)) {
    findings.push(finding('INVALID_MANIFEST_REGISTRY', 'Manifest registry is missing, malformed, or has an unresolved owner.', { file: normalizePath(registryPath) }));
  } else {
    const manifestIds = new Set();
    const manifestPaths = new Set();
    for (const expected of registry.manifests) {
      if (!expected || typeof expected.manifestId !== 'string' || manifestIds.has(expected.manifestId) ||
        !isBoundedRelativePath(expected.relativePath) || manifestPaths.has(expected.relativePath) ||
        !Number.isInteger(expected.targetCount) || expected.targetCount < 0) {
        findings.push(finding('INVALID_MANIFEST_REGISTRATION', 'Manifest registrations require unique IDs/paths and non-negative target counts.', {
          file: normalizePath(registryPath), manifestId: expected && expected.manifestId
        }));
        continue;
      }
      manifestIds.add(expected.manifestId);
      manifestPaths.add(expected.relativePath);
      const filePath = path.join(manifestDirectory, expected.relativePath);
      const manifest = readJson(filePath, findings);
      if (!validateEnvelope(manifest, expected, owners, filePath, findings)) continue;
      let entries = manifest.entries || [];
      if (manifest.kind === 'legacy-reuse-ledger') {
        entries = loadReuseEntries(manifest, manifestDirectory, findings);
        if (entries.length !== manifest.targetCount) findings.push(finding('MANIFEST_TARGET_COUNT_MISMATCH', 'Active reuse ledger must reach its target count.', {
          file: normalizePath(filePath), actualCount: entries.length, targetCount: manifest.targetCount
        }));
        validateReuseLedger({ ...manifest, entries }, owners, repositoryRoot, filePath, findings);
      } else {
        entries = loadInventoryEntries(manifest, manifestDirectory, findings);
        if (entries.length > manifest.targetCount || (manifest.status === 'active' && entries.length !== manifest.targetCount)) {
          findings.push(finding('MANIFEST_TARGET_COUNT_MISMATCH', 'Active inventory must reach its target count.', {
            file: normalizePath(filePath), manifestId: manifest.manifestId, actualCount: entries.length, targetCount: manifest.targetCount
          }));
        }
        validateInventoryEntries({ ...manifest, entries }, owners, filePath, findings);
      }
      manifestResults.push({
        manifestId: manifest.manifestId,
        status: manifest.status,
        entryCount: entries.length,
        targetCount: manifest.targetCount,
        digest: canonicalDigest(manifest.entryFiles || manifest.kind === 'legacy-reuse-ledger' ? { manifest, entries } : manifest)
      });
    }
  }

  const packageMarkers = discoverPackageMarkers(rootPath);
  const packageIds = new Set();
  for (const markerPath of packageMarkers) {
    const marker = readJson(markerPath, findings);
    if (!marker || marker.schemaVersion !== 1 || typeof marker.packageId !== 'string' || packageIds.has(marker.packageId) || !owners.has(marker.owner)) {
      findings.push(finding('INVALID_PACKAGE_MANIFEST', 'Package markers require unique IDs and resolved owners.', { file: normalizePath(markerPath) }));
    } else packageIds.add(marker.packageId);
  }
  const packageTarget = registry && registry.distributedTargets && registry.distributedTargets.packageBoundaries;
  if (packageMarkers.length !== packageTarget) {
    findings.push(finding('PACKAGE_TARGET_COUNT_MISMATCH', 'Distributed package boundary count must match the registry target.', {
      actualCount: packageMarkers.length, targetCount: packageTarget
    }));
  }

  const digestRecords = [];
  if (fs.existsSync(manifestDirectory)) {
    for (const filePath of discoverJsonFiles(manifestDirectory)) {
      const value = readJson(filePath, findings);
      if (value) digestRecords.push({ path: normalizePath(path.relative(manifestDirectory, filePath)), digest: canonicalDigest(value) });
    }
  }
  for (const markerPath of packageMarkers) {
    const value = readJson(markerPath, findings);
    if (value) digestRecords.push({ path: normalizePath(path.relative(rootPath, markerPath)), digest: canonicalDigest(value) });
  }

  return {
    ok: findings.length === 0,
    rootPath: normalizePath(rootPath),
    ownerCount: owners.size,
    packageCount: packageMarkers.length,
    manifests: manifestResults,
    aggregateDigest: canonicalDigest(digestRecords.sort((a, b) => a.path.localeCompare(b.path))),
    findings
  };
}

module.exports = Object.freeze({ canonicalDigest, validateManifestSet });
