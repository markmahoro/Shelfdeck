'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  RULES_SCHEMA_REF,
  SYSTEM_TEMPLATE_ID,
  SYSTEM_TEMPLATE_NAME,
} = require('../../src/helix/domains/arca/model/rule-template-contracts');

const secretRoot = 'p14-rule-template-secret-root-0123456789abcdef';
const roots = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p14-template-'));
  roots.push(root);
  const dataDir = path.join(root, 'data');
  const adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<!doctype html><html><body><div id="root"></div></body></html>',
  );
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  return {
    dataDir,
    adminDistDir,
    initialized,
    databasePath: path.join(dataDir, 'shelfdeck.db'),
  };
}

function unsigned(value, digestField) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== digestField),
  );
}

function reviseMovieRating(rules, rating, maxSizeGiB) {
  const changed = structuredClone(rules);
  const movie = changed.profileRuleSets.find((item) => item.contentProfile === 'movie');
  const branch = movie.decisionBranches.find((item) =>
    item.conditionKind === 'rating_equals' && item.rating === rating);
  branch.requirements.space.maxSizeGiB = maxSizeGiB;
  branch.requirements.space.maxSizeBytes = maxSizeGiB * 1073741824;
  movie.profileRuleSetDigest = canonicalDigest(unsigned(movie, 'profileRuleSetDigest'));
  return changed;
}

async function createShelf(host, headers) {
  const placementValue = {
    folderTemplate: '{title} ({year})',
    primaryTemplate: '{stem}{ext}',
    nfoTemplate: '{stem}.nfo',
    subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
    posterTemplate: 'poster{ext}',
    fanartTemplate: 'fanart{ext}',
    collisionPolicy: 'reject',
  };
  const targetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-template-shelf-'));
  roots.push(targetRoot);
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves',
    headers,
    payload: {
      idempotencyKey: 'template-shelf-create',
      shelfId: 'template-shelf-1',
      name: 'Template Shelf',
      targetRootLocation: targetRoot,
      ruleTemplateId: SYSTEM_TEMPLATE_ID,
      expectedTemplateRevision: 1,
      placementPolicy: placementValue,
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().shelf;
}

test.after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('Rule Template implementation remains Arca owner-local and Composition only wires its public port', () => {
  const serviceRoot = path.resolve(__dirname, '../..');
  const modelSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src',
      'helix',
      'domains',
      'arca',
      'model',
      'rule-template-contracts.js',
    ),
    'utf8',
  );
  const storeSource = fs.readFileSync(
    path.join(
      serviceRoot,
      'src',
      'helix',
      'domains',
      'arca',
      'persistence',
      'rule-template-store.js',
    ),
    'utf8',
  );
  const compositionSource = fs.readFileSync(
    path.join(serviceRoot, 'src', 'helix', 'composition', 'create-clean-facades.js'),
    'utf8',
  );
  const hostSource = fs.readFileSync(
    path.join(serviceRoot, 'src', 'clean-service-host.js'),
    'utf8',
  );
  assert.doesNotMatch(
    modelSource + storeSource,
    /require\([^)]*domains[\\/]+libra|require\([^)]*\.\.[\\/]+\.\.[\\/]+libra/i,
  );
  assert.doesNotMatch(
    compositionSource + hostSource,
    /rule-template-store|createRuleTemplateStore|arca_rule_template|arca_shelves/,
  );
  assert.match(hostSource, /createArcaRuleTemplateAdminApplication/);
  assert.match(storeSource, /owner: 'arca'/);
  assert.doesNotMatch(storeSource, /\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});

