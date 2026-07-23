'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createCommandCommitCoordinator } = require('../../../foundation/persistence/commit-foundation');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { validateExpression, evaluateRoutingExpression } = require('../model/routing-contracts');

const DIGEST = /^[a-f0-9]{64}$/;
const FACT_KINDS = new Set([
  'content_profile',
  'structure_kind',
  'material_field',
  'release_year',
  'region',
  'genre',
  'resolved_provider_identity',
]);

class FieldRoutingPolicyStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldRoutingPolicyStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldRoutingPolicyStoreError(code, message, details);
}

function exact(value, keys, code, path = 'input') {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    fail(code, 'Routing Policy input does not match its closed contract.', { path });
  }
}

function text(value, path) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    fail('P14_ROUTING_TEXT', 'Routing text field is outside its bound.', { path });
  }
  return value;
}

function revision(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('P14_ROUTING_REVISION', 'Routing revision is invalid.', { path });
  }
  return value;
}

function closedExpression(expression, path = 'policy.targets.matchExpression') {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) {
    fail('P14_ROUTING_EXPRESSION', 'Routing expression must be a closed object.', { path });
  }
  if (expression.nodeKind === 'always') {
    exact(expression, ['nodeKind'], 'P14_ROUTING_EXPRESSION', path);
  } else if (expression.nodeKind === 'predicate') {
    exact(expression, ['nodeKind', 'factKind', 'operator', 'expectedValue'], 'P14_ROUTING_EXPRESSION', path);
    if (expression.operator === 'exists' && typeof expression.expectedValue !== 'boolean') {
      fail('P14_ROUTING_EXPRESSION_VALUE', 'exists requires a boolean expectedValue.', { path });
    }
    if (expression.operator === 'one_of' &&
        (!Array.isArray(expression.expectedValue) ||
         expression.expectedValue.length < 1 ||
         expression.expectedValue.length > 64)) {
      fail('P14_ROUTING_EXPRESSION_VALUE', 'one_of requires 1..64 expected values.', { path });
    }
  } else if (expression.nodeKind === 'all' || expression.nodeKind === 'any') {
    exact(expression, ['nodeKind', 'children'], 'P14_ROUTING_EXPRESSION', path);
    if (Array.isArray(expression.children)) {
      expression.children.forEach((child, index) => closedExpression(child, path + '.children[' + index + ']'));
    }
  } else if (expression.nodeKind === 'not') {
    exact(expression, ['nodeKind', 'child'], 'P14_ROUTING_EXPRESSION', path);
    closedExpression(expression.child, path + '.child');
  } else {
    fail('P14_ROUTING_EXPRESSION', 'Routing expression nodeKind is invalid.', { path });
  }
  validateExpression(expression);
}

function validateFacts(facts) {
  if (!Array.isArray(facts) || facts.length > 256) {
    fail('P14_ROUTING_FACTS', 'Preview facts must be a bounded list.');
  }
  facts.forEach((fact, index) => {
    const path = 'facts[' + index + ']';
    if (!fact || !FACT_KINDS.has(fact.factKind)) {
      fail('P14_ROUTING_FACT', 'Preview fact kind is invalid.', { path });
    }
    if (fact.factKind === 'material_field') {
      exact(fact, ['factKind', 'fieldId'], 'P14_ROUTING_FACT', path);
      text(fact.fieldId, path + '.fieldId');
    } else if (fact.factKind === 'release_year') {
      exact(fact, ['factKind', 'year'], 'P14_ROUTING_FACT', path);
      if (!Number.isSafeInteger(fact.year) || fact.year < 1800 || fact.year > 9999) {
        fail('P14_ROUTING_FACT', 'Preview release year is invalid.', { path });
      }
    } else {
      exact(fact, ['factKind', 'value'], 'P14_ROUTING_FACT', path);
      if (!['string', 'number', 'boolean'].includes(typeof fact.value)) {
        fail('P14_ROUTING_FACT', 'Preview fact value must be scalar.', { path });
      }
    }
  });
}

