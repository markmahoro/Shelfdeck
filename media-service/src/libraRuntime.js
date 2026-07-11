'use strict';

const crypto = require('crypto');
const libraStore = require('./libraStore');
const configStore = require('./configStore');
const defaultResourceGovernor = require('./resourceGovernor');
const { HelixError } = require('./helixError');
const { createLibraReconciler } = require('./libraReconciler');
const defaultDoubanService = require('./services/doubanService');
const doubanMatchService = require('./doubanMatchService');

const CLEANUP_MODES = new Set(['retain_source', 'detach_source', 'delete_source']);

function createLibraRuntime({ nexoraService, kairoxService, store = libraStore, configs = configStore, resourceGovernor = defaultResourceGovernor, doubanService = defaultDoubanService }) {
  const reconciler = createLibraReconciler({ store, nexoraService, kairoxService, configStore: configs });

  function libraryProjection(item, sourceProjection = {}, maintenanceProjection = {}, currentOperation = undefined, maintenanceScopes = undefined) {
    if (!item) return null;
    return {
      itemId: item.itemId,
      subLibraryId: item.subLibraryId || '',
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
      hierarchy: {
        mediaKind: item.mediaKind || '',
        playable: item.playable !== false,
        parentItemId: item.parentItemId || '',
        seriesItemId: item.seriesItemId || '',
      },
      maintenanceScopes: maintenanceScopes === undefined
        ? store.listActiveMaintenanceScopes(item.subLibraryId).filter((scope) => scope.rootItemId === item.itemId)
        : maintenanceScopes,
      currentOperation: currentOperation === undefined
        ? store.getCurrentOperationForItem(item.itemId)
        : currentOperation,
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
    const currentOperations = store.getCurrentOperationsForItems(ids);
    const scopesByRoot = store.listActiveMaintenanceScopes().reduce((out, scope) => {
      if (!out[scope.rootItemId]) out[scope.rootItemId] = [];
      out[scope.rootItemId].push(scope);
      return out;
    }, {});
    return items.reduce((out, item) => {
      out[item.itemId] = libraryProjection(
        item,
        sourceProjections[item.itemId] || {},
        maintenanceProjections[item.itemId] || {},
        currentOperations[item.itemId] || null,
        scopesByRoot[item.itemId] || [],
      );
      return out;
    }, {});
  }

  function libraryListView(projection) {
    const source = projection.source || {};
    const maintenance = projection.maintenance || {};
    const basedata = maintenance.basedataFacts || {};
    const metadata = maintenance.metadataFacts || {};
    const descriptor = source.sourceAccessDescriptor || {};
    const identity = descriptor.identityPayload || {};
    const locator = descriptor.locator || {};
    const structure = descriptor.observedStructure || projection.hierarchy || {};
    return {
      itemId: projection.itemId,
      subLibraryId: projection.subLibraryId || descriptor.subLibraryId || '',
      name: metadata.title || metadata.name || structure.displayName || identity.name || '',
      title: metadata.title || metadata.name || '',
      type: metadata.type || structure.mediaKind || identity.type || '',
      source: descriptor.sourceType || identity.source || '',
      sourceId: descriptor.sourceId || '',
      embyItemId: identity.embyItemId || locator.sourceRefId || '',
      path: basedata.path || locator.path || '',
      resolution: basedata.resolution || '',
      codec: basedata.codec || basedata.videoCodec || '',
      bitrate: basedata.bitrate || 0,
      size: basedata.size || 0,
      duration: basedata.duration || 0,
      metadataComplete: !!maintenance.metadataPassed,
      userRating: (maintenance.userPerceptionFacts && maintenance.userPerceptionFacts.userRating) ?? null,
      watched: !!(maintenance.userPerceptionFacts && maintenance.userPerceptionFacts.watched),
      playCount: maintenance.userPerceptionFacts && maintenance.userPerceptionFacts.playCount || 0,
      maintenanceState: maintenance.maintenanceState || 'maintaining',
      maintenanceComplete: !!maintenance.maintenanceComplete,
      helix: projection,
      updatedAt: projection.updatedAt,
    };
  }

  function queryLibraryProjections(filter = {}, options = {}) {
    const membershipItems = store.getLibraryItems();
    const projections = getLibraryProjections(membershipItems.map((item) => item.itemId));
    const search = String(filter.search || '').trim().toLowerCase();
    const views = membershipItems
      .map((item) => projections[item.itemId])
      .filter(Boolean)
      .map(libraryListView);
    for (const view of views) {
      if (view.helix.hierarchy.playable !== false) continue;
      const members = views.filter((candidate) => candidate.helix.hierarchy.playable !== false
        && (view.type === 'series' ? candidate.helix.hierarchy.seriesItemId === view.itemId : candidate.helix.hierarchy.parentItemId === view.itemId));
      const activeScopes = view.helix.maintenanceScopes || [];
      view.maintenanceComplete = members.length > 0 && members.every((member) => member.maintenanceComplete);
      view.helix.maintenance = {
        ...view.helix.maintenance,
        maintenanceComplete: view.maintenanceComplete,
        maintenanceState: view.maintenanceComplete ? 'complete' : 'maintaining',
        aggregateMemberCount: members.length,
        aggregateCompleteCount: members.filter((member) => member.maintenanceComplete).length,
        run: activeScopes.some((scope) => scope.action === 'start') ? { status: 'active_scope' } : null,
        priority: {
          class: activeScopes.some((scope) => scope.action === 'priority') || members.some((member) => member.helix.maintenance.priority && member.helix.maintenance.priority.class === 'expedited') ? 'expedited' : 'normal',
          revision: 0,
        },
      };
    }
    const items = views
      .filter((item) => !filter.itemId || item.itemId === filter.itemId)
      .filter((item) => !filter.subLibraryId || item.subLibraryId === filter.subLibraryId)
      .filter((item) => !filter.source || item.source === filter.source)
      .filter((item) => !filter.type || item.type === filter.type)
      .filter((item) => !filter.lifecycle || item.helix.phase === filter.lifecycle || (filter.lifecycle === 'open' && item.helix.phase !== 'closed'))
      .filter((item) => !filter.metadataStatus || (['done', 'complete'].includes(filter.metadataStatus) ? item.metadataComplete : !item.metadataComplete))
      .filter((item) => !search || [item.name, item.title, item.path, item.embyItemId].some((value) => String(value || '').toLowerCase().includes(search)));
    const offset = Math.max(0, Number(options.offset) || 0);
    const limit = Number(options.limit) > 0 ? Math.min(500, Number(options.limit)) : items.length;
    return { items: items.slice(offset, offset + limit), total: items.length };
  }

  async function getLibraryMaintenanceSummaries(options = {}) {
    const batchSize = Math.max(1, Math.min(100, Number(options.batchSize) || 100));
    const items = store.getLibraryItems().filter((item) => (
      item.membershipStatus === 'active' && item.playable !== false
    ));
    const summaries = {};
    for (let offset = 0; offset < items.length; offset += batchSize) {
      const batch = items.slice(offset, offset + batchSize);
      const ids = batch.map((item) => item.itemId);
      const projections = typeof kairoxService.getMaintenanceSummaryProjections === 'function'
        ? kairoxService.getMaintenanceSummaryProjections(ids)
        : kairoxService.getMaintenanceProjections(ids);
      for (const item of batch) {
        const subLibraryId = item.subLibraryId || '';
        if (!subLibraryId) continue;
        if (!summaries[subLibraryId]) {
          summaries[subLibraryId] = {
            total: 0, basedataPassed: 0, metadataPassed: 0, optimizePassed: 0, maintenanceComplete: 0,
            directionCounts: { none: 0, transcode: 0, upgrade: 0, undetermined: 0, blocked: 0 },
          };
        }
        const summary = summaries[subLibraryId];
        const maintenance = projections[item.itemId] || {};
        summary.total += 1;
        if (maintenance.basedataPassed) summary.basedataPassed += 1;
        if (maintenance.metadataPassed) summary.metadataPassed += 1;
        if (maintenance.optimizePassed) summary.optimizePassed += 1;
        if (maintenance.maintenanceComplete) summary.maintenanceComplete += 1;
        const direction = Object.prototype.hasOwnProperty.call(summary.directionCounts, maintenance.optimizationDirection)
          ? maintenance.optimizationDirection
          : 'undetermined';
        summary.directionCounts[direction] += 1;
      }
      if (offset + batchSize < items.length) await new Promise((resolve) => setImmediate(resolve));
    }
    return summaries;
  }

  function acceptSource(command = {}) {
    const itemId = String(command.itemId || crypto.randomUUID());
    const payload = { sourceReference: command.sourceReference || {}, requestedBy: command.requestedBy || 'system' };
    const subLibraryId = command.sourceReference && command.sourceReference.subLib && command.sourceReference.subLib.uuid
      || command.sourceReference && command.sourceReference.subLibraryId
      || '';
    const existingItem = store.getLibraryItem(itemId);
    const observed = command.sourceReference && command.sourceReference.item || {};
    const structure = {
      sourceRefId: String(command.sourceReference && (command.sourceReference.sourceRefId || command.sourceReference.embyItemId || command.sourceReference.path) || ''),
      mediaKind: String(observed.type || (command.sourceReference && ['adult_folder', 'folder'].includes(command.sourceReference.source) ? 'adult_file' : '')),
      playable: observed.type ? ['movie', 'episode'].includes(String(observed.type).toLowerCase()) : !!(command.sourceReference && ['adult_folder', 'folder'].includes(command.sourceReference.source)),
      parentSourceRefId: String(observed.parentId || ''),
      seriesSourceRefId: String(observed.seriesId || ''),
    };
    const item = store.upsertLibraryItem(existingItem && existingItem.membershipStatus !== 'closed' ? {
      itemId,
      subLibraryId: subLibraryId || existingItem.subLibraryId,
      ...structure,
    } : {
      itemId,
      subLibraryId,
      ...structure,
      membershipStatus: 'active',
      desiredState: 'managed',
      phase: 'onboarding',
      blockedReason: '',
      admissionGeneration: existingItem ? existingItem.admissionGeneration + 1 : 0,
    });
    const created = store.createOrGetOperation({
      itemId,
      operationKind: 'onboarding',
      idempotencyKey: command.idempotencyKey,
      libraryGeneration: item.admissionGeneration,
      payload,
    });
    if (!created.created && created.operation.status === 'done') {
      return { operation: created.operation, projection: command.includeProjection === false ? null : getLibraryProjection(itemId) };
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
      if (subLibraryId && command.deferHierarchyResolution !== true) store.resolveLibraryHierarchy(subLibraryId);
      const reconciled = reconciler.reconcileItem(itemId);
      const operation = store.updateOperation(created.operation.operationId, {
        status: 'done',
        step: 'completed',
        errorCode: '',
        errorMessage: '',
        result: { sourceRevision: sourceProjection.sourceRevision || 0, phase: reconciled.phase },
      });
      return { operation, projection: command.includeProjection === false ? null : getLibraryProjection(itemId) };
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

  function assertMaintenanceIntent(command, expectedAction) {
    const forbidden = ['targetGate', 'gateObjective', 'flowKind', 'executor'].filter((field) => command[field] !== undefined);
    if (forbidden.length > 0) throw new HelixError('KAIROX_MAINTENANCE_INTENT_INVALID', `${expectedAction} does not accept Gate or Flow fields`);
    if (!command.idempotencyKey) throw new HelixError('LIBRA_IDEMPOTENCY_KEY_REQUIRED', 'idempotencyKey is required');
    const item = store.getLibraryItem(command.itemId);
    if (!item) throw new HelixError('LIBRA_ITEM_NOT_FOUND', 'Library item not found');
    if (item.membershipStatus !== 'active' || item.phase !== 'maintenance' || item.quarantineStatus !== 'none') {
      throw new HelixError('LIBRA_MAINTENANCE_NOT_ADMITTED', 'Library item is not admitted for maintenance');
    }
    const config = configs.loadConfig();
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === item.subLibraryId);
    if (!subLibrary) throw new HelixError('LIBRA_LIBRARY_NOT_FOUND', 'SubLibrary not found');
    return { item, config, subLibrary };
  }

  function scopeItems(item) {
    store.resolveLibraryHierarchy(item.subLibraryId);
    return store.getMaintenanceScopeMembers(item.itemId);
  }

  function incompleteScopeItems(item) {
    const members = scopeItems(item);
    const projections = kairoxService.getMaintenanceProjections(members.map((member) => member.itemId));
    return members.filter((member) => !(projections[member.itemId] && projections[member.itemId].maintenanceComplete));
  }

  function runIdempotentMaintenanceIntent(item, command, operationKind, payload, work) {
    const claimed = store.createOrGetOperation({
      itemId: item.itemId,
      operationKind,
      idempotencyKey: command.idempotencyKey,
      libraryGeneration: item.admissionGeneration,
      payload,
    });
    if (!claimed.created && claimed.operation.status === 'done') {
      return { replayed: true, operation: claimed.operation, projection: getLibraryProjection(item.itemId), ...claimed.operation.result };
    }
    store.updateOperation(claimed.operation.operationId, { status: 'running', step: 'kairox_intent', incrementAttempt: true });
    try {
      const result = work();
      const summary = { affected: Number(result && result.affected) || 1, scopeId: result && result.scope && result.scope.scopeId || '' };
      const operation = store.updateOperation(claimed.operation.operationId, { status: 'done', step: 'completed', errorCode: '', errorMessage: '', result: summary });
      return { ...result, operation };
    } catch (error) {
      store.updateOperation(claimed.operation.operationId, { status: 'failed', step: 'kairox_intent', errorCode: error.code || 'KAIROX_MAINTENANCE_INTENT_FAILED', errorMessage: error.message });
      throw error;
    }
  }

  function createGroupScope(command, item, action, priorityClass) {
    const observation = requestLibraryObservation({
      subLibraryId: item.subLibraryId,
      idempotencyKey: `${command.idempotencyKey}:observe`,
      requestedBy: `maintenance_scope:${action}`,
    });
    const created = store.createOrGetMaintenanceScope({
      idempotencyKey: command.idempotencyKey,
      rootItemId: item.itemId,
      subLibraryId: item.subLibraryId,
      action,
      priorityClass,
      observationWorkId: observation.workId,
    });
    return created.scope;
  }

  function requestMaintenanceRun(command = {}) {
    const { item, config, subLibrary } = assertMaintenanceIntent(command, 'start-maintenance');
    if (subLibrary.maintenanceAutomationMode !== 'manual') {
      throw new HelixError('KAIROX_MANUAL_START_NOT_ALLOWED', 'Automatic maintenance libraries do not accept manual start');
    }
    return runIdempotentMaintenanceIntent(item, command, 'maintenance_run_start', { action: 'start' }, () => {
      const members = incompleteScopeItems(item);
      if (members.length === 0) throw new HelixError('KAIROX_MAINTENANCE_SUBJECT_NOT_PLAYABLE', 'No playable media found for maintenance');
      const scope = item.playable ? null : createGroupScope(command, item, 'start', 'normal');
      const results = members.map((member) => {
        if (scope) store.addMaintenanceScopeMember(scope.scopeId, member.itemId);
        return kairoxService.startMaintenanceRun({ itemId: member.itemId, libraryGeneration: member.admissionGeneration, config, idempotencyKey: `${command.idempotencyKey}:${member.itemId}` });
      });
      return { itemId: item.itemId, scope, affected: results.length, results };
    });
  }

  function setMaintenancePriority(command = {}) {
    const { item, config } = assertMaintenanceIntent(command, 'prioritize-maintenance');
    return runIdempotentMaintenanceIntent(item, command, 'maintenance_priority_set', { action: 'priority', reason: command.reason || '' }, () => {
      const members = incompleteScopeItems(item);
      if (members.length === 0) throw new HelixError('KAIROX_MAINTENANCE_SUBJECT_NOT_PLAYABLE', 'No playable media found for prioritization');
      const scope = item.playable ? null : createGroupScope(command, item, 'priority', 'expedited');
      const results = members.map((member) => {
        if (scope) store.addMaintenanceScopeMember(scope.scopeId, member.itemId);
        return kairoxService.setMaintenancePriority({ itemId: member.itemId, reason: command.reason || 'user_expedited', config });
      });
      return { itemId: item.itemId, scope, affected: results.length, results };
    });
  }

  function clearMaintenancePriority(command = {}) {
    const { item } = assertMaintenanceIntent(command, 'cancel-maintenance-priority');
    return runIdempotentMaintenanceIntent(item, command, 'maintenance_priority_clear', { action: 'cancel_priority', reason: command.reason || '' }, () => {
      const members = scopeItems(item);
      const scopedIds = store.listActiveMaintenanceScopes(item.subLibraryId)
        .filter((scope) => scope.rootItemId === item.itemId && scope.action === 'priority')
        .flatMap((scope) => {
          store.updateMaintenanceScope(scope.scopeId, { status: 'cancelled', completedAt: new Date().toISOString() });
          return store.listMaintenanceScopeMembers(scope.scopeId);
        });
      const ids = [...new Set([...members.map((member) => member.itemId), ...scopedIds])];
      const results = ids.map((memberId) => kairoxService.clearMaintenancePriority({ itemId: memberId, reason: command.reason || 'user_cancelled_priority' }));
      return { itemId: item.itemId, affected: results.length, results };
    });
  }

  function requestMetadataRefresh(command = {}) {
    const { item, config } = assertMaintenanceIntent(command, 'metadata-refresh');
    if (!item.playable) throw new HelixError('KAIROX_MAINTENANCE_SUBJECT_NOT_PLAYABLE', 'Metadata refresh requires playable media');
    return runIdempotentMaintenanceIntent(item, command, 'metadata_refresh', { adultId: command.adultId || '', reason: command.reason || '' }, () => {
      const result = kairoxService.requestMetadataRefresh({
        itemId: item.itemId,
        adultId: command.adultId || '',
        reason: command.reason || 'user_metadata_refresh',
        config,
      });
      return { itemId: item.itemId, affected: 1, result };
    });
  }

  function updateUserPerception(command = {}) {
    const item = store.getLibraryItem(command.itemId);
    if (!item) throw new HelixError('LIBRA_ITEM_NOT_FOUND', 'Library item not found');
    if (item.membershipStatus !== 'active' || item.phase !== 'maintenance' || item.quarantineStatus !== 'none') {
      throw new HelixError('LIBRA_MAINTENANCE_NOT_ADMITTED', 'Library item is not admitted for in-library operations');
    }
    return kairoxService.updateUserPerception({
      itemId: item.itemId,
      facts: command.facts || {},
      evidence: command.evidence || {},
      observedAt: command.observedAt,
      libraryGeneration: item.admissionGeneration,
    });
  }

  function createSubLibrary(spec = {}) {
    const config = configs.loadConfig();
    const mediaType = spec.mediaType || 'movie';
    const isAdult = mediaType === 'adult';
    const subLibrary = {
      uuid: String(spec.uuid || crypto.randomUUID()),
      name: spec.name || 'New Library',
      embyServerId: spec.embyServerId || '',
      sectionId: spec.sectionId || '',
      source: spec.source || 'emby',
      doubanEnabled: spec.doubanEnabled === true,
      enabled: true,
      mediaType,
      adultRegion: isAdult ? (spec.adultRegion || 'japanese_jav') : undefined,
      scraperType: isAdult ? (spec.scraperType || (spec.adultRegion === 'western_adult' ? 'western_builtin' : 'shelfdeck_japanese_jav')) : undefined,
      watchRoot: isAdult ? spec.watchRoot || '' : '',
      japaneseJav: isAdult && spec.adultRegion !== 'western_adult' ? spec.japaneseJav || undefined : undefined,
      western: isAdult && spec.adultRegion === 'western_adult' ? spec.western || undefined : undefined,
      ruleTemplateId: spec.ruleTemplateId || (isAdult ? (spec.adultRegion === 'western_adult' ? 'adult_western_default' : 'adult_jav_default') : mediaType === 'tv' ? 'tv_default' : 'default'),
      metadataGate: spec.metadataGate || undefined,
      libraryAutomationMode: spec.libraryAutomationMode || 'manual',
      maintenanceAutomationMode: spec.maintenanceAutomationMode || 'manual',
      approvalPolicy: spec.approvalPolicy || {},
      allowedCapabilities: spec.allowedCapabilities || {
        metadata: isAdult ? ['metadata.sidecar.render', 'metadata.poster.acquire', 'metadata.fanart.acquire'] : [],
        optimize: isAdult ? ['media.transcode', 'media.replace', 'source.organize', 'metadata.artifacts.materialize'] : ['media.transcode', 'source.upgrade.download', 'media.replace'],
      },
      capabilityPolicyRevision: String(spec.capabilityPolicyRevision || '1'),
      updatedAt: new Date().toISOString(),
      upgradeSmartSelect: spec.upgradeSmartSelect || { enabled: false, codecPreference: [], resolutionPreference: [], audioPreference: [], sitePreference: [], preferCNSub: false },
    };
    config.subLibraries = [...(config.subLibraries || []), subLibrary];
    configs.saveConfig(config);
    let observationWork = null;
    let userPerceptionSyncWork = null;
    if (subLibrary.libraryAutomationMode === 'auto') {
      observationWork = requestLibraryObservation({
        subLibraryId: subLibrary.uuid,
        idempotencyKey: `observe-library:${subLibrary.uuid}:initial`,
        requestedBy: 'library_created',
      });
      if (subLibrary.doubanEnabled) {
        userPerceptionSyncWork = requestUserPerceptionSync({
          subLibraryId: subLibrary.uuid,
          idempotencyKey: `sync-user-perception:${subLibrary.uuid}:initial`,
          requestedBy: 'library_created',
        });
      }
    }
    return { subLibrary, observationWork, userPerceptionSyncWork };
  }

  function updateSubLibrary(subLibraryId, updates = {}) {
    const config = configs.loadConfig();
    const index = (config.subLibraries || []).findIndex((entry) => entry.uuid === subLibraryId);
    if (index < 0) return null;
    const forbidden = ['uuid', 'automationMode', 'scheduleMode', 'autoCreate', 'autoExecute'];
    const patch = Object.entries(updates).reduce((out, [key, value]) => {
      if (!forbidden.includes(key)) out[key] = value;
      return out;
    }, {});
    const capabilityChanged = updates.allowedCapabilities !== undefined
      && JSON.stringify(updates.allowedCapabilities) !== JSON.stringify(config.subLibraries[index].allowedCapabilities);
    const next = { ...config.subLibraries[index], ...patch };
    if (capabilityChanged) next.capabilityPolicyRevision = String((Number(config.subLibraries[index].capabilityPolicyRevision) || 0) + 1);
    next.updatedAt = new Date().toISOString();
    if (next.mediaType !== 'adult') {
      delete next.adultRegion;
      delete next.scraperType;
      delete next.japaneseJav;
      delete next.western;
      next.watchRoot = '';
    }
    config.subLibraries[index] = next;
    configs.saveConfig(config);
    return config.subLibraries[index];
  }

  function deleteSubLibrary(subLibraryId) {
    const config = configs.loadConfig();
    const before = (config.subLibraries || []).length;
    config.subLibraries = (config.subLibraries || []).filter((entry) => entry.uuid !== subLibraryId);
    if (config.subLibraries.length === before) return false;
    configs.saveConfig(config);
    return true;
  }

  function requestLibraryObservation(command = {}) {
    const config = configs.loadConfig();
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === command.subLibraryId);
    if (!subLibrary) throw new HelixError('LIBRA_LIBRARY_NOT_FOUND', 'SubLibrary not found');
    const open = store.listLibraryWork({ subLibraryId: subLibrary.uuid })
      .find((work) => work.workKind === 'observe_library' && !['done', 'cancelled'].includes(work.status));
    if (open) return open;
    return store.createOrGetLibraryWork({
      workKind: 'observe_library',
      subLibraryId: subLibrary.uuid,
      idempotencyKey: command.idempotencyKey,
      payload: { requestedBy: command.requestedBy || 'admin', libraryRevision: subLibrary.updatedAt || '' },
      cursor: {},
    }).work;
  }

  function requestReconcileSweep(command = {}) {
    const open = store.listLibraryWork()
      .find((work) => work.workKind === 'reconcile_library' && !['done', 'cancelled'].includes(work.status));
    if (open) return open;
    return store.createOrGetLibraryWork({
      workKind: 'reconcile_library',
      idempotencyKey: command.idempotencyKey,
      payload: { requestedBy: command.requestedBy || 'automation' },
      cursor: { afterItemId: '' },
    }).work;
  }

  function requestUserPerceptionSync(command = {}) {
    const config = configs.loadConfig();
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === command.subLibraryId);
    if (!subLibrary) throw new HelixError('LIBRA_LIBRARY_NOT_FOUND', 'SubLibrary not found');
    if (!subLibrary.doubanEnabled) throw new HelixError('DOUBAN_SYNC_NOT_ENABLED', 'Douban sync is not enabled for this media library');
    const open = store.listLibraryWork({ subLibraryId: subLibrary.uuid })
      .find((work) => work.workKind === 'sync_user_perception' && !['done', 'cancelled'].includes(work.status));
    if (open) return open;
    return store.createOrGetLibraryWork({
      workKind: 'sync_user_perception',
      subLibraryId: subLibrary.uuid,
      idempotencyKey: command.idempotencyKey,
      payload: { requestedBy: command.requestedBy || 'admin' },
      cursor: { phase: 'fetch', afterItemId: '', entries: [] },
    }).work;
  }

  function matchDoubanRating(maintenance = {}, byTitle, bySubject) {
    const metadata = maintenance.metadataFacts || {};
    const basedata = maintenance.basedataFacts || {};
    const directId = String(metadata.doubanId || basedata.doubanId || '').trim();
    if (directId && bySubject.has(directId)) return bySubject.get(directId);
    const mediaKind = String(maintenance.maintenanceSubject && maintenance.maintenanceSubject.mediaKind || metadata.type || basedata.type || '').toLowerCase();
    const name = metadata.title || metadata.name || basedata.title || basedata.name || '';
    if (mediaKind === 'movie') {
      const stars = doubanMatchService.movieDoubanStars(name, 'Movie', byTitle);
      return stars == null ? null : { stars, subjectId: '' };
    }
    const seriesName = metadata.seriesName || basedata.seriesName || name;
    const seasonNumber = metadata.seasonNumber ?? basedata.seasonNumber;
    const stars = seasonNumber == null
      ? byTitle.get(doubanMatchService.seriesKey(seriesName))
      : doubanMatchService.seasonDoubanStars(seriesName, seasonNumber, byTitle);
    return stars == null ? null : { stars, subjectId: '' };
  }

  async function runUserPerceptionSync(work, options = {}) {
    const config = configs.loadConfig();
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === work.subLibraryId);
    if (!subLibrary) throw new HelixError('LIBRA_LIBRARY_NOT_FOUND', 'SubLibrary not found');
    const openObservation = store.listLibraryWork({ subLibraryId: work.subLibraryId })
      .find((candidate) => candidate.workKind === 'observe_library' && !['done', 'cancelled'].includes(candidate.status));
    if (openObservation) {
      return store.updateLibraryWork(work.workId, {
        status: 'retrying', retryAt: new Date(Date.now() + 5000).toISOString(),
        errorCode: '', errorMessage: '',
      });
    }
    const session = doubanService.getSession(config);
    if (!session.userId) throw new HelixError('DOUBAN_SESSION_REQUIRED', 'Douban user ID is not configured');
    store.updateLibraryWork(work.workId, { status: 'running', incrementAttempt: true, errorCode: '', errorMessage: '' });
    try {
      if ((work.cursor.phase || 'fetch') === 'fetch') {
        const now = Date.now();
        const nextRequestAt = Date.parse(work.cursor.nextRequestAt || '') || 0;
        if (nextRequestAt > now) {
          return store.updateLibraryWork(work.workId, {
            status: 'retrying', retryAt: new Date(nextRequestAt).toISOString(),
            errorCode: '', errorMessage: '',
          });
        }
        const collectType = work.cursor.collectType === 'tv' ? 'tv' : 'movie';
        const page = await resourceGovernor.runWithPermit({
          owner: 'libra', workId: work.workId, resourceKey: `douban:${session.userId}:api`, priority: 5,
        }, () => doubanService.fetchRatingsPage(session, { collectType, start: Number(work.cursor.start) || 0 }));
        const entriesBySubject = new Map((Array.isArray(work.cursor.entries) ? work.cursor.entries : [])
          .map((entry) => [String(entry && entry.subjectId || ''), entry]).filter(([subjectId]) => subjectId));
        for (const entry of page.entries || []) entriesBySubject.set(String(entry.subjectId), entry);
        const entries = [...entriesBySubject.values()];
        if (page.typeDone && collectType === 'tv') {
          return store.updateLibraryWork(work.workId, {
            status: 'pending', retryAt: '', errorCode: '', errorMessage: '',
            cursor: { phase: 'apply', afterItemId: '', entries, matched: 0, unchanged: 0, failureCount: 0 },
          });
        }
        const nextType = page.typeDone ? 'tv' : collectType;
        const nextStart = page.typeDone ? 0 : page.nextStart;
        const resumeAt = new Date(Date.now() + 800).toISOString();
        return store.updateLibraryWork(work.workId, {
          status: 'retrying', retryAt: resumeAt, errorCode: '', errorMessage: '',
          cursor: { phase: 'fetch', collectType: nextType, start: nextStart, entries, nextRequestAt: resumeAt, failureCount: 0 },
        });
      }
      const entries = Array.isArray(work.cursor.entries) ? work.cursor.entries : [];
      const byTitle = doubanMatchService.buildDoubanStarsByNormalizedTitle(entries);
      const bySubject = new Map(entries.map((entry) => [String(entry.subjectId || ''), entry]).filter(([id]) => id));
      const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
      const items = store.getLibraryItemsPage({ subLibraryId: work.subLibraryId, afterItemId: work.cursor.afterItemId || '', limit });
      const projections = kairoxService.getMaintenanceProjections(items.map((item) => item.itemId));
      let matched = Number(work.cursor.matched || 0);
      let unchanged = Number(work.cursor.unchanged || 0);
      for (const item of items) {
        if (!item.playable || item.membershipStatus !== 'active') continue;
        const rating = matchDoubanRating(projections[item.itemId] || {}, byTitle, bySubject);
        if (!rating) continue;
        const previousFacts = projections[item.itemId] && projections[item.itemId].userPerceptionFacts || {};
        const updated = kairoxService.updateUserPerception({
          itemId: item.itemId,
          facts: { doubanRating: Number(rating.stars), watched: true },
          evidence: { source: 'douban_collect', subjectId: rating.subjectId || '', syncWorkId: work.workId },
          observedAt: new Date().toISOString(),
        });
        matched += 1;
        if (previousFacts.doubanRating === Number(rating.stars) && previousFacts.watched === true) unchanged += 1;
      }
      const done = items.length < limit;
      return store.updateLibraryWork(work.workId, {
        status: done ? 'done' : 'pending',
        cursor: {
          phase: 'apply', entries,
          afterItemId: items.length ? items[items.length - 1].itemId : work.cursor.afterItemId || '',
          matched, unchanged,
          completedAt: done ? new Date().toISOString() : '',
        },
        retryAt: '', errorCode: '', errorMessage: '',
      });
    } catch (error) {
      const failureCount = Number(work.cursor.failureCount || 0) + 1;
      const delayMs = Math.min(60 * 60 * 1000, 30000 * (2 ** Math.min(6, failureCount - 1)));
      store.updateLibraryWork(work.workId, {
        status: 'retrying', retryAt: new Date(Date.now() + delayMs).toISOString(),
        errorCode: error.code || 'DOUBAN_SYNC_FAILED', errorMessage: error.message,
        cursor: { ...work.cursor, failureCount },
      });
      throw error;
    }
  }

  async function runLibraryWork(workId, options = {}) {
    const work = store.getLibraryWork(workId);
    if (!work) throw new HelixError('LIBRA_WORK_NOT_FOUND', 'Library work not found');
    if (work.status === 'done') return work;
    if (work.workKind === 'sync_user_perception') return runUserPerceptionSync(work, options);
    if (work.workKind === 'reconcile_library') {
      store.updateLibraryWork(work.workId, { status: 'running', incrementAttempt: true, errorCode: '', errorMessage: '' });
      try {
        const items = store.getLibraryItemsPage({ afterItemId: work.cursor.afterItemId || '', limit: Math.max(1, Math.min(100, Number(options.limit) || 100)) });
        reconciler.reconcileBatch(items.map((item) => item.itemId));
        reconcileMaintenanceScopes();
        const done = items.length === 0 || items.length < Math.max(1, Math.min(100, Number(options.limit) || 100));
        return store.updateLibraryWork(work.workId, {
          status: done ? 'done' : 'pending',
          cursor: { afterItemId: items.length > 0 ? items[items.length - 1].itemId : work.cursor.afterItemId || '' },
          retryAt: '', errorCode: '', errorMessage: '',
        });
      } catch (error) {
        store.updateLibraryWork(work.workId, {
          status: 'retrying', retryAt: new Date(Date.now() + 30000).toISOString(),
          errorCode: error.code || 'LIBRA_RECONCILE_FAILED', errorMessage: error.message,
        });
        throw error;
      }
    }
    if (work.workKind !== 'observe_library') throw new HelixError('LIBRA_WORK_KIND_UNSUPPORTED', `Unsupported Library work: ${work.workKind}`);
    const config = configs.loadConfig();
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === work.subLibraryId);
    if (!subLibrary) throw new HelixError('LIBRA_LIBRARY_NOT_FOUND', 'SubLibrary not found');
    const serverConfig = subLibrary.source === 'emby' ? (config.embyServers || {})[subLibrary.embyServerId] : null;
    const limit = Math.max(1, Math.min(100, Number(options.limit) || 100));
    const deadlineMs = Date.now() + Math.max(100, Math.min(5000, Number(options.timeBudgetMs) || 5000));
    store.updateLibraryWork(work.workId, { status: 'running', incrementAttempt: true, errorCode: '', errorMessage: '' });
    try {
      const resourceKey = subLibrary.source === 'emby'
        ? `emby:${subLibrary.embyServerId || 'default'}:api`
        : `filesystem:${subLibrary.uuid}:probe`;
      const page = await resourceGovernor.runWithPermit({
        owner: 'libra', workId: work.workId, resourceKey, priority: 5,
      }, () => nexoraService.observeLibraryPage({
        sourceDefinition: subLibrary,
        serverConfig,
        cursor: work.cursor,
        limit,
        deadlineMs,
      }));
      const observedItemIds = [];
      for (const observation of page.observations || []) {
        const sourceReference = observation.sourceReference || {};
        const existingItemId = nexoraService.resolveBoundItemId(sourceReference);
        const itemId = existingItemId || crypto.randomUUID();
        const sourceIdentity = JSON.stringify(sourceReference.source === 'emby'
          ? [sourceReference.subLib && sourceReference.subLib.embyServerId, sourceReference.subLib && sourceReference.subLib.sectionId, sourceReference.sourceRefId]
          : [sourceReference.subLib && sourceReference.subLib.uuid, sourceReference.path]);
        const identityHash = crypto.createHash('sha1').update(sourceIdentity).digest('hex');
        acceptSource({
          itemId,
          sourceReference,
          idempotencyKey: `observe-source:${work.workId}:${identityHash}`,
          requestedBy: 'libra_automation',
          deferHierarchyResolution: true,
          includeProjection: false,
        });
        observedItemIds.push(itemId);
      }
      const hierarchyChanges = store.resolveLibraryHierarchy(subLibrary.uuid, { changedOnly: true });
      const affectedItemIds = [...new Set([...observedItemIds, ...hierarchyChanges.map((item) => item.itemId)])];
      reconciler.reconcileBatch(affectedItemIds);
      for (const scope of store.listActiveMaintenanceScopes(subLibrary.uuid)) {
        const root = store.getLibraryItem(scope.rootItemId);
        if (!root) continue;
        for (const member of store.getMaintenanceScopeMembers(root.itemId)) {
          if (store.listMaintenanceScopeMembers(scope.scopeId).includes(member.itemId)) continue;
          store.addMaintenanceScopeMember(scope.scopeId, member.itemId);
          if (scope.action === 'start') {
            const projection = kairoxService.getMaintenanceProjection(member.itemId);
            if (projection && projection.maintenanceComplete) continue;
            kairoxService.startMaintenanceRun({ itemId: member.itemId, libraryGeneration: member.admissionGeneration, config, idempotencyKey: `${scope.idempotencyKey}:${member.itemId}` });
          } else if (scope.action === 'priority') {
            const projection = kairoxService.getMaintenanceProjection(member.itemId);
            if (projection && projection.maintenanceComplete) continue;
            kairoxService.setMaintenancePriority({ itemId: member.itemId, reason: 'series_scope_expedited', config });
          }
        }
      }
      const updatedWork = store.updateLibraryWork(work.workId, {
        status: page.done ? 'done' : 'pending',
        cursor: page.cursor || work.cursor,
        retryAt: '',
        errorCode: '',
        errorMessage: '',
      });
      reconcileMaintenanceScopes();
      return updatedWork;
    } catch (error) {
      store.updateLibraryWork(work.workId, {
        status: 'retrying',
        retryAt: new Date(Date.now() + 30000).toISOString(),
        errorCode: error.code || 'LIBRA_OBSERVATION_FAILED',
        errorMessage: error.message,
      });
      throw error;
    }
  }

  function getAutomationProjection() {
    const runnableWorks = store.listRunnableLibraryWork(new Date().toISOString(), 100);
    return { works: store.listLibraryWork(), runnableWorks, runnable: runnableWorks.length, maintenanceScopes: store.listActiveMaintenanceScopes() };
  }

  function reconcileMaintenanceScopes() {
    const completed = [];
    for (const scope of store.listActiveMaintenanceScopes()) {
      const observation = scope.observationWorkId ? store.getLibraryWork(scope.observationWorkId) : null;
      if (scope.observationWorkId && (!observation || observation.status !== 'done')) continue;
      const memberIds = store.listMaintenanceScopeMembers(scope.scopeId);
      if (memberIds.length === 0) continue;
      const projections = kairoxService.getMaintenanceProjections(memberIds);
      if (!memberIds.every((itemId) => projections[itemId] && projections[itemId].maintenanceComplete)) continue;
      completed.push(store.updateMaintenanceScope(scope.scopeId, { status: 'complete', completedAt: new Date().toISOString() }));
    }
    return completed;
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
    requestMaintenanceRun,
    setMaintenancePriority,
    clearMaintenancePriority,
    requestMetadataRefresh,
    updateUserPerception,
    createSubLibrary,
    updateSubLibrary,
    deleteSubLibrary,
    requestLibraryObservation,
    requestReconcileSweep,
    requestUserPerceptionSync,
    runLibraryWork,
    getAutomationProjection,
    requestOffboarding,
    requestOffboardingBatch,
    reconcileItem: reconciler.reconcileItem,
    reconcileBatch: reconciler.reconcileBatch,
    getLibraryProjection,
    getLibraryProjections,
    queryLibraryProjections,
    getLibraryMaintenanceSummaries,
  });
}

module.exports = { createLibraRuntime };
