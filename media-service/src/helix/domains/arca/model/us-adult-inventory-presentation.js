'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { originalNameProvenance, buildUsAdultTitle } = require('../../../contracts/us-adult-presentation');
const { inventoryContentProfile } = require('./product-content-profile');
const { SCHEMA, assertUsAdultInventoryPresentation } = require('../../../contracts/us-adult-inventory-presentation');

function fail() {
  throw Object.assign(new TypeError('US Adult presentation requires the exact current Inventory actor and original naming evidence.'),
    { code: 'ARCA_US_ADULT_PRESENTATION_INVALID' });
}

function oneFact(raw, kind) {
  const rows = raw.facts.filter(row => row.fact_kind === kind);
  if (rows.length !== 1 || !rows[0].value) fail();
  return rows[0].value;
}

function readUsAdultInventoryPresentation(context) {
  const raw = context?.raw;
  if (!raw || inventoryContentProfile(raw.identity, raw.entry?.structure_kind) !== 'western_adult' ||
      raw.entry.status !== 'active' || raw.entry.shelf_entry_id !== context.shelfEntryId ||
      !Number.isSafeInteger(Number(raw.entry.current_inventory_revision)) || Number(raw.entry.current_inventory_revision) < 1 ||
      !Array.isArray(raw.facts) || !Array.isArray(raw.people) || raw.people.length !== 1) fail();
  const resolvedFact = oneFact(raw, 'resolved_identity'), resolved = resolvedFact.resolvedProductIdentity || resolvedFact;
  if (resolved.contentProfile !== 'western_adult' || resolved.identityKind !== 'internal_identity' || resolved.structureKind !== 'single' ||
      resolved.identityDigest !== raw.identity.identity_digest) fail();
  const entries = resolved.displayIdentity?.entries;
  if (!Array.isArray(entries) || new Set(entries.map(item => item.key)).size !== entries.length) fail();
  const display = new Map(entries.map(item => [item.key, item.value]));
  const originalName = originalNameProvenance(display.get('original_file_name'));
  if (display.get('original_file_name_digest') !== originalName.provenanceDigest) fail();

  const cast = oneFact(raw, 'media_cast'), actor = cast.relations?.[0], row = raw.people[0];
  if (cast.schemaRef !== 'helix://contracts/types/MediaCastFact/v1' || cast.sourceBasisKind !== 'us_adult_actor' ||
      cast.relationCount !== 1 || cast.relations?.length !== 1 ||
      cast.relationsDigest !== canonicalDigest({ schema: 'libra.media-cast-relations@1', relations: cast.relations }) ||
      !actor || actor.role !== 'actor' || typeof actor.personId !== 'string' || !actor.personId ||
      typeof actor.displayName !== 'string' || !actor.displayName.trim() ||
      !['user_actor_choice', 'face_reference_match'].includes(actor.source) || !Array.isArray(actor.providerIdentities) ||
      row.shelf_entry_id !== context.shelfEntryId || Number(row.inventory_revision) !== Number(raw.entry.current_inventory_revision) ||
      row.relation_id !== actor.relationId || row.person_id !== actor.personId || row.display_name !== actor.displayName ||
      row.display_name_normalized !== actor.displayNameNormalized || row.role !== actor.role || row.relation_source !== actor.source ||
      row.origin_evidence_digest !== actor.originEvidenceDigest || row.confidence_class !== actor.confidenceClass ||
      row.relation_digest !== canonicalDigest(actor)) fail();
  const { relationDigest, ...relationBody } = actor;
  if (relationDigest !== canonicalDigest(relationBody)) fail();
  const providers = row.provider_identity_json === null ? [] : JSON.parse(row.provider_identity_json);
  if (canonicalJson(providers) !== canonicalJson(actor.providerIdentities) ||
      (providers.length ? row.provider_identity_digest !== canonicalDigest(providers) : row.provider_identity_digest !== null)) fail();

  const named = buildUsAdultTitle({ actorName: actor.displayName, originalName });
  return Object.freeze({ title: named.title, year: null, actor: Object.freeze(structuredClone(actor)), originalName,
    inventoryRevision: Number(raw.entry.current_inventory_revision), shelfEntryId: context.shelfEntryId });
}

function buildUsAdultInventoryPresentation(context, aftercareCaseId) {
  const current = readUsAdultInventoryPresentation(context);
  const body = { schemaRef: SCHEMA, schemaVersion: 1, shelfEntryId: current.shelfEntryId,
    inventoryRevision: current.inventoryRevision, aftercareCaseId, representationDigest: context.raw.inventory.representation_digest,
    canonicalIdentityDigest: context.raw.identity.identity_digest, personId: current.actor.personId, actorName: current.actor.displayName,
    actorRelationDigest: canonicalDigest(current.actor), originalName: current.originalName };
  return Object.freeze(assertUsAdultInventoryPresentation({ ...body, snapshotDigest: canonicalDigest(body) }, { shelfEntryId: context.shelfEntryId, aftercareCaseId }));
}

module.exports = Object.freeze({ readUsAdultInventoryPresentation, buildUsAdultInventoryPresentation });
