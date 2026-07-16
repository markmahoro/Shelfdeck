'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs']);
const RESOLUTION_EXTENSIONS = ['', '.js', '.cjs', '.json'];

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function isInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function createFinding(code, message, details = {}) {
  return { code, message, ...details };
}

function readJson(filePath, findings, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    findings.push(createFinding(
      'INVALID_JSON',
      `Cannot read ${label}: ${error.message}`,
      { file: normalizePath(filePath) }
    ));
    return null;
  }
}

function walk(rootPath, findings) {
  const files = [];
  const directories = [rootPath];

  while (directories.length > 0) {
    const current = directories.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      findings.push(createFinding(
        'UNREADABLE_PATH',
        `Cannot inspect clean root path: ${error.message}`,
        { file: normalizePath(current) }
      ));
      continue;
    }

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        findings.push(createFinding(
          'SYMLINK_NOT_ALLOWED',
          'Clean Helix packages cannot contain symbolic links.',
          { file: normalizePath(absolute) }
        ));
      } else if (entry.isDirectory()) {
        directories.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }

  return files.sort();
}

function discoverPackages(rootPath, files, findings) {
  const byDirectory = new Map();
  const byId = new Map();

  for (const markerPath of files.filter((file) => path.basename(file) === 'package.boundary.json')) {
    const descriptor = readJson(markerPath, findings, 'package boundary descriptor');
    if (!descriptor) continue;

    if (
      descriptor.schemaVersion !== 1 ||
      typeof descriptor.packageId !== 'string' || descriptor.packageId.length === 0 ||
      typeof descriptor.layer !== 'string' || descriptor.layer.length === 0 ||
      typeof descriptor.owner !== 'string' || descriptor.owner.length === 0
    ) {
      findings.push(createFinding(
        'INVALID_PACKAGE_DESCRIPTOR',
        'Package descriptor requires schemaVersion 1 plus non-empty packageId, layer, and owner.',
        { file: normalizePath(markerPath) }
      ));
      continue;
    }

    if (byId.has(descriptor.packageId)) {
      findings.push(createFinding(
        'DUPLICATE_PACKAGE_ID',
        `Duplicate packageId ${descriptor.packageId}.`,
        { file: normalizePath(markerPath), firstFile: normalizePath(byId.get(descriptor.packageId).markerPath) }
      ));
      continue;
    }

    const packageInfo = {
      ...descriptor,
      directory: path.dirname(markerPath),
      markerPath
    };
    byDirectory.set(packageInfo.directory, packageInfo);
    byId.set(packageInfo.packageId, packageInfo);
  }

  if (!byDirectory.has(rootPath)) {
    findings.push(createFinding(
      'MISSING_ROOT_PACKAGE',
      'The clean root must contain package.boundary.json.',
      { file: normalizePath(rootPath) }
    ));
  }

  return { byDirectory, byId };
}

function classifyFile(filePath, rootPath, packages) {
  let current = path.dirname(filePath);
  while (isInside(rootPath, current)) {
    if (packages.byDirectory.has(current)) return packages.byDirectory.get(current);
    if (current === rootPath) break;
    current = path.dirname(current);
  }
  return null;
}

function skipQuoted(source, start, quote) {
  let index = start + 1;
  let hasInterpolation = false;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && source[index] === '$' && source[index + 1] === '{') {
      hasInterpolation = true;
    }
    if (source[index] === quote) {
      return { end: index + 1, closed: true, hasInterpolation };
    }
    index += 1;
  }
  return { end: source.length, closed: false, hasInterpolation };
}

function skipTrivia(source, start) {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      return end === -1 ? source.length : skipTrivia(source, end + 2);
    }
    break;
  }
  return index;
}

function parseStringLiteral(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') return null;

  let value = '';
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character === '\n' || character === '\r') return null;
    if (character !== '\\') {
      value += character;
      index += 1;
      continue;
    }

    index += 1;
    if (index >= source.length) return null;
    const escaped = source[index];
    const simpleEscapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
    value += Object.prototype.hasOwnProperty.call(simpleEscapes, escaped) ? simpleEscapes[escaped] : escaped;
    index += 1;
  }
  return null;
}

