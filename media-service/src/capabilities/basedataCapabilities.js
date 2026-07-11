'use strict';

const path = require('path');
const basedata = require('../basedataObserver');
const kairoxStore = require('../kairoxStore');

function registerBasedataCapabilities(register) {
  register({ capability: 'emby.item.observe', allowedTargetGates: ['basedata'], execute: async ({ task, config }) => ({ result: { facts: await basedata.observeEmby(task.helixAdmission || {}, config) } }) });
  register({ capability: 'filesystem.media.probe', allowedTargetGates: ['basedata'], execute: async ({ task, config }) => ({ result: { facts: await basedata.observeFile(task.helixAdmission || {}, config) } }) });
  register({ capability: 'filesystem.layout.observe', allowedTargetGates: ['basedata'], execute: async ({ task, config }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
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
  register({ capability: 'basedata.publish', allowedTargetGates: ['basedata'], execute: async ({ task, event, input }) => {
    const published = kairoxStore.publishBasedata({ itemId: task.itemId, sourceRevision: task.helixAdmission && task.helixAdmission.sourceRevision || '', facts: input.basedata.facts, evidence: { taskId: task.id, eventId: event.eventId }, observedAt: new Date().toISOString() });
    return { result: { basedataRevision: published.factRevision }, commitMarker: `basedata:${published.factRevision}` };
  } });
}

module.exports = { registerBasedataCapabilities };
