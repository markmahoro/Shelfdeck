'use strict';

const fs = require('fs');
const path = require('path');

const EXEMPTION_PURPOSES = new Set(['rule-definition', 'negative-fixture', 'evidence-locator']);

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function finding(code, message, details = {}) {
  return { code, message, ...details };
}

function readPolicy(policyPath, findings) {
  try {
    return JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  } catch (error) {
    findings.push(finding('INVALID_SEMANTIC_POLICY', `Cannot read semantic policy: ${error.message}`, {
      file: normalizePath(policyPath)
    }));
    return null;
  }
}

function walkFiles(rootPath, findings) {
  const files = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      findings.push(finding('UNREADABLE_PATH', `Cannot inspect clean root: ${error.message}`, {
        file: normalizePath(current)
      }));
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        findings.push(finding('SYMLINK_NOT_ALLOWED', 'Clean semantic scan does not follow symbolic links.', {
          file: normalizePath(absolute)
        }));
      } else if (entry.isDirectory()) {
        pending.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  return files.sort();
}

function isBoundedRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) return false;
  const normalized = normalizePath(path.normalize(relativePath));
  return normalized !== '..' && !normalized.startsWith('../');
}

function validatePolicy(policy, policyPath, rootPath, findings) {
  if (!policy) return null;
  if (
    policy.schemaVersion !== 1 ||
    policy.defaultDecision !== 'deny' ||
    !Array.isArray(policy.scanExtensions) || policy.scanExtensions.length === 0 ||
    !Array.isArray(policy.rules) || policy.rules.length === 0 ||
    !Array.isArray(policy.exemptions)
  ) {
    findings.push(finding(
      'INVALID_SEMANTIC_POLICY',
      'Semantic policy requires schemaVersion 1, default deny, scan extensions, rules, and exemptions.',
      { file: normalizePath(policyPath) }
    ));
    return null;
  }

  const ruleIds = new Set();
  const compiledRules = [];
  for (const rule of policy.rules) {
    if (
      !rule || typeof rule.id !== 'string' || rule.id.length === 0 || ruleIds.has(rule.id) ||
      typeof rule.pattern !== 'string' || rule.pattern.length === 0 ||
      !['', 'i', 'u', 'iu'].includes(rule.flags || '') ||
      !Array.isArray(rule.ssotRefs) || rule.ssotRefs.length === 0 ||
      typeof rule.rationale !== 'string' || rule.rationale.length === 0
    ) {
      findings.push(finding('INVALID_SEMANTIC_RULE', 'Semantic rules require unique IDs, bounded flags, SSOT refs, and rationale.', {
        file: normalizePath(policyPath),
        ruleId: rule && rule.id
      }));
      continue;
    }
    ruleIds.add(rule.id);
    try {
      const expression = new RegExp(rule.pattern, `${rule.flags || ''}g`);
      expression.lastIndex = 0;
      if (expression.test('')) throw new Error('pattern may match an empty string');
      compiledRules.push({ ...rule, expression });
    } catch (error) {
      findings.push(finding('INVALID_SEMANTIC_RULE', `Cannot compile semantic rule: ${error.message}`, {
        file: normalizePath(policyPath), ruleId: rule.id
      }));
    }
  }

  const exemptionsByPath = new Map();
  const exemptionIds = new Set();
  for (const exemption of policy.exemptions) {
    const valid = exemption &&
      typeof exemption.id === 'string' && exemption.id.length > 0 && !exemptionIds.has(exemption.id) &&
      isBoundedRelativePath(exemption.relativePath) &&
      EXEMPTION_PURPOSES.has(exemption.purpose) &&
      Array.isArray(exemption.allowedLocationTypes) && exemption.allowedLocationTypes.length > 0 &&
      exemption.allowedLocationTypes.every((value) => value === 'path' || value === 'content') &&
      Array.isArray(exemption.allowedRuleIds) && exemption.allowedRuleIds.length > 0 &&
      !exemption.allowedRuleIds.includes('*') &&
      exemption.allowedRuleIds.every((ruleId) => ruleIds.has(ruleId));
    if (!valid) {
      findings.push(finding('INVALID_SEMANTIC_EXEMPTION', 'Exemptions require an exact path, known rule IDs, and a bounded purpose.', {
        file: normalizePath(policyPath), exemptionId: exemption && exemption.id
      }));
      continue;
    }

    exemptionIds.add(exemption.id);
    const relativePath = normalizePath(path.normalize(exemption.relativePath));
    const absolutePath = path.resolve(rootPath, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      findings.push(finding('UNRESOLVED_SEMANTIC_EXEMPTION', 'Exemption target must be an existing exact file.', {
        file: normalizePath(policyPath), exemptionId: exemption.id, relativePath
      }));
      continue;
    }
    const existing = exemptionsByPath.get(relativePath) || new Map();
    for (const ruleId of exemption.allowedRuleIds) {
      const locationTypes = existing.get(ruleId) || new Set();
      for (const locationType of exemption.allowedLocationTypes) locationTypes.add(locationType);
      existing.set(ruleId, locationTypes);
    }
    exemptionsByPath.set(relativePath, existing);
  }

  const extensions = new Set();
  for (const extension of policy.scanExtensions) {
    if (typeof extension !== 'string' || !/^\.[a-z0-9]+$/i.test(extension)) {
      findings.push(finding('INVALID_SCAN_EXTENSION', 'Scan extensions must be explicit file extensions.', {
        file: normalizePath(policyPath), extension
      }));
    } else {
      extensions.add(extension.toLowerCase());
    }
  }

  return { compiledRules, exemptionsByPath, extensions };
}

