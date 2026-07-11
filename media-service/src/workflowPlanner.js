'use strict';

const optimizeGapAnalyzer = require('./optimizeGapAnalyzer');
const workflowGraph = require('./workflowGraph');
const capabilityRegistry = require('./capabilityRegistry');

const REQUIRED = Object.freeze({
  basedata: new Set(['emby.item.observe', 'filesystem.media.probe', 'filesystem.layout.observe', 'basedata.verify', 'basedata.publish']),
  metadata: new Set(['media.identity.resolve', 'metadata.provider.fetch', 'media.frames.extract', 'person.faces.embed', 'person.faces.cluster', 'person.faces.match', 'metadata.poster.compose', 'adult.metadata.compose', 'compute.asset.register', 'compute.asset.upload', 'adult.analysis.request', 'adult.analysis.observe', 'adult.metadata.normalize', 'person.relations.resolve', 'metadata.sidecar.render', 'metadata.image.acquire', 'metadata.artifacts.verify', 'metadata.publish']),
  optimize: new Set(['subtitle.search', 'subtitle.download', 'subtitle.verify', 'source.upgrade.search', 'source.upgrade.request', 'source.upgrade.observe-download', 'source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'media.transcode', 'container.remux', 'optimization.objective.verify', 'output.media.verify', 'source.organize', 'metadata.artifacts.materialize', 'filesystem.layout.verify', 'media.replace', 'optimization.result.publish']),
});

function text(value) { return String(value == null ? '' : value).trim(); }
function event(taskId, suffix, capability, dependsOn = [], extra = {}) { return { eventId: `${taskId}:${suffix}`, capability, dependsOn, ...extra }; }
function from(eventId) { return { source: 'event', eventId }; }
function fromMany(eventIds) { return { source: 'events', eventIds }; }

function subLibraryFor(task, config) {
  const id = text(task.itemInfo && task.itemInfo.subLibraryId || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.subLibraryId);
  return (config.subLibraries || []).find((entry) => entry.uuid === id) || {};
}

function allowedSideEffects(task, config, gate) {
  const library = subLibraryFor(task, config);
  const configured = library.allowedCapabilities && library.allowedCapabilities[gate];
  return new Set(Array.isArray(configured) ? configured : []);
}

function requireAllowed(allowed, capability, rejected) {
  if (!allowed.has(capability)) {
    rejected.push({ capability, reason: 'library_capability_not_allowed' });
    return false;
  }
  if (!capabilityRegistry.has(capability)) {
    rejected.push({ capability, reason: 'runtime_capability_unavailable' });
    return false;
  }
  return true;
}
function requireAvailable(capabilities, rejected) {
  const missing = capabilities.filter((capability) => !capabilityRegistry.has(capability));
  for (const capability of missing) rejected.push({ capability, reason: 'runtime_capability_unavailable' });
  return missing.length === 0;
}

function basedataNodes(task) {
  const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
  const observe = descriptor.sourceType === 'emby' ? 'emby.item.observe' : 'filesystem.media.probe';
  return [
    event(task.id, 'observe', observe, [], { resourceRequest: { resourceType: descriptor.sourceType === 'emby' ? 'emby' : 'filesystem' } }),
    event(task.id, 'layout', 'filesystem.layout.observe', [`${task.id}:observe`], { when: descriptor.sourceType === 'emby' ? false : true, resourceRequest: { resourceType: 'filesystem' } }),
    event(task.id, 'verify', 'basedata.verify', [`${task.id}:observe`, `${task.id}:layout`], { inputBindings: { observation: from(`${task.id}:observe`), layout: from(`${task.id}:layout`) } }),
    event(task.id, 'publish', 'basedata.publish', [`${task.id}:verify`], { inputBindings: { basedata: from(`${task.id}:verify`) }, outputContract: { basedataRevision: 'number' } }),
  ];
}

function metadataNodes(task, config) {
  const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
  const library = subLibraryFor(task, config);
  const allowed = allowedSideEffects(task, config, 'metadata');
  const nodes = [event(task.id, 'identity', 'media.identity.resolve')];
  let metadataEventId;
  if (library.adultRegion === 'western_adult') {
    const western = { ...((config.adultLibrary || {}).western || {}), ...(library.western || {}) };
    if (String(western.computeMode || 'local').toLowerCase() === 'worker') {
      nodes.push(event(task.id, 'compute-asset-register', 'compute.asset.register', [`${task.id}:identity`], { inputBindings: { identity: from(`${task.id}:identity`) }, resourceRequest: { resourceType: 'worker' } }));
      nodes.push(event(task.id, 'compute-asset-upload', 'compute.asset.upload', [`${task.id}:compute-asset-register`], { inputBindings: { asset: from(`${task.id}:compute-asset-register`) }, resourceRequest: { resourceType: 'worker' } }));
      nodes.push(event(task.id, 'adult-analysis-request', 'adult.analysis.request', [`${task.id}:compute-asset-upload`], { inputBindings: { asset: from(`${task.id}:compute-asset-upload`) }, resourceRequest: { resourceType: 'worker' } }));
      nodes.push(event(task.id, 'adult-analysis-observe', 'adult.analysis.observe', [`${task.id}:adult-analysis-request`], { inputBindings: { job: from(`${task.id}:adult-analysis-request`) }, resourceRequest: { resourceType: 'worker' }, retryPolicy: { maxAttempts: 3600 } }));
      nodes.push(event(task.id, 'adult-metadata', 'adult.metadata.normalize', [`${task.id}:adult-analysis-observe`], { inputBindings: { analysis: from(`${task.id}:adult-analysis-observe`) } }));
    } else {
      nodes.push(event(task.id, 'frames', 'media.frames.extract', [`${task.id}:identity`], { inputBindings: { identity: from(`${task.id}:identity`) }, resourceRequest: { resourceType: 'transcode' } }));
      nodes.push(event(task.id, 'face-embeddings', 'person.faces.embed', [`${task.id}:frames`], { inputBindings: { frames: from(`${task.id}:frames`) }, resourceRequest: { resourceType: 'ai' } }));
      nodes.push(event(task.id, 'face-clusters', 'person.faces.cluster', [`${task.id}:face-embeddings`], { inputBindings: { embeddings: from(`${task.id}:face-embeddings`) } }));
      nodes.push(event(task.id, 'face-matches', 'person.faces.match', [`${task.id}:face-clusters`], { inputBindings: { clusters: from(`${task.id}:face-clusters`) } }));
      nodes.push(event(task.id, 'poster-compose', 'metadata.poster.compose', [`${task.id}:face-matches`], { inputBindings: { people: from(`${task.id}:face-matches`) }, resourceRequest: { resourceType: 'filesystem' } }));
      nodes.push(event(task.id, 'adult-metadata', 'adult.metadata.compose', [`${task.id}:poster-compose`], { inputBindings: { presentation: from(`${task.id}:poster-compose`) } }));
    }
    metadataEventId = `${task.id}:adult-metadata`;
  } else {
    nodes.push(event(task.id, 'metadata-fetch', 'metadata.provider.fetch', [`${task.id}:identity`], { inputBindings: { identity: from(`${task.id}:identity`) }, resourceRequest: { resourceType: descriptor.sourceType === 'emby' ? 'emby' : 'scraper' } }));
    metadataEventId = `${task.id}:metadata-fetch`;
  }
  nodes.push(event(task.id, 'people', 'person.relations.resolve', [metadataEventId], { inputBindings: { metadata: from(metadataEventId) } }));
  let tail = `${task.id}:people`;
  const artifactCapabilities = [
    ['nfo', 'metadata.sidecar.render', null],
    ['poster', 'metadata.image.acquire', 'poster'],
    ['fanart', 'metadata.image.acquire', 'fanart'],
  ];
  const artifactNodes = [];
  const imageKinds = new Set(library.capabilityParameters && library.capabilityParameters['metadata.image.acquire'] && library.capabilityParameters['metadata.image.acquire'].kinds || ['poster', 'fanart']);
  for (const [suffix, capability, kind] of artifactCapabilities) {
    if (!allowed.has(capability)) continue;
    if (kind && !imageKinds.has(kind)) continue;
    const id = `${task.id}:${suffix}`;
    nodes.push(event(task.id, suffix, capability, [tail], { inputBindings: { metadata: from(tail) }, ...(kind ? { parameters: { kind } } : {}), resourceRequest: { resourceType: 'filesystem' } }));
    artifactNodes.push(id);
  }
  if (artifactNodes.length) {
    nodes.push(event(task.id, 'artifacts-verify', 'metadata.artifacts.verify', artifactNodes, { inputBindings: { artifacts: fromMany(artifactNodes) } }));
    tail = `${task.id}:artifacts-verify`;
  }
  const publishBindings = { metadata: from(`${task.id}:people`) };
  if (artifactNodes.length) publishBindings.artifacts = from(`${task.id}:artifacts-verify`);
  nodes.push(event(task.id, 'metadata-publish', 'metadata.publish', [...new Set([`${task.id}:people`, tail])], { inputBindings: publishBindings }));
  return { nodes, explanation: { selectedCapabilities: nodes.map((node) => node.capability), rejected: [] }, classification: descriptor.sourceType === 'emby' ? 'metadata_observation' : 'metadata_enrichment', library };
}

function optimizeNodes(task, config) {
  const item = task.itemInfo || {};
  const allowed = allowedSideEffects(task, config, 'optimize');
  const rejected = [];
  const selection = optimizeGapAnalyzer.analyze({
    itemInfo: item,
    optimizeObjective: task.taskTarget && task.taskTarget.gateObjective || item.optimizeObjective,
    optimizeObjectiveStatus: item.optimizeObjectiveStatus,
    objectiveHash: task.objectiveRevisionSnapshot || item.objectiveHash,
  });
  const nodes = [];
  let tail = null;
  const add = (suffix, capability, options = {}) => {
    const dependencies = options.dependsOn || (tail ? [tail] : []);
    const node = event(task.id, suffix, capability, dependencies, options);
    nodes.push(node);
    tail = node.eventId;
  };
  const objective = task.taskTarget && task.taskTarget.gateObjective || {};
  const target = objective.targetMediaFacts || objective;
  const needsSubtitle = !!(target.requireChineseSubtitles || target.subtitleLanguage === 'zh');
  if (needsSubtitle) {
    const subtitleCapabilities = ['subtitle.search', 'subtitle.download', 'subtitle.verify'];
    if (requireAllowed(allowed, 'subtitle.download', rejected) && requireAvailable(subtitleCapabilities, rejected)) {
      add('subtitle-search', 'subtitle.search', { resourceRequest: { resourceType: 'service_api' } });
      add('subtitle-download', 'subtitle.download', { resourceRequest: { resourceType: 'service_api' } });
      add('subtitle-verify', 'subtitle.verify');
    }
  }
  const strategies = new Set((selection.gap || []).map((gap) => gap.requiredStrategy));
  if (strategies.has('upgrade') && requireAllowed(allowed, 'source.upgrade.request', rejected)) {
    add('upgrade-search', 'source.upgrade.search', { resourceRequest: { resourceType: 'moviepilot' } });
    add('upgrade-request', 'source.upgrade.request', { inputBindings: { candidates: from(`${task.id}:upgrade-search`) }, resourceRequest: { resourceType: 'moviepilot' }, approvalRequirement: { gateId: 'upgrade.candidateSelect' } });
    add('upgrade-download-observe', 'source.upgrade.observe-download', { inputBindings: { request: from(`${task.id}:upgrade-request`) }, resourceRequest: { resourceType: 'moviepilot' }, retryPolicy: { maxAttempts: 2160 } });
    add('upgrade-transfer', 'source.upgrade.observe-transfer', { inputBindings: { request: from(`${task.id}:upgrade-request`), download: from(`${task.id}:upgrade-download-observe`) }, dependsOn: [`${task.id}:upgrade-request`, `${task.id}:upgrade-download-observe`], resourceRequest: { resourceType: 'moviepilot' }, retryPolicy: { maxAttempts: 2160 } });
    add('upgrade-output', 'source.upgrade.output.resolve', { inputBindings: { transfer: from(`${task.id}:upgrade-transfer`) }, resourceRequest: { resourceType: 'filesystem' }, retryPolicy: { maxAttempts: 120 } });
    add('upgrade-media-verify', 'output.media.verify', { inputBindings: { stagedAsset: from(`${task.id}:upgrade-output`) }, resourceRequest: { resourceType: 'filesystem' } });
    if (requireAllowed(allowed, 'media.replace', rejected)) add('upgrade-replace', 'media.replace', { inputBindings: { verifiedAsset: from(`${task.id}:upgrade-media-verify`) }, resourceRequest: { resourceType: 'filesystem' }, approvalRequirement: { gateId: 'upgrade.beforeReplace' } });
  }
  if (strategies.has('transcode') && requireAllowed(allowed, 'media.transcode', rejected)) {
    add('transcode', 'media.transcode', { resourceRequest: { resourceType: 'transcode' } });
    add('transcode-media-verify', 'output.media.verify', { inputBindings: { stagedAsset: from(`${task.id}:transcode`) }, resourceRequest: { resourceType: 'filesystem' } });
    if (requireAllowed(allowed, 'media.replace', rejected)) add('transcode-replace', 'media.replace', { inputBindings: { verifiedAsset: from(`${task.id}:transcode-media-verify`) }, resourceRequest: { resourceType: 'filesystem' }, approvalRequirement: { gateId: 'transcode.beforeReplace' } });
  }
  const layout = item.layoutFacts || item.basedataFacts && item.basedataFacts.layout || {};
  const requiresOrganize = target.storageLayout === 'organized' && layout.compliant !== true;
  if (requiresOrganize && requireAllowed(allowed, 'source.organize', rejected)) add('organize', 'source.organize', { resourceRequest: { resourceType: 'filesystem' }, approvalRequirement: { gateId: 'source.beforeOrganize' } });
  if (rejected.length > 0) {
    return {
      nodes: [event(task.id, 'blocked', 'workflow.blocked', [], { inputBindings: { reason: 'required_capability_not_allowed', rejected } })],
      classification: 'blocked',
      explanation: { objectiveGap: selection.gap || [], selectedCapabilities: [], rejected },
    };
  }
  // A source identity/path mutation ends this immutable Graph. Libra must
  // consume SourceMutationResult, coordinate Nexora rebind, and issue a new
  // admission before any materialize/verify/publish capability may run.
  if (requiresOrganize) {
    return { nodes, classification: 'source_mutation', explanation: { objectiveGap: selection.gap || [], selectedCapabilities: nodes.map((node) => node.capability), rejected } };
  }
  if (target.metadataArtifacts === 'materialized' && item.metadataArtifactsReady && !item.metadataArtifactsMaterialized && requireAllowed(allowed, 'metadata.artifacts.materialize', rejected)) add('materialize', 'metadata.artifacts.materialize', { resourceRequest: { resourceType: 'filesystem' } });
  if (rejected.length > 0) {
    return { nodes: [event(task.id, 'blocked', 'workflow.blocked', [], { inputBindings: { reason: 'required_capability_not_allowed', rejected } })], classification: 'blocked', explanation: { objectiveGap: selection.gap || [], selectedCapabilities: [], rejected } };
  }
  if (nodes.length === 0) add('verify-objective', 'optimization.objective.verify');
  const materializeId = nodes.find((node) => node.capability === 'metadata.artifacts.materialize')?.eventId;
  add('layout-verify', 'filesystem.layout.verify', { inputBindings: materializeId ? { materialization: from(materializeId) } : {}, resourceRequest: { resourceType: 'filesystem' } });
  const replacementId = [...nodes].reverse().find((node) => node.capability === 'media.replace')?.eventId;
  add('optimize-publish', 'optimization.result.publish', { inputBindings: { layout: from(`${task.id}:layout-verify`), ...(replacementId ? { replacement: from(replacementId) } : {}) }, dependsOn: [...new Set([`${task.id}:layout-verify`, ...(replacementId ? [replacementId] : [])])] });
  const selected = nodes.map((node) => node.capability);
  const classification = selected.includes('source.upgrade.request') && selected.includes('media.transcode')
    ? 'composite_maintenance'
    : selected.includes('source.upgrade.request') ? 'source_upgrade'
      : selected.includes('media.transcode') ? 'transcode'
        : selected.includes('source.organize') ? 'source_organization' : 'objective_verification';
  return { nodes, classification, explanation: { objectiveGap: selection.gap || [], selectedCapabilities: selected, rejected } };
}

function planTask(task, config = {}) {
  const targetGate = text(task.taskTarget && task.taskTarget.targetGate || task.targetGate);
  let planned;
  if (targetGate === 'basedata') planned = { nodes: basedataNodes(task), classification: 'basedata_observation', explanation: {} };
  else if (targetGate === 'metadata') planned = metadataNodes(task, config);
  else if (targetGate === 'optimize') planned = optimizeNodes(task, config);
  else throw Object.assign(new Error(`Unsupported Kairox target gate: ${targetGate}`), { code: 'KAIROX_INVALID_TARGET_GATE' });
  return workflowGraph.buildPlan({
    ...task,
    targetGate,
    classification: planned.classification,
    capabilityPolicyRevision: task.capabilityPolicyRevision || subLibraryFor(task, config).capabilityPolicyRevision || '',
    explanation: planned.explanation,
  }, planned.nodes);
}

module.exports = { REQUIRED, planTask, basedataNodes, metadataNodes, optimizeNodes };
