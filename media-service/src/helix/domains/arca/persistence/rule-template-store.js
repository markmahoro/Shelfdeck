'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  RULES_SCHEMA_REF,
  SYSTEM_TEMPLATE_ID,
  SYSTEM_TEMPLATE_NAME,
  buildShelfStandard,
  validateRuleTemplateRules,
} = require('../model/rule-template-contracts');

const SHA256 = /^[a-f0-9]{64}$/;
const STANDARD_SCHEMA_REF = 'helix://contracts/types/ShelfStandard/v1';

class ArcaRuleTemplateStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArcaRuleTemplateStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ArcaRuleTemplateStoreError(code, message, details);
}

function exact(value, keys, code, path = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'Rule Template input does not match its closed contract.', { path });
  }
}

function text(value, path, maximum = 256) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    fail('P14_RULE_TEMPLATE_TEXT', 'Rule Template text is outside its bound.', { path });
  }
  return value;
}

function revision(value, path, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('P14_RULE_TEMPLATE_REVISION', 'Rule Template revision is invalid.', { path });
  }
  return value;
}

function digest(value, path) {
  if (!SHA256.test(value || '')) {
    fail('P14_RULE_TEMPLATE_DIGEST', 'Rule Template digest must be lowercase SHA-256.', { path });
  }
  return value;
}

