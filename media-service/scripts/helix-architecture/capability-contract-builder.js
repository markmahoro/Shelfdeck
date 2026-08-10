'use strict';

const crypto = require('crypto');
const { contracts: RESULT_TYPE_CONTRACTS } = require('./result-type-schema-builder');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const PARAMETER_NAMES = new Set(['cursor', 'pageBudget', 'phase', 'quietWindowMs', 'artifactKind', 'structureKind', 'contentProfile']);
const SHARED_TYPES = new Set([
  'PhysicalMaterialIdentity', 'PhysicalMaterialReadHandle', 'WorkspaceMaterialHandle', 'ArtifactHandle', 'FieldAccessHandle', 'FieldObservationPageRequest',
  'IntegrationHandle', 'WorkerHandle', 'CanonicalQueryHandle', 'DomainFactCommitHandle', 'ResponsibilityControlCommitHandle',
  'ApprovalHandle', 'AuthorizationHandle', 'ExternalJobReceipt', 'EffectReceipt', 'TargetCommitSlotHandle', 'ExternalMaterialHandle',
  'WorkerAssetReceipt', 'WorkerUploadReceipt', 'FaceEmbeddingSetHandle', 'FaceClusterSetHandle', 'EvidenceEnvelope',
  'VerificationEnvelope', 'DomainFactEnvelope', 'ReceiptEnvelope', 'ManifestEnvelope', 'DraftEnvelope',
  'CapabilityExecutionContext', 'CapabilityOutcome'
]);
const RESULT_TYPES = new Set(Object.keys(RESULT_TYPE_CONTRACTS));
const HANDLE_LIST_EXPRESSIONS = new Set([
  'Material handles', 'Workspace handles', 'Aftercare Workspace handles', 'People Workspace handles', 'Old Input handles',
  'Product Material handles', 'Superseded Inventory handles'
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
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inputSummary.length; index += 1) {
    if (inputSummary[index] === '(') depth += 1;
    else if (inputSummary[index] === ')') depth -= 1;
    else if (inputSummary[index] === '+' && depth === 0) {
      parts.push(inputSummary.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(inputSummary.slice(start).trim());
  return parts.filter(Boolean);
}

function normalizedTypeName(value) {
  const direct = value.trim().replace(/\[(?:\d+\.\.\d+)?\]$/, '');
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
    'Provider/person hint': 'ProviderPersonHint',
    'PeopleCandidateDraft(registration|merge)': 'PeopleCandidateDraft',
    'Candidates': 'AcquisitionCandidates',
    'Fulfillment result': 'FulfillmentVerification',
    'Resolution draft': 'PerceptionResolutionDraft',
    'Stable evidence': 'StableExternalMaterialEvidence',
    'Staged manifest': 'StagedInventoryManifest',
    'Verified staged manifest': 'StagedInventoryVerification',
    'Verified destruction': 'DestructionCompletionVerification',
    'Verified release': 'ReleaseVerification',
    'Input Settlement Approval': 'ApprovalHandle',
    'Aftercare Settlement Approval': 'ApprovalHandle',
    'Destructive Authorization': 'AuthorizationHandle',
    'External handle': 'ExternalMaterialHandle',
    'Verified Workspace deletion evidence': 'DeletionEvidence',
    'Verified Artifact': 'ArtifactHandle',
    'Verified reference asset': 'ArtifactHandle',
    'Structure Evidence': 'TriageStructureEvidence',
    'Inventory media evidence': 'ProductMediaVerification',
    'Product media evidence': 'ProductMediaVerification',
    'Workspace media evidence': 'ProductMediaVerification'
  };
  return aliases[direct] || pascal(direct);
}

function typeRef(name) {
  if (SHARED_TYPES.has(name)) return `helix://contracts/types/${name}/v${name === 'PhysicalMaterialIdentity' ? 2 : 1}`;
  if (RESULT_TYPES.has(name)) return `helix://contracts/types/${name}/v1`;
  if (name === 'MaterialHandle') return null;
  return `helix://contracts/domain-types/${name}/v1`;
}

function splitTopLevelUnion(expression) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === '(') depth += 1;
    else if (expression[index] === ')') depth -= 1;
    else if (expression[index] === '|' && depth === 0) {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts;
}

function expressionSchema(expression) {
  if (expression === 'FieldObservationLayoutSnapshot') {
    return {
      type: 'object', additionalProperties: false,
      properties: {
        schemaRef: { const: 'helix://contracts/types/FieldObservationLayoutSnapshot/v1' },
        schemaVersion: { const: 1 }, snapshotId: text(), snapshotDigest: digest(), observationId: text(),
        fieldId: text(), parentDirectory: text(),
        entries: { type: 'array', maxItems: 256, items: {
          type: 'object', additionalProperties: false,
          properties: {
            entryOrdinal: { type: 'integer', minimum: 0 }, entryKind: { type: 'string', enum: ['file', 'directory'] },
            relativeLocation: text(), baseName: text(), extension: text(),
            identity: { $ref: typeRef('PhysicalMaterialIdentity') }, endpointId: text({ maxLength: 256 }), location: text(),
            sizeBytes: { type: 'integer', minimum: 0 }, mtimeNs: text(), entryDigest: digest()
          },
          required: ['entryOrdinal', 'entryKind', 'relativeLocation', 'baseName', 'endpointId', 'location', 'entryDigest']
        } }
      },
      required: ['schemaRef', 'schemaVersion', 'snapshotId', 'snapshotDigest', 'observationId', 'fieldId', 'parentDirectory', 'entries'],
      'x-helix-typeExpression': expression
    };
  }
  if (expression === 'mediaCastFactRef?{productFactId,factRevision,factDigest}') {
    return {
      anyOf: [object({
        productFactId: text({ maxLength: 256 }),
        factRevision: { type: 'integer', minimum: 1 },
        factDigest: digest()
      }), { type: 'null' }],
      'x-helix-typeExpression': expression
    };
  }
  if (expression === '(Provider person hint + IntegrationHandle) | OnDeckPersonEvidenceProjectionItem') {
    return { oneOf: [object({ providerPersonHint: { $ref: typeRef('ProviderPersonHint') },
      integrationHandle: { $ref: typeRef('IntegrationHandle') } }),
    { $ref: typeRef('OnDeckPersonEvidenceProjectionItem') }], 'x-helix-typeExpression': expression };
  }
  const exactHandle = {
    'Inventory Material handle': 'PhysicalMaterialReadHandle',
    'Primary handle': 'PhysicalMaterialReadHandle',
    'Unreferenced Related handle': 'PhysicalMaterialReadHandle'
  }[expression];
  if (exactHandle) return { $ref: typeRef(exactHandle), 'x-helix-typeExpression': expression };
  const exactHandleList = {
    'Old Input handles': 'PhysicalMaterialReadHandle',
    'Superseded Inventory handles': 'PhysicalMaterialReadHandle',
    'Aftercare Workspace handles': 'WorkspaceMaterialHandle',
    'People Workspace handles': 'WorkspaceMaterialHandle',
    'Workspace handles': 'WorkspaceMaterialHandle'
  }[expression];
  if (exactHandleList) return { ...arrayOf({ $ref: typeRef(exactHandleList) }), 'x-helix-typeExpression': expression };
  if (expression === 'Product Material handles') {
    return {
      ...arrayOf({ oneOf: ['PhysicalMaterialReadHandle', 'WorkspaceMaterialHandle'].map((name) => ({ $ref: typeRef(name) })) }),
      'x-helix-typeExpression': expression
    };
  }
  const boundedList = expression.match(/\[(\d+)\.\.(\d+)\]/);
  const isMany = /\[\]/.test(expression) || boundedList !== null || HANDLE_LIST_EXPRESSIONS.has(expression);
  let normalizedExpression = expression.replace(/\[(?:\d+\.\.\d+)?\]/g, '').trim();
  if (normalizedExpression.startsWith('(') && normalizedExpression.endsWith(')')) normalizedExpression = normalizedExpression.slice(1, -1).trim();
  const unionParts = splitTopLevelUnion(normalizedExpression).map((value) => normalizedTypeName(value));
  let itemSchema;
  if (unionParts.length > 1) itemSchema = { oneOf: unionParts.map((name) => ({ $ref: typeRef(name) })) };
  else if (unionParts[0] === 'MaterialHandle') {
    itemSchema = { oneOf: ['PhysicalMaterialReadHandle', 'WorkspaceMaterialHandle', 'ArtifactHandle'].map((name) => ({ $ref: typeRef(name) })) };
  } else itemSchema = { $ref: typeRef(unionParts[0]) };
  const schema = isMany ? { ...arrayOf(itemSchema), ...(boundedList ? {
    minItems:Number(boundedList[1]), maxItems:Number(boundedList[2])
  } : {}) } : itemSchema;
  return { ...schema, 'x-helix-typeExpression': expression };
}

function uniquePortName(expression, used) {
  const base = camel(expression
    .replace(/\|/g, ' Or ')
    .replace(/\[(?:\d+\.\.\d+)?\]/g, ' List')
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
  if (name === 'quietWindowMs') return { type: 'integer', minimum: 1, maximum: 86400000 };
  if (name === 'structureKind') return { type: 'string', enum: ['single', 'season'] };
  if (name === 'contentProfile') return { type: 'string', enum: ['movie', 'series', 'jav', 'western_adult'] };
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
  if (capability.id === 'procurement.field.observation.page.commit@1') return ['volume_read', 'sqlite_write'];
  const value = `${capability.id} ${capability.inputSummary}`.toLowerCase();
  const kinds = new Set();
  if (/integration|external|worker|provider|search|acquire|upload|request/.test(value)) kinds.add('network');
  if (/material|filesystem|workspace|artifact|media|frame|hash|layout|inventory|delete|remux|transcode/.test(value)) kinds.add('disk_io');
  if (/transcode|remux|probe|hash|face|frame|analysis|render|normalize|resolve|verify/.test(value)) kinds.add('cpu');
  if (/transcode|remux|face|analysis/.test(value)) kinds.add('compute_device');
  if (capability.id === 'libra.western.analysis.request@1') kinds.delete('network');
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
