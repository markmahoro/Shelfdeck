'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCapabilityContractValidator } = require('../../src/helix/foundation/capability/contract-validator');
const { catalogueRunToken } = require('../../src/helix/domains/people/application/us-adult-catalogue-registration-evidence');

const SELECTED = 'helix://contracts/domain-types/PeopleSelectedImageHandle/v1';
const IMPORT_INPUTS = 'helix://contracts/capabilities/people.reference_asset.import/v1/inputs';

function loadSchemas() {
  const out = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'schema.json' || entry.name.endsWith('.schema.json')) {
        out.push(JSON.parse(fs.readFileSync(full, 'utf8')));
      }
    }
  }
  walk(path.join(__dirname, '../../src/helix/contracts'));
  return out;
}

function selectedImage(provenance) {
  const basis = {
    schemaRef: SELECTED,
    schemaVersion: 1,
    uploadId: 'a'.repeat(64),
    digestHex: 'b'.repeat(64),
    sizeBytes: 128,
    mediaType: 'image/jpeg',
    provenance,
  };
  return { ...basis, handleDigest: canonicalDigest(basis) };
}

function peopleWorkspace() {
  const body = {
    workspaceId: 'people-image:operation',
    workspaceHandles: [],
    scopeDigest: 'c'.repeat(64),
  };
  return {
    schemaRef: 'helix://contracts/domain-types/PeopleWorkspace/v1',
    schemaVersion: 1,
    objectId: body.workspaceId,
    revision: 1,
    digest: canonicalDigest(body),
    ...body,
  };
}

const validator = createCapabilityContractValidator({ schemas: loadSchemas() });

function assertImportOk(provenance) {
  const handle = selectedImage(provenance);
  assert.doesNotThrow(() => validator.validate(SELECTED, handle));
  assert.doesNotThrow(() => validator.validate(IMPORT_INPUTS, {
    peopleSelectedImageHandle: handle,
    peopleWorkspace: peopleWorkspace(),
  }));
}

function assertImportRejected(provenance) {
  const handle = selectedImage(provenance);
  assert.throws(() => validator.validate(SELECTED, handle), { code: 'P4_CAPABILITY_SCHEMA_REJECTED' });
}

test('catalogue staged provenance shapes pass PeopleSelectedImageHandle and import inputs', () => {
  const runToken = catalogueRunToken('run-contract', 'initial');
  assertImportOk({ source: 'stashbox', sourceObjectId: runToken });
  assertImportOk({ source: 'catalogue_frame', sourceObjectId: runToken });
  assertImportOk({ source: 'user_upload' });
});

test('PeopleSelectedImageHandle provenance rejects undeclared properties', () => {
  const runToken = catalogueRunToken('run-contract', 'initial');
  assertImportRejected({
    source: 'stashbox',
    sourceObjectId: runToken,
    providerKey: 'tpdb-1',
    imageId: 'photo-1',
  });
  assertImportRejected({
    source: 'catalogue_frame',
    sourceObjectId: runToken,
    proofDigest: 'd'.repeat(64),
  });
});
