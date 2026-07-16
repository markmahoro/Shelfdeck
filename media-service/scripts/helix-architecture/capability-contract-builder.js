'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const PARAMETER_NAMES = new Set(['cursor', 'pageBudget', 'phase', 'artifactKind', 'structureKind', 'contentProfile']);
const SHARED_TYPES = new Set([
  'PhysicalMaterialIdentity', 'PhysicalMaterialReadHandle', 'WorkspaceMaterialHandle', 'ArtifactHandle', 'FieldAccessHandle',
  'IntegrationHandle', 'WorkerHandle', 'CanonicalQueryHandle', 'DomainFactCommitHandle', 'ResponsibilityControlCommitHandle',
  'ApprovalHandle', 'AuthorizationHandle', 'ExternalJobReceipt', 'EffectReceipt', 'TargetCommitSlotHandle', 'ExternalMaterialHandle',
  'WorkerAssetReceipt', 'WorkerUploadReceipt', 'FaceEmbeddingSetHandle', 'FaceClusterSetHandle', 'EvidenceEnvelope',
  'VerificationEnvelope', 'DomainFactEnvelope', 'ReceiptEnvelope', 'ManifestEnvelope', 'DraftEnvelope',
  'CapabilityExecutionContext', 'CapabilityOutcome'
]);

const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const arrayOf = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const object = (properties, required = Object.keys(properties), extras = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...extras
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => { result[key] = canonicalize(value[key]); return result; }, {});
  }
  return value;
}

function digestValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function capabilityBase(capabilityRef) {
  return capabilityRef.replace(/@1$/, '');
}

function capabilitySchemaId(capabilityRef, part) {
  return `helix://contracts/capabilities/${capabilityBase(capabilityRef)}/v1/${part}`;
}

function packageRelativePath(capabilityRef) {
  return `capabilities/${capabilityBase(capabilityRef).split('.').join('/')}/v1`;
}