function createFieldRoutingPolicyStore(options) {
  if (!options?.schemaManifest || !options?.unitOfWork) {
    throw new TypeError('Libra Routing Policy store requires clean persistence dependencies.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_field_routing_policy_repository',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    statements: {
      find_head: {
        kind: 'select-one',
        tableId: 'libra_field_routing_heads',
        columns: ['field_id', 'current_routing_policy_id', 'current_policy_revision', 'updated_at_ms'],
        keyColumns: ['field_id'],
      },
      insert_head: {
        kind: 'insert',
        tableId: 'libra_field_routing_heads',
        columns: ['field_id', 'current_routing_policy_id', 'current_policy_revision', 'updated_at_ms'],
      },
      advance_head: {
        kind: 'update',
        tableId: 'libra_field_routing_heads',
        setColumns: ['current_routing_policy_id', 'current_policy_revision', 'updated_at_ms'],
        keyColumns: ['field_id'],
        compareColumns: [
          { column: 'current_routing_policy_id', parameter: 'expected_policy_id' },
          { column: 'current_policy_revision', parameter: 'expected_revision' },
        ],
      },
      find_revision: {
        kind: 'select-one',
        tableId: 'libra_routing_policy_revisions',
        columns: ['routing_policy_id', 'revision', 'field_id', 'mode', 'policy_schema_ref', 'policy_json', 'policy_digest', 'effective_at_ms'],
        keyColumns: ['routing_policy_id', 'revision'],
      },
      list_revisions: {
        kind: 'select-all',
        tableId: 'libra_routing_policy_revisions',
        columns: ['routing_policy_id', 'revision', 'field_id', 'mode', 'policy_schema_ref', 'policy_json', 'policy_digest', 'effective_at_ms'],
        keyColumns: ['field_id'],
      },
      insert_revision: {
        kind: 'insert',
        tableId: 'libra_routing_policy_revisions',
        columns: ['routing_policy_id', 'revision', 'field_id', 'mode', 'policy_schema_ref', 'policy_json', 'policy_digest', 'effective_at_ms'],
      },
      list_targets: {
        kind: 'select-all',
        tableId: 'libra_routing_policy_targets',
        columns: ['routing_policy_id', 'policy_revision', 'shelf_id', 'rank', 'match_rule_schema_ref', 'match_rule_json', 'match_rule_digest'],
        keyColumns: ['routing_policy_id', 'policy_revision'],
      },
      insert_target: {
        kind: 'insert',
        tableId: 'libra_routing_policy_targets',
        columns: ['routing_policy_id', 'policy_revision', 'shelf_id', 'rank', 'match_rule_schema_ref', 'match_rule_json', 'match_rule_digest'],
      },
    },
  });
  const commandCommit = createCommandCommitCoordinator({
    schemaManifest: options.schemaManifest,
    unitOfWork: options.unitOfWork,
  });
  const execute = (body) => options.unitOfWork.execute([{
    participantId: 'libra_routing_query',
    owner: 'libra',
    repositories: [repository],
    execute: body,
  }]).libra_routing_query;

  function mapRevision(repo, row) {
    if (!row) return null;
    const targets = repo.invoke('list_targets', {
      routing_policy_id: row.routing_policy_id,
      policy_revision: row.revision,
    }).sort((left, right) => left.rank - right.rank).map((item) => Object.freeze({
      shelfId: item.shelf_id,
      rank: item.rank,
      matchExpression: JSON.parse(item.match_rule_json),
      matchRuleDigest: item.match_rule_digest,
    }));
    const policy = Object.freeze({
      routingPolicyId: row.routing_policy_id,
      revision: row.revision,
      fieldId: row.field_id,
      mode: row.mode,
      targets: Object.freeze(targets),
      policyDigest: row.policy_digest,
    });
    if (policy.policyDigest !== canonicalDigest({
      routingPolicyId: policy.routingPolicyId,
      revision: policy.revision,
      fieldId: policy.fieldId,
      mode: policy.mode,
      targets: policy.targets,
    })) {
      fail('P14_ROUTING_POLICY_INTEGRITY', 'Stored Routing Policy digest is invalid.');
    }
    return policy;
  }

  function current(fieldId) {
    text(fieldId, 'fieldId');
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      const head = repo.invoke('find_head', { field_id: fieldId });
      if (!head) return null;
      return mapRevision(repo, repo.invoke('find_revision', {
        routing_policy_id: head.current_routing_policy_id,
        revision: head.current_policy_revision,
      }));
    });
  }

  function history(fieldId) {
    text(fieldId, 'fieldId');
    return execute((context) => {
      const repo = context.repository(repository.repositoryId);
      return Object.freeze(repo.invoke('list_revisions', { field_id: fieldId })
        .sort((left, right) => left.revision - right.revision)
        .map((row) => mapRevision(repo, row)));
    });
  }

  function validatePolicyDraft(input) {
    exact(input.policy, ['routingPolicyId', 'mode', 'targets'], 'P14_ROUTING_POLICY_INPUT', 'policy');
    text(input.fieldId, 'fieldId');
    text(input.policy.routingPolicyId, 'policy.routingPolicyId');
    if (!['direct', 'sorting'].includes(input.policy.mode) ||
        !Array.isArray(input.policy.targets) ||
        input.policy.targets.length < 1 ||
        input.policy.targets.length > 64) {
      fail('P14_ROUTING_POLICY_SHAPE', 'Routing Policy mode or targets are invalid.');
    }
    const shelfIds = new Set();
    input.policy.targets.forEach((target, index) => {
      exact(target, ['shelfId', 'rank', 'matchExpression'], 'P14_ROUTING_TARGET_INPUT', 'policy.targets[' + index + ']');
      text(target.shelfId, 'policy.targets[' + index + '].shelfId');
      closedExpression(target.matchExpression, 'policy.targets[' + index + '].matchExpression');
      if (target.rank !== index + 1 || shelfIds.has(target.shelfId)) {
        fail('P14_ROUTING_TARGET_INVALID', 'Routing target rank or Shelf identity is invalid.');
      }
      shelfIds.add(target.shelfId);
    });
    if (input.policy.mode === 'direct' &&
        (input.policy.targets.length !== 1 ||
         input.policy.targets[0].matchExpression.nodeKind !== 'always')) {
      fail('P14_ROUTING_DIRECT_POLICY', 'Direct Routing requires exactly one always target.');
    }
    if (Buffer.byteLength(canonicalJson(input.policy), 'utf8') > 65536) {
      fail('P14_ROUTING_POLICY_SIZE', 'Routing Policy exceeds 64 KiB.');
    }
  }

  function projectionMap(policy, projections) {
    if (!Array.isArray(projections) || projections.length > 4096) {
      fail('P14_ROUTING_PROJECTION_INPUT', 'Arca Routing projection input is invalid.');
    }
    const available = new Map();
    for (const projection of projections) {
      exact(projection, [
        'shelfId',
        'status',
        'currentStandardRevision',
        'currentStandardDigest',
        'routingProjectionRevision',
        'projectionDigest',
      ], 'P14_ROUTING_PROJECTION_INPUT', 'arcaRoutingProjection');
      text(projection.shelfId, 'arcaRoutingProjection.shelfId');
      revision(projection.currentStandardRevision, 'arcaRoutingProjection.currentStandardRevision', 1);
      revision(projection.routingProjectionRevision, 'arcaRoutingProjection.routingProjectionRevision', 1);
      if (!DIGEST.test(projection.currentStandardDigest || '') ||
          !DIGEST.test(projection.projectionDigest || '') ||
          !['active', 'deregistering', 'deregistered'].includes(projection.status)) {
        fail('P14_ROUTING_PROJECTION_INPUT', 'Arca Routing projection fields are invalid.');
      }
      const expectedDigest = canonicalDigest({
        schema: 'arca.shelf-routing-target-projection@1',
        shelfId: projection.shelfId,
        status: projection.status,
        currentStandardRevision: projection.currentStandardRevision,
        currentStandardDigest: projection.currentStandardDigest,
        routingProjectionRevision: projection.routingProjectionRevision,
      });
      if (projection.projectionDigest !== expectedDigest || available.has(projection.shelfId)) {
        fail('P14_ROUTING_PROJECTION_INTEGRITY', 'Arca Routing projection digest or identity is invalid.');
      }
      available.set(projection.shelfId, projection);
    }
    for (const target of policy.targets) {
      const projection = available.get(target.shelfId);
      if (!projection || projection.status !== 'active') {
        fail('P14_ROUTING_TARGET_INACTIVE', 'Every published Routing target must be an active Shelf.', {
          shelfId: target.shelfId,
        });
      }
    }
    return available;
  }

  function buildPreview(input, projections) {
    exact(input, ['fieldId', 'policy', 'facts'], 'P14_ROUTING_PREVIEW_INPUT');
    validatePolicyDraft(input);
    validateFacts(input.facts);
    const available = projectionMap(input.policy, projections);
    const evaluatedTargets = [];
    let result = 'unresolved';
    let targetShelfId = null;
    let unresolvedReasonCode = 'no_matching_shelf';
    for (const target of input.policy.targets) {
      const projection = available.get(target.shelfId);
      const evaluation = evaluateRoutingExpression(target.matchExpression, input.facts);
      evaluatedTargets.push(Object.freeze({
        shelfId: target.shelfId,
        rank: target.rank,
        evaluation,
        projectionRevision: projection.routingProjectionRevision,
        projectionDigest: projection.projectionDigest,
      }));
      if (evaluation === 'true') {
        result = 'resolved';
        targetShelfId = target.shelfId;
        unresolvedReasonCode = null;
        break;
      }
      if (evaluation === 'unknown') {
        unresolvedReasonCode = 'higher_priority_rule_unknown';
        break;
      }
    }
    const evaluated = Object.freeze(evaluatedTargets);
    const previewDigest = canonicalDigest({
      fieldId: input.fieldId,
      routingPolicyId: input.policy.routingPolicyId,
      result,
      targetShelfId,
      unresolvedReasonCode,
      evaluatedTargets: evaluated,
    });
    return Object.freeze({
      previewId: canonicalDigest({
        schema: 'libra.field-routing-policy-preview-id@1',
        fieldId: input.fieldId,
        previewDigest,
      }),
      fieldId: input.fieldId,
      result,
      targetShelfId,
      unresolvedReasonCode,
      resolvedCount: result === 'resolved' ? 1 : 0,
      unknownCount: unresolvedReasonCode === 'higher_priority_rule_unknown' ? 1 : 0,
      evaluatedTargetCount: evaluated.length,
      previewDigest,
    });
  }

  function preview(request, projections) {
    if (!request || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      fail('IDEMPOTENCY_KEY_REQUIRED', 'Routing preview requires idempotencyKey.');
    }
    const commandContract = 'libra.admin.field-routing-policy.preview@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({
      commandContract,
      idempotencyKey: request.idempotencyKey,
      fieldId: request.input?.fieldId,
    });
    const committed = commandCommit.execute({
      command: {
        commandReceiptId: 'libra-routing-preview-receipt-' + keyDigest.slice(0, 32),
        ownerDomain: 'libra',
        commandContract,
        callerScope: 'admin',
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        targetType: 'material_field',
        targetId: request.input?.fieldId,
      },
      domainParticipant: {
        participantId: 'libra_routing_preview',
        owner: 'libra',
        repositories: [repository],
        execute: () => buildPreview(request.input, projections),
      },
      commitMarker: {
        commitMarker: 'libra-routing-preview-' + keyDigest,
        scopeType: 'material_field',
        scopeId: request.input?.fieldId,
        commitDigest: requestDigest,
      },
      auditRecords: [{
        auditId: 'libra-routing-preview-audit-' + keyDigest.slice(0, 32),
        actorType: 'admin',
        action: 'preview_field_routing_policy',
        scopeType: 'material_field',
        scopeId: request.input?.fieldId,
        evidenceDigest: requestDigest,
      }],
      resultEnvelope: (result) => ({
        resultSchemaRef: 'helix://contracts/application-results/FieldRoutingPolicyPreviewResult/v1',
        resultRef: result,
      }),
    });
    return Object.freeze({ ...committed.receipt.resultRef, replayed: committed.replayed });
  }

  function preparePublish(input) {
    exact(input, ['fieldId', 'expectedPolicyId', 'expectedRevision', 'policy'], 'P14_ROUTING_PUBLISH_INPUT');
    validatePolicyDraft(input);
    revision(input.expectedRevision, 'expectedRevision');
    if (input.expectedRevision === 0) {
      if (input.expectedPolicyId !== null) {
        fail('P14_ROUTING_EXPECTED_HEAD', 'Initial Routing publish requires an absent head.');
      }
    } else if (text(input.expectedPolicyId, 'expectedPolicyId') !== input.policy.routingPolicyId) {
      fail('P14_ROUTING_POLICY_IDENTITY', 'Routing Policy identity must remain stable across revisions.');
    }
    const nextRevision = input.expectedRevision + 1;
    const targets = Object.freeze(input.policy.targets.map((target) => Object.freeze({
      ...target,
      matchRuleDigest: canonicalDigest(target.matchExpression),
    })));
    const policy = Object.freeze({
      routingPolicyId: input.policy.routingPolicyId,
      revision: nextRevision,
      fieldId: input.fieldId,
      mode: input.policy.mode,
      targets,
    });
    const policyDigest = canonicalDigest(policy);
    return Object.freeze({
      policy: Object.freeze({ ...policy, policyDigest }),
      policyDigest,
      nextRevision,
    });
  }

  function publish(request, projections) {
    if (!request || typeof request.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
      fail('IDEMPOTENCY_KEY_REQUIRED', 'Routing publish requires idempotencyKey.');
    }
    const prepared = preparePublish(request.input);
    const commandContract = 'libra.admin.field-routing-policy.publish@1';
    const requestDigest = canonicalDigest({ commandContract, input: request.input });
    const keyDigest = canonicalDigest({
      commandContract,
      idempotencyKey: request.idempotencyKey,
      fieldId: request.input.fieldId,
    });
    const message = {
      messageId: 'libra-routing-policy-' + keyDigest,
      producerDomain: 'libra',
      messageKind: 'field_routing_policy_published',
      aggregateType: 'field_routing_policy',
      aggregateId: prepared.policy.routingPolicyId,
      aggregateRevision: prepared.nextRevision,
      dedupKey: 'field-routing:' + request.input.fieldId + ':' + prepared.nextRevision,
      payloadSchemaRef: 'helix://contracts/messages/FieldRoutingPolicyPublished/v1',
      payload: {
        fieldId: request.input.fieldId,
        routingPolicyId: prepared.policy.routingPolicyId,
        policyRevision: prepared.nextRevision,
        policyDigest: prepared.policyDigest,
      },
      intendedConsumers: ['read-model'],
    };
    const committed = commandCommit.execute({
      command: {
        commandReceiptId: 'libra-routing-receipt-' + keyDigest.slice(0, 32),
        ownerDomain: 'libra',
        commandContract,
        callerScope: 'admin',
        idempotencyKey: request.idempotencyKey,
        requestDigest,
        targetType: 'material_field',
        targetId: request.input.fieldId,
      },
      domainParticipant: {
        participantId: 'libra_routing_publish',
        owner: 'libra',
        repositories: [repository],
        execute(context) {
          projectionMap(prepared.policy, projections);
          const repo = context.repository(repository.repositoryId);
          const head = repo.invoke('find_head', { field_id: request.input.fieldId });
          if (request.input.expectedRevision === 0) {
            if (head || request.input.expectedPolicyId !== null) {
              fail('P14_ROUTING_HEAD_CAS', 'Routing head must be absent.');
            }
          } else if (!head ||
              head.current_routing_policy_id !== request.input.expectedPolicyId ||
              head.current_policy_revision !== request.input.expectedRevision) {
            fail('P14_ROUTING_HEAD_CAS', 'Routing head is stale.');
          }
          repo.invoke('insert_revision', {
            routing_policy_id: prepared.policy.routingPolicyId,
            revision: prepared.nextRevision,
            field_id: request.input.fieldId,
            mode: prepared.policy.mode,
            policy_schema_ref: 'helix://contracts/domain-types/FieldRoutingPolicy/v1',
            policy_json: canonicalJson(prepared.policy),
            policy_digest: prepared.policyDigest,
            effective_at_ms: context.commitTimeMs,
          });
          for (const target of prepared.policy.targets) {
            repo.invoke('insert_target', {
              routing_policy_id: prepared.policy.routingPolicyId,
              policy_revision: prepared.nextRevision,
              shelf_id: target.shelfId,
              rank: target.rank,
              match_rule_schema_ref: 'RoutingMatchExpression@1',
              match_rule_json: canonicalJson(target.matchExpression),
              match_rule_digest: target.matchRuleDigest,
            });
          }
          if (prepared.nextRevision === 1) {
            repo.invoke('insert_head', {
              field_id: request.input.fieldId,
              current_routing_policy_id: prepared.policy.routingPolicyId,
              current_policy_revision: prepared.nextRevision,
              updated_at_ms: context.commitTimeMs,
            });
          } else {
            const changed = repo.invoke('advance_head', {
              current_routing_policy_id: prepared.policy.routingPolicyId,
              current_policy_revision: prepared.nextRevision,
              updated_at_ms: context.commitTimeMs,
              field_id: request.input.fieldId,
              expected_policy_id: request.input.expectedPolicyId,
              expected_revision: request.input.expectedRevision,
            });
            if (changed.changes !== 1) {
              fail('P14_ROUTING_HEAD_CAS', 'Routing head CAS failed.');
            }
          }
          return mapRevision(repo, repo.invoke('find_revision', {
            routing_policy_id: prepared.policy.routingPolicyId,
            revision: prepared.nextRevision,
          }));
        },
      },
      commitMarker: {
        commitMarker: 'libra-routing-publish-' + keyDigest,
        scopeType: 'material_field',
        scopeId: request.input.fieldId,
        commitDigest: requestDigest,
      },
      auditRecords: [{
        auditId: 'libra-routing-audit-' + keyDigest.slice(0, 32),
        actorType: 'admin',
        action: 'publish_field_routing_policy',
        scopeType: 'material_field',
        scopeId: request.input.fieldId,
        evidenceDigest: requestDigest,
      }],
      outboxMessages: [message],
      resultEnvelope: (policy) => ({
        resultSchemaRef: 'helix://contracts/application-results/FieldRoutingPolicyPublishResult/v1',
        resultRef: { policy },
      }),
    });
    return Object.freeze({
      policy: committed.receipt.resultRef.policy,
      replayed: committed.replayed,
    });
  }

  return Object.freeze({
    repositoryManifest: Object.freeze({
      component: 'FieldRoutingPolicyRepository',
      repositoryId: repository.repositoryId,
      tableIds: repository.tableIds,
    }),
    current,
    history,
    preview,
    publish,
  });
}

module.exports = Object.freeze({
  FieldRoutingPolicyStoreError,
  createFieldRoutingPolicyStore,
});
