'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');

class ArcaShelfAdminApplicationError extends Error { constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfAdminApplicationError'; this.code = code; this.details = details; } }

function createArcaShelfAdminApplication(options) {
  const store = createShelfQueryStore(options);
  function invoke(operation) {
    try { return operation(); } catch (error) {
      if (error instanceof ArcaShelfAdminApplicationError) throw error;
      if (error.code === 'P3_COMMAND_IDEMPOTENCY_CONFLICT') {
        throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_IDEMPOTENCY_CONFLICT', '同一幂等键不能用于不同的Shelf创建请求。');
      }
      throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求未通过Arca Owner-local合同校验。', { reasonCode: error.code || 'ARCA_SHELF_CONTRACT_REJECTED' });
    }
  }
  return Object.freeze({
    listShelves() { return Object.freeze({ items: store.listShelves() }); },
    getShelf(shelfId) { const shelf = store.getShelf(shelfId); if (!shelf) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_NOT_FOUND', 'Shelf不存在。', { shelfId }); return Object.freeze({ shelf }); },
    createShelf(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_COMMAND_REJECTED', 'Shelf请求体无效。');
      const { idempotencyKey, ...input } = body;
      return invoke(() => store.createShelf({ idempotencyKey, input }));
    },
  });
}

module.exports = Object.freeze({ ArcaShelfAdminApplicationError, createArcaShelfAdminApplication });