function lineAndColumn(content, offset) {
  const before = content.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function scanValue(value, locationType, relativePath, rules, exemptions, findings) {
  for (const rule of rules) {
    rule.expression.lastIndex = 0;
    let match;
    while ((match = rule.expression.exec(value)) !== null) {
      const exemptLocations = exemptions.get(rule.id) || new Set();
      if (!exemptLocations.has(locationType)) {
        const position = lineAndColumn(value, match.index);
        findings.push(finding('FORBIDDEN_LEGACY_SEMANTIC', rule.rationale, {
          file: relativePath,
          locationType,
          ruleId: rule.id,
          match: match[0],
          line: locationType === 'content' ? position.line : undefined,
          column: locationType === 'content' ? position.column : undefined,
          ssotRefs: rule.ssotRefs
        }));
      }
      if (match[0].length === 0) rule.expression.lastIndex += 1;
    }
  }
}

function checkForbiddenSemantics(options) {
  const rootPath = path.resolve(options.rootPath);
  const policyPath = path.resolve(options.policyPath);
  const findings = [];
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return {
      ok: false,
      rootPath: normalizePath(rootPath),
      filesChecked: 0,
      exemptionsApplied: 0,
      findings: [finding('MISSING_CLEAN_ROOT', 'Clean Helix root does not exist.', { file: normalizePath(rootPath) })]
    };
  }

  const policy = readPolicy(policyPath, findings);
  const validated = validatePolicy(policy, policyPath, rootPath, findings);
  let filesChecked = 0;
  let exemptionsApplied = 0;

  if (validated) {
    const files = walkFiles(rootPath, findings);
    for (const filePath of files) {
      if (!validated.extensions.has(path.extname(filePath).toLowerCase())) continue;
      filesChecked += 1;
      const relativePath = normalizePath(path.relative(rootPath, filePath));
      const exemptions = validated.exemptionsByPath.get(relativePath) || new Map();
      exemptionsApplied += [...exemptions.values()].reduce((total, locations) => total + locations.size, 0);
      scanValue(relativePath, 'path', relativePath, validated.compiledRules, exemptions, findings);
      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch (error) {
        findings.push(finding('UNREADABLE_FILE', `Cannot read clean source: ${error.message}`, { file: relativePath }));
        continue;
      }
      scanValue(content, 'content', relativePath, validated.compiledRules, exemptions, findings);
    }
  }

  return {
    ok: findings.length === 0,
    rootPath: normalizePath(rootPath),
    filesChecked,
    exemptionsApplied,
    findings
  };
}

module.exports = Object.freeze({ checkForbiddenSemantics });
