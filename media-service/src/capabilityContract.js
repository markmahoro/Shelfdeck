'use strict';

const PRIMITIVES = new Set(['string', 'number', 'boolean', 'object', 'array']);
const TYPE_SCHEMAS = Object.freeze({
  None: shape({}), AssetSnapshot: shape({ assetId: 'string', assetKind: 'string', canonicalLocator: 'object' }),
  SourceObservation: shape({ facts: 'object' }), LayoutObservation: shape({ layout: 'object' }),
  VerifiedBasedata: shape({ facts: 'object', valid: 'boolean' }), BasedataPublication: shape({ basedataRevision: 'number' }),
  MetadataPublication: shape({ metadataRevision: 'number' }), MediaIdentity: shape({ descriptor: 'object' }),
  MetadataObservation: shape({ facts: 'object' }), ResolvedMetadata: shape({ facts: 'object', people: 'array' }),
  MetadataArtifact: shape({}, { artifact: 'object', skipped: 'boolean' }, [['artifact'], ['skipped']]), ArtifactManifest: shape({ valid: 'boolean' }),
  StagedMediaAsset: shape({ assetId: 'string', sourcePath: 'string', workDir: 'string', replacementScope: 'string', producingEventId: 'string' }),
  VerifiedMediaAsset: shape({ stagedAsset: 'object', objectiveSatisfied: 'boolean' }),
  MediaReplacementEvidence: shape({ stagedAsset: 'object', targetPath: 'string' }), SourceMutationEffect: shape({ sourceMutationResult: 'object' }),
  ArtifactMaterialization: shape({ written: 'array' }), LayoutVerification: shape({ valid: 'boolean' }),
  UpgradeCandidates: shape({ candidates: 'array' }), UpgradeRequest: shape({ downloadId: 'string' }), DownloadObservation: shape({ completed: 'boolean' }),
  TransferObservation: shape({ transfer: 'object' }), OptimizePublication: shape({ passed: 'boolean' }), ObjectiveVerification: shape({ objectiveSatisfied: 'boolean' }),
  FrameSet: shape({ frames: 'array', frameCount: 'number' }), FaceEmbeddingSet: shape({ faces: 'array', frames: 'array' }),
  FaceClusterSet: shape({ clusters: 'array', frames: 'array' }), PersonMatchSet: shape({ match: 'object', clusters: 'array', frames: 'array' }),
  WesternPresentation: shape({ actorName: 'string', sceneTitle: 'string', matched: 'object' }), ComputeAsset: shape({ assetId: 'string', sourcePath: 'string' }),
  UploadedComputeAsset: shape({ assetId: 'string', sourcePath: 'string', uploaded: 'boolean' }), AdultAnalysisJob: shape({ jobId: 'string', assetId: 'string' }),
  AdultAnalysisResult: shape({ jobId: 'string', result: 'object' }), TranscodePrecheck: shape({ sourcePath: 'string', deviceSlots: 'array', rateControlPlan: 'array', workDir: 'string' }),
  CleanupEvidence: shape({ cleaned: 'boolean' }), IdentityInspection: shape({ stagedAsset: 'object', matched: 'boolean', reason: 'string' }),
  IntegrationEvidence: shape({ available: 'boolean' }), UpgradeIdentity: shape({ title: 'string', tmdbId: 'string', mediaKind: 'string' }),
});

function shape(required, optional = {}, anyOf = []) { return Object.freeze({ required: Object.freeze(required), optional: Object.freeze(optional), anyOf: Object.freeze(anyOf.map((group) => Object.freeze(group))) }); }
function valueMatches(expected, value) {
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'number') return Number.isFinite(Number(value));
  return typeof value === expected;
}
function assertNamedShape(type, value, label) {
  const schema = TYPE_SCHEMAS[type];
  if (!schema) throw new TypeError(`Unknown nominal capability type: ${type}`);
  if (!valueMatches('object', value)) throw Object.assign(new Error(`${label} must be ${type}`), { code: 'KAIROX_CAPABILITY_STRUCTURAL_TYPE_VIOLATION', type, label });
  for (const [field, expected] of Object.entries(schema.required)) if (!valueMatches(expected, value[field])) throw Object.assign(new Error(`${label}.${field} must be ${expected}`), { code: 'KAIROX_CAPABILITY_STRUCTURAL_TYPE_VIOLATION', type, field, label });
  for (const [field, expected] of Object.entries(schema.optional)) if (value[field] != null && !valueMatches(expected, value[field])) throw Object.assign(new Error(`${label}.${field} must be ${expected}`), { code: 'KAIROX_CAPABILITY_STRUCTURAL_TYPE_VIOLATION', type, field, label });
  if (schema.anyOf.length && !schema.anyOf.some((group) => group.every((field) => value[field] != null))) throw Object.assign(new Error(`${label} does not satisfy any structural variant of ${type}`), { code: 'KAIROX_CAPABILITY_STRUCTURAL_TYPE_VIOLATION', type, label });
}