function words(value) {
  return value
    .replace(/\[\]/g, ' list ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function pascal(value) {
  return words(value).map((word) => word[0].toUpperCase() + word.slice(1)).join('');
}

function camel(value) {
  const converted = pascal(value);
  return converted ? converted[0].toLowerCase() + converted.slice(1) : 'input';
}

function parameterName(expression) {
  const compact = expression.replace(/[^A-Za-z]/g, '').toLowerCase();
  return [...PARAMETER_NAMES].find((name) => compact === name.toLowerCase()) || null;
}

function splitSummary(inputSummary) {
  return inputSummary.split(/\s+\+\s+/).map((value) => value.trim()).filter(Boolean);
}

function normalizedTypeName(value) {
  const direct = value.trim().replace(/\[\]$/, '');
  const aliases = {
    'Material handle': 'MaterialHandle',
    'Material handles': 'MaterialHandle',
    'Workspace handles': 'WorkspaceMaterialHandle',
    'Workspace handle': 'WorkspaceMaterialHandle',
    'Artifact handles': 'ArtifactHandle',
    'MaterialHandle': 'MaterialHandle',
    'target handle': 'TargetCommitSlotHandle',
    'Inventory target handle': 'TargetCommitSlotHandle',
    'External/user asset handle': 'ExternalMaterialHandle',
    'Provider/person hint': 'ProviderPersonHint'
  };
  return aliases[direct] || pascal(direct);
}

function typeRef(name) {
  if (SHARED_TYPES.has(name)) return `helix://contracts/types/${name}/v1`;
  if (name === 'MaterialHandle') return null;
  return `helix://contracts/domain-types/${name}/v1`;
}

function expressionSchema(expression) {
  const isMany = /\[\]|handles|materials|Facts|Candidates|records|assessments|Evidence\[\]/i.test(expression);
  const unionParts = expression.replace(/\[\]/g, '').split('|').map((value) => normalizedTypeName(value));
  let itemSchema;
  if (unionParts.length > 1) itemSchema = { oneOf: unionParts.map((name) => ({ $ref: typeRef(name) })) };
  else if (unionParts[0] === 'MaterialHandle') {
    itemSchema = { oneOf: ['PhysicalMaterialReadHandle', 'WorkspaceMaterialHandle', 'ArtifactHandle'].map((name) => ({ $ref: typeRef(name) })) };
  } else itemSchema = { $ref: typeRef(unionParts[0]) };
  const schema = isMany ? arrayOf(itemSchema) : itemSchema;
  return { ...schema, 'x-helix-typeExpression': expression };
}

function uniquePortName(expression, used) {
  const base = camel(expression
    .replace(/\|/g, ' Or ')
    .replace(/\[\]/g, ' List')
    .replace(/\bhandles\b/ig, 'HandleList')
    .replace(/\bmaterials\b/ig, 'MaterialList'));
  let candidate = base;
  let ordinal = 2;
  while (used.has(candidate)) candidate = `${base}${ordinal++}`;
  used.add(candidate);
  return candidate;
}

function parameterSchema(name, capabilityRef) {
  if (name === 'cursor') return text({ maxLength: 4096 });
  if (name === 'pageBudget') return { type: 'integer', minimum: 1, maximum: 1000 };
  if (name === 'phase') {
    const values = capabilityRef.includes('acquire.observe') ? ['download', 'transfer'] : ['observe'];
    return { type: 'string', enum: values };
  }
  if (name === 'structureKind') return { type: 'string', enum: ['single', 'season'] };
  if (name === 'contentProfile') return { type: 'string', enum: ['movie', 'season', 'jav', 'western_adult'] };
  if (name === 'artifactKind') return text({ pattern: '^[a-z][a-z0-9_.-]{0,127}$' });
  throw new Error(`Unknown parameter ${name}`);
}

function approvalAuthorization(capabilityRef) {
  if (capabilityRef === 'arca.ondeck.input_settlement.delete@1' || capabilityRef === 'arca.aftercare.input_settlement.delete@1') {
    return { approvalRequirementRef: 'helix://contracts/requirements/exact-settlement-approval/v1' };
  }
  if (capabilityRef === 'arca.offdeck.primary_material.delete@1' || capabilityRef === 'arca.offdeck.unreferenced_related.delete@1') {
    return { authorizationRequirementRef: 'helix://contracts/requirements/destructive-authorization/v1' };
  }
  return {};
}

function resourceKinds(capability) {
  const value = `${capability.id} ${capability.inputSummary}`.toLowerCase();
  const kinds = new Set();
  if (/integration|external|worker|provider|search|acquire|upload|request/.test(value)) kinds.add('network');
  if (/material|filesystem|workspace|artifact|media|frame|hash|layout|inventory|delete|remux|transcode/.test(value)) kinds.add('disk_io');
  if (/transcode|remux|probe|hash|face|frame|analysis|render|normalize|resolve|verify/.test(value)) kinds.add('cpu');
  if (/transcode|remux|face|analysis/.test(value)) kinds.add('compute_device');
  if (kinds.size === 0) kinds.add('cpu');
  return [...kinds].sort();
}

function buildCapabilityPackage(capability) {
  const usedNames = new Set();
  const inputDefinitions = {};
  const inputProperties = {};
  const inputPorts = {};
  const parameterProperties = {};

  for (const expression of splitSummary(capability.inputSummary)) {
    const parameter = parameterName(expression);
    if (parameter) {
      parameterProperties[parameter] = parameterSchema(parameter, capability.id);
      continue;
    }
    const portName = uniquePortName(expression, usedNames);
    inputDefinitions[portName] = expressionSchema(expression);
    inputProperties[portName] = { $ref: `#/$defs/${portName}` };
    inputPorts[portName] = {
      schemaRef: `${capabilitySchemaId(capability.id, 'inputs')}#/$defs/${portName}`,
      required: true,
      cardinality: inputDefinitions[portName].type === 'array' ? 'many' : 'one'
    };
  }

  const schemas = {
    'inputs.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'inputs'),
      title: `${capability.id} named inputs`,
      ...object(inputProperties),
      $defs: inputDefinitions
    },
    'parameters.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'parameters'),
      title: `${capability.id} parameters`,
      ...object(parameterProperties)
    },
    'result.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'result'),
      title: `${capability.id} succeeded result`,
      $ref: `helix://contracts/types/${capability.outputFamily}/v1`
    },
    'evidence.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'evidence'),
      title: `${capability.id} evidence`,
      $ref: 'helix://contracts/types/EvidenceEnvelope/v1'
    },
    'failure.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'failure'),
      title: `${capability.id} failure`,
      ...object({
        failureClass: text(), code: text(), message: text({ maxLength: 4096 }), retryability: { type: 'string', enum: ['never', 'contract_policy'] },
        evidenceRef: text()
      })
    },
    'fence.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'fence'),
      title: `${capability.id} fence`,
      ...object({
        basisDigest: digest(), inputSetDigest: digest(), eventFenceDigest: digest(), effectScopeDigest: digest()
      }, capability.effectClass === 'pure_observation'
        ? ['basisDigest', 'inputSetDigest']
        : ['basisDigest', 'inputSetDigest', 'eventFenceDigest', 'effectScopeDigest'])
    },
    'resource-demand.schema.json': {
      $schema: DRAFT, $id: capabilitySchemaId(capability.id, 'resource-demand'),
      title: `${capability.id} resource demand`,
      ...object({
        resourceKinds: { type: 'array', prefixItems: resourceKinds(capability).map((kind) => ({ const: kind })),
          minItems: resourceKinds(capability).length, maxItems: resourceKinds(capability).length },
        demandDigest: digest()
      })
    }
  };

  const manifest = {
    schemaVersion: 1,
    capabilityRef: capability.id,
    contractVersion: 1,
    ownerScope: capability.owner,
    effectClass: capability.effectClass,
    inputPorts,
    parametersSchemaRef: schemas['parameters.schema.json'].$id,
    resultSchemaRef: schemas['result.schema.json'].$id,
    evidenceSchemaRef: schemas['evidence.schema.json'].$id,
    failureSchemaRef: schemas['failure.schema.json'].$id,
    fenceSchemaRef: schemas['fence.schema.json'].$id,
    resourceDemandSchemaRef: schemas['resource-demand.schema.json'].$id,
    ...approvalAuthorization(capability.id),
    idempotencyScope: 'event',
    semanticValidatorRef: `helix://contracts/semantic-validators/${capabilityBase(capability.id)}/v1`,
    executorCompatibility: { minimumVersion: 1 },
    sourceLocator: capability.source
  };

  return {
    capabilityRef: capability.id,
    relativePath: packageRelativePath(capability.id),
    files: { 'manifest.json': manifest, ...schemas },
    packageDigest: digestValue({ 'manifest.json': manifest, ...schemas })
  };
}

function buildCapabilityPackages(capabilities) {
  return capabilities.map(buildCapabilityPackage);
}

module.exports = Object.freeze({
  buildCapabilityPackage,
  buildCapabilityPackages,
  capabilitySchemaId,
  digestValue,
  packageRelativePath
});
