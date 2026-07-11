'use strict';

const path = require('path');
const metadata = require('../metadataProviderAdapter');
const kairoxStore = require('../kairoxStore');
const personCatalogStore = require('../personCatalogStore');
const artifacts = require('../metadataArtifactWorkspace');
const adultSourceIdentity = require('../adultSourceIdentity');

function metadataRevision(context) { return String(context.task.objectiveRevisionSnapshot || context.task.id); }
function xml(value) { return String(value == null ? '' : value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char])); }
function nfoFor(facts = {}) { return `<?xml version="1.0" encoding="UTF-8"?>\n<movie>\n  <title>${xml(facts.title || facts.name)}</title>\n  <originaltitle>${xml(facts.originalTitle)}</originaltitle>\n  <plot>${xml(facts.plot)}</plot>\n  <id>${xml(facts.adultId || facts.tmdbId)}</id>\n</movie>\n`; }
function seriesNfoFor(facts = {}) { return `<?xml version="1.0" encoding="UTF-8"?>\n<tvshow>\n  <title>${xml(facts.title || facts.name)}</title>\n  <originaltitle>${xml(facts.originalTitle)}</originaltitle>\n  <plot>${xml(facts.plot)}</plot>\n  <tmdbid>${xml(facts.tmdbId)}</tmdbid>\n</tvshow>\n`; }
async function download(url) { const response = await fetch(url); if (!response.ok) throw Object.assign(new Error(`Artifact download failed: HTTP ${response.status}`), { code: 'METADATA_ARTIFACT_DOWNLOAD_FAILED' }); return Buffer.from(await response.arrayBuffer()); }

