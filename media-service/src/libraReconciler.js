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

function createLibraReconciler({ store, nexoraService, kairoxService, configStore }) {
  if (!store || !nexoraService || !kairoxService) throw new TypeError('Libra Reconciler dependencies are required');

  function persistIfChanged(item, patch) {
    const updates = Object.entries(patch || {}).reduce((out, [key, value]) => {
      if (key !== 'subjectId' && value !== undefined && item[key] !== value) out[key] = value;
      return out;
    }, {});
    if (Object.keys(updates).length === 0) return { item, changed: false };
    return { item: store.upsertLibrarySubject({ subjectId: item.subjectId, ...updates }), changed: true };
  }

  function reconcileItem(subjectId) {
    let item = store.getLibrarySubject(subjectId);
    if (!item) return null;
    if (item.membershipStatus === 'closed') return item;

    const source = safeCall(() => nexoraService.getSourceProjection(subjectId), { subjectId, readiness: 'unresolved', sourceRevision: '' });
    const maintenance = safeCall(() => kairoxService.getMaintenanceProjection(subjectId), { subjectId, availability: 'not_implemented' });
    return reconcileResolved(item, source, maintenance);
  }

  function reconcileResolved(currentItem, source, maintenance) {
    let item = currentItem;
    if (!item || item.membershipStatus === 'closed') return item;
    const subjectId = item.subjectId;
    const patch = {
      subjectId,
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
        subjectId,
        admissionGeneration: item.admissionGeneration,
        reason: item.quarantineReason || 'source_incident',
      }), null);
      const diagnosis = safeCall(() => nexoraService.diagnoseSource({
        subjectId,
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
      const subject = {
        subjectKind: item.subjectKind || '',
      };
      const currentSubject = maintenance && maintenance.maintenanceSubject || {};
      const config = configStore && configStore.loadConfig ? configStore.loadConfig() : { subLibraries: [] };
      const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === item.subLibraryId) || {};
      const subjectCurrent = currentSubject.subjectKind === subject.subjectKind;
      const admissionAlreadyCurrent = maintenance && maintenance.admissionCurrent
        && Number(admission && admission.admissionGeneration) === item.admissionGeneration
        && String(admission && admission.sourceRevision || '') === String(source.sourceRevision || '')
        && subjectCurrent
        && !(maintenance && maintenance.unresolvedSourceIncident);
      const maintenanceResult = admissionAlreadyCurrent
        ? maintenance
        : safeCall(() => kairoxService.reconcileMaintenance({
          subjectId,
          admissionGeneration: item.admissionGeneration,
          sourceRevision: source.sourceRevision || '',
          sourceAccessDescriptor: source.sourceAccessDescriptor || {},
          assets: source.assets || [],
          policyRevision: String(subLibrary.updatedAt || ''),
          maintenancePolicy: {
            maintenanceAutomationMode: subLibrary.maintenanceAutomationMode || 'manual',
            libraryPriority: Number(subLibrary.priorityWeight) || 100,
          },
          maintenanceSubject: subject,
        }), maintenance);
      persisted = persistIfChanged(item, {
        maintenanceRevision: maintenanceResult.maintenanceRevision || item.maintenanceRevision,
      });
      item = persisted.item;
      changed = changed || persisted.changed;
    }
    if (changed) {
      store.appendEvent({
        subjectId,
        eventType: 'libra.item_reconciled',
        generation: item.admissionGeneration,
        payload: { phase: item.phase, sourceReadiness: source.readiness, quarantineStatus: item.quarantineStatus },
      });
    }
    return item;
  }

  function reconcileBatch(subjectIds = null) {
    const pendingMutations = typeof kairoxService.getPendingSourceMutations === 'function'
      ? safeCall(() => kairoxService.getPendingSourceMutations(100), [])
      : [];
    for (const mutation of pendingMutations || []) {
      let mutationItem = store.getLibrarySubject(mutation.subjectId);
      if (!mutationItem || mutationItem.membershipStatus === 'closed') {
        if (typeof kairoxService.acknowledgeSourceMutation === 'function') safeCall(() => kairoxService.acknowledgeSourceMutation(mutation.mutationId), false);
        continue;
      }
      mutationItem = store.upsertLibrarySubject({
        subjectId: mutation.subjectId,
        admissionGeneration: mutationItem.admissionGeneration + 1,
        quarantineStatus: 'source_incident',
        quarantineReason: 'source_mutation_rebind',
      });
      safeCall(() => kairoxService.suspendMaintenance({ subjectId: mutation.subjectId, admissionGeneration: mutationItem.admissionGeneration, reason: 'source_mutation_rebind' }), null);
      const rebound = typeof nexoraService.rebindSourceMutation === 'function'
        ? safeCall(() => nexoraService.rebindSourceMutation({ subjectId: mutation.subjectId, libraryGeneration: mutationItem.admissionGeneration, mutation }), null)
        : null;
      if (rebound && rebound.readiness === 'ready') {
        store.upsertLibrarySubject({ subjectId: mutation.subjectId, sourceRevision: rebound.sourceRevision || mutationItem.sourceRevision, quarantineStatus: 'none', quarantineReason: '' });
        if (typeof kairoxService.acknowledgeSourceMutation === 'function') safeCall(() => kairoxService.acknowledgeSourceMutation(mutation.mutationId), false);
      }
    }
    const items = store.getLibrarySubjects(subjectIds);
    const ids = items.map((item) => item.subjectId);
    const sources = safeCall(() => nexoraService.getSourceProjections(ids), {});
    const maintenanceIds = items
      .filter((item) => item.membershipStatus !== 'closed'
        && (item.phase === 'maintenance' || (sources[item.subjectId] && sources[item.subjectId].readiness === 'ready')))
      .map((item) => item.subjectId);
    const maintenance = maintenanceIds.length > 0
      ? safeCall(() => kairoxService.getMaintenanceProjections(maintenanceIds), {})
      : {};
    return items.map((item) => reconcileResolved(
      item,
      sources[item.subjectId] || { subjectId: item.subjectId, readiness: 'unresolved', sourceRevision: '' },
      maintenance[item.subjectId] || { subjectId: item.subjectId, availability: 'not_implemented' },
    ));
  }

  return Object.freeze({ reconcileItem, reconcileBatch });
}

module.exports = { createLibraReconciler };
