'use strict';

const path = require('path');
const basedata = require('../basedataObserver');
const kairoxStore = require('../kairoxStore');

function registerBasedataCapabilities(register) {
  const admissionForAsset = (task, asset) => ({ ...(task.helixAdmission || {}), sourceAccessDescriptor: { ...(task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {}), locator: asset.canonicalLocator || {} } });
  register({ capability: 'emby.item.observe', allowedTargetGates: ['basedata'], execute: async ({ task, config, input }) => ({ result: { facts: { ...(await basedata.observeEmby(admissionForAsset(task, input.asset), config)), assetId: input.asset.assetId, assetRevision: input.asset.assetRevision } } }) });
  register({ capability: 'filesystem.media.probe', allowedTargetGates: ['basedata'], execute: async ({ task, config, input }) => ({ result: { facts: { ...(await basedata.observeFile(admissionForAsset(task, input.asset), config)), assetId: input.asset.assetId, assetRevision: input.asset.assetRevision } } }) });
  register({ capability: 'filesystem.layout.observe', allowedTargetGates: ['basedata'], execute: async ({ task, config, input }) => {
    const descriptor = { ...(task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {}), locator: input.asset.canonicalLocator || {} };
    const file = descriptor.locator && descriptor.locator.path || '';
    const library = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
    const relative = library.watchRoot && file ? path.relative(library.watchRoot, file).split(path.sep).filter(Boolean) : [];
    const organizedFolder = library.organizedFolderName || config.adultLibrary && config.adultLibrary.organizedFolderName || 'scraped';
    return { result: { layout: { path: file, parent: file ? path.dirname(file) : '', relativePath: relative.join('/'), organizedFolder, compliant: relative.length >= 3 && relative[0].toLowerCase() === organizedFolder.toLowerCase() } } };
  } });
  register({ capability: 'basedata.verify', allowedTargetGates: ['basedata'], execute: async ({ input }) => {
    const observed = input.observation;
    if (!observed.facts || !observed.facts.path) throw Object.assign(new Error('Basedata observation did not produce a source path'), { code: 'BASEDATA_VERIFY_FAILED' });
    return { result: { facts: { ...observed.facts, layout: input.layout && input.layout.layout || null }, valid: true } };
  } });
  register({ capability: 'basedata.publish', allowedTargetGates: ['basedata'], execute: async ({ task, event, input, assertFence }) => {
    assertFence('before_basedata_publish');
    const facts = input.basedata.facts;
    const published = kairoxStore.upsertAssetBasedata({ assetId: facts.assetId, subjectId: task.subjectId, assetRevision: facts.assetRevision, sourceRevision: task.helixAdmission && task.helixAdmission.sourceRevision || '', facts, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { basedataRevision: published.factRevision }, commitMarker: `asset-basedata:${facts.assetId}:${published.factRevision}` };
  } });
  register({ capability: 'basedata.subject.publish', allowedTargetGates: ['basedata'], execute: async ({ task, event, assertFence }) => {
    assertFence('before_subject_basedata_publish');
    const assetFacts = kairoxStore.getAssetBasedataForSubject(task.subjectId);
    const expected = task.helixAdmission && task.helixAdmission.assets || [];
    const current = assetFacts.filter((fact) => expected.some((asset) => asset.assetId === fact.assetId && Number(asset.assetRevision) === Number(fact.assetRevision)) && fact.status === 'fresh');
    if (current.length !== expected.length) throw Object.assign(new Error('Not all admitted Assets have fresh Basedata'), { code: 'KAIROX_SUBJECT_BASEDATA_INCOMPLETE' });
    const subjectKind = task.subjectInfo && task.subjectInfo.subjectKind || task.helixAdmission && task.helixAdmission.sourceAccessDescriptor && task.helixAdmission.sourceAccessDescriptor.subjectKind || '';
    const aggregate = { assetCount: current.length, assets: current.map((fact) => ({ assetId: fact.assetId, facts: fact.facts })) };
    const subjectFacts = subjectKind === 'series' ? { ...aggregate, subjectKind } : { ...(current[0] && current[0].facts || {}), ...aggregate, subjectKind };
    const published = kairoxStore.publishBasedata({ subjectId: task.subjectId, sourceRevision: task.helixAdmission && task.helixAdmission.sourceRevision || '', facts: subjectFacts, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { basedataRevision: published.factRevision }, commitMarker: `subject-basedata:${published.factRevision}` };
  } });
}

module.exports = { registerBasedataCapabilities };
