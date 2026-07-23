'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');

function createShelfRoutingTargetProjection(options) {
  const store = createShelfQueryStore(options);
  return Object.freeze({
    list() {
      return Object.freeze(store.listShelves().map((shelf) => Object.freeze({
        shelfId: shelf.shelfId,
        status: shelf.status,
        currentStandardRevision: shelf.currentStandardRevision,
        currentStandardDigest: shelf.standard.digest,
        routingProjectionRevision: shelf.routingProjection.revision,
        projectionDigest: shelf.routingProjection.digest,
      })));
    },
  });
}

module.exports = Object.freeze({ createShelfRoutingTargetProjection });
