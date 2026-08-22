'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');
const { createShelfDeregistrationStore } = require('../persistence/shelf-deregistration-store');
const { createInputSettlementAuthorizationStore } = require('../persistence/input-settlement-authorization-store');
const { createShelfPlacementPolicy } = require('../model/shelf-placement-policy-contracts');

class ArcaShelfAdminApplicationError extends Error { constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfAdminApplicationError'; this.code = code; this.details = details; } }

function createArcaShelfAdminApplication(options) {
  if (!options?.targetFolderProbe ||
      typeof options.targetFolderProbe.inspect !== 'function' ||
      typeof options.targetFolderProbe.inspectRoot !== 'function') {
    throw new TypeError('Arca Shelf application requires the Target Folder probe port.');
  }
  const store = createShelfQueryStore(options);
  const deregistrations = options.shelfDeregistrationStore || createShelfDeregistrationStore(options);
  const settlementAuthorizations = options.inputSettlementAuthorizationStore
    || createInputSettlementAuthorizationStore(options);
  const withSummary=(shelf)=>Object.freeze({...shelf,deregistrationSummary:deregistrations.summary(shelf.shelfId)});
  const targetFolderProbe = options.targetFolderProbe;
  const assertLocationAvailable = (rootLocation) => {
    if (typeof options.assertLocationAvailable === 'function') {
      options.assertLocationAvailable({ requestedRoot:rootLocation });
    }
  };
  function invoke(operation) {
    try { return operation(); } catch (error) {
      if (error instanceof ArcaShelfAdminApplicationError) throw error;
      if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
        throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的Shelf请求。');
      }
      if (error.code === 'P14_SHELF_PLACEMENT_CAS') {
        throw new ArcaShelfAdminApplicationError(
          'ADMIN_SHELF_CONFLICT',
          'Shelf Target Folder或Placement已变化，请刷新后重试。',
          { reasonCode: error.code },
        );
      }
      if (error.code === 'P14_RULE_TEMPLATE_BIND_TEMPLATE_CAS') {
        throw new ArcaShelfAdminApplicationError(
          'ADMIN_SHELF_CONFLICT',
          'Rule Template revision已变化，请刷新后重试。',
          { reasonCode: error.code },
        );
      }
      throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求未通过Arca Owner-local合同校验。', { reasonCode: error.code || 'ARCA_SHELF_CONTRACT_REJECTED',...(error.details||{}) });
    }
  }
  function placementEnvelope(shelfId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        body.shelfId !== shelfId) {
      throw new ArcaShelfAdminApplicationError(
        'ADMIN_SHELF_TARGET_MISMATCH',
        'URL中的Shelf与请求体目标必须一致。',
        { pathShelfId: shelfId, bodyShelfId: body?.shelfId },
      );
    }
    const { idempotencyKey, ...input } = body;
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new ArcaShelfAdminApplicationError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Shelf Placement操作必须提供幂等键。',
      );
    }
    return { idempotencyKey, input };
  }
  function placementRequest(envelope, shelfId) {
    const input = envelope.input;
    assertLocationAvailable(input?.target?.rootLocation);
    const observation = targetFolderProbe.inspect({
      shelfId,
      target: input.target,
    });
    return {
      idempotencyKey: envelope.idempotencyKey,
      input: {
        ...input,
        target: observation.target,
        targetReadiness: observation.evidence,
      },
    };
  }
  function ownerResults(authorization) {
    const enabled = authorization?.state === 'enabled';
    return Object.freeze([
      Object.freeze({
        owner: 'arca',
        topic: 'input_settlement',
        result: enabled ? 'enabled' : 'confirmation_required',
        label: enabled ? '已启用上架旧输入自动处理授权' : '上架旧输入改为每次确认',
      }),
      Object.freeze({
        owner: 'procurement',
        topic: 'accepted_automation',
        result: 'unchanged',
        label: '文件来源自动化保持不变',
      }),
      Object.freeze({
        owner: 'libra',
        topic: 'accepted_automation',
        result: 'unchanged',
        label: '整理与上架接纳自动化保持不变',
      }),
      Object.freeze({
        owner: 'arca',
        topic: 'aftercare',
        result: 'unchanged',
        label: '安全的收藏健康自动修复保持不变',
      }),
      Object.freeze({
        owner: 'people',
        topic: 'weak_identity',
        result: 'unchanged_manual',
        label: '弱人物身份仍需确认',
      }),
      Object.freeze({
        owner: 'arca_offdeck',
        topic: 'offdeck_destruction',
        result: 'unchanged_disabled',
        label: '退出收藏销毁保持独立关闭',
      }),
    ]);
  }
  function publishAutomaticOperation(kind, body, actor) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_COMMAND_REJECTED', '自动运营请求体无效。');
    }
    const required = kind === 'enable'
      ? ['coverExclusiveRelatedInput', 'expectedRevision', 'idempotencyKey']
      : ['expectedRevision', 'idempotencyKey'];
    if (JSON.stringify(Object.keys(body).sort()) !== JSON.stringify(required.slice().sort())) {
      throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_COMMAND_REJECTED', '自动运营请求体无效。');
    }
    if (typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length === 0) {
      throw new ArcaShelfAdminApplicationError('IDEMPOTENCY_KEY_REQUIRED', '自动运营操作必须提供幂等键。');
    }
    try {
      const published = kind === 'enable'
        ? settlementAuthorizations.enable({
            idempotencyKey: body.idempotencyKey,
            expectedRevision: body.expectedRevision,
            coverExclusiveRelatedInput: body.coverExclusiveRelatedInput,
            actorId: actor?.actorId || 'admin',
          })
        : settlementAuthorizations.revoke({
            idempotencyKey: body.idempotencyKey,
            expectedRevision: body.expectedRevision,
            actorId: actor?.actorId || 'admin',
          });
      const readiness = typeof options.readSetupReadiness === 'function' ? options.readSetupReadiness() : null;
      return Object.freeze({
        replayed: published.replayed === true,
        standingAuthorization: published.authorization,
        ownerResults: ownerResults(published.authorization),
        readiness,
      });
    } catch (error) {
      if (error instanceof ArcaShelfAdminApplicationError) throw error;
      if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
        throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的自动运营请求。');
      }
      if (error.code === 'P14_INPUT_SETTLEMENT_AUTH_CAS') {
        throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_CONFLICT', '自动运营授权已变化，请刷新后重试。', { reasonCode: error.code });
      }
      if (typeof error.code === 'string' && error.code.startsWith('P14_INPUT_SETTLEMENT_AUTH_')) {
        throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_COMMAND_REJECTED', '自动运营请求未通过Arca合同校验。', { reasonCode: error.code, ...(error.details || {}) });
      }
      throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_COMMAND_REJECTED', '自动运营请求未通过Arca Owner-local合同校验。', { reasonCode: error.code || 'ARCA_AUTOMATION_CONTRACT_REJECTED', ...(error.details || {}) });
    }
  }
  return Object.freeze({
    listShelves() { return Object.freeze({ items: store.listShelves().map(withSummary) }); },
    getShelf(shelfId) { const shelf = store.getShelf(shelfId); if (!shelf) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_NOT_FOUND', 'Shelf不存在。', { shelfId }); return Object.freeze({ shelf:withSummary(shelf) }); },
    getStandard(shelfId) { return Object.freeze({ standard: this.getShelf(shelfId).shelf.standard }); },
    getPlacement(shelfId) {
      const shelf = this.getShelf(shelfId).shelf;
      return Object.freeze({ target: shelf.target, placement: shelf.placement });
    },
    createShelf(body) {
      return invoke(() => {
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            JSON.stringify(Object.keys(body).sort()) !== JSON.stringify([
              'expectedTemplateRevision',
              'idempotencyKey',
              'name',
              'placementPolicy',
              'ruleTemplateId',
              'shelfId',
              'targetRootLocation',
            ].sort())) {
          throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求体无效。');
        }
        const { idempotencyKey } = body;
        if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
          throw new ArcaShelfAdminApplicationError('IDEMPOTENCY_KEY_REQUIRED', 'Shelf创建必须提供幂等键。');
        }
        const placement = createShelfPlacementPolicy(body.placementPolicy);
        const requestInput = Object.freeze({
          shelfId: body.shelfId,
          name: body.name,
          targetRootLocation: body.targetRootLocation,
          ruleTemplateId: body.ruleTemplateId,
          expectedTemplateRevision: body.expectedTemplateRevision,
          placementPolicy: placement.value,
        });
        const replay = store.preflightCreateCommand({ idempotencyKey, requestInput });
        if (replay) return Object.freeze({...replay,shelf:withSummary(replay.shelf)});
        assertLocationAvailable(body.targetRootLocation);
        const targetObservation = targetFolderProbe.inspectRoot({
          shelfId: body.shelfId,
          rootLocation: body.targetRootLocation,
        });
        const created=store.createShelf({
          idempotencyKey,
          requestInput,
          input: {
            shelfId: body.shelfId,
            name: body.name,
            target: targetObservation.target,
            targetReadiness: targetObservation.evidence,
            ruleTemplateId: body.ruleTemplateId,
            expectedTemplateRevision: body.expectedTemplateRevision,
            placement,
          },
        });
        return Object.freeze({...created,shelf:withSummary(created.shelf)});
      });
    },
    renameShelf(shelfId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.shelfId !== shelfId) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_TARGET_MISMATCH', 'URL中的Shelf与请求体目标必须一致。', { pathShelfId: shelfId, bodyShelfId: body?.shelfId });
      const { idempotencyKey, ...input } = body;
      return invoke(() => store.renameShelf({ idempotencyKey, input }));
    },
    reviseStandard(shelfId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.shelfId !== shelfId) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_TARGET_MISMATCH', 'URL中的Shelf与请求体目标必须一致。', { pathShelfId: shelfId, bodyShelfId: body?.shelfId });
      const { idempotencyKey, ...input } = body;
      return invoke(() => store.reviseStandard({ idempotencyKey, input }));
    },
    revisePlacement(shelfId, body) {
      return invoke(() => {
        const envelope = placementEnvelope(shelfId, body);
        const replay = store.preflightPlacementCommand(envelope, 'revise_placement');
        if (replay) return replay;
        return store.revisePlacement(placementRequest(envelope, shelfId));
      });
    },
    previewPlacement(shelfId, body) {
      return invoke(() => {
        const envelope = placementEnvelope(shelfId, body);
        const replay = store.preflightPlacementCommand(envelope, 'placement_preview');
        if (replay) return replay;
        return store.previewPlacement(placementRequest(envelope, shelfId));
      });
    },
    deregisterShelf(shelfId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.shelfId !== shelfId) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_TARGET_MISMATCH', 'URL中的Shelf与请求体目标必须一致。', { pathShelfId: shelfId, bodyShelfId: body?.shelfId });
      const { idempotencyKey, ...input } = body;
      return invoke(() => {
        const result=deregistrations.admit({ idempotencyKey, input });
        options.onDeregistrationIntent?.(result);
        return result;
      });
    },
    currentStandingAuthorization() {
      return settlementAuthorizations.current();
    },
    getAutomaticOperation() {
      if (typeof options.readSetupReadiness !== 'function') {
        throw new ArcaShelfAdminApplicationError('ADMIN_AUTOMATION_PROJECTION_UNAVAILABLE', '自动运营Readiness Projection尚未接入。');
      }
      return options.readSetupReadiness();
    },
    enableFullAutomaticOperation(body, actor) {
      return publishAutomaticOperation('enable', body, actor);
    },
    requireSettlementConfirmation(body, actor) {
      return publishAutomaticOperation('revoke', body, actor);
    },
  });
}

module.exports = Object.freeze({ ArcaShelfAdminApplicationError, createArcaShelfAdminApplication });
