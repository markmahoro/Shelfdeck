'use strict';

function isNotImplemented(error) {
  return error && error.code === 'HELIX_CAPABILITY_NOT_IMPLEMENTED';
}

function safeCall(fn, fallback) {
  try { return fn(); } catch (error) {
    if (isNotImplemented(error)) return fallback;
    throw error;
  }
}

function createLibraReconciler({ store, nexoraService, kairoxService }) {
  if (!store || !nexoraService || !kairoxService) throw new TypeError('Libra Reconciler dependencies are required');

  function reconcileItem(itemId) {
    let item = store.getLibraryItem(itemId);
    if (!item) return null;
    if (item.membershipStatus === 'closed') return item;

    const source = safeCall(() => nexoraService.getSourceProjection(itemId), { itemId, readiness: 'unresolved', sourceRevision: '' });
    const maintenance = safeCall(() => kairoxService.getMaintenanceProjection(itemId), { itemId, availability: 'not_implemented' });
    const patch = {
      itemId,
      sourceProjection: source,
      sourceRevision: source.sourceRevision || item.sourceRevision,
      maintenanceProjection: maintenance,
      maintenanceRevision: maintenance.maintenanceRevision || item.maintenanceRevision,
    };

    if (item.desiredState === 'closed') {
      if (item.phase !== 'offboarding') {
        patch.phase = 'offboarding';
        patch.admissionGeneration = item.admissionGeneration + 1;
      }
    } else if (source.readiness === 'ready') {
      patch.phase = 'maintenance';
      patch.blockedReason = '';
      if (item.phase !== 'maintenance' || item.quarantineStatus !== 'none') {
        patch.admissionGeneration = item.admissionGeneration + 1;
      }
      patch.quarantineStatus = 'none';
      patch.quarantineReason = '';
    } else if (item.phase === 'maintenance') {
      patch.quarantineStatus = 'source_incident';
      patch.quarantineReason = source.latestObservation && source.latestObservation.reason || 'source_unavailable';
      if (item.quarantineStatus !== 'source_incident') patch.admissionGeneration = item.admissionGeneration + 1;
    } else {
      patch.phase = 'onboarding';
      patch.blockedReason = source.readiness === 'unresolved' ? 'migration_source_unresolved' : `source_${source.readiness}`;
    }

    item = store.upsertLibraryItem(patch);
    if (item.quarantineStatus === 'source_incident') {
      safeCall(() => kairoxService.suspendMaintenance({
        itemId,
        admissionGeneration: item.admissionGeneration,
        reason: item.quarantineReason || 'source_incident',
      }), null);
      const diagnosis = safeCall(() => nexoraService.diagnoseSource({
        itemId,
        libraryGeneration: item.admissionGeneration,
        sourceRevision: source.sourceRevision || '',
      }), source);
      if (diagnosis && diagnosis.sourceRevision) {
        item = store.upsertLibraryItem({ itemId, sourceProjection: diagnosis, sourceRevision: diagnosis.sourceRevision });
      }
    }
    if (item.phase === 'maintenance' && item.quarantineStatus === 'none' && source.readiness === 'ready') {
      const maintenanceResult = safeCall(() => kairoxService.reconcileMaintenance({
        itemId,
        admissionGeneration: item.admissionGeneration,
        sourceRevision: source.sourceRevision || '',
        sourceAccessDescriptor: source.sourceAccessDescriptor || {},
        policyRevision: '',
      }), maintenance);
      item = store.upsertLibraryItem({
        itemId,
        maintenanceProjection: maintenanceResult,
        maintenanceRevision: maintenanceResult.maintenanceRevision || item.maintenanceRevision,
      });
    }
    store.appendEvent({
      itemId,
      eventType: 'libra.item_reconciled',
      generation: item.admissionGeneration,
      payload: { phase: item.phase, sourceReadiness: source.readiness, quarantineStatus: item.quarantineStatus },
    });
    return item;
  }

  function reconcileBatch(itemIds = null) {
    return store.getLibraryItems(itemIds).map((item) => reconcileItem(item.itemId));
  }

  return Object.freeze({ reconcileItem, reconcileBatch });
}

module.exports = { createLibraReconciler };