function scanCommonJsDependencies(source, filePath) {
  const dependencies = [];
  const findings = [];
  try {
    new vm.Script(`(function (exports, require, module, __filename, __dirname) {\n${source}\n})`, {
      filename: filePath
    });
  } catch (error) {
    findings.push(createFinding(
      'PARSE_FAILURE',
      `CommonJS source cannot be parsed: ${error.message}`,
      { file: normalizePath(filePath) }
    ));
    return { dependencies, findings };
  }

  let index = 0;
  let previousToken = null;

  while (index < source.length) {
    const character = source[index];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end === -1) {
        findings.push(createFinding('PARSE_FAILURE', 'Unterminated block comment.', { file: normalizePath(filePath) }));
        break;
      }
      index = end + 2;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      const quoted = skipQuoted(source, index, character);
      if (!quoted.closed) {
        findings.push(createFinding('PARSE_FAILURE', 'Unterminated string or template literal.', { file: normalizePath(filePath) }));
        break;
      }
      if (character === '`' && quoted.hasInterpolation) {
        findings.push(createFinding(
          'UNSUPPORTED_DYNAMIC_SYNTAX',
          'Interpolated template literals are not accepted by the P1 fail-closed CommonJS scanner.',
          { file: normalizePath(filePath) }
        ));
      }
      previousToken = 'literal';
      index = quoted.end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (end < source.length && /[A-Za-z0-9_$]/.test(source[end])) end += 1;
      const token = source.slice(index, end);

      if (token === 'import') {
        findings.push(createFinding(
          'UNSUPPORTED_IMPORT_SYNTAX',
          'P1 package boundaries accept CommonJS static require() only.',
          { file: normalizePath(filePath) }
        ));
      }

      const callStart = skipTrivia(source, end);
      if (token === 'require' && previousToken !== '.' && source[callStart] === '(') {
        const argumentStart = skipTrivia(source, callStart + 1);
        const literal = parseStringLiteral(source, argumentStart);
        if (!literal) {
          findings.push(createFinding(
            'DYNAMIC_REQUIRE_NOT_ALLOWED',
            'require() must use one static string literal.',
            { file: normalizePath(filePath) }
          ));
        } else {
          const callEnd = skipTrivia(source, literal.end);
          if (source[callEnd] !== ')') {
            findings.push(createFinding(
              'DYNAMIC_REQUIRE_NOT_ALLOWED',
              'require() must use exactly one static string literal.',
              { file: normalizePath(filePath), specifier: literal.value }
            ));
          } else {
            dependencies.push({ specifier: literal.value, offset: index });
            end = callEnd + 1;
          }
        }
      } else if (token === 'require' && previousToken !== '.') {
        findings.push(createFinding(
          'REQUIRE_REFERENCE_NOT_ALLOWED',
          'The CommonJS loader cannot be aliased or passed as a value.',
          { file: normalizePath(filePath) }
        ));
      }

      previousToken = token;
      index = end;
      continue;
    }

    previousToken = character;
    index += 1;
  }

  return { dependencies, findings };
}

function resolveRelativeDependency(sourceFile, specifier, rootPath) {
  const base = path.resolve(path.dirname(sourceFile), specifier);
  if (!isInside(rootPath, base)) {
    return { error: createFinding(
      'CLEAN_ROOT_ESCAPE',
      'Relative dependency escapes the clean Helix root.',
      { file: normalizePath(sourceFile), specifier }
    ) };
  }

  const candidates = [];
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(base + extension);
  for (const extension of RESOLUTION_EXTENSIONS.slice(1)) candidates.push(path.join(base, 'index' + extension));

  const resolved = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (_error) {
      return false;
    }
  });

  if (!resolved) {
    return { error: createFinding(
      'UNRESOLVED_DEPENDENCY',
      'Static relative dependency cannot be resolved.',
      { file: normalizePath(sourceFile), specifier }
    ) };
  }

  const realRoot = fs.realpathSync(rootPath);
  const realResolved = fs.realpathSync(resolved);
  if (!isInside(realRoot, realResolved)) {
    return { error: createFinding(
      'CLEAN_ROOT_ESCAPE',
      'Resolved dependency escapes the clean Helix root.',
      { file: normalizePath(sourceFile), specifier }
    ) };
  }

  return { resolved: realResolved };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function packagePatternMatches(pattern, packageInfo, sourceOwner) {
  const expanded = pattern.replaceAll('{owner}', sourceOwner || '__missing_owner__');
  const expression = expanded.split('.').map((part) => part === '*' ? '[^.]+' : escapeRegExp(part)).join('\\.');
  return new RegExp(`^${expression}$`).test(packageInfo.packageId);
}

function matchingRules(sourcePackage, policy) {
  return policy.rules.filter((rule) => packagePatternMatches(rule.source, sourcePackage, sourcePackage.owner));
}

function isExternalModuleAllowed(sourcePackage, specifier, policy) {
  if (policy.defaultExternalDecision !== 'deny') return false;
  const rules = Array.isArray(policy.externalModuleRules) ? policy.externalModuleRules : [];
  return rules.some((rule) =>
    packagePatternMatches(rule.source, sourcePackage, sourcePackage.owner) &&
    Array.isArray(rule.allow) && rule.allow.includes(specifier)
  );
}

function expectedDomainPublicEntry(targetPackage) {
  if (!targetPackage.packageId.startsWith('domains.')) return null;
  const domainDirectory = path.dirname(targetPackage.directory);
  return path.join(domainDirectory, 'public', 'index.js');
}

function validatePolicy(policy, policyPath, findings) {
  if (!policy) return;
  if (policy.schemaVersion !== 1 || policy.defaultInternalDecision !== 'deny' || policy.defaultExternalDecision !== 'deny') {
    findings.push(createFinding(
      'INVALID_BOUNDARY_POLICY',
      'Boundary policy must be schemaVersion 1 and deny internal and external dependencies by default.',
      { file: normalizePath(policyPath) }
    ));
  }
  if (!Array.isArray(policy.rules) || !Array.isArray(policy.externalModuleRules)) {
    findings.push(createFinding(
      'INVALID_BOUNDARY_POLICY',
      'Boundary policy requires rules and externalModuleRules arrays.',
      { file: normalizePath(policyPath) }
    ));
  }
}

