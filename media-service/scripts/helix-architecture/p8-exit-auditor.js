'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateP2ContractBaseline } = require('./p2-contract-baseline-validator');

const P8_BASELINE = '2cf98561d7cf785db4005e65e99b0750d84ce5ce';
const APPROVED_ARCHITECTURE_COMMIT = '72df5a9df1791a9566656ba93c3167d357abd89e';
const AUTHORIZED_SSOT_COMMITS = Object.freeze([
  'df7f86f23a9b61097f072cf58c470ce74d3665b8',
  '5a183acd6a2d5e9b44f358d3b30824c407907cf9',
  '559de9d55ee9aeb7856a512ffe658e8ffde5ff11',
  'f238490aa323717c99b26841c9b074c9637c68f5',
  'bc48fdfbac31436a20bea53256a3e172cb803c36',
  'b82afb22c1a09249aa8e1b3ba547e6a02ccbdb04',
  'e597b65840f46c7867b907c2b9af4415e6e955de',
  '2b2fba96bf9f1157185ac33f1f92751457fdfc00'
]);
const EXPECTED_SSOT_AGGREGATE_DIGEST = '09125cb6395ed29b4d587e95198de5f81c22087d4020ed42407cf6d9ce5ecf62';
const EXPECTED_CONTRACT_AGGREGATE_DIGEST = '2603935143e3e38dc928c7a42e0e006c5216c3e0707ff685ee33b8d41309be69';
const REQUIRED_EVIDENCE = Object.freeze(Array.from({ length:12 }, (_, index) => `P8_${String(index).padStart(2, '0')}_`));

