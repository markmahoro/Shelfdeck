'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

function fieldBody(fieldId, rootLocation) {
  const policy = {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  };
  return {
    idempotencyKey: `field:${fieldId}:register`,
    fieldId,
    name: '电影文件来源',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: `policy:${fieldId}`,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy,
      policyDigest: canonicalDigest({ extractionPolicyId:`policy:${fieldId}`, revision:1, ...policy }),
    },
    access: {
      fieldId,
      revision: 1,
      rootLocation,
      accessSchemaRef: 'helix://shelfdeck/platform/local-filesystem-field-access/v1',
    },
  };
}

function shelfBody(shelfId, rootLocation) {
  return {
    idempotencyKey: `shelf:${shelfId}:create`,
    shelfId,
    name: '电影收藏架',
    targetRootLocation: rootLocation,
    ruleTemplateId: 'system-beta-recommended',
    expectedTemplateRevision: 1,
    placementPolicy: {
      folderTemplate: '{title} ({year})',
      primaryTemplate: '{stem}{ext}',
      nfoTemplate: '{stem}.nfo',
      subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
      posterTemplate: 'poster{ext}',
      fanartTemplate: 'fanart{ext}',
      collisionPolicy: 'reject',
    },
  };
}

async function authenticate(host, apiKey) {
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key':apiKey },
  });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

for (const order of ['field-first', 'shelf-first']) {
  test(`same-root Field and Shelf share one Platform Mount Scope when registered ${order}`, async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `helix-same-root-${order}-`));
    const dataDir = path.join(root, 'data');
    const adminDistDir = path.join(root, 'admin');
    const mediaRoot = path.join(root, 'media');
    fs.mkdirSync(adminDistDir, { recursive:true });
    fs.mkdirSync(mediaRoot, { recursive:true });
    fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
    const secretRoot = `same-root-${order}-${crypto.randomUUID()}`;
    const initialized = initializeCleanData({
      dataDir,
      confirmation:'INITIALIZE_HELIX_CLEAN_V1',
      secretRoot,
    });
    t.after(() => fs.rmSync(root, { recursive:true, force:true }));
    let host = await createCleanServiceHost({ dataDir, adminDistDir, secretRoot });
    let field;
    let shelf;
    try {
      const cookie = await authenticate(host, initialized.adminApiKey);
      const createField = async () => {
        const response = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie },
          payload:fieldBody(`field-${order}`, mediaRoot) });
        assert.equal(response.statusCode, 201, response.body);
        field = response.json().materialField;
      };
      const createShelf = async () => {
        const response = await host.inject({ method:'POST', url:'/v1/admin/shelves', headers:{ cookie },
          payload:shelfBody(`shelf-${order}`, mediaRoot) });
        assert.equal(response.statusCode, 201, response.body);
        shelf = response.json().shelf;
      };
      if (order === 'field-first') {
        await createField();
        await createShelf();
      } else {
        await createShelf();
        await createField();
      }
      assert.equal(field.access.rootLocation, fs.realpathSync(mediaRoot));
      assert.equal(shelf.target.rootLocation, fs.realpathSync(mediaRoot));
      assert.equal(field.access.endpointId, shelf.target.endpointId);
      assert.equal(field.access.mountScopeId, shelf.target.mountScopeId);
      assert.equal(field.access.mountScopeRevision, shelf.target.mountScopeRevision);
    } finally {
      await host.close();
    }

    const db = new Database(path.join(dataDir, 'shelfdeck.db'), { readonly:true });
    assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scopes').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM platform_mount_scope_revisions').get().count, 1);
    db.close();

    host = await createCleanServiceHost({ dataDir, adminDistDir, secretRoot });
    await host.close();
  });
}

test('Admin Web registration helper no longer manufactures Platform identity fields', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/helix/api.ts'), 'utf8');
  const block = source.slice(source.indexOf('export async function materialFieldRegistration'));
  assert.doesNotMatch(block, /physicalScopeDigest/);
  assert.doesNotMatch(block, /endpointId:\s*`local-fs-/);
  assert.doesNotMatch(block, /mountScopeId:\s*`local-mount-/);
});

test('startup fail-closes a retained Field reference outside the Platform Mount Scope Registry', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-unsafe-retained-scope-'));
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  const mediaRoot = path.join(root, 'media');
  fs.mkdirSync(adminDistDir, { recursive:true });
  fs.mkdirSync(mediaRoot, { recursive:true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = `unsafe-retained-${crypto.randomUUID()}`;
  const initialized = initializeCleanData({ dataDir, confirmation:'INITIALIZE_HELIX_CLEAN_V1', secretRoot });
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  let host = await createCleanServiceHost({ dataDir, adminDistDir, secretRoot });
  try {
    const cookie = await authenticate(host, initialized.adminApiKey);
    const response = await host.inject({ method:'POST', url:'/v1/admin/material-fields', headers:{ cookie },
      payload:fieldBody('field-unsafe-retained', mediaRoot) });
    assert.equal(response.statusCode, 201, response.body);
  } finally {
    await host.close();
  }

  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const db = new Database(databasePath);
  const row = db.prepare('SELECT * FROM proc_field_access_revisions WHERE field_id=? AND revision=1')
    .get('field-unsafe-retained');
  const basis = {
    fieldId: row.field_id,
    revision: Number(row.revision),
    endpointId: row.endpoint_id,
    rootLocation: row.root_location,
    mountScopeId: 'legacy-unregistered-mount-scope',
    mountScopeRevision: Number(row.mount_scope_revision),
    accessSchemaRef: row.access_schema_ref,
  };
  db.prepare('UPDATE proc_field_access_revisions SET mount_scope_id=?,access_digest=? WHERE field_id=? AND revision=1')
    .run(basis.mountScopeId, canonicalDigest(basis), basis.fieldId);
  db.close();

  await assert.rejects(
    createCleanServiceHost({ dataDir, adminDistDir, secretRoot }),
    (error) => error.code === 'HELIX_MOUNT_SCOPE_UNSAFE',
  );
});
