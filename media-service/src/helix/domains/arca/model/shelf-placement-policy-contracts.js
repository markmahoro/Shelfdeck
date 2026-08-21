'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const PLACEMENT_SCHEMA_REF = 'helix://contracts/policies/ArcaShelfPlacementPolicy/v1';
const COLLISION_POLICIES = new Set(['reject', 'suffix']);
const POLICY_FIELDS = Object.freeze([
  'folderTemplate',
  'primaryTemplate',
  'nfoTemplate',
  'subtitleTemplate',
  'posterTemplate',
  'fanartTemplate',
  'collisionPolicy',
]);
const DEFAULT_SHELF_PLACEMENT_POLICY = Object.freeze({
  folderTemplate: '{title} ({year})',
  primaryTemplate: '{stem}{ext}',
  nfoTemplate: '{stem}.nfo',
  subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
  posterTemplate: 'poster{ext}',
  fanartTemplate: 'fanart{ext}',
  collisionPolicy: 'reject',
});
const TEMPLATE_SPECS = Object.freeze({
  folderTemplate: Object.freeze({ tokens: ['title', 'year'], required: ['title'] }),
  primaryTemplate: Object.freeze({ tokens: ['stem', 'ext'], required: ['stem', 'ext'] }),
  nfoTemplate: Object.freeze({ tokens: ['stem', 'ext'], required: ['stem'] }),
  subtitleTemplate: Object.freeze({ tokens: ['stem', 'language', 'forced', 'sdh', 'ext'], required: ['stem', 'ext'] }),
  posterTemplate: Object.freeze({ tokens: ['ext'], required: ['ext'] }),
  fanartTemplate: Object.freeze({ tokens: ['ext'], required: ['ext'] }),
});

class ShelfPlacementPolicyContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ShelfPlacementPolicyContractError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ShelfPlacementPolicyContractError(code, message, details);
}

function validateTemplate(field, template) {
  const spec = TEMPLATE_SPECS[field];
  if (typeof template !== 'string' || template.length < 1 || template.length > 256 ||
      template.includes('..') || /[\\/]/.test(template)) {
    fail('P14_SHELF_PLACEMENT_TEMPLATE', 'Shelf ' + field + ' is invalid.', { field });
  }
  const tokens = Array.from(template.matchAll(/\{([^{}]+)\}/g), (match) => match[1]);
  if (/[{}]/.test(template.replace(/\{[^{}]+\}/g, '')) ||
      tokens.some((token) => !spec.tokens.includes(token)) ||
      spec.required.some((token) => !tokens.includes(token))) {
    fail('P14_SHELF_PLACEMENT_TEMPLATE', 'Shelf ' + field + ' contains an unsupported or missing token.', { field });
  }
}

function createShelfPlacementPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== POLICY_FIELDS.length ||
      POLICY_FIELDS.some((field) => !Object.hasOwn(value, field))) {
    fail('P14_SHELF_PLACEMENT_POLICY_SHAPE', 'Shelf Placement Policy does not match its closed contract.');
  }
  Object.keys(TEMPLATE_SPECS).forEach((field) => validateTemplate(field, value[field]));
  if (!COLLISION_POLICIES.has(value.collisionPolicy)) {
    fail('P14_SHELF_PLACEMENT_COLLISION', 'Shelf collision policy is unsupported.');
  }
  const policy = Object.freeze(Object.fromEntries(POLICY_FIELDS.map((field) => [field, value[field]])));
  return Object.freeze({
    schemaRef: PLACEMENT_SCHEMA_REF,
    value: policy,
    digest: canonicalDigest(policy),
  });
}

module.exports = Object.freeze({
  PLACEMENT_SCHEMA_REF,
  DEFAULT_SHELF_PLACEMENT_POLICY,
  ShelfPlacementPolicyContractError,
  createShelfPlacementPolicy,
});