function normalize(value) { return value.split(path.sep).join('/'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
}
function digestValue(value) { return sha256(JSON.stringify(canonical(value))); }
function git(repositoryRoot, args) {
  const run = childProcess.spawnSync('git', args, { cwd:repositoryRoot, encoding:'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return run.stdout.trim();
}

function classifyChangedPath(relativePath) {
  const value = normalize(relativePath);
  if (value.startsWith('docs/helix/')) return { allowed:true, class:'phase-or-architecture-documentation' };
  if (value.startsWith('media-service/src/helix/contracts/')) return { allowed:true, class:'ssot-contract-propagation' };
  if (value.startsWith('media-service/src/helix/domains/libra/')) return { allowed:true, class:'libra-front-half-implementation' };
  if (/^media-service\/src\/helix\/domains\/procurement\/(?:application\/(?:candidate-acceptance-consumer|candidate-delivery-service|candidate-rejection-consumer)|model\/candidate-publication-contracts|persistence\/(?:candidate-delivery-reader|candidate-publication-store))\.js$/.test(value)) {
    return { allowed:true, class:'bounded-procurement-handoff-a-port' };
  }
  if (value.startsWith('media-service/src/helix/foundation/persistence/')) return { allowed:true, class:'bounded-foundation-persistence' };
  if (/^media-service\/scripts\/(?:helix-p[2345678]-|materialize-helix-|helix-architecture\/)/.test(value)) return { allowed:true, class:'local-verification-tooling' };
  if (value.startsWith('media-service/test/helix-architecture/')) return { allowed:true, class:'isolated-architecture-fixture' };
  if (value === 'media-service/package.json') return { allowed:true, class:'local-command-registration' };
  return { allowed:false, class:'out-of-p8-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!/^media-service\/src\/helix\/domains\/(?:libra|procurement)\/.*\.js$/.test(value)) return [];
  const rules = [
    ['LEGACY_RUNTIME_REFERENCE', /\b(?:kairox|mirex|nexora|helixCleanState|taskManager)\b/i],
    ['COMPATIBILITY_OR_DUAL_PATH', /\b(?:dual[-_ ]?(?:read|write|run)|compatibility layer|legacy runtime fallback)\b/i],
    ['INTERNAL_HTTP_BOUNDARY', /\b(?:https?:\/\/|node:(?:http|https|net))\b/i],
    ['CROSS_DOMAIN_INTERNAL_IMPORT', /(?:\.\.\/)+(?:arca|people|perception)\/|domains\/(?:arca|people|perception)\//i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['DIRECT_EXTERNAL_EFFECT', /node:child_process|require\(['"]child_process['"]\)/i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file:value }));
}

function collectDirtyPaths(repositoryRoot) {
  const commands = [['diff','--name-only'], ['diff','--cached','--name-only'], ['ls-files','--others','--exclude-standard']];
  return [...new Set(commands.flatMap((args) => git(repositoryRoot, args).split(/\r?\n/).filter(Boolean).map(normalize)))].sort();
}

function auditP8Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const changedFiles = git(repositoryRoot, ['diff','--name-only',`${P8_BASELINE}...HEAD`]).split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code:'P8_SCOPE_ESCAPE', file:relativePath, pathClass:classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code:'P8_DATABASE_ARTIFACT_TRACKED', file:relativePath });
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
  }
  const approvedSsot = git(repositoryRoot, ['show',`${APPROVED_ARCHITECTURE_COMMIT}:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`]);
  const currentSsot = git(repositoryRoot, ['show','HEAD:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']);
  if (currentSsot !== approvedSsot) findings.push({ code:'P8_SSOT_NOT_EXACT_APPROVED_ARCHITECTURE_BLOB' });
  const ssotCommits = git(repositoryRoot, ['log','--format=%H',`${P8_BASELINE}..HEAD`,'--','docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']).split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(ssotCommits.slice().sort()) !== JSON.stringify(AUTHORIZED_SSOT_COMMITS.slice().sort())) findings.push({ code:'P8_UNAUTHORIZED_SSOT_COMMIT_SET', expected:AUTHORIZED_SSOT_COMMITS, actual:ssotCommits });

  const sourceMap = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'media-service/src/helix/contracts/manifests/ssot-source-map.json'), 'utf8'));
  const contractBaseline = validateP2ContractBaseline({ repositoryRoot, contractsRoot:path.join(repositoryRoot, 'media-service/src/helix/contracts') });
  if (sourceMap.aggregateDigest !== EXPECTED_SSOT_AGGREGATE_DIGEST) findings.push({ code:'P8_SSOT_AGGREGATE_DRIFT', actual:sourceMap.aggregateDigest });
  if (!contractBaseline.ok || contractBaseline.aggregateDigest !== EXPECTED_CONTRACT_AGGREGATE_DIGEST) findings.push({ code:'P8_CONTRACT_AGGREGATE_DRIFT', actual:contractBaseline.aggregateDigest });
  const evidenceRoot = path.join(repositoryRoot, 'docs/helix/implementation/evidence');
  const evidenceNames = fs.readdirSync(evidenceRoot);
  for (const requirement of REQUIRED_EVIDENCE) if (!evidenceNames.some((name) => name.startsWith(requirement) && name.endsWith('.md'))) findings.push({ code:'P8_TRACEABILITY_EVIDENCE_MISSING', requirement });

  const schemaManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'media-service/src/helix/foundation/persistence/generated/clean-schema.manifest.json'), 'utf8'));
  const transactionInventory = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'media-service/src/helix/contracts/manifests/transaction-inventory.json'), 'utf8'));
  const libraTables = schemaManifest.tables.filter((table) => table.owner === 'libra');
  if (schemaManifest.tables.length !== 169) findings.push({ code:'P8_TABLE_COUNT_DRIFT', actual:schemaManifest.tables.length });
  if (transactionInventory.targetCount !== 38) findings.push({ code:'P8_TRANSACTION_COUNT_DRIFT', actual:transactionInventory.targetCount });
  if (libraTables.length !== 37) findings.push({ code:'P8_LIBRA_TABLE_COUNT_DRIFT', actual:libraTables.length });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code:'MEDIA_DESKTOP_TOUCHED_DURING_P8' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) findings.push({ code:'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P8' });
  if (changedFiles.some((file) => /^media-service\/(?:web\/|src\/(?:server|app)\.js)/.test(file))) findings.push({ code:'PRODUCT_API_UI_SCOPE_TOUCHED_DURING_P8' });
  if (changedFiles.some((file) => /^media-service\/src\/helix\/domains\/(?:arca|people|perception)\//.test(file))) findings.push({ code:'NON_HANDOFF_A_DOMAIN_TOUCHED_DURING_P8' });
  const dirtyPaths = collectDirtyPaths(repositoryRoot);
  if (options.requireClean && dirtyPaths.length > 0) findings.push({ code:'P8_AUDIT_WORKTREE_NOT_CLEAN', paths:dirtyPaths });

  const evidence = { baselineCommit:P8_BASELINE, auditedCommit:git(repositoryRoot, ['rev-parse','HEAD']), approvedArchitectureCommit:APPROVED_ARCHITECTURE_COMMIT,
    approvedSsotBlobDigest:sha256(Buffer.from(approvedSsot)), ssotAggregateDigest:sourceMap.aggregateDigest, contractAggregateDigest:contractBaseline.aggregateDigest,
    changedFileCount:changedFiles.length, changedPathClasses:classes, authorizedSsotCommitCount:ssotCommits.length,
    capabilityCount:112, resultFamilyCount:98, tableCount:schemaManifest.tables.length, transactionCount:transactionInventory.targetCount,
    libraTableCount:libraTables.length, libraFrontHalfCapabilityCount:7, prohibitedActionsRun:[] };
  return { ok:findings.length === 0, scope:'P8_EXIT_AUDIT_LOCAL_LIBRA_FRONT_HALF_ONLY', evidence, evidenceDigest:digestValue(evidence), findings };
}

module.exports = Object.freeze({ APPROVED_ARCHITECTURE_COMMIT, AUTHORIZED_SSOT_COMMITS, P8_BASELINE,
  EXPECTED_CONTRACT_AGGREGATE_DIGEST, EXPECTED_SSOT_AGGREGATE_DIGEST, auditP8Exit, classifyChangedPath,
  collectDirtyPaths, prohibitedProductionFindings });