function registerMetadataCapabilities(register) {
  register({ capability: 'media.identity.resolve', allowedTargetGates: ['metadata'], execute: async ({ task, config }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const library = (config.subLibraries || []).find((entry) => entry.uuid === descriptor.subLibraryId) || {};
    const sourcePath = descriptor.locator && descriptor.locator.path || task.subjectInfo && task.subjectInfo.path || '';
    const adultId = library.mediaType === 'adult' && library.adultRegion !== 'western_adult' ? adultSourceIdentity.extractAdultId(path.basename(sourcePath)) || adultSourceIdentity.extractAdultId(sourcePath) : '';
    if (library.mediaType === 'adult' && library.adultRegion !== 'western_adult' && !adultId) throw Object.assign(new Error('Adult ID could not be resolved from admitted source evidence'), { code: 'KAIROX_METADATA_ID_UNRESOLVED' });
    return { result: { descriptor, sourcePath, adultId, tmdbId: task.subjectInfo && task.subjectInfo.tmdbId || '', providerIds: task.subjectInfo && task.subjectInfo.providerIds || {} } };
  } });
  register({ capability: 'series.identity.resolve', allowedTargetGates: ['metadata'], execute: async ({ task }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    return { result: { descriptor, sourcePath: '', adultId: '', tmdbId: task.subjectInfo && task.subjectInfo.tmdbId || '', providerIds: task.subjectInfo && task.subjectInfo.providerIds || {}, subjectKind: 'series' } };
  } });
  register({ capability: 'metadata.provider.fetch', allowedTargetGates: ['metadata'], execute: async ({ task, config, input }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === (descriptor.subLibraryId || task.subjectInfo && task.subjectInfo.subLibraryId || ''));
    if (!subLibrary) throw Object.assign(new Error('SubLibrary not found'), { code: 'KAIROX_METADATA_LIBRARY_MISSING' });
    const value = descriptor.sourceType === 'emby' ? await metadata.observeEmbyMetadata(task, config, subLibrary) : await metadata.observeFolderMetadata(task, config, subLibrary, input.identity);
    metadata.assertMetadataFacts(value.facts); return { result: value };
  } });
  register({ capability: 'series.metadata.provider.fetch', allowedTargetGates: ['metadata'], execute: async ({ task, config }) => {
    const descriptor = task.helixAdmission && task.helixAdmission.sourceAccessDescriptor || {};
    const subLibrary = (config.subLibraries || []).find((entry) => entry.uuid === (descriptor.subLibraryId || task.subjectInfo && task.subjectInfo.subLibraryId || ''));
    if (!subLibrary) throw Object.assign(new Error('SubLibrary not found'), { code: 'KAIROX_METADATA_LIBRARY_MISSING' });
    const value = await metadata.observeEmbyMetadata(task, config, subLibrary);
    metadata.assertMetadataFacts(value.facts); return { result: value };
  } });
  register({ capability: 'person.relations.resolve', allowedTargetGates: ['metadata'], execute: async (context) => {
    const facts = context.input.metadata.facts || {};
    const matched = (facts.matchedPeople || []).map((person) => ({ personId: person.personId || '', name: person.name || '', role: 'actor', source: person.matchMode || 'face_embedding', confidence: person.confidence || 0, contentKinds: ['adult'] }));
    const matchedNames = new Set(matched.map((person) => person.name));
    const people = [...(facts.people || []), ...matched, ...(facts.actors || []).filter((actor) => !matchedNames.has(typeof actor === 'string' ? actor : actor.name)).map((actor) => typeof actor === 'string' ? { name: actor, role: 'actor', contentKinds: ['adult'] } : actor)];
    context.assertFence('before_person_relations_publish');
    const projection = personCatalogStore.observeSubjectPeople({ subjectId: context.task.subjectId, people, metadataRevision: metadataRevision(context) });
    return { result: { facts: { ...facts, ...projection }, people, projection } };
  } });
  register({ capability: 'metadata.sidecar.render', allowedTargetGates: ['metadata'], execute: async (context) => ({ result: { artifact: artifacts.writeArtifact(context.config, { subjectId: context.task.subjectId, metadataRevision: metadataRevision(context), name: 'metadata.nfo', content: nfoFor(context.input.metadata.facts || {}), source: 'metadata', eventId: context.event.eventId }) } }) });
  register({ capability: 'series.metadata.sidecar.render', allowedTargetGates: ['metadata'], execute: async (context) => ({ result: { artifact: artifacts.writeArtifact(context.config, { subjectId: context.task.subjectId, metadataRevision: metadataRevision(context), name: 'tvshow.nfo', content: seriesNfoFor(context.input.metadata.facts || {}), source: 'series_metadata', eventId: context.event.eventId }) } }) });
  register({ capability: 'metadata.image.acquire', allowedTargetGates: ['metadata'], execute: async (context) => {
    const kind = context.parameters.kind; const field = kind === 'poster' ? 'posterUrl' : 'fanartUrl'; const facts = context.input.metadata.facts || {};
    const embedded = kind === 'poster' ? facts.posterImageBase64 : facts.galleryImages && facts.galleryImages[0] && facts.galleryImages[0].imageBase64;
    if (!facts[field] && !embedded) return { result: { skipped: true, reason: `${field}_missing` } };
    const content = embedded ? Buffer.from(embedded, 'base64') : await download(facts[field]);
    return { result: { artifact: artifacts.writeArtifact(context.config, { subjectId: context.task.subjectId, metadataRevision: metadataRevision(context), name: `${kind}.jpg`, content, source: embedded ? 'western_analysis' : facts[field], eventId: context.event.eventId }) } };
  } });
  register({ capability: 'metadata.artifacts.verify', allowedTargetGates: ['metadata'], execute: async (context) => ({ result: { ...artifacts.verifyManifest(context.config, context.task.subjectId, metadataRevision(context)), artifacts: context.input.artifacts } }) });
  register({ capability: 'metadata.publish', allowedTargetGates: ['metadata'], execute: async (context) => {
    const resolved = context.input.metadata; const artifactVerification = context.input.artifacts || {}; metadata.assertMetadataFacts(resolved.facts);
    const artifactRevision = artifactVerification.valid ? metadataRevision(context) : '';
    context.assertFence('before_metadata_publish');
    const published = kairoxStore.publishMetadata({ subjectId: context.task.subjectId, facts: resolved.facts, evidence: { taskId: context.task.id, eventId: context.event.eventId, ...(artifactRevision ? { artifactRevision } : {}) }, observedAt: new Date().toISOString() });
    return { result: { metadataRevision: published.factRevision, artifactRevision }, commitMarker: `metadata:${published.factRevision}` };
  } });
  register({ capability: 'series.metadata.publish', allowedTargetGates: ['metadata'], execute: async (context) => {
    const resolved = context.input.metadata; const artifactVerification = context.input.artifacts || {}; metadata.assertMetadataFacts(resolved.facts);
    const artifactRevision = artifactVerification.valid ? metadataRevision(context) : '';
    context.assertFence('before_series_metadata_publish');
    const published = kairoxStore.publishMetadata({ subjectId: context.task.subjectId, facts: { ...resolved.facts, subjectKind: 'series' }, evidence: { taskId: context.task.id, eventId: context.event.eventId, ...(artifactRevision ? { artifactRevision } : {}) }, observedAt: new Date().toISOString() });
    return { result: { metadataRevision: published.factRevision, artifactRevision }, commitMarker: `series-metadata:${published.factRevision}` };
  } });
}

module.exports = { registerMetadataCapabilities, nfoFor, seriesNfoFor };
