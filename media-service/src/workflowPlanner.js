'use strict';

const optimizeGapAnalyzer = require('./optimizeGapAnalyzer');
const workflowGraph = require('./workflowGraph');
const capabilityRegistry = require('./capabilityRegistry');
const transcodeDevicePlan = require('./transcodeDevicePlan');

const REQUIRED = Object.freeze({
  basedata: new Set(['emby.item.observe', 'filesystem.media.probe', 'filesystem.layout.observe', 'basedata.verify', 'basedata.publish']),
  metadata: new Set(['media.identity.resolve', 'metadata.provider.fetch', 'media.frames.extract', 'person.faces.embed', 'person.faces.cluster', 'person.faces.match', 'metadata.poster.compose', 'adult.metadata.compose', 'compute.asset.register', 'compute.asset.upload', 'adult.analysis.request', 'adult.analysis.observe', 'adult.metadata.normalize', 'person.relations.resolve', 'metadata.sidecar.render', 'metadata.image.acquire', 'metadata.artifacts.verify', 'metadata.publish']),
  optimize: new Set(['integration.moviepilot.check', 'media.upgrade.identity.resolve', 'source.upgrade.search', 'source.upgrade.request', 'source.upgrade.observe-download', 'source.upgrade.observe-transfer', 'source.upgrade.output.resolve', 'source.upgrade.output.settle', 'media.identity.inspect', 'media.identity.accept', 'media.transcode.precheck', 'transcode.tonemap.accept', 'media.transcode', 'container.remux', 'optimization.objective.verify', 'output.media.verify', 'output.media.select', 'output.media.disposition', 'output.preview.generate', 'source.organize', 'metadata.artifacts.materialize', 'filesystem.layout.verify', 'media.replace', 'staged.asset.discard', 'workspace.cleanup', 'optimization.outcome.select', 'optimization.result.publish']),
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
  const addMutationOutcome = (prefix, verifiedId, approvalGate) => {
    const dispositionId = `${task.id}:${prefix}-disposition`;
    const previewId = `${task.id}:${prefix}-preview`;
    const replaceId = `${task.id}:${prefix}-replace`;
    const discardId = `${task.id}:${prefix}-discard`;
    const cleanupId = `${task.id}:${prefix}-cleanup`;
    add(`${prefix}-disposition`, 'output.media.disposition', { dependsOn: [verifiedId], inputBindings: { verifiedAsset: from(verifiedId) } });
    add(`${prefix}-preview`, 'output.preview.generate', { inputBindings: { verifiedAsset: from(dispositionId) }, resourceRequest: { resourceType: 'transcode' } });
    add(`${prefix}-replace`, 'media.replace', { inputBindings: { verifiedAsset: from(previewId) }, runWhen: { port: 'verifiedAsset', path: 'action', equals: 'replace' }, resourceRequest: { resourceType: 'filesystem' }, approvalRequirement: { gateId: approvalGate } });
    add(`${prefix}-discard`, 'staged.asset.discard', { dependsOn: [dispositionId], inputBindings: { verifiedAsset: from(dispositionId) }, runWhen: { port: 'verifiedAsset', path: 'action', equals: 'discard' }, resourceRequest: { resourceType: 'filesystem' } });
    add(`${prefix}-cleanup`, 'workspace.cleanup', { dependsOn: [replaceId], inputBindings: { replacement: from(replaceId) }, runWhen: { port: 'replacement' }, resourceRequest: { resourceType: 'filesystem' } });
    add(`${prefix}-outcome`, 'optimization.outcome.select', { dependsOn: [replaceId, discardId, cleanupId], inputBindings: { outcomes: fromMany([replaceId, discardId]) } });
  };
  const objective = task.taskTarget && task.taskTarget.gateObjective || {};
  const target = objective.targetMediaFacts || objective;
  const needsSubtitle = !!(target.requireChineseSubtitles || target.subtitleLanguage === 'zh');
  if (needsSubtitle) rejected.push({ capability: 'subtitle.download', reason: 'objective_capability_not_implemented' });
  const strategies = new Set((selection.gap || []).map((gap) => gap.requiredStrategy));
  if (strategies.has('upgrade') && requireAllowed(allowed, 'source.upgrade.request', rejected)) {
    add('moviepilot-check', 'integration.moviepilot.check', { resourceRequest: { resourceType: 'moviepilot' } });
    add('upgrade-identity-resolve', 'media.upgrade.identity.resolve', { inputBindings: { integration: from(`${task.id}:moviepilot-check`) }, resourceRequest: { resourceType: 'moviepilot' } });
    add('upgrade-search', 'source.upgrade.search', { inputBindings: { identity: from(`${task.id}:upgrade-identity-resolve`) }, resourceRequest: { resourceType: 'moviepilot' } });
    add('upgrade-request', 'source.upgrade.request', { inputBindings: { candidates: from(`${task.id}:upgrade-search`) }, resourceRequest: { resourceType: 'moviepilot' }, approvalRequirement: { gateId: 'upgrade.candidateSelect', forceWhenInput: { port: 'candidates', path: 'forceConfirmation', equals: true } } });
    add('upgrade-download-observe', 'source.upgrade.observe-download', { inputBindings: { request: from(`${task.id}:upgrade-request`) }, resourceRequest: { resourceType: 'moviepilot' }, retryPolicy: { maxAttempts: 2160 } });
    add('upgrade-transfer', 'source.upgrade.observe-transfer', { inputBindings: { request: from(`${task.id}:upgrade-request`), download: from(`${task.id}:upgrade-download-observe`) }, dependsOn: [`${task.id}:upgrade-request`, `${task.id}:upgrade-download-observe`], resourceRequest: { resourceType: 'moviepilot' }, retryPolicy: { maxAttempts: 2160 } });
    add('upgrade-output', 'source.upgrade.output.resolve', { inputBindings: { transfer: from(`${task.id}:upgrade-transfer`) }, resourceRequest: { resourceType: 'filesystem' }, retryPolicy: { maxAttempts: 120 } });
    add('upgrade-output-settle', 'source.upgrade.output.settle', { inputBindings: { stagedAsset: from(`${task.id}:upgrade-output`) }, resourceRequest: { resourceType: 'filesystem' }, retryPolicy: { maxAttempts: 2160 } });
    add('upgrade-identity-inspect', 'media.identity.inspect', { inputBindings: { stagedAsset: from(`${task.id}:upgrade-output-settle`) }, resourceRequest: { resourceType: 'filesystem' } });
    add('upgrade-identity-accept', 'media.identity.accept', { inputBindings: { inspection: from(`${task.id}:upgrade-identity-inspect`) }, approvalRequirement: { gateId: 'upgrade.identityMismatch', whenInput: { port: 'inspection', path: 'matched', equals: false } } });
    add('upgrade-media-verify', 'output.media.verify', { inputBindings: { stagedAsset: from(`${task.id}:upgrade-identity-accept`) }, resourceRequest: { resourceType: 'filesystem' } });
    add('upgrade-media-select', 'output.media.select', { inputBindings: { attempts: fromMany([`${task.id}:upgrade-media-verify`]) } });
    if (requireAllowed(allowed, 'media.replace', rejected)) {
      addMutationOutcome('upgrade', `${task.id}:upgrade-media-select`, 'upgrade.beforeReplace');
    }
  }
  if (strategies.has('transcode') && requireAllowed(allowed, 'media.transcode', rejected)) {
    let precheckDependencies = [];
    let precheckBindings = {};
    if (item.isDiscLike) {
      if (requireAllowed(allowed, 'container.remux', rejected)) {
        add('disc-remux', 'container.remux', { resourceRequest: { resourceType: 'transcode' } });
        precheckDependencies = [`${task.id}:disc-remux`];
        precheckBindings = { sourceAsset: from(`${task.id}:disc-remux`) };
      }
    }
    add('transcode-precheck', 'media.transcode.precheck', { dependsOn: precheckDependencies, inputBindings: precheckBindings, resourceRequest: { resourceType: 'transcode' } });
    add('transcode-tonemap-accept', 'transcode.tonemap.accept', { inputBindings: { precheck: from(`${task.id}:transcode-precheck`) }, approvalRequirement: { gateId: 'transcode.dolbyVisionTonemap', whenInput: { port: 'precheck', path: 'isDolbyVision', equals: true } } });
    const rateAttempts = transcodeDevicePlan.buildRateControlPlan(transcodeDevicePlan.buildDeviceSlots(config));
    const verifyIds = [];
    let previousVerifyId = '';
    rateAttempts.forEach((attempt, index) => {
      const encodeId = `${task.id}:transcode-attempt-${index + 1}`;
      const verifyId = `${task.id}:transcode-verify-${index + 1}`;
      const dependencies = [`${task.id}:transcode-tonemap-accept`, ...(previousVerifyId ? [previousVerifyId] : [])];
      add(`transcode-attempt-${index + 1}`, 'media.transcode', {
        dependsOn: dependencies,
        inputBindings: { precheck: from(`${task.id}:transcode-tonemap-accept`), ...(previousVerifyId ? { previousAttempt: from(previousVerifyId) } : {}) },
        ...(previousVerifyId ? { runWhen: { port: 'previousAttempt', path: 'objectiveSatisfied', equals: false } } : {}),
        parameters: { strategy: attempt.strategy, encoderKind: attempt.encoderKind }, resourceRequest: { resourceType: 'transcode' },
      });
      add(`transcode-verify-${index + 1}`, 'output.media.verify', { dependsOn: [encodeId], inputBindings: { stagedAsset: from(encodeId) }, runWhen: { port: 'stagedAsset' }, resourceRequest: { resourceType: 'filesystem' } });
      verifyIds.push(verifyId); previousVerifyId = verifyId;
    });
    if (!verifyIds.length) rejected.push({ capability: 'media.transcode', reason: 'transcode_attempt_plan_empty' });
    else add('transcode-media-select', 'output.media.select', { dependsOn: verifyIds, inputBindings: { attempts: fromMany(verifyIds) } });
    if (requireAllowed(allowed, 'media.replace', rejected)) {
      addMutationOutcome('transcode', `${task.id}:transcode-media-select`, 'transcode.beforeReplace');
    }
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
  const replacementId = [...nodes].reverse().find((node) => node.capability === 'optimization.outcome.select')?.eventId;
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
  }, planned.nodes, capabilityRegistry);
}

module.exports = { REQUIRED, planTask, basedataNodes, metadataNodes, optimizeNodes };
