'use strict';

const { createShelfQueryStore } = require('../persistence/shelf-query-store');
const { canonicalDigest } = require('../../../contracts/canonical-json');

function createShelfRoutingTargetProjection(options) {
  const store = createShelfQueryStore(options);
  function routeProjection(shelf) {
    return Object.freeze({
      shelfId: shelf.shelfId,
      status: shelf.status,
      currentStandardRevision: shelf.currentStandardRevision,
      currentStandardDigest: shelf.standard.digest,
      routingProjectionRevision: shelf.routingProjection.revision,
      projectionDigest: shelf.routingProjection.digest,
    });
  }
  return Object.freeze({
    list() {
      return Object.freeze(store.listShelves()
        .filter((shelf) => shelf.status === 'active')
        .map(routeProjection));
    },
    getStandard(shelfId) {
      const shelf = store.getShelf(shelfId);
      if (!shelf) return null;
      const route = routeProjection(shelf);
      if (shelf.status !== 'active') {
        return Object.freeze({
          resultKind: 'unavailable',
          reasonCode: 'shelf_inactive',
          shelfId,
          routingProjection: route,
        });
      }
      const standard = shelf.standard.value;
      if (!standard || standard.shelfId !== shelf.shelfId ||
          standard.standardRevision !== shelf.standard.revision ||
          standard.ruleTemplateId !== shelf.standard.ruleTemplateId ||
          standard.ruleTemplateRevision !== shelf.standard.ruleTemplateRevision ||
          standard.standardDigest !== shelf.standard.digest) {
        return Object.freeze({
          resultKind: 'unavailable',
          reasonCode: 'shelf_standard_unavailable',
          shelfId,
          routingProjection: route,
        });
      }
      const projection = {
        shelfId,
        status: shelf.status,
        routingProjectionRevision: route.routingProjectionRevision,
        projectionDigest: route.projectionDigest,
        standard,
      };
      return Object.freeze({
        resultKind: 'found',
        projection: Object.freeze({
          ...projection,
          projectionResultDigest: canonicalDigest(projection),
        }),
      });
    },
  });
}

module.exports = Object.freeze({ createShelfRoutingTargetProjection });
