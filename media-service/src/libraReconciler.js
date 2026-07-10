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

  function persistIfChanged(item, patch) {
    const updates = Object.entries(patch || {}).reduce((out, [key, value]) => {
      if (key !== 'itemId' && value !== undefined && item[key] !== value) out[key] = value;
      return out;
    }, {});
    if (Object.keys(updates).length === 0) return { item, changed: false };
    return { item: store.upsertLibraryItem({ itemId: item.itemId, ...updates }), changed: true };
  }

  function reconcileItem(itemId) {
    let item = store.getLibraryItem(itemId);
    if (!item) return null;
    if (item.membershipStatus === 'closed') return item;

    const source = safeCall(() => nexoraService.getSourceProjection(itemId), { itemId, readiness: 'unresolved', sourceRevision: '' });
    const maintenance = safeCall(() => kairoxService.getMaintenanceProjection(itemId), { itemId, availability: 'not_implemented' });
    return reconcileResolved(item, source, maintenance);
  }

  function reconcileResolved(currentItem, source, maintenance) {
    let item = currentItem;
    if (!item || item.membershipStatus === 'closed') return item;
    const itemId = item.itemId;
    const patch = {
      itemId,
      sourceRevision: source.sourceRevision || item.sourceRevision,
    };
    if (item.phase === 'maintenance' || source.readiness === 'ready') {
      patch.maintenanceRevision = maintenance.maintenanceRevision || item.maintenanceRevision;
    }

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

    let persisted = persistIfChanged(item, patch);
    item = persisted.item;
    let changed = persisted.changed;
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
        persisted = persistIfChanged(item, { sourceRevision: diagnosis.sourceRevision });
        item = persisted.item;
        changed = changed || persisted.changed;
      }
    }
    if (item.phase === 'maintenance' && item.quarantineStatus === 'none' && source.readiness === 'ready') {
      const admission = maintenance && maintenance.admission;
      const admissionAlreadyCurrent = maintenance && maintenance.admissionCurrent
        && Number(admission && admission.admissionGeneration) === item.admissionGeneration
        && String(admission && admission.sourceRevision || '') === String(source.sourceRevision || '')
        && !(maintenance && maintenance.unresolvedSourceIncident);
      const maintenanceResult = admissionAlreadyCurrent
        ? maintenance
        : safeCall(() => kairoxService.reconcileMaintenance({
          itemId,
          admissionGeneration: item.admissionGeneration,
          sourceRevision: source.sourceRevision || '',
          sourceAccessDescriptor: source.sourceAccessDescriptor || {},
          policyRevision: '',
        }), maintenance);
      persisted = persistIfChanged(item, {
        maintenanceRevision: maintenanceResult.maintenanceRevision || item.maintenanceRevision,
      });
      item = persisted.item;
      changed = changed || persisted.changed;
    }
    if (changed) {
      store.appendEvent({
        itemId,
        eventType: 'libra.item_reconciled',
        generation: item.admissionGeneration,
        payload: { phase: item.phase, sourceReadiness: source.readiness, quarantineStatus: item.quarantineStatus },
      });
    }
    return item;
  }

  function reconcileBatch(itemIds = null) {
    const items = store.getLibraryItems(itemIds);
    const ids = items.map((item) => item.itemId);
    const sources = safeCall(() => nexoraService.getSourceProjections(ids), {});
    const maintenanceIds = items
      .filter((item) => item.membershipStatus !== 'closed'
        && (item.phase === 'maintenance' || (sources[item.itemId] && sources[item.itemId].readiness === 'ready')))
      .map((item) => item.itemId);
    const maintenance = maintenanceIds.length > 0
      ? safeCall(() => kairoxService.getMaintenanceProjections(maintenanceIds), {})
      : {};
    return items.map((item) => reconcileResolved(
      item,
      sources[item.itemId] || { itemId: item.itemId, readiness: 'unresolved', sourceRevision: '' },
      maintenance[item.itemId] || { itemId: item.itemId, availability: 'not_implemented' },
    ));
  }

  return Object.freeze({ reconcileItem, reconcileBatch });
}

module.exports = { createLibraReconciler };
