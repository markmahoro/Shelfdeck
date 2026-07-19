'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positive = () => ({ type: 'integer', minimum: 1 });
const nonNegative = () => ({ type: 'integer', minimum: 0 });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

function productDeliveryQuery() {
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryQuery'),
    title: 'ProductDeliveryQuery@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      queryContract: { const: 'libra.product-delivery@1' },
      readPurpose: { type: 'string', enum: ['historical', 'acceptance_fence'] },
      offerId: id(),
      onDeckPackageId: id(),
      expectedPackageRevision: positive(),
      expectedPackageDigest: digest()
    })
  };
}

function deliveryFence() {
  return object({
    eligibility: { type: 'string', enum: ['eligible', 'ineligible'] },
    reasonCode: { type: 'string', enum: [
      'run_not_active', 'spec_not_current', 'package_not_current', 'delivery_already_terminal', 'control_not_libra'
    ] },
    libraRunId: id(),
    runState: { type: 'string', enum: ['active', 'suspended', 'superseded', 'frozen', 'completed', 'discarded'] },
    runStateRevision: positive(),
    runStateDigest: digest(),
    acceptanceSpecId: id(),
    packageRevisionHead: nonNegative(),
    deliveryReceiptAbsent: { type: 'boolean' },
    productControlSetDigest: digest(),
    fenceDigest: digest()
  }, [
    'eligibility', 'libraRunId', 'runState', 'runStateRevision', 'runStateDigest', 'acceptanceSpecId',
    'packageRevisionHead', 'deliveryReceiptAbsent', 'fenceDigest'
  ], {
    allOf: [{
      if: { properties: { eligibility: { const: 'eligible' } } },
      then: {
        properties: { runState: { const: 'active' }, deliveryReceiptAbsent: { const: true } },
        not: { required: ['reasonCode'] }
      },
      else: { required: ['reasonCode'] }
    }]
  });
}

function productDeliveryReadResult() {
  const found = object({
    resultKind: { const: 'found' },
    onDeckProductPackage: { $ref: 'helix://contracts/types/OnDeckProductPackage/v1' },
    deliveryFence: { oneOf: [deliveryFence(), { type: 'null' }] },
    readDigest: digest()
  });
  const notFound = object({
    resultKind: { const: 'not_found' },
    reasonCode: { const: 'package_missing' },
    checkedAtMs: nonNegative()
  });
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryReadResult'),
    title: 'ProductDeliveryReadResult@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024 * 1024,
    oneOf: [found, notFound]
  };
}

function buildLibraApplicationSchemas() {
  return Object.freeze({
    ProductDeliveryQuery: productDeliveryQuery(),
    ProductDeliveryReadResult: productDeliveryReadResult()
  });
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

function schemaDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

module.exports = Object.freeze({ buildLibraApplicationSchemas, schemaDigest, typeId });