function utf8Compare(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function createRuleTemplateStore(options) {
  if (!options?.schemaManifest || !options?.unitOfWork) {
    throw new TypeError('Arca Rule Template store requires clean persistence dependencies.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_rule_template_repository',
    owner: 'arca',
    schemaManifest: options.schemaManifest,
    statements: {
      list_templates: {
        kind: 'select-all',
        tableId: 'arca_rule_templates',
        columns: [
          'rule_template_id',
          'name',
          'owner_kind',
          'status',
          'current_revision',
          'created_at_ms',
          'archived_at_ms',
        ],
        keyColumns: [],
      },
      find_template: {
        kind: 'select-one',
        tableId: 'arca_rule_templates',
        columns: [
          'rule_template_id',
          'name',
          'owner_kind',
          'status',
          'current_revision',
          'created_at_ms',
          'archived_at_ms',
        ],
        keyColumns: ['rule_template_id'],
      },
      insert_template: {
        kind: 'insert',
        tableId: 'arca_rule_templates',
        columns: [
          'rule_template_id',
          'name',
          'owner_kind',
          'status',
          'current_revision',
          'created_at_ms',
          'archived_at_ms',
        ],
      },
      advance_template_head: {
        kind: 'update',
        tableId: 'arca_rule_templates',
        setColumns: ['current_revision'],
        keyColumns: ['rule_template_id'],
        compareColumns: [
          { column: 'current_revision', parameter: 'expected_revision' },
          { column: 'status', parameter: 'expected_status' },
        ],
      },
      archive_template: {
        kind: 'update',
        tableId: 'arca_rule_templates',
        setColumns: ['status', 'archived_at_ms'],
        keyColumns: ['rule_template_id'],
        compareColumns: [
          { column: 'current_revision', parameter: 'expected_revision' },
          { column: 'status', parameter: 'expected_status' },
        ],
      },
      find_revision: {
        kind: 'select-one',
        tableId: 'arca_rule_template_revisions',
        columns: [
          'rule_template_id',
          'revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'published_at_ms',
        ],
        keyColumns: ['rule_template_id', 'revision'],
      },
      list_revisions: {
        kind: 'select-all',
        tableId: 'arca_rule_template_revisions',
        columns: [
          'rule_template_id',
          'revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'published_at_ms',
        ],
        keyColumns: ['rule_template_id'],
      },
      insert_revision: {
        kind: 'insert',
        tableId: 'arca_rule_template_revisions',
        columns: [
          'rule_template_id',
          'revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'published_at_ms',
        ],
      },
      find_draft: {
        kind: 'select-one',
        tableId: 'arca_rule_template_drafts',
        columns: [
          'rule_template_id',
          'draft_revision',
          'base_published_revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'updated_at_ms',
        ],
        keyColumns: ['rule_template_id'],
      },
      insert_draft: {
        kind: 'insert',
        tableId: 'arca_rule_template_drafts',
        columns: [
          'rule_template_id',
          'draft_revision',
          'base_published_revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'updated_at_ms',
        ],
      },
      update_draft: {
        kind: 'update',
        tableId: 'arca_rule_template_drafts',
        setColumns: [
          'draft_revision',
          'base_published_revision',
          'rules_schema_ref',
          'rules_json',
          'rules_digest',
          'updated_at_ms',
        ],
        keyColumns: ['rule_template_id'],
        compareColumns: [
          { column: 'draft_revision', parameter: 'expected_draft_revision' },
        ],
      },
      list_shelves: {
        kind: 'select-all',
        tableId: 'arca_shelves',
        columns: [
          'shelf_id',
          'status',
          'current_standard_revision',
          'routing_projection_revision',
          'routing_projection_digest',
          'updated_at_ms',
        ],
        keyColumns: [],
      },
      find_shelf: {
        kind: 'select-one',
        tableId: 'arca_shelves',
        columns: [
          'shelf_id',
          'status',
          'current_standard_revision',
          'routing_projection_revision',
          'routing_projection_digest',
          'updated_at_ms',
        ],
        keyColumns: ['shelf_id'],
      },
      find_standard: {
        kind: 'select-one',
        tableId: 'arca_shelf_standard_revisions',
        columns: [
          'shelf_id',
          'revision',
          'rule_template_id',
          'rule_template_revision',
          'standard_schema_ref',
          'standard_json',
          'standard_digest',
          'effective_at_ms',
        ],
        keyColumns: ['shelf_id', 'revision'],
      },
      insert_standard: {
        kind: 'insert',
        tableId: 'arca_shelf_standard_revisions',
        columns: [
          'shelf_id',
          'revision',
          'rule_template_id',
          'rule_template_revision',
          'standard_schema_ref',
          'standard_json',
          'standard_digest',
          'effective_at_ms',
        ],
      },
      advance_shelf_head: {
        kind: 'update',
        tableId: 'arca_shelves',
        setColumns: [
          'current_standard_revision',
          'routing_projection_revision',
          'routing_projection_digest',
          'updated_at_ms',
        ],
        keyColumns: ['shelf_id'],
        compareColumns: [
          { column: 'current_standard_revision', parameter: 'expected_standard_revision' },
          { column: 'routing_projection_revision', parameter: 'expected_projection_revision' },
          { column: 'status', parameter: 'expected_status' },
        ],
      },
      list_shelf_entries: {
        kind: 'select-all',
        tableId: 'arca_shelf_entries',
        columns: ['shelf_entry_id', 'status'],
        keyColumns: ['shelf_id'],
      },
    },
  });
  const commandEvidence = createRepositoryDefinition({
    repositoryId: 'arca_rule_template_command_evidence',
    owner: 'execution-foundation',
    schemaManifest: options.schemaManifest,
    statements: {
      find_receipt_by_id: {
        kind: 'select-one',
        tableId: 'fx_command_receipts',
        columns: [
          'command_receipt_id',
          'owner_domain',
          'command_contract',
          'caller_scope',
          'request_digest',
          'target_id',
          'result_ref_json',
          'result_digest',
        ],
        keyColumns: ['command_receipt_id'],
      },
    },
  });
  const commandCommit = createCommandCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
  });
  const execute = (body) => options.unitOfWork.execute([{
    participantId: 'arca_rule_template_query',
    owner: 'arca',
    repositories: [repository],
    execute: body,
  }]).arca_rule_template_query;
  const readEvidence = (body) => options.unitOfWork.execute([{
    participantId: 'arca_rule_template_evidence_query',
    owner: 'execution-foundation',
    repositories: [commandEvidence],
    execute: body,
  }]).arca_rule_template_evidence_query;

  function mapRevision(row) {
    if (!row) return null;
    let rules;
    try {
      rules = JSON.parse(row.rules_json);
    } catch (_error) {
      fail('P14_RULE_TEMPLATE_STORAGE_INTEGRITY', 'Stored Rule Template revision is not JSON.');
    }
    validateRuleTemplateRules(row.rules_schema_ref, rules, row.rules_digest);
    return Object.freeze({
      templateId: row.rule_template_id,
      revision: row.revision,
      rulesSchemaRef: row.rules_schema_ref,
      rules,
      rulesDigest: row.rules_digest,
      publishedAtMs: row.published_at_ms,
    });
  }

  function mapDraft(row) {
    if (!row) return null;
    let rules;
    try {
      rules = JSON.parse(row.rules_json);
    } catch (_error) {
      fail('P14_RULE_TEMPLATE_STORAGE_INTEGRITY', 'Stored Rule Template draft is not JSON.');
    }
    validateRuleTemplateRules(row.rules_schema_ref, rules, row.rules_digest);
    return Object.freeze({
      templateId: row.rule_template_id,
      draftRevision: row.draft_revision,
      basePublishedRevision: row.base_published_revision,
      rulesSchemaRef: row.rules_schema_ref,
      rules,
      rulesDigest: row.rules_digest,
      updatedAtMs: row.updated_at_ms,
    });
  }

  function draftSummary(draft) {
    return draft && Object.freeze({
      templateId: draft.templateId,
      draftRevision: draft.draftRevision,
      basePublishedRevision: draft.basePublishedRevision,
      rulesSchemaRef: draft.rulesSchemaRef,
      rulesDigest: draft.rulesDigest,
      updatedAtMs: draft.updatedAtMs,
    });
  }

  function mapTemplate(repo, row, includeRevision = true) {
    if (!row) return null;
    const template = {
      templateId: row.rule_template_id,
      name: row.rule_template_id === SYSTEM_TEMPLATE_ID ? SYSTEM_TEMPLATE_NAME : row.name,
      ownerKind: row.owner_kind,
      status: row.status,
      currentRevision: row.current_revision,
      createdAtMs: row.created_at_ms,
      archivedAtMs: row.archived_at_ms,
    };
    if (includeRevision) {
      const current = mapRevision(repo.invoke('find_revision', {
        rule_template_id: row.rule_template_id,
        revision: row.current_revision,
      }));
      if (!current) {
        fail('P14_RULE_TEMPLATE_STORAGE_INTEGRITY', 'Rule Template head does not resolve.');
      }
      template.current = current;
    }
    return Object.freeze(template);
  }

  function findTemplate(repo, templateId) {
    return mapTemplate(repo, repo.invoke('find_template', { rule_template_id: templateId }));
  }

  function listTemplates() {
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      return Object.freeze(repo.invoke('list_templates')
        .sort((left, right) => utf8Compare(left.rule_template_id, right.rule_template_id))
        .map((row) => mapTemplate(repo, row)));
    });
  }

  function getTemplate(templateId) {
    text(templateId, 'templateId');
    return execute((context) =>
      findTemplate(context.repository(repository.repositoryId), templateId));
  }

  function getDraft(templateId) {
    text(templateId, 'templateId');
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      const template = findTemplate(repo, templateId);
      if (!template) return null;
      return Object.freeze({
        templateId,
        writable: template.ownerKind === 'user' && template.status === 'active',
        reasonCode: template.ownerKind === 'system' ? 'SYSTEM_TEMPLATE_IMMUTABLE' : null,
        draft: mapDraft(repo.invoke('find_draft', { rule_template_id: templateId })),
      });
    });
  }

  function history(templateId) {
    text(templateId, 'templateId');
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      if (!repo.invoke('find_template', { rule_template_id: templateId })) return null;
      return Object.freeze(repo.invoke('list_revisions', { rule_template_id: templateId })
        .sort((left, right) => left.revision - right.revision)
        .map(mapRevision));
    });
  }

  function command(
    request,
    operation,
    targetId,
    apply,
    resultEnvelope,
    outboxMessages,
    targetType = 'rule_template',
  ) {
    if (!request || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      fail('IDEMPOTENCY_KEY_REQUIRED', 'Rule Template command requires idempotencyKey.');
    }
    const commandContract = 'arca.admin.rule-template.' + operation + '@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({
      commandContract,
      idempotencyKey: request.idempotencyKey,
      targetId,
    });
    const committed = commandCommit.execute({
      command: {
        commandReceiptId: 'arca-rule-template-' + operation + '-receipt-' +
          keyDigest.slice(0, 32),
        ownerDomain: 'arca',
        commandContract,
        callerScope: 'admin',
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        targetType,
        targetId,
      },
      domainParticipant: {
        participantId: 'arca_rule_template_' + operation,
        owner: 'arca',
        repositories: [repository],
        execute: apply,
      },
      commitMarker: {
        commitMarker: 'arca-rule-template-' + operation + '-' + keyDigest,
        scopeType: targetType,
        scopeId: targetId,
        commitDigest: requestDigest,
      },
      auditRecords: [{
        auditId: 'arca-rule-template-' + operation + '-audit-' +
          keyDigest.slice(0, 32),
        actorType: 'admin',
        action: operation + '_rule_template',
        scopeType: targetType,
        scopeId: targetId,
        evidenceDigest: requestDigest,
      }],
      ...(outboxMessages ? { outboxMessages } : {}),
      resultEnvelope,
    });
    return Object.freeze({
      value: committed.receipt.resultRef,
      replayed: committed.replayed,
    });
  }

  function copyTemplate(request) {
    const input = request?.input;
    exact(input, [
      'sourceTemplateId',
      'newTemplateId',
      'name',
      'expectedSourceRevision',
    ], 'P14_RULE_TEMPLATE_COPY_INPUT');
    text(input.sourceTemplateId, 'sourceTemplateId');
    text(input.newTemplateId, 'newTemplateId');
    text(input.name, 'name');
    revision(input.expectedSourceRevision, 'expectedSourceRevision');
    if (input.sourceTemplateId === input.newTemplateId) {
      fail('P14_RULE_TEMPLATE_COPY_IDENTITY', 'Copied Rule Template requires a new stable identity.');
    }
    return command(
      request,
      'copy',
      input.newTemplateId,
      (context) => {
        const repo = context.repository(repository.repositoryId);
        if (repo.invoke('find_template', { rule_template_id: input.newTemplateId })) {
          fail('P14_RULE_TEMPLATE_EXISTS', 'Target Rule Template already exists.');
        }
        const source = findTemplate(repo, input.sourceTemplateId);
        if (!source) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Source Rule Template does not exist.');
        if (source.status !== 'active' || source.currentRevision !== input.expectedSourceRevision) {
          fail('P14_RULE_TEMPLATE_HEAD_CAS', 'Source Rule Template head is stale.');
        }
        const sourceRevision = source.current;
        repo.invoke('insert_template', {
          rule_template_id: input.newTemplateId,
          name: input.name,
          owner_kind: 'user',
          status: 'active',
          current_revision: 1,
          created_at_ms: context.commitTimeMs,
          archived_at_ms: null,
        });
        repo.invoke('insert_revision', {
          rule_template_id: input.newTemplateId,
          revision: 1,
          rules_schema_ref: sourceRevision.rulesSchemaRef,
          rules_json: canonicalJson(sourceRevision.rules),
          rules_digest: sourceRevision.rulesDigest,
          published_at_ms: context.commitTimeMs,
        });
        repo.invoke('insert_draft', {
          rule_template_id: input.newTemplateId,
          draft_revision: 1,
          base_published_revision: 1,
          rules_schema_ref: sourceRevision.rulesSchemaRef,
          rules_json: canonicalJson(sourceRevision.rules),
          rules_digest: sourceRevision.rulesDigest,
          updated_at_ms: context.commitTimeMs,
        });
        return Object.freeze({
          template: mapTemplate(
            repo,
            repo.invoke('find_template', { rule_template_id: input.newTemplateId }),
            false,
          ),
          draft: draftSummary(mapDraft(repo.invoke('find_draft', {
            rule_template_id: input.newTemplateId,
          }))),
        });
      },
      (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplateCopyResult/v1',
        resultRef: result,
      }),
    );
  }

  function reviseDraft(request) {
    const input = request?.input;
    exact(input, [
      'templateId',
      'expectedDraftRevision',
      'basePublishedRevision',
      'rulesSchemaRef',
      'rules',
      'rulesDigest',
    ], 'P14_RULE_TEMPLATE_DRAFT_INPUT');
    text(input.templateId, 'templateId');
    revision(input.expectedDraftRevision, 'expectedDraftRevision');
    revision(input.basePublishedRevision, 'basePublishedRevision');
    validateRuleTemplateRules(input.rulesSchemaRef, input.rules, input.rulesDigest);
    return command(
      request,
      'draft',
      input.templateId,
      (context) => {
        const repo = context.repository(repository.repositoryId);
        const template = findTemplate(repo, input.templateId);
        if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
        if (template.ownerKind === 'system') {
          fail('SYSTEM_TEMPLATE_IMMUTABLE', 'System Rule Template is immutable.');
        }
        if (template.status !== 'active' ||
            template.currentRevision !== input.basePublishedRevision) {
          fail('P14_RULE_TEMPLATE_HEAD_CAS', 'Rule Template base revision is stale.');
        }
        const draft = mapDraft(repo.invoke('find_draft', {
          rule_template_id: input.templateId,
        }));
        if (!draft || draft.draftRevision !== input.expectedDraftRevision) {
          fail('P14_RULE_TEMPLATE_DRAFT_CAS', 'Rule Template draft revision is stale.');
        }
        const nextDraftRevision = input.expectedDraftRevision + 1;
        const changed = repo.invoke('update_draft', {
          draft_revision: nextDraftRevision,
          base_published_revision: input.basePublishedRevision,
          rules_schema_ref: input.rulesSchemaRef,
          rules_json: canonicalJson(input.rules),
          rules_digest: input.rulesDigest,
          updated_at_ms: Math.max(context.commitTimeMs, draft.updatedAtMs + 1),
          rule_template_id: input.templateId,
          expected_draft_revision: input.expectedDraftRevision,
        });
        if (changed.changes !== 1) {
          fail('P14_RULE_TEMPLATE_DRAFT_CAS', 'Rule Template draft CAS failed.');
        }
        return draftSummary(mapDraft(repo.invoke('find_draft', {
          rule_template_id: input.templateId,
        })));
      },
      (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplateDraftResult/v1',
        resultRef: { draft: result },
      }),
    );
  }

  function boundShelves(repo, templateId) {
    const result = [];
    for (const shelf of repo.invoke('list_shelves')) {
      if (shelf.status !== 'active') continue;
      const standard = repo.invoke('find_standard', {
        shelf_id: shelf.shelf_id,
        revision: shelf.current_standard_revision,
      });
      if (!standard) {
        fail('P14_RULE_TEMPLATE_SHELF_INTEGRITY', 'Shelf Standard head does not resolve.');
      }
      if (standard.rule_template_id !== templateId) continue;
      result.push(Object.freeze({
        shelfId: shelf.shelf_id,
        currentStandardRevision: shelf.current_standard_revision,
        currentStandardDigest: standard.standard_digest,
        routingProjectionRevision: shelf.routing_projection_revision,
        routingProjectionDigest: shelf.routing_projection_digest,
        currentEntryCount: repo.invoke('list_shelf_entries', {
          shelf_id: shelf.shelf_id,
        }).filter((entry) => entry.status === 'active').length,
      }));
    }
    result.sort((left, right) => utf8Compare(left.shelfId, right.shelfId));
    if (result.length > 256) {
      fail('OPERATIONAL_SCALE_LIMIT', 'A Rule Template cannot bind more than 256 active Shelves.');
    }
    return Object.freeze(result);
  }

  function previewTemplate(request) {
    const input = request?.input;
    exact(input, [
      'templateId',
      'expectedCurrentRevision',
      'expectedDraftRevision',
      'expectedDraftDigest',
    ], 'P14_RULE_TEMPLATE_PREVIEW_INPUT');
    text(input.templateId, 'templateId');
    revision(input.expectedCurrentRevision, 'expectedCurrentRevision');
    revision(input.expectedDraftRevision, 'expectedDraftRevision');
    digest(input.expectedDraftDigest, 'expectedDraftDigest');
    if (!request || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      fail('IDEMPOTENCY_KEY_REQUIRED', 'Rule Template preview requires idempotencyKey.');
    }
    const commandContract = 'arca.admin.rule-template.preview@1';
    const requestDigest = canonicalDigest({ commandContract, input });
    const keyDigest = canonicalDigest({
      commandContract,
      idempotencyKey: request.idempotencyKey,
      targetId: input.templateId,
    });
    const previewId = 'arca-rule-template-preview-' + keyDigest.slice(0, 32);
    const committed = commandCommit.execute({
      command: {
        commandReceiptId: previewId,
        ownerDomain: 'arca',
        commandContract,
        callerScope: 'admin',
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        targetType: 'rule_template',
        targetId: input.templateId,
      },
      domainParticipant: {
        participantId: 'arca_rule_template_preview',
        owner: 'arca',
        repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId);
          const template = findTemplate(repo, input.templateId);
          if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
          if (template.ownerKind === 'system') {
            fail('SYSTEM_TEMPLATE_IMMUTABLE', 'System Rule Template is immutable.');
          }
          const draft = mapDraft(repo.invoke('find_draft', { rule_template_id: input.templateId }));
          if (template.status !== 'active' ||
              template.currentRevision !== input.expectedCurrentRevision ||
              !draft ||
              draft.basePublishedRevision !== input.expectedCurrentRevision ||
              draft.draftRevision !== input.expectedDraftRevision ||
              draft.rulesDigest !== input.expectedDraftDigest) {
            fail('P14_RULE_TEMPLATE_PREVIEW_CAS', 'Rule Template preview basis is stale.');
          }
          const shelves = boundShelves(repo, input.templateId);
          const affectedShelfSetDigest = canonicalDigest({
            schema: 'arca.rule-template-affected-shelf-set@1',
            items: shelves,
          });
          const currentEntryPotentialGapCount = shelves
            .reduce((sum, shelf) => sum + shelf.currentEntryCount, 0);
          const previewBase = {
            previewId,
            templateId: input.templateId,
            expectedCurrentRevision: input.expectedCurrentRevision,
            expectedDraftRevision: input.expectedDraftRevision,
            expectedDraftDigest: input.expectedDraftDigest,
            affectedShelfCount: shelves.length,
            affectedShelfSetDigest,
            currentEntryPotentialGapCount,
            notOnDeckSubjectSpecChangeCount: null,
            unresolvedReasonCodes: ['libra_subject_impact_projection_unavailable'],
          };
          return Object.freeze({
            ...previewBase,
            previewDigest: canonicalDigest(previewBase),
          });
        },
      },
      commitMarker: {
        commitMarker: 'arca-rule-template-preview-' + keyDigest,
        scopeType: 'rule_template',
        scopeId: input.templateId,
        commitDigest: requestDigest,
      },
      auditRecords: [{
        auditId: 'arca-rule-template-preview-audit-' + keyDigest.slice(0, 32),
        actorType: 'admin',
        action: 'preview_rule_template',
        scopeType: 'rule_template',
        scopeId: input.templateId,
        evidenceDigest: requestDigest,
      }],
      resultEnvelope: (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplatePreviewResult/v1',
        resultRef: result,
      }),
    });
    return Object.freeze({
      ...committed.receipt.resultRef,
      replayed: committed.replayed,
    });
  }

  function readPreview(input) {
    const row = readEvidence((context) =>
      context.repository(commandEvidence.repositoryId).invoke('find_receipt_by_id', {
        command_receipt_id: input.previewId,
      }));
    if (!row || row.owner_domain !== 'arca' ||
        row.command_contract !== 'arca.admin.rule-template.preview@1' ||
        row.caller_scope !== 'admin' ||
        row.target_id !== input.templateId) {
      fail('P14_RULE_TEMPLATE_PREVIEW_REQUIRED', 'Publish requires its exact durable preview.');
    }
    let result;
    try {
      result = JSON.parse(row.result_ref_json);
    } catch (_error) {
      fail('P14_RULE_TEMPLATE_PREVIEW_CORRUPT', 'Rule Template preview receipt is corrupt.');
    }
    if (!result || canonicalDigest(result) !== row.result_digest ||
        result.previewId !== input.previewId ||
        result.previewDigest !== input.previewDigest ||
        result.templateId !== input.templateId ||
        result.expectedCurrentRevision !== input.expectedCurrentRevision ||
        result.expectedDraftRevision !== input.expectedDraftRevision ||
        result.expectedDraftDigest !== input.expectedDraftDigest) {
      fail('P14_RULE_TEMPLATE_PREVIEW_MISMATCH', 'Publish does not match its durable preview.');
    }
    return result;
  }

  function publishTemplate(request) {
    const input = request?.input;
    exact(input, [
      'templateId',
      'expectedCurrentRevision',
      'expectedDraftRevision',
      'expectedDraftDigest',
      'previewId',
      'previewDigest',
    ], 'P14_RULE_TEMPLATE_PUBLISH_INPUT');
    text(input.templateId, 'templateId');
    revision(input.expectedCurrentRevision, 'expectedCurrentRevision');
    revision(input.expectedDraftRevision, 'expectedDraftRevision');
    digest(input.expectedDraftDigest, 'expectedDraftDigest');
    text(input.previewId, 'previewId');
    digest(input.previewDigest, 'previewDigest');
    const mutable = getTemplate(input.templateId);
    if (!mutable) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
    if (mutable.ownerKind === 'system') {
      fail('SYSTEM_TEMPLATE_IMMUTABLE', 'System Rule Template is immutable.');
    }
    const preview = readPreview(input);
    const nextRevision = input.expectedCurrentRevision + 1;
    const commandContract = 'arca.admin.rule-template.publish@1';
    const keyDigest = canonicalDigest({
      commandContract,
      idempotencyKey: request.idempotencyKey,
      targetId: input.templateId,
    });
    const outbox = [{
      messageId: 'arca-rule-template-published-' + keyDigest,
      producerDomain: 'arca',
      messageKind: 'rule_template_published',
      aggregateType: 'rule_template',
      aggregateId: input.templateId,
      aggregateRevision: nextRevision,
      dedupKey: 'rule-template:' + input.templateId + ':' + nextRevision,
      payloadSchemaRef: 'helix://contracts/messages/ArcaRuleTemplatePublished/v1',
      payload: {
        messageKind: 'rule_template_published',
        ruleTemplateId: input.templateId,
        ruleTemplateRevision: nextRevision,
        rulesDigest: input.expectedDraftDigest,
        affectedShelfSetDigest: preview.affectedShelfSetDigest,
      },
      intendedConsumers: ['read-model'],
    }];
    return command(
      request,
      'publish',
      input.templateId,
      (context) => {
        const repo = context.repository(repository.repositoryId);
        const template = findTemplate(repo, input.templateId);
        if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
        if (template.ownerKind === 'system') {
          fail('SYSTEM_TEMPLATE_IMMUTABLE', 'System Rule Template is immutable.');
        }
        const draft = mapDraft(repo.invoke('find_draft', { rule_template_id: input.templateId }));
        if (template.status !== 'active' ||
            template.currentRevision !== input.expectedCurrentRevision ||
            !draft ||
            draft.basePublishedRevision !== input.expectedCurrentRevision ||
            draft.draftRevision !== input.expectedDraftRevision ||
            draft.rulesDigest !== input.expectedDraftDigest) {
          fail('P14_RULE_TEMPLATE_PUBLISH_CAS', 'Rule Template publish basis is stale.');
        }
        const shelves = boundShelves(repo, input.templateId);
        const affectedShelfSetDigest = canonicalDigest({
          schema: 'arca.rule-template-affected-shelf-set@1',
          items: shelves,
        });
        if (shelves.length !== preview.affectedShelfCount ||
            affectedShelfSetDigest !== preview.affectedShelfSetDigest) {
          fail('P14_RULE_TEMPLATE_PREVIEW_STALE', 'Bound Shelf set changed after preview.');
        }
        repo.invoke('insert_revision', {
          rule_template_id: input.templateId,
          revision: nextRevision,
          rules_schema_ref: draft.rulesSchemaRef,
          rules_json: canonicalJson(draft.rules),
          rules_digest: draft.rulesDigest,
          published_at_ms: context.commitTimeMs,
        });
        const templateChanged = repo.invoke('advance_template_head', {
          current_revision: nextRevision,
          rule_template_id: input.templateId,
          expected_revision: input.expectedCurrentRevision,
          expected_status: 'active',
        });
        if (templateChanged.changes !== 1) {
          fail('P14_RULE_TEMPLATE_PUBLISH_CAS', 'Rule Template head CAS failed.');
        }
        const updatedShelves = [];
        for (const shelfBasis of shelves) {
          const standardRevision = shelfBasis.currentStandardRevision + 1;
          const routingProjectionRevision = shelfBasis.routingProjectionRevision + 1;
          const standard = buildShelfStandard({
            shelfId: shelfBasis.shelfId,
            standardRevision,
            ruleTemplateId: input.templateId,
            ruleTemplateRevision: nextRevision,
            rules: draft.rules,
          });
          const routingProjectionDigest = canonicalDigest({
            schema: 'arca.shelf-routing-target-projection@1',
            shelfId: shelfBasis.shelfId,
            status: 'active',
            currentStandardRevision: standardRevision,
            currentStandardDigest: standard.standardDigest,
            routingProjectionRevision,
          });
          repo.invoke('insert_standard', {
            shelf_id: shelfBasis.shelfId,
            revision: standardRevision,
            rule_template_id: input.templateId,
            rule_template_revision: nextRevision,
            standard_schema_ref: STANDARD_SCHEMA_REF,
            standard_json: canonicalJson(standard),
            standard_digest: standard.standardDigest,
            effective_at_ms: context.commitTimeMs,
          });
          const shelfChanged = repo.invoke('advance_shelf_head', {
            current_standard_revision: standardRevision,
            routing_projection_revision: routingProjectionRevision,
            routing_projection_digest: routingProjectionDigest,
            updated_at_ms: context.commitTimeMs,
            shelf_id: shelfBasis.shelfId,
            expected_standard_revision: shelfBasis.currentStandardRevision,
            expected_projection_revision: shelfBasis.routingProjectionRevision,
            expected_status: 'active',
          });
          if (shelfChanged.changes !== 1) {
            fail('P14_RULE_TEMPLATE_SHELF_CAS', 'Bound Shelf Standard head CAS failed.');
          }
          updatedShelves.push(Object.freeze({
            shelfId: shelfBasis.shelfId,
            standardRevision,
            standardDigest: standard.standardDigest,
            routingProjectionRevision,
            routingProjectionDigest,
          }));
        }
        return Object.freeze({
          template: mapTemplate(
            repo,
            repo.invoke('find_template', { rule_template_id: input.templateId }),
            false,
          ),
          affectedShelfCount: updatedShelves.length,
          affectedShelfSetDigest,
          updatedShelfResultSetDigest: canonicalDigest({
            schema: 'arca.rule-template-updated-shelf-result-set@1',
            items: updatedShelves,
          }),
        });
      },
      (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplatePublishResult/v1',
        resultRef: result,
      }),
      outbox,
    );
  }

  function archiveTemplate(request) {
    const input = request?.input;
    exact(input, ['templateId', 'expectedCurrentRevision'], 'P14_RULE_TEMPLATE_ARCHIVE_INPUT');
    text(input.templateId, 'templateId');
    revision(input.expectedCurrentRevision, 'expectedCurrentRevision');
    return command(
      request,
      'archive',
      input.templateId,
      (context) => {
        const repo = context.repository(repository.repositoryId);
        const template = findTemplate(repo, input.templateId);
        if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
        if (template.ownerKind === 'system') {
          fail('SYSTEM_TEMPLATE_IMMUTABLE', 'System Rule Template is immutable.');
        }
        if (template.status !== 'active' ||
            template.currentRevision !== input.expectedCurrentRevision) {
          fail('P14_RULE_TEMPLATE_ARCHIVE_CAS', 'Rule Template archive basis is stale.');
        }
        if (boundShelves(repo, input.templateId).length !== 0) {
          fail('P14_RULE_TEMPLATE_BOUND', 'A Rule Template bound to an active Shelf cannot be archived.');
        }
        const changed = repo.invoke('archive_template', {
          status: 'archived',
          archived_at_ms: context.commitTimeMs,
          rule_template_id: input.templateId,
          expected_revision: input.expectedCurrentRevision,
          expected_status: 'active',
        });
        if (changed.changes !== 1) {
          fail('P14_RULE_TEMPLATE_ARCHIVE_CAS', 'Rule Template archive CAS failed.');
        }
        return mapTemplate(
          repo,
          repo.invoke('find_template', { rule_template_id: input.templateId }),
          false,
        );
      },
      (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplateArchiveResult/v1',
        resultRef: { template: result },
      }),
    );
  }

  function bindShelf(request) {
    const input = request?.input;
    exact(input, [
      'shelfId',
      'expectedStandardRevision',
      'expectedRoutingProjectionRevision',
      'ruleTemplateId',
      'expectedTemplateRevision',
    ], 'P14_RULE_TEMPLATE_BIND_INPUT');
    text(input.shelfId, 'shelfId');
    text(input.ruleTemplateId, 'ruleTemplateId');
    revision(input.expectedStandardRevision, 'expectedStandardRevision');
    revision(input.expectedRoutingProjectionRevision, 'expectedRoutingProjectionRevision');
    revision(input.expectedTemplateRevision, 'expectedTemplateRevision');
    return command(
      request,
      'bind',
      input.shelfId,
      (context) => {
        const repo = context.repository(repository.repositoryId);
        const template = findTemplate(repo, input.ruleTemplateId);
        if (!template) fail('P14_RULE_TEMPLATE_NOT_FOUND', 'Rule Template does not exist.');
        if (template.status !== 'active' ||
            template.currentRevision !== input.expectedTemplateRevision) {
          fail('P14_RULE_TEMPLATE_BIND_TEMPLATE_CAS', 'Rule Template binding head is stale.');
        }
        const shelf = repo.invoke('find_shelf', { shelf_id: input.shelfId });
        if (!shelf) fail('P14_RULE_TEMPLATE_SHELF_NOT_FOUND', 'Shelf does not exist.');
        if (shelf.status !== 'active' ||
            shelf.current_standard_revision !== input.expectedStandardRevision ||
            shelf.routing_projection_revision !== input.expectedRoutingProjectionRevision) {
          fail('P14_RULE_TEMPLATE_BIND_SHELF_CAS', 'Shelf binding head is stale.');
        }
        const currentStandard = repo.invoke('find_standard', {
          shelf_id: input.shelfId,
          revision: shelf.current_standard_revision,
        });
        if (!currentStandard) {
          fail('P14_RULE_TEMPLATE_SHELF_INTEGRITY', 'Shelf Standard head does not resolve.');
        }
        const alreadyBound = currentStandard.rule_template_id === input.ruleTemplateId;
        const currentlyBound = boundShelves(repo, input.ruleTemplateId);
        if (!alreadyBound && currentlyBound.length >= 256) {
          fail('OPERATIONAL_SCALE_LIMIT', 'A Rule Template cannot bind more than 256 active Shelves.');
        }
        const standardRevision = input.expectedStandardRevision + 1;
        const routingProjectionRevision = input.expectedRoutingProjectionRevision + 1;
        const standard = buildShelfStandard({
          shelfId: input.shelfId,
          standardRevision,
          ruleTemplateId: input.ruleTemplateId,
          ruleTemplateRevision: input.expectedTemplateRevision,
          rules: template.current.rules,
        });
        const routingProjectionDigest = canonicalDigest({
          schema: 'arca.shelf-routing-target-projection@1',
          shelfId: input.shelfId,
          status: 'active',
          currentStandardRevision: standardRevision,
          currentStandardDigest: standard.standardDigest,
          routingProjectionRevision,
        });
        repo.invoke('insert_standard', {
          shelf_id: input.shelfId,
          revision: standardRevision,
          rule_template_id: input.ruleTemplateId,
          rule_template_revision: input.expectedTemplateRevision,
          standard_schema_ref: STANDARD_SCHEMA_REF,
          standard_json: canonicalJson(standard),
          standard_digest: standard.standardDigest,
          effective_at_ms: context.commitTimeMs,
        });
        const changed = repo.invoke('advance_shelf_head', {
          current_standard_revision: standardRevision,
          routing_projection_revision: routingProjectionRevision,
          routing_projection_digest: routingProjectionDigest,
          updated_at_ms: context.commitTimeMs,
          shelf_id: input.shelfId,
          expected_standard_revision: input.expectedStandardRevision,
          expected_projection_revision: input.expectedRoutingProjectionRevision,
          expected_status: 'active',
        });
        if (changed.changes !== 1) {
          fail('P14_RULE_TEMPLATE_BIND_SHELF_CAS', 'Shelf binding CAS failed.');
        }
        return Object.freeze({
          shelfId: input.shelfId,
          standard: Object.freeze({
            shelfId: input.shelfId,
            standardRevision,
            ruleTemplateId: input.ruleTemplateId,
            ruleTemplateRevision: input.expectedTemplateRevision,
            standardDigest: standard.standardDigest,
          }),
          routingProjection: Object.freeze({
            revision: routingProjectionRevision,
            digest: routingProjectionDigest,
          }),
        });
      },
      (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/ArcaRuleTemplateBindResult/v1',
        resultRef: { binding: result },
      }),
      undefined,
      'shelf',
    );
  }

  return Object.freeze({
    repositoryManifest: Object.freeze({
      component: 'RuleTemplateRepository',
      repositoryId: repository.repositoryId,
      tableIds: repository.tableIds,
    }),
    listTemplates,
    getTemplate,
    getDraft,
    history,
    copyTemplate,
    reviseDraft,
    previewTemplate,
    publishTemplate,
    archiveTemplate,
    bindShelf,
  });
}

module.exports = Object.freeze({
  ArcaRuleTemplateStoreError,
  createRuleTemplateStore,
});
