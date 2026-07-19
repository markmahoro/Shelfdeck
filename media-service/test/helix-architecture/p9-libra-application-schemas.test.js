'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildLibraApplicationSchemas, schemaDigest, typeId
} = require('../../scripts/helix-architecture/libra-application-schema-builder');

const root = path.resolve(__dirname, '../../src/helix/contracts');

test('materializes the SSOT-exact Product Delivery application contracts reproducibly', () => {
  const schemas = buildLibraApplicationSchemas();
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'libra-application-type-registry.json'), 'utf8'));
  assert.equal(registry.targetCount, 2);
  for (const [name, schema] of Object.entries(schemas)) {
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'application-types', name, 'v1/schema.json'), 'utf8'));
    assert.deepEqual(stored, schema);
    const entry = registry.entries.find((item) => item.id === name);
    assert.equal(entry.schemaId, typeId(name));
    assert.equal(entry.digest.value, schemaDigest(schema));
  }
});

test('Product Delivery query and read variants close history and acceptance fencing', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.deepEqual(schemas.ProductDeliveryQuery.properties.readPurpose.enum, ['historical', 'acceptance_fence']);
  assert.equal(schemas.ProductDeliveryQuery.properties.queryContract.const, 'libra.product-delivery@1');
  const [found, notFound] = schemas.ProductDeliveryReadResult.oneOf;
  assert.equal(found.properties.onDeckProductPackage.$ref, 'helix://contracts/types/OnDeckProductPackage/v1');
  assert.equal(found.properties.deliveryFence.oneOf[1].type, 'null');
  assert.equal(notFound.properties.reasonCode.const, 'package_missing');
});