function checkPackageBoundaries(options) {
  const rootPath = path.resolve(options.rootPath);
  const policyPath = path.resolve(options.policyPath);
  const findings = [];

  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    findings.push(createFinding('MISSING_CLEAN_ROOT', 'Clean Helix root does not exist.', { file: normalizePath(rootPath) }));
    return { ok: false, rootPath: normalizePath(rootPath), filesChecked: 0, dependenciesChecked: 0, packageCount: 0, findings };
  }

  const files = walk(rootPath, findings);
  const packages = discoverPackages(rootPath, files, findings);
  const policy = readJson(policyPath, findings, 'package boundary policy');
  validatePolicy(policy, policyPath, findings);

  let filesChecked = 0;
  let dependenciesChecked = 0;

  if (policy && Array.isArray(policy.rules)) {
    for (const filePath of files.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file)))) {
      filesChecked += 1;
      const sourcePackage = classifyFile(filePath, rootPath, packages);
      if (!sourcePackage) {
        findings.push(createFinding(
          'UNKNOWN_SOURCE_PACKAGE',
          'Source file is not owned by a package boundary.',
          { file: normalizePath(filePath) }
        ));
        continue;
      }

      if (sourcePackage.packageId === 'helix') {
        findings.push(createFinding(
          'SOURCE_IN_ROOT_PACKAGE_NOT_ALLOWED',
          'Executable source must belong to a declared child package, not the clean root package.',
          { file: normalizePath(filePath) }
        ));
        continue;
      }

      const sourceRules = matchingRules(sourcePackage, policy);
      if (sourceRules.length !== 1) {
        findings.push(createFinding(
          'AMBIGUOUS_OR_MISSING_SOURCE_RULE',
          'Each source package must match exactly one dependency rule.',
          { file: normalizePath(filePath), sourcePackage: sourcePackage.packageId, matchedRules: sourceRules.length }
        ));
        continue;
      }

      const scanned = scanCommonJsDependencies(fs.readFileSync(filePath, 'utf8'), filePath);
      findings.push(...scanned.findings);

      for (const dependency of scanned.dependencies) {
        dependenciesChecked += 1;
        const specifier = dependency.specifier;
        if (!specifier.startsWith('.')) {
          if (!isExternalModuleAllowed(sourcePackage, specifier, policy)) {
            findings.push(createFinding(
              path.isAbsolute(specifier) ? 'ABSOLUTE_DEPENDENCY_NOT_ALLOWED' : 'EXTERNAL_MODULE_NOT_ALLOWED',
              'External or absolute dependency is not explicitly allowed.',
              { file: normalizePath(filePath), sourcePackage: sourcePackage.packageId, specifier }
            ));
          }
          continue;
        }

        const resolution = resolveRelativeDependency(filePath, specifier, rootPath);
        if (resolution.error) {
          findings.push(resolution.error);
          continue;
        }

        const targetPackage = classifyFile(resolution.resolved, rootPath, packages);
        if (!targetPackage) {
          findings.push(createFinding(
            'UNKNOWN_TARGET_PACKAGE',
            'Resolved dependency is not owned by a package boundary.',
            { file: normalizePath(filePath), specifier, target: normalizePath(resolution.resolved) }
          ));
          continue;
        }

        if (sourcePackage.packageId === targetPackage.packageId) continue;

        if (targetPackage.packageId.startsWith('domains.') && sourcePackage.owner !== targetPackage.owner) {
          const expectedEntry = expectedDomainPublicEntry(targetPackage);
          if (path.resolve(resolution.resolved) !== path.resolve(expectedEntry)) {
            findings.push(createFinding(
              'DOMAIN_INTERNAL_IMPORT_NOT_ALLOWED',
              'A different owner may import a Domain only through public/index.js.',
              {
                file: normalizePath(filePath),
                sourcePackage: sourcePackage.packageId,
                targetPackage: targetPackage.packageId,
                target: normalizePath(resolution.resolved)
              }
            ));
            continue;
          }
        }

        const allowed = sourceRules[0].allow.some((pattern) => packagePatternMatches(pattern, targetPackage, sourcePackage.owner));
        if (!allowed) {
          findings.push(createFinding(
            'PACKAGE_DEPENDENCY_NOT_ALLOWED',
            'Cross-package dependency is not allowed by the package boundary policy.',
            {
              file: normalizePath(filePath),
              sourcePackage: sourcePackage.packageId,
              targetPackage: targetPackage.packageId,
              specifier
            }
          ));
        }
      }
    }
  }

  return {
    ok: findings.length === 0,
    rootPath: normalizePath(rootPath),
    filesChecked,
    dependenciesChecked,
    packageCount: packages.byId.size,
    findings
  };
}

module.exports = Object.freeze({
  checkPackageBoundaries,
  packagePatternMatches,
  scanCommonJsDependencies
});
