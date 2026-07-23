'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');

class ArcaShelfAdminApplicationError extends Error { constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfAdminApplicationError'; this.code = code; this.details = details; } }

function createArcaShelfAdminApplication(options) {
  if (!options?.targetFolderProbe ||
      typeof options.targetFolderProbe.inspect !== 'function') {
    throw new TypeError('Arca Shelf application requires the Target Folder probe port.');
  }
  const store = createShelfQueryStore(options);
  const targetFolderProbe = options.targetFolderProbe;
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
      throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求未通过Arca Owner-local合同校验。', { reasonCode: error.code || 'ARCA_SHELF_CONTRACT_REJECTED' });
    }
  }
  function placementRequest(shelfId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        body.shelfId !== shelfId) {
      throw new ArcaShelfAdminApplicationError(
        'ADMIN_SHELF_TARGET_MISMATCH',
        'URL中的Shelf与请求体目标必须一致。',
        { pathShelfId: shelfId, bodyShelfId: body?.shelfId },
      );
    }
    const { idempotencyKey, ...input } = body;
    const observation = targetFolderProbe.inspect({
      shelfId,
      target: input.target,
    });
    return {
      idempotencyKey,
      input: {
        ...input,
        target: observation.target,
        targetReadiness: observation.evidence,
      },
    };
  }
  return Object.freeze({
    listShelves() { return Object.freeze({ items: store.listShelves() }); },
    getShelf(shelfId) { const shelf = store.getShelf(shelfId); if (!shelf) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_NOT_FOUND', 'Shelf不存在。', { shelfId }); return Object.freeze({ shelf }); },
    getStandard(shelfId) { return Object.freeze({ standard: this.getShelf(shelfId).shelf.standard }); },
    getPlacement(shelfId) {
      const shelf = this.getShelf(shelfId).shelf;
      return Object.freeze({ target: shelf.target, placement: shelf.placement });
    },
    createShelf(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求体无效。');
      const { idempotencyKey, ...input } = body;
      return invoke(() => store.createShelf({ idempotencyKey, input }));
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
      return invoke(() => store.revisePlacement(placementRequest(shelfId, body)));
    },
    previewPlacement(shelfId, body) {
      return invoke(() => store.previewPlacement(placementRequest(shelfId, body)));
    },
    deregisterShelf(shelfId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || body.shelfId !== shelfId) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_TARGET_MISMATCH', 'URL中的Shelf与请求体目标必须一致。', { pathShelfId: shelfId, bodyShelfId: body?.shelfId });
      const { idempotencyKey, ...input } = body;
      return invoke(() => store.deregisterShelf({ idempotencyKey, input }));
    },
  });
}

module.exports = Object.freeze({ ArcaShelfAdminApplicationError, createArcaShelfAdminApplication });
