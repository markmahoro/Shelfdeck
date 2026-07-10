'use strict';

const crypto = require('crypto');
const libraStore = require('./libraStore');
const { HelixError } = require('./helixError');
const { createLibraReconciler } = require('./libraReconciler');

const CLEANUP_MODES = new Set(['retain_source', 'detach_source', 'delete_source']);

function createLibraRuntime({ nexoraService, kairoxService, store = libraStore }) {
  store.migrateLegacyFacts();
  const reconciler = createLibraReconciler({ store, nexoraService, kairoxService });

  function libraryProjection(item, sourceProjection = {}, maintenanceProjection = {}) {
    if (!item) return null;
    return {
      itemId: item.itemId,
      membership: { status: item.membershipStatus, active: item.membershipStatus === 'active' },
      desiredState: item.desiredState,
      phase: item.phase,
      quarantine: { status: item.quarantineStatus, reason: item.quarantineReason },
      blockedReason: item.blockedReason,
      admissionGeneration: item.admissionGeneration,
      source: sourceProjection || {},
      maintenance: maintenanceProjection || {},
      coordination: {
        consumedSourceRevision: item.sourceRevision || '',
        consumedMaintenanceRevision: item.maintenanceRevision || '',
      },
      currentOperation: store.getCurrentOperationForItem(item.itemId),
      updatedAt: item.updatedAt,
    };
  }

  function getLibraryProjection(itemId) {
    const item = store.getLibraryItem(itemId);
    if (!item) return null;
    return libraryProjection(
      item,
      nexoraService.getSourceProjection(itemId),
      kairoxService.getMaintenanceProjection(itemId),
    );
  }

  function getLibraryProjections(itemIds = []) {
    const items = store.getLibraryItems(itemIds);
    const ids = items.map((item) => item.itemId);
    const sourceProjections = nexoraService.getSourceProjections(ids);
    const maintenanceProjections = kairoxService.getMaintenanceProjections(ids);
    return items.reduce((out, item) => {
      out[item.itemId] = libraryProjection(
        item,
        sourceProjections[item.itemId] || {},
        maintenanceProjections[item.itemId] || {},
      );
      return out;
    }, {});
  }

  function acceptSource(command = {}) {
    const itemId = String(command.itemId || crypto.randomUUID());
    const payload = { sourceReference: command.sourceReference || {}, requestedBy: command.requestedBy || 'system' };
    const item = store.upsertLibraryItem({
      itemId,
      membershipStatus: 'active',
      desiredState: 'managed',
      phase: 'onboarding',
      blockedReason: '',
    });
    const created = store.createOrGetOperation({
      itemId,
      operationKind: 'onboarding',
      idempotencyKey: command.idempotencyKey,
      libraryGeneration: item.admissionGeneration,
      payload,
    });
    if (!created.created && created.operation.status === 'done') {
      return { operation: created.operation, projection: getLibraryProjection(itemId) };
    }
    if (created.created) {
      store.appendEvent({ itemId, operationId: created.operation.operationId, eventType: 'libra.onboarding_requested', payload });
    }
    store.updateOperation(created.operation.operationId, { status: 'running', step: 'nexora_onboarding', incrementAttempt: true });
    try {
      const sourceProjection = nexoraService.ensureOnboarding({
        itemId,
        sourceReference: command.sourceReference || {},
        libraryGeneration: item.admissionGeneration,
        idempotencyKey: command.idempotencyKey,
      });
      store.upsertLibraryItem({
        itemId,
        sourceRevision: sourceProjection.sourceRevision || '',
        blockedReason: sourceProjection.readiness === 'ready' ? '' : `source_${sourceProjection.readiness || 'unresolved'}`,
      });
      const reconciled = reconciler.reconcileItem(itemId);
      const operation = store.updateOperation(created.operation.operationId, {
        status: 'done',
        step: 'completed',
        errorCode: '',
        errorMessage: '',
        result: { sourceRevision: sourceProjection.sourceRevision || 0, phase: reconciled.phase },
      });
      return { operation, projection: getLibraryProjection(itemId) };
    } catch (error) {
      store.updateOperation(created.operation.operationId, {
        status: 'retrying',
        step: 'nexora_onboarding',
        retryAt: new Date(Date.now() + 30000).toISOString(),
        errorCode: error.code || 'NEXORA_ONBOARDING_FAILED',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  function requestMaintenance(command = {}) {
    const item = store.getLibraryItem(command.itemId);
    if (!item) throw new HelixError('LIBRA_ITEM_NOT_FOUND', 'Library item not found');
    if (item.membershipStatus !== 'active' || item.phase !== 'maintenance' || item.quarantineStatus !== 'none') {
      throw new HelixError('LIBRA_MAINTENANCE_NOT_ADMITTED', 'Library item is not admitted for maintenance', {
        itemId: item.itemId, phase: item.phase, quarantineStatus: item.quarantineStatus,
      });
    }
    return kairoxService.requestMaintenance({ ...command, libraryGeneration: item.admissionGeneration });
  }

  async function requestOffboarding(command = {}) {
    const item = store.getLibraryItem(command.itemId);
    if (!item) throw new HelixError('LIBRA_ITEM_NOT_FOUND', 'Library item not found');
    const cleanupMode = String(command.cleanupMode || 'retain_source');
    if (!CLEANUP_MODES.has(cleanupMode)) throw new HelixError('LIBRA_INVALID_CLEANUP_MODE', 'Invalid cleanup mode');
    if (cleanupMode === 'delete_source' && command.destructiveAuthorization !== true) {
      throw new HelixError('LIBRA_DESTRUCTIVE_AUTHORIZATION_REQUIRED', 'Physical delete requires explicit authorization');
    }
    const generation = item.admissionGeneration + 1;
    const payload = { cleanupMode, reason: command.reason || '', destructiveAuthorization: command.destructiveAuthorization === true };
    const created = store.createOrGetOperation({
      itemId: item.itemId,
      operationKind: 'offboarding',
      idempotencyKey: command.idempotencyKey,
      libraryGeneration: generation,
      payload,
    });
    if (!created.created && created.operation.status === 'done') {
      return { operation: created.operation, projection: getLibraryProjection(item.itemId) };
    }
    if (created.created) {
      store.upsertLibraryItem({ itemId: item.itemId, desiredState: 'closed', phase: 'offboarding', admissionGeneration: generation });
      store.appendEvent({ itemId: item.itemId, operationId: created.operation.operationId, eventType: 'libra.offboarding_requested', generation, payload });
    }
    store.updateOperation(created.operation.operationId, { status: 'running', step: 'kairox_suspend', incrementAttempt: true });
    try {
      const suspended = await Promise.resolve(kairoxService.suspendMaintenance({
        itemId: item.itemId,
        admissionGeneration: generation,
        reason: 'offboarding',
      }));
      store.updateOperation(created.operation.operationId, { status: 'running', step: 'nexora_cleanup' });
      const cleanup = await Promise.resolve(nexoraService.ensureOffboarding({
        itemId: item.itemId,
        cleanupMode,
        destructiveAuthorization: command.destructiveAuthorization === true,
        libraryGeneration: generation,
        idempotencyKey: command.idempotencyKey,
      }));
      const closed = store.upsertLibraryItem({
        itemId: item.itemId,
        membershipStatus: 'closed',
        desiredState: 'closed',
        phase: 'closed',
        quarantineStatus: 'none',
        quarantineReason: '',
        blockedReason: '',
        sourceRevision: cleanup.sourceProjection && cleanup.sourceProjection.sourceRevision || item.sourceRevision,
      });
      store.appendEvent({ itemId: item.itemId, operationId: created.operation.operationId, eventType: 'libra.offboarding_completed', generation, payload: { cleanupMode } });
      const operation = store.updateOperation(created.operation.operationId, {
        status: 'done', step: 'completed', errorCode: '', errorMessage: '',
        result: { cleanup, interruptedTasks: suspended && suspended.interruptedTasks || [] },
      });
      return { operation, projection: getLibraryProjection(closed.itemId) };
    } catch (error) {
      store.updateOperation(created.operation.operationId, {
        status: 'retrying',
        retryAt: new Date(Date.now() + 30000).toISOString(),
        errorCode: error.code || 'LIBRA_OFFBOARDING_FAILED',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  async function requestOffboardingBatch(command = {}) {
    const itemIds = [...new Set((command.itemIds || []).map((itemId) => String(itemId || '').trim()).filter(Boolean))];
    const idempotencyKey = String(command.idempotencyKey || '').trim();
    if (!idempotencyKey) throw new HelixError('LIBRA_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
    const cleanupMode = String(command.cleanupMode || 'retain_source');
    if (cleanupMode !== 'retain_source') {
      throw new HelixError('LIBRA_SUBLIBRARY_RETAIN_SOURCE_REQUIRED', 'Sub-library offboarding only supports retain_source');
    }
    const results = [];
    const failures = [];
    let alreadyClosed = 0;
    for (const itemId of itemIds) {
      const projection = getLibraryProjection(itemId);
      if (projection && projection.membership.status === 'closed') {
        alreadyClosed += 1;
        results.push({ itemId, status: 'already_closed', phase: projection.phase });
        continue;
      }
      try {
        const result = await requestOffboarding({
          itemId,
          cleanupMode,
          reason: command.reason || 'sub_library_removed',
          destructiveAuthorization: false,
          idempotencyKey: `${idempotencyKey}:${itemId}`,
        });
        results.push({
          itemId,
          status: 'closed',
          operationId: result.operation && result.operation.operationId || '',
          phase: result.projection && result.projection.phase || '',
        });
      } catch (error) {
        failures.push({ itemId, code: error.code || 'LIBRA_OFFBOARDING_FAILED', message: error.message });
      }
    }
    return {
      requested: itemIds.length,
      closed: results.filter((entry) => entry.status === 'closed').length,
      alreadyClosed,
      failed: failures.length,
      completed: failures.length === 0,
      results,
      failures,
    };
  }

  return Object.freeze({
    acceptSource,
    requestMaintenance,
    requestOffboarding,
    requestOffboardingBatch,
    reconcileItem: reconciler.reconcileItem,
    reconcileBatch: reconciler.reconcileBatch,
    getLibraryProjection,
    getLibraryProjections,
  });
}

module.exports = { createLibraRuntime };
