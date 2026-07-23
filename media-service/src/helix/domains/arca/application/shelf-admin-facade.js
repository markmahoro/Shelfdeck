'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');

class ArcaShelfAdminApplicationError extends Error { constructor(code, message, details = {}) { super(message); this.name = 'ArcaShelfAdminApplicationError'; this.code = code; this.details = details; } }

function createArcaShelfAdminApplication(options) {
  const store = createShelfQueryStore(options);
  return Object.freeze({
    listShelves() { return Object.freeze({ items: store.listShelves() }); },
    getShelf(shelfId) { const shelf = store.getShelf(shelfId); if (!shelf) throw new ArcaShelfAdminApplicationError('ADMIN_SHELF_NOT_FOUND', 'Shelf不存在。', { shelfId }); return Object.freeze({ shelf }); },
  });
}

module.exports = Object.freeze({ ArcaShelfAdminApplicationError, createArcaShelfAdminApplication });
