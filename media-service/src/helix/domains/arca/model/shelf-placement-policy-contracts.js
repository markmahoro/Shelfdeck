'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const PLACEMENT_SCHEMA_REF = 'helix://contracts/policies/ArcaShelfPlacementPolicy/v1';
const COLLISION_POLICIES = new Set(['reject', 'suffix']);
const TEMPLATE_TOKEN = /\{(?:title|year)\}/g;

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

function createShelfPlacementPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'folderTemplate') ||
      !Object.hasOwn(value, 'collisionPolicy')) {
    fail('P14_SHELF_PLACEMENT_POLICY_SHAPE', 'Shelf Placement Policy does not match its closed contract.');
  }
  if (typeof value.folderTemplate !== 'string' || value.folderTemplate.length < 1 ||
      value.folderTemplate.length > 256 || !value.folderTemplate.includes('{title}') ||
      value.folderTemplate.includes('..') || /[\\/]/.test(value.folderTemplate)) {
    fail('P14_SHELF_PLACEMENT_TEMPLATE', 'Shelf folder template is invalid.');
  }
  const residue = value.folderTemplate.replace(TEMPLATE_TOKEN, '');
  if (/[{}]/.test(residue)) {
    fail('P14_SHELF_PLACEMENT_TEMPLATE', 'Shelf folder template contains an unsupported token.');
  }
  if (!COLLISION_POLICIES.has(value.collisionPolicy)) {
    fail('P14_SHELF_PLACEMENT_COLLISION', 'Shelf collision policy is unsupported.');
  }
  const policy = Object.freeze({
    folderTemplate: value.folderTemplate,
    collisionPolicy: value.collisionPolicy,
  });
  return Object.freeze({
    schemaRef: PLACEMENT_SCHEMA_REF,
    value: policy,
    digest: canonicalDigest(policy),
  });
}

module.exports = Object.freeze({
  PLACEMENT_SCHEMA_REF,
  ShelfPlacementPolicyContractError,
  createShelfPlacementPolicy,
});
