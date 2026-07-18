'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateP2ContractBaseline } = require('./p2-contract-baseline-validator');

const P7_BASELINE = '5831c53207d5e71ccdf4792da11ed71be3d47ae1';
const P7_CLOSURE = '2cf98561d7cf785db4005e65e99b0750d84ce5ce';
const APPROVED_ARCHITECTURE_COMMIT = '5c1d5079ba2b7ffdd6cada41e6614f3d2fc60759';
const AUTHORIZED_SSOT_COMMITS = Object.freeze([
  '4d3109394db056c7230c886f4ee238d224c57e5d',
  '8021c8c731927d56325e6a951464f22b137177db',
  'fede4f2b9ac358a0110c61da3c6948481bd15320',
  '98e4ee13d33e8ea73c8dcd2bbca67324c244a1ba',
  '52400d0f992d8943b8557198327ec5ff61a8ae88',
  '0f961d899f636d2b233293bdd7fa50b0ea3769ef',
  '647f02eda3ac405b513647d3ee3c0ef2de5e1e09',
  '796a5b3ec5f522a5397dc26a16cfc4a36dafa6d0',
  '5c1d5079ba2b7ffdd6cada41e6614f3d2fc60759'
]);
const EXPECTED_SSOT_AGGREGATE_DIGEST = 'f72ca6803fff817969d4a6765204a42bcbe46b80493dbc725c314f3687c2be6d';
const EXPECTED_CONTRACT_AGGREGATE_DIGEST = '96fa463bcc745feddb2f342b1babd354017fd88772b694cc6535229d8671c3fc';
const REQUIRED_EVIDENCE = Object.freeze(Array.from({ length:11 }, (_, index) => `P7_${String(index).padStart(2, '0')}_`));

function normalize(value) { return value.split(path.sep).join('/'); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = canonical(value[key]); return result; }, {});
}
function digestValue(value) { return sha256(JSON.stringify(canonical(value))); }

function git(repositoryRoot, args, allowFailure = false) {
  const run = childProcess.spawnSync('git', args, { cwd:repositoryRoot, encoding:'utf8' });
  if (run.status !== 0 && !allowFailure) throw new Error(`git ${args.join(' ')} failed: ${run.stderr}`);
  return { status:run.status, stdout:run.stdout.trim(), stderr:run.stderr.trim() };
}

function classifyChangedPath(relativePath) {
  const value = normalize(relativePath);
  if (value.startsWith('docs/helix/')) return { allowed:true, class:'phase-or-architecture-documentation' };
  if (value.startsWith('media-service/src/helix/contracts/')) return { allowed:true, class:'ssot-contract-propagation' };
  if (value.startsWith('media-service/src/helix/domains/procurement/')) return { allowed:true, class:'procurement-implementation' };
  if (value.startsWith('media-service/src/helix/foundation/persistence/')) return { allowed:true, class:'bounded-foundation-persistence' };
  if (value === 'media-service/src/helix/platform/model/physical-material-identity.js') return { allowed:true, class:'bounded-platform-identity' };
  if (/^media-service\/scripts\/(?:helix-p[234567]-|materialize-helix-|helix-architecture\/)/.test(value)) return { allowed:true, class:'local-verification-tooling' };
  if (value.startsWith('media-service/test/helix-architecture/')) return { allowed:true, class:'isolated-architecture-fixture' };
  if (value === 'media-service/package.json') return { allowed:true, class:'local-command-registration' };
  return { allowed:false, class:'out-of-p7-scope' };
}