test('Arca Rule Template public HTTP preserves immutable system defaults and closed user copy/draft lifecycle', async () => {
  const value = fixture();
  const headers = { 'x-api-key': value.initialized.adminApiKey };
  const host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const unauthenticated = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates',
    });
    assert.equal(unauthenticated.statusCode, 401);

    const listed = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates',
      headers,
    });
    assert.equal(listed.statusCode, 200, listed.body);
    assert.equal(listed.json().items.length, 1);
    const system = listed.json().items[0];
    assert.equal(system.templateId, SYSTEM_TEMPLATE_ID);
    assert.equal(system.name, SYSTEM_TEMPLATE_NAME);
    assert.equal(system.ownerKind, 'system');
    const storedName = new Database(value.databasePath, { readonly: false });
    storedName.prepare('UPDATE arca_rule_templates SET name = ? WHERE rule_template_id = ?')
      .run('Beta Recommended', SYSTEM_TEMPLATE_ID);
    storedName.close();
    const listedAfterEnglishStore = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates',
      headers,
    });
    assert.equal(listedAfterEnglishStore.statusCode, 200, listedAfterEnglishStore.body);
    assert.equal(listedAfterEnglishStore.json().items[0].name, SYSTEM_TEMPLATE_NAME);
    assert.equal(system.current.rulesSchemaRef, RULES_SCHEMA_REF);
    assert.deepEqual(
      system.current.rules.profileRuleSets.map((item) => item.contentProfile),
      ['jav', 'movie', 'series', 'western_adult'],
    );
    const movie = system.current.rules.profileRuleSets.find(
      (item) => item.contentProfile === 'movie',
    );
    assert.equal(movie.decisionBranches[5].requirements.space.maxSizeGiB, 50);
    assert.equal(
      movie.decisionBranches[5].requirements.mandatoryMedia.minimumRasterClass,
      '4k',
    );
    const systemDraft = await host.inject({
      method: 'GET',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/draft`,
      headers,
    });
    assert.equal(systemDraft.statusCode, 200);
    assert.equal(systemDraft.json().writable, false);
    assert.equal(systemDraft.json().reasonCode, 'SYSTEM_TEMPLATE_IMMUTABLE');
    assert.equal(systemDraft.json().draft, null);

    const forbiddenSystemEdit = await host.inject({
      method: 'PATCH',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/draft`,
      headers,
      payload: {
        idempotencyKey: 'system-edit',
        templateId: SYSTEM_TEMPLATE_ID,
        expectedDraftRevision: 1,
        basePublishedRevision: 1,
        rulesSchemaRef: RULES_SCHEMA_REF,
        rules: system.current.rules,
        rulesDigest: system.current.rulesDigest,
      },
    });
    assert.equal(forbiddenSystemEdit.statusCode, 409);
    assert.equal(forbiddenSystemEdit.json().error.code, 'SYSTEM_TEMPLATE_IMMUTABLE');
    const forbiddenSystemPublish = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/publish`,
      headers,
      payload: {
        idempotencyKey: 'system-publish',
        templateId: SYSTEM_TEMPLATE_ID,
        expectedCurrentRevision: 1,
        expectedDraftRevision: 1,
        expectedDraftDigest: system.current.rulesDigest,
        previewId: 'system-preview-does-not-exist',
        previewDigest: '0'.repeat(64),
      },
    });
    assert.equal(forbiddenSystemPublish.statusCode, 409);
    assert.equal(
      forbiddenSystemPublish.json().error.code,
      'SYSTEM_TEMPLATE_IMMUTABLE',
    );

    const copyBody = {
      idempotencyKey: 'copy-user-template-1',
      sourceTemplateId: SYSTEM_TEMPLATE_ID,
      newTemplateId: 'user-template-1',
      name: 'My Collection Standard',
      expectedSourceRevision: 1,
    };
    const copied = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: copyBody,
    });
    assert.equal(copied.statusCode, 201, copied.body);
    assert.equal(copied.json().template.ownerKind, 'user');
    assert.equal(copied.json().draft.draftRevision, 1);
    assert.equal(copied.json().replayed, false);
    const replay = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: copyBody,
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().replayed, true);
    const idempotencyConflict = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: { ...copyBody, name: 'Different Name' },
    });
    assert.equal(idempotencyConflict.statusCode, 409);
    assert.equal(
      idempotencyConflict.json().error.code,
      'ADMIN_RULE_TEMPLATE_IDEMPOTENCY_CONFLICT',
    );
    const targetMismatch = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: {
        ...copyBody,
        idempotencyKey: 'copy-target-mismatch',
        sourceTemplateId: 'another-template',
      },
    });
    assert.equal(targetMismatch.statusCode, 400);
    assert.equal(
      targetMismatch.json().error.code,
      'ADMIN_RULE_TEMPLATE_TARGET_MISMATCH',
    );

    const draftRead = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates/user-template-1/draft',
      headers,
    });
    assert.equal(draftRead.statusCode, 200);
    const changedRules = reviseMovieRating(draftRead.json().draft.rules, 1, 3);
    const draftBody = {
      idempotencyKey: 'revise-user-template-draft-1',
      templateId: 'user-template-1',
      expectedDraftRevision: 1,
      basePublishedRevision: 1,
      rulesSchemaRef: RULES_SCHEMA_REF,
      rules: changedRules,
      rulesDigest: canonicalDigest(changedRules),
    };
    const revised = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/user-template-1/draft',
      headers,
      payload: draftBody,
    });
    assert.equal(revised.statusCode, 200, revised.body);
    assert.equal(revised.json().draft.draftRevision, 2);
    const revisedReplay = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/user-template-1/draft',
      headers,
      payload: draftBody,
    });
    assert.equal(revisedReplay.statusCode, 200);
    assert.equal(revisedReplay.json().replayed, true);
    const wrongDigest = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/user-template-1/draft',
      headers,
      payload: {
        ...draftBody,
        idempotencyKey: 'draft-wrong-digest',
        expectedDraftRevision: 2,
        rulesDigest: '0'.repeat(64),
      },
    });
    assert.equal(wrongDigest.statusCode, 400);
    const draftTargetMismatch = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/user-template-1/draft',
      headers,
      payload: {
        ...draftBody,
        idempotencyKey: 'draft-target-mismatch',
        templateId: 'user-template-2',
      },
    });
    assert.equal(draftTargetMismatch.statusCode, 400);

    const rows = new Database(value.databasePath, { readonly: true });
    assert.equal(
      rows.prepare('SELECT COUNT(*) count FROM arca_rule_templates').get().count,
      2,
    );
    assert.equal(
      rows.prepare("SELECT COUNT(*) count FROM arca_rule_template_drafts WHERE rule_template_id='user-template-1'").get().count,
      1,
    );
    assert.equal(
      rows.prepare("SELECT draft_revision FROM arca_rule_template_drafts WHERE rule_template_id='user-template-1'").get().draft_revision,
      2,
    );
    rows.close();
  } finally {
    await host.close();
  }
});

test('Rule Template publish atomically auto-follows bound Shelves across restart and rolls back a fault', async () => {
  const value = fixture();
  const headers = { 'x-api-key': value.initialized.adminApiKey };
  let host = await createCleanServiceHost({
    dataDir: value.dataDir,
    adminDistDir: value.adminDistDir,
    secretRoot,
  });
  try {
    const shelf = await createShelf(host, headers);
    const copy = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: {
        idempotencyKey: 'follow-copy',
        sourceTemplateId: SYSTEM_TEMPLATE_ID,
        newTemplateId: 'follow-template',
        name: 'Follow Template',
        expectedSourceRevision: 1,
      },
    });
    assert.equal(copy.statusCode, 201, copy.body);
    const bindBody = {
      idempotencyKey: 'bind-follow-template',
      shelfId: shelf.shelfId,
      expectedStandardRevision: 1,
      expectedRoutingProjectionRevision: 1,
      ruleTemplateId: 'follow-template',
      expectedTemplateRevision: 1,
    };
    const bound = await host.inject({
      method: 'POST',
      url: `/v1/admin/shelves/${shelf.shelfId}/actions/bind-template`,
      headers,
      payload: bindBody,
    });
    assert.equal(bound.statusCode, 200, bound.body);
    assert.equal(bound.json().binding.standard.standardRevision, 2);
    const bindReplay = await host.inject({
      method: 'POST',
      url: `/v1/admin/shelves/${shelf.shelfId}/actions/bind-template`,
      headers,
      payload: bindBody,
    });
    assert.equal(bindReplay.statusCode, 200);
    assert.equal(bindReplay.json().replayed, true);
    const bindConflict = await host.inject({
      method: 'POST',
      url: `/v1/admin/shelves/${shelf.shelfId}/actions/bind-template`,
      headers,
      payload: { ...bindBody, expectedTemplateRevision: 2 },
    });
    assert.equal(bindConflict.statusCode, 409);
    assert.equal(
      bindConflict.json().error.code,
      'ADMIN_RULE_TEMPLATE_IDEMPOTENCY_CONFLICT',
    );

    const draft = (await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates/follow-template/draft',
      headers,
    })).json().draft;
    const changedRules = reviseMovieRating(draft.rules, 1, 3);
    const changedDigest = canonicalDigest(changedRules);
    const draftUpdate = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/follow-template/draft',
      headers,
      payload: {
        idempotencyKey: 'follow-draft-2',
        templateId: 'follow-template',
        expectedDraftRevision: 1,
        basePublishedRevision: 1,
        rulesSchemaRef: RULES_SCHEMA_REF,
        rules: changedRules,
        rulesDigest: changedDigest,
      },
    });
    assert.equal(draftUpdate.statusCode, 200, draftUpdate.body);
    const preview = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/preview',
      headers,
      payload: {
        idempotencyKey: 'follow-preview-2',
        templateId: 'follow-template',
        expectedCurrentRevision: 1,
        expectedDraftRevision: 2,
        expectedDraftDigest: changedDigest,
      },
    });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.equal(preview.json().affectedShelfCount, 1);
    assert.equal(preview.json().notOnDeckSubjectSpecChangeCount, null);
    const publishBody = {
      idempotencyKey: 'follow-publish-2',
      templateId: 'follow-template',
      expectedCurrentRevision: 1,
      expectedDraftRevision: 2,
      expectedDraftDigest: changedDigest,
      previewId: preview.json().previewId,
      previewDigest: preview.json().previewDigest,
    };
    const published = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/publish',
      headers,
      payload: publishBody,
    });
    assert.equal(published.statusCode, 200, published.body);
    assert.equal(published.json().template.currentRevision, 2);
    assert.equal(published.json().affectedShelfCount, 1);
    const publishReplay = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/publish',
      headers,
      payload: publishBody,
    });
    assert.equal(publishReplay.statusCode, 200);
    assert.equal(publishReplay.json().replayed, true);

    const shelfAfterPublish = await host.inject({
      method: 'GET',
      url: `/v1/admin/shelves/${shelf.shelfId}`,
      headers,
    });
    assert.equal(shelfAfterPublish.statusCode, 200);
    assert.equal(shelfAfterPublish.json().shelf.currentStandardRevision, 3);
    assert.equal(shelfAfterPublish.json().shelf.routingProjection.revision, 3);
    assert.equal(
      shelfAfterPublish.json().shelf.standard.ruleTemplateRevision,
      2,
    );
    assert.equal(
      shelfAfterPublish.json().shelf.standard.value.standardDigest,
      shelfAfterPublish.json().shelf.standard.digest,
    );
    const movie = shelfAfterPublish.json().shelf.standard.value.profileRuleSets.find(
      (item) => item.contentProfile === 'movie',
    );
    assert.equal(movie.decisionBranches[1].requirements.space.maxSizeGiB, 3);
    const history = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates/follow-template/revisions',
      headers,
    });
    assert.equal(history.statusCode, 200);
    assert.deepEqual(history.json().items.map((item) => item.revision), [1, 2]);
    const archiveBound = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/archive',
      headers,
      payload: {
        idempotencyKey: 'archive-bound-template',
        templateId: 'follow-template',
        expectedCurrentRevision: 2,
      },
    });
    assert.equal(archiveBound.statusCode, 409);
    assert.equal(
      archiveBound.json().error.details.reasonCode,
      'P14_RULE_TEMPLATE_BOUND',
    );

    await host.close();
    host = await createCleanServiceHost({
      dataDir: value.dataDir,
      adminDistDir: value.adminDistDir,
      secretRoot,
    });
    const restarted = await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates/follow-template',
      headers,
    });
    assert.equal(restarted.statusCode, 200);
    assert.equal(restarted.json().template.currentRevision, 2);
    const restartedShelf = await host.inject({
      method: 'GET',
      url: `/v1/admin/shelves/${shelf.shelfId}`,
      headers,
    });
    assert.equal(restartedShelf.statusCode, 200);
    assert.equal(restartedShelf.json().shelf.currentStandardRevision, 3);

    const currentDraft = (await host.inject({
      method: 'GET',
      url: '/v1/admin/rule-templates/follow-template/draft',
      headers,
    })).json().draft;
    const nextRules = reviseMovieRating(currentDraft.rules, 2, 5);
    const nextDigest = canonicalDigest(nextRules);
    const nextDraft = await host.inject({
      method: 'PATCH',
      url: '/v1/admin/rule-templates/follow-template/draft',
      headers,
      payload: {
        idempotencyKey: 'follow-draft-3',
        templateId: 'follow-template',
        expectedDraftRevision: 2,
        basePublishedRevision: 2,
        rulesSchemaRef: RULES_SCHEMA_REF,
        rules: nextRules,
        rulesDigest: nextDigest,
      },
    });
    assert.equal(nextDraft.statusCode, 200, nextDraft.body);
    const nextPreview = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/preview',
      headers,
      payload: {
        idempotencyKey: 'follow-preview-3',
        templateId: 'follow-template',
        expectedCurrentRevision: 2,
        expectedDraftRevision: 3,
        expectedDraftDigest: nextDigest,
      },
    });
    assert.equal(nextPreview.statusCode, 200, nextPreview.body);

    const currentStandard = restartedShelf.json().shelf.standard;
    const collision = new Database(value.databasePath);
    collision.prepare(
      `INSERT INTO arca_shelf_standard_revisions(
        shelf_id,revision,rule_template_id,rule_template_revision,
        standard_schema_ref,standard_json,standard_digest,effective_at_ms
      ) VALUES(?,?,?,?,?,?,?,?)`,
    ).run(
      shelf.shelfId,
      4,
      'follow-template',
      2,
      currentStandard.schemaRef,
      JSON.stringify(currentStandard.value),
      currentStandard.digest,
      Date.now(),
    );
    collision.close();

    const failedPublish = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/follow-template/actions/publish',
      headers,
      payload: {
        idempotencyKey: 'follow-publish-fault',
        templateId: 'follow-template',
        expectedCurrentRevision: 2,
        expectedDraftRevision: 3,
        expectedDraftDigest: nextDigest,
        previewId: nextPreview.json().previewId,
        previewDigest: nextPreview.json().previewDigest,
      },
    });
    assert.equal(failedPublish.statusCode, 400);
    assert.equal(
      failedPublish.json().error.code,
      'ADMIN_RULE_TEMPLATE_COMMAND_REJECTED',
    );
    const audit = new Database(value.databasePath, { readonly: true });
    assert.equal(
      audit.prepare("SELECT current_revision FROM arca_rule_templates WHERE rule_template_id='follow-template'").get().current_revision,
      2,
    );
    assert.equal(
      audit.prepare("SELECT COUNT(*) count FROM arca_rule_template_revisions WHERE rule_template_id='follow-template' AND revision=3").get().count,
      0,
    );
    assert.equal(
      audit.prepare("SELECT current_standard_revision FROM arca_shelves WHERE shelf_id=?").get(shelf.shelfId).current_standard_revision,
      3,
    );
    assert.equal(
      audit.prepare("SELECT COUNT(*) count FROM fx_outbox WHERE aggregate_type='rule_template' AND aggregate_id='follow-template'").get().count,
      1,
    );
    assert.equal(
      audit.prepare("SELECT COUNT(*) count FROM fx_command_receipts WHERE command_contract='arca.admin.rule-template.publish@1'").get().count,
      1,
    );
    audit.close();

    const copyForArchive = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/copy`,
      headers,
      payload: {
        idempotencyKey: 'archive-copy',
        sourceTemplateId: SYSTEM_TEMPLATE_ID,
        newTemplateId: 'archive-template',
        name: 'Archive Template',
        expectedSourceRevision: 1,
      },
    });
    assert.equal(copyForArchive.statusCode, 201);
    const archived = await host.inject({
      method: 'POST',
      url: '/v1/admin/rule-templates/archive-template/actions/archive',
      headers,
      payload: {
        idempotencyKey: 'archive-unbound-template',
        templateId: 'archive-template',
        expectedCurrentRevision: 1,
      },
    });
    assert.equal(archived.statusCode, 200, archived.body);
    assert.equal(archived.json().template.status, 'archived');
    const systemArchive = await host.inject({
      method: 'POST',
      url: `/v1/admin/rule-templates/${SYSTEM_TEMPLATE_ID}/actions/archive`,
      headers,
      payload: {
        idempotencyKey: 'archive-system-template',
        templateId: SYSTEM_TEMPLATE_ID,
        expectedCurrentRevision: 1,
      },
    });
    assert.equal(systemArchive.statusCode, 409);
    assert.equal(systemArchive.json().error.code, 'SYSTEM_TEMPLATE_IMMUTABLE');
  } finally {
    await host.close();
  }
});