function contract(type, version = 1, options = {}) {
  const value = String(type || '').trim();
  if (!value) throw new TypeError('Capability contract requires a nominal type');
  return Object.freeze({ type: value, version: Number(version) || 1, optional: !!options.optional, many: !!options.many });
}

function normalizePorts(ports = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(ports).map(([name, value]) => {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new TypeError(`Invalid capability input port: ${name}`);
    return [name, contract(value.type, value.version, value)];
  })));
}

function normalizeDefinition(definition = {}) {
  const contractVersion = Number(definition.contractVersion);
  if (!Number.isInteger(contractVersion) || contractVersion < 1) throw new TypeError(`Capability ${definition.capability || ''} requires contractVersion`);
  if (!definition.outputContract || !definition.outputContract.type) throw new TypeError(`Capability ${definition.capability || ''} requires outputContract`);
  return {
    contractVersion,
    inputContract: normalizePorts(definition.inputContract || {}),
    outputContract: contract(definition.outputContract.type, definition.outputContract.version, definition.outputContract),
    effectKind: String(definition.effectKind || definition.idempotency || 'pure'),
    resourceContract: Object.freeze({ types: Object.freeze([...(definition.resourceContract && definition.resourceContract.types || [])]) }),
    approvalContract: Object.freeze({ actions: Object.freeze([...(definition.approvalContract && definition.approvalContract.actions || [])]) }),
    fencingContract: Object.freeze({ admission: definition.fencingContract ? definition.fencingContract.admission !== false : true }),
    parameterContract: Object.freeze(definition.parameterContract || {}),
  };
}

function assertParameters(contract = {}, parameters = {}, capability = '') {
  for (const [name, spec] of Object.entries(contract)) {
    const value = parameters[name];
    if (value == null && spec.required !== false) throw Object.assign(new Error(`Capability ${capability} requires parameter ${name}`), { code: 'KAIROX_CAPABILITY_PARAMETER_MISSING' });
    if (value != null && spec.type === 'enum' && !(spec.values || []).includes(value)) throw Object.assign(new Error(`Capability ${capability} parameter ${name} is invalid`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
    if (value != null && spec.type === 'string' && typeof value !== 'string') throw Object.assign(new Error(`Capability ${capability} parameter ${name} must be a string`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
    if (value != null && spec.type === 'array' && !Array.isArray(value)) throw Object.assign(new Error(`Capability ${capability} parameter ${name} must be an array`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
    if (value != null && spec.type === 'boolean' && typeof value !== 'boolean') throw Object.assign(new Error(`Capability ${capability} parameter ${name} must be a boolean`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
    if (value != null && spec.type === 'number' && !Number.isFinite(Number(value))) throw Object.assign(new Error(`Capability ${capability} parameter ${name} must be a number`), { code: 'KAIROX_CAPABILITY_PARAMETER_INVALID' });
  }
  for (const name of Object.keys(parameters || {})) if (!contract[name]) throw Object.assign(new Error(`Capability ${capability} received unknown parameter ${name}`), { code: 'KAIROX_CAPABILITY_PARAMETER_UNKNOWN' });
}

function compatible(expected, actual) {
  return !!expected && !!actual && expected.type === actual.type && Number(expected.version) === Number(actual.version);
}

function assertRuntimeValue(spec, value, label) {
  if (value == null) {
    if (!spec.optional) throw Object.assign(new Error(`Required capability input is missing: ${label}`), { code: 'KAIROX_CAPABILITY_INPUT_MISSING', input: label });
    return;
  }
  if (spec.many && !Array.isArray(value)) throw Object.assign(new Error(`Capability input must be an array: ${label}`), { code: 'KAIROX_CAPABILITY_INPUT_TYPE_VIOLATION', input: label });
  if (PRIMITIVES.has(spec.type)) {
    const candidate = spec.many ? value : [value];
    for (const entry of candidate) {
      const valid = spec.type === 'array' ? Array.isArray(entry)
        : spec.type === 'object' ? !!entry && typeof entry === 'object' && !Array.isArray(entry)
          : typeof entry === spec.type;
      if (!valid) throw Object.assign(new Error(`Capability input type violation: ${label}:${spec.type}`), { code: 'KAIROX_CAPABILITY_INPUT_TYPE_VIOLATION', input: label });
    }
  } else for (const entry of spec.many ? value : [value]) if (entry != null) assertNamedShape(spec.type, entry, label);
}

function assertOutput(spec, value, capability) {
  if (value == null) throw Object.assign(new Error(`Capability ${capability} did not return ${spec.type}@${spec.version}`), { code: 'KAIROX_CAPABILITY_OUTPUT_MISSING' });
  if (PRIMITIVES.has(spec.type)) assertRuntimeValue(spec, value, 'output');
  else assertNamedShape(spec.type, value, `${capability}.output`);
}

module.exports = { TYPE_SCHEMAS, contract, normalizeDefinition, compatible, assertRuntimeValue, assertOutput, assertParameters, assertNamedShape };