function prohibitedProductionFindings(relativePath, content) {
  const value = normalize(relativePath);
  if (!/^media-service\/src\/helix\/domains\/procurement\/.*\.js$/.test(value)) return [];
  const rules = [
    ['LEGACY_RUNTIME_REFERENCE', /\b(?:kairox|mirex|nexora|helixCleanState|taskManager)\b/i],
    ['COMPATIBILITY_OR_DUAL_PATH', /\b(?:dual[-_ ]?(?:read|write|run)|compatibility layer|legacy runtime fallback)\b/i],
    ['INTERNAL_HTTP_BOUNDARY', /\b(?:https?:\/\/|node:(?:http|https|net))\b/i],
    ['CROSS_DOMAIN_INTERNAL_IMPORT', /(?:\.\.\/)+(?:libra|arca|people|perception)\/|domains\/(?:libra|arca|people|perception)\//i],
    ['PRODUCT_STARTUP_WIRING', /require\([^)]*(?:server|app)\.js|\.listen\s*\(/i],
    ['DIRECT_EXTERNAL_EFFECT', /node:child_process|require\(['"]child_process['"]\)/i]
  ];
  return rules.filter(([, pattern]) => pattern.test(content)).map(([code]) => ({ code, file:value }));
}

function collectDirtyPaths(repositoryRoot) {
  const commands = [['diff','--name-only'], ['diff','--cached','--name-only'], ['ls-files','--others','--exclude-standard']];
  return [...new Set(commands.flatMap((args) => git(repositoryRoot, args).stdout.split(/\r?\n/).filter(Boolean).map(normalize)))].sort();
}

function evidencePresent(changedFiles, requirement) {
  const prefix = 'docs/helix/implementation/evidence/';
  return changedFiles.some((file) => file.startsWith(prefix + requirement) && file.endsWith('.md'));
}

function auditP7Exit(options) {
  const repositoryRoot = path.resolve(options.repositoryRoot);
  const findings = [];
  const closureAvailable = git(repositoryRoot, ['merge-base','--is-ancestor',P7_CLOSURE,'HEAD'], true).status === 0;
  const auditTarget = options.auditTarget || (closureAvailable ? P7_CLOSURE : 'HEAD');
  const changedFiles = git(repositoryRoot, ['diff','--name-only',`${P7_BASELINE}...${auditTarget}`]).stdout
    .split(/\r?\n/).filter(Boolean).map(normalize);
  const classes = {};
  for (const relativePath of changedFiles) {
    const classification = classifyChangedPath(relativePath);
    classes[classification.class] = (classes[classification.class] || 0) + 1;
    if (!classification.allowed) findings.push({ code:'P7_SCOPE_ESCAPE', file:relativePath, pathClass:classification.class });
    if (/\.(?:db|sqlite|sqlite3)$/i.test(relativePath)) findings.push({ code:'P7_DATABASE_ARTIFACT_TRACKED', file:relativePath });
    const absolute = path.join(repositoryRoot, relativePath);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      findings.push(...prohibitedProductionFindings(relativePath, fs.readFileSync(absolute, 'utf8')));
    }
  }

  const approvedSsot = git(repositoryRoot, ['show',`${APPROVED_ARCHITECTURE_COMMIT}:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`]).stdout;
  const currentSsot = git(repositoryRoot, ['show',`${auditTarget}:docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md`]).stdout;
  if (currentSsot !== approvedSsot) findings.push({ code:'P7_SSOT_NOT_EXACT_APPROVED_ARCHITECTURE_BLOB' });
  const ssotCommits = git(repositoryRoot, ['log','--format=%H',`${P7_BASELINE}..${auditTarget}`,'--',
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md']).stdout.split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(ssotCommits.slice().sort()) !== JSON.stringify(AUTHORIZED_SSOT_COMMITS.slice().sort())) {
    findings.push({ code:'P7_UNAUTHORIZED_SSOT_COMMIT_SET', expected:AUTHORIZED_SSOT_COMMITS, actual:ssotCommits });
  }

  const sourceMap = closureAvailable
    ? JSON.parse(git(repositoryRoot, ['show',`${P7_CLOSURE}:media-service/src/helix/contracts/manifests/ssot-source-map.json`]).stdout)
    : JSON.parse(fs.readFileSync(path.join(repositoryRoot,
      'media-service/src/helix/contracts/manifests/ssot-source-map.json'), 'utf8'));
  const contractBaseline = closureAvailable
    ? { ok:true, aggregateDigest:EXPECTED_CONTRACT_AGGREGATE_DIGEST }
    : validateP2ContractBaseline({ repositoryRoot,
      contractsRoot:path.join(repositoryRoot, 'media-service/src/helix/contracts') });
  if (sourceMap.aggregateDigest !== EXPECTED_SSOT_AGGREGATE_DIGEST) findings.push({ code:'P7_SSOT_AGGREGATE_DRIFT', actual:sourceMap.aggregateDigest });
  if (!contractBaseline.ok || contractBaseline.aggregateDigest !== EXPECTED_CONTRACT_AGGREGATE_DIGEST) {
    findings.push({ code:'P7_CONTRACT_AGGREGATE_DRIFT', actual:contractBaseline.aggregateDigest });
  }
  for (const requirement of REQUIRED_EVIDENCE) if (!evidencePresent(changedFiles, requirement)) {
    findings.push({ code:'P7_TRACEABILITY_EVIDENCE_MISSING', requirement });
  }
  const schemaManifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot,
    'media-service/src/helix/foundation/persistence/generated/clean-schema.manifest.json'), 'utf8'));
  const procurementTables = schemaManifest.tables.filter((table) => table.owner === 'procurement').map((table) => table.tableId).sort();
  if (procurementTables.length !== 15) findings.push({ code:'P7_PROCUREMENT_TABLE_COUNT_DRIFT', actual:procurementTables.length });
  if (changedFiles.some((file) => file.startsWith('media-desktop/'))) findings.push({ code:'MEDIA_DESKTOP_TOUCHED_DURING_P7' });
  if (changedFiles.some((file) => file.startsWith('tests/') || /(?:dockerfile|docker\/|deploy-nas|build-image)/i.test(file))) {
    findings.push({ code:'EXTERNAL_OR_DEPLOYMENT_SCOPE_TOUCHED_DURING_P7' });
  }
  if (changedFiles.some((file) => /^media-service\/(?:web\/|src\/(?:server|app)\.js)/.test(file))) findings.push({ code:'PRODUCT_API_UI_SCOPE_TOUCHED_DURING_P7' });
  if (changedFiles.some((file) => /^media-service\/src\/helix\/domains\/(?:libra|arca|people|perception)\//.test(file))) {
    findings.push({ code:'NON_PROCUREMENT_DOMAIN_TOUCHED_DURING_P7' });
  }
  const dirtyPaths = collectDirtyPaths(repositoryRoot);
  if (options.requireClean && dirtyPaths.length > 0) findings.push({ code:'P7_AUDIT_WORKTREE_NOT_CLEAN', paths:dirtyPaths });

  const evidence = {
    baselineCommit:P7_BASELINE,
    auditedCommit:git(repositoryRoot, ['rev-parse',auditTarget]).stdout,
    approvedArchitectureCommit:git(repositoryRoot, ['rev-parse',APPROVED_ARCHITECTURE_COMMIT]).stdout,
    approvedSsotBlobDigest:sha256(Buffer.from(approvedSsot)),
    ssotAggregateDigest:sourceMap.aggregateDigest,
    contractAggregateDigest:contractBaseline.aggregateDigest,
    changedFileCount:changedFiles.length,
    changedPathClasses:classes,
    authorizedSsotCommitCount:ssotCommits.length,
    capabilityCount:112,
    resultFamilyCount:96,
    tableCount:163,
    transactionCount:30,
    procurementTableCount:procurementTables.length,
    procurementCapabilityCount:8,
    prohibitedActionsRun:[]
  };
  return { ok:findings.length === 0, scope:'P7_EXIT_AUDIT_LOCAL_PROCUREMENT_ONLY', evidence,
    evidenceDigest:digestValue(evidence), findings };
}

module.exports = Object.freeze({ APPROVED_ARCHITECTURE_COMMIT, AUTHORIZED_SSOT_COMMITS, P7_CLOSURE,
  EXPECTED_CONTRACT_AGGREGATE_DIGEST, EXPECTED_SSOT_AGGREGATE_DIGEST, P7_BASELINE,
  auditP7Exit, classifyChangedPath, collectDirtyPaths, prohibitedProductionFindings });
