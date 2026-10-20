'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { faceModelReference } = require('../../../contracts/us-adult-face-model');
const { US_ADULT_PRESENTATION_VERSION } = require('../../../contracts/us-adult-presentation');
const { readUsAdultInventoryPresentation } = require('./us-adult-inventory-presentation');
const { physicalIdentityFromInventoryRow } = require('./aftercare-contract');

const SCHEMA = 'helix://contracts/domain-types/UsAdultActorRefreshIntent/v1';
const {POLICY, requirement, readRequirement} = require('./us-adult-actor-refresh-objective');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const compare = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));
function fail(code, message) { throw Object.assign(new TypeError(message), { code }); }
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}
function assertRequest(body) {
  const fields = body?.mode === 'specified'
    ? 'expectedInventoryRevision,expectedPersonRevision,expectedReferenceRevision,expectedRepresentationDigest,idempotencyKey,mode,personId'
    : 'expectedInventoryRevision,expectedRepresentationDigest,idempotencyKey,mode';
  if (!body || Object.keys(body).sort().join(',') !== fields || !['specified', 'automatic'].includes(body.mode) ||
      !positive(body.expectedInventoryRevision) || !hex(body.expectedRepresentationDigest) ||
      typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128 ||
      body.mode === 'specified' && (typeof body.personId !== 'string' || !body.personId || body.personId.length > 256 ||
        !positive(body.expectedPersonRevision) || !positive(body.expectedReferenceRevision))) {
    fail('ARCA_US_ADULT_REFRESH_REQUEST_INVALID', 'Actor refresh requires an exact single-Entry user request and expected versions.');
  }
  return body;
}
function intentId(actorId, idempotencyKey) {
  if (typeof actorId !== 'string' || !actorId || actorId.length > 256) fail('ARCA_US_ADULT_REFRESH_REQUEST_INVALID', 'Actor refresh requires its authenticated initiator.');
  return canonicalDigest({ schema:'arca.us-adult-actor-refresh-intent-id@1', actorId, idempotencyKey });
}
function assertPerson(person, validator) {
  validator.validate('helix://contracts/domain-types/UsAdultPersonSnapshot/v1', person);
  const { snapshotDigest, ...body } = person, projection = person.referenceProjection,
    { projectionRevision, projectionDigest, ...projectionBody } = projection, contribution = projection.contributions[0];
  if (person.libraryKind !== 'us_adult' || snapshotDigest !== canonicalDigest(body) || projectionDigest !== canonicalDigest(projectionBody) ||
      Buffer.byteLength(canonicalJson(person)) > 128 * 1024 ||
      projection.personId !== person.personId || projection.personRevision !== person.personRevision || projection.contributions.length !== 1 ||
      contribution.ownerPersonId !== person.personId || contribution.ownerReferenceRevision !== projection.currentReferenceRevision || contribution.inheritedReadOnly ||
      contribution.activeAssets.length === 0 || contribution.activeFaces.length === 0 ||
      contribution.activeFaces.some(face => face.modelRef !== faceModelReference('single_reference_face').digest ||
        !contribution.activeAssets.some(asset => asset.referenceAssetId === face.referenceAssetId))) {
    fail('ARCA_US_ADULT_REFRESH_PERSON_INVALID', 'Actor refresh requires an isolated usable Person and exact pinned reference evidence.');
  }
  return person;
}
function referencePages(pages, validator) {
  if (!Array.isArray(pages) || pages.length === 0 || !pages[0]) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Automatic refresh requires the complete frozen reference library.');
  let count = 0, previous = null;
  const digest = pages[0].libraryDigest, total = pages[0].totalPersonCount;
  for (const [ordinal, page] of pages.entries()) {
    validator.validate('helix://contracts/domain-types/PeopleReferenceLibraryPage/v1', page);
    const { pageDigest, ...body } = page;
    if (pageDigest !== canonicalDigest(body) || Buffer.byteLength(canonicalJson(page)) > 512 * 1024 || page.libraryDigest !== digest || page.totalPersonCount !== total ||
        ordinal < pages.length - 1 && page.nextCursor === null || ordinal === pages.length - 1 && page.nextCursor !== null ||
        page.items.length === 0 && (total !== 0 || pages.length !== 1)) {
      fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Automatic refresh reference pages are partial or from different library versions.');
    }
    for (const person of page.items) {
      assertPerson(person, validator);
      if (previous !== null && compare(previous, person.personId) >= 0) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Reference pages must preserve complete stable Person ordering.');
      previous = person.personId; count++;
    }
    if (page.nextCursor !== null && page.nextCursor !== previous) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Reference page cursor does not match its last Person.');
  }
  if (count !== total) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Automatic refresh cannot truncate or duplicate the reference library.');
  return { libraryDigest:digest, personCount:count, pageCount:pages.length,
    pageSetDigest:canonicalDigest({ schema:'arca.us-adult-refresh-reference-pages@1', pages:pages.map((page, ordinal) => ({ ordinal, pageDigest:page.pageDigest })) }) };
}
function assertIntent(value, validator) {
  validator.validate(SCHEMA, value);
  const { intentDigest, ...body } = value;
  if (intentDigest !== canonicalDigest(body) || value.intentId !== intentId(value.actorId, value.idempotencyKey) ||
      canonicalJson(value.faceModelRef) !== canonicalJson(faceModelReference('western_frame_set')) ||
      value.referenceModelRefDigest !== faceModelReference('single_reference_face').digest ||
      Buffer.byteLength(canonicalJson(value)) > 256 * 1024) {
    fail('ARCA_US_ADULT_REFRESH_INTENT_INVALID', 'Actor refresh lost its frozen request, model or Intent proof.');
  }
  const request = { idempotencyKey:value.idempotencyKey, mode:value.mode, expectedInventoryRevision:value.inventoryRevision,
    expectedRepresentationDigest:value.representationDigest };
  if (value.mode === 'specified') {
    const person = assertPerson(value.manualPersonSnapshot, validator);
    if (value.libraryDigest !== null || value.personCount !== 0 || value.pageCount !== 0 ||
        value.pageSetDigest !== canonicalDigest({ schema:'arca.us-adult-refresh-reference-pages@1', pages:[] })) {
      fail('ARCA_US_ADULT_REFRESH_INTENT_INVALID', 'An explicit actor Intent cannot carry automatic library inputs.');
    }
    Object.assign(request, { personId:person.personId, expectedPersonRevision:person.personRevision,
      expectedReferenceRevision:person.referenceProjection.currentReferenceRevision });
  } else if (value.manualPersonSnapshot !== null || !hex(value.libraryDigest) || value.pageCount < 1) {
    fail('ARCA_US_ADULT_REFRESH_INTENT_INVALID', 'Automatic actor Intent requires a complete reference-library commitment.');
  }
  assertRequest(request);
  if (value.requestDigest !== canonicalDigest({ shelfEntryId:value.shelfEntryId, ...request })) {
    fail('ARCA_US_ADULT_REFRESH_INTENT_INVALID', 'Actor refresh does not explain its exact original user request.');
  }
  return value;
}
function buildIntent({ context, body, actorId, personSnapshot = null, pages = [], activeCases = [], contractValidator }) {
  assertRequest(body);
  if (typeof contractValidator?.validate !== 'function') throw new TypeError('Actor refresh admission requires nominal contract validation.');
  const current = readUsAdultInventoryPresentation(context), raw = context.raw;
  if (raw.shelf?.status !== 'active' || raw.correctionGate || raw.reservations?.some(row => row.state === 'active') ||
      activeCases.some(row => ['queued', 'active'].includes(row.state))) {
    fail('ARCA_US_ADULT_REFRESH_BUSY', 'An active Entry modification must finish before a new actor refresh.');
  }
  if (current.inventoryRevision !== body.expectedInventoryRevision || raw.inventory.representation_digest !== body.expectedRepresentationDigest ||
      !hex(context.basis?.digest) || !hex(context.knownBindings?.digest)) {
    fail('ARCA_US_ADULT_REFRESH_BASIS_STALE', 'The current Inventory differs from the explicit actor refresh request.');
  }
  const primary = raw.materials?.filter(row => row.role === 'primary_payload');
  if (primary?.length !== 1) fail('ARCA_US_ADULT_REFRESH_SOURCE_INVALID', 'Actor refresh requires one owned primary video.');
  const identity = physicalIdentityFromInventoryRow(primary[0]);
  let library = { libraryDigest:null, personCount:0, pageCount:0,
    pageSetDigest:canonicalDigest({ schema:'arca.us-adult-refresh-reference-pages@1', pages:[] }) };
  if (body.mode === 'specified') {
    if (pages.length !== 0) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'An explicit actor request must not import a reference-library scan.');
    const person = assertPerson(personSnapshot, contractValidator);
    if (person.personId !== body.personId || person.personRevision !== body.expectedPersonRevision ||
        person.referenceProjection.currentReferenceRevision !== body.expectedReferenceRevision) {
      fail('ARCA_US_ADULT_REFRESH_PERSON_STALE', 'The target actor changed since the user selection.');
    }
  } else {
    if (personSnapshot !== null) fail('ARCA_US_ADULT_REFRESH_PERSON_INVALID', 'Automatic refresh must obtain its actor from complete match Results.');
    library = referencePages(pages, contractValidator);
  }
  const value = { schemaRef:SCHEMA, schemaVersion:1, policyVersion:POLICY, intentId:intentId(actorId, body.idempotencyKey), actorId,
    idempotencyKey:body.idempotencyKey, requestDigest:canonicalDigest({ shelfEntryId:context.shelfEntryId, ...body }), mode:body.mode,
    shelfEntryId:context.shelfEntryId, inventoryRevision:current.inventoryRevision, representationDigest:raw.inventory.representation_digest,
    deckFactRevision:Number(raw.entry.current_deck_fact_revision), canonicalIdentityRevision:Number(raw.entry.canonical_identity_revision),
    canonicalIdentityKey:raw.entry.canonical_identity_key, canonicalIdentityDigest:raw.identity.identity_digest,
    careBasisDigest:context.basis.digest, knownBindingsDigest:context.knownBindings.digest,
    originalName:current.originalName, actorRelationDigest:canonicalDigest(current.actor),
    sourceMaterialBinding:{ materialKey:identity.materialKey, endpointId:primary[0].endpoint_id, bindingRevision:Number(primary[0].binding_revision),
      identityDigest:canonicalDigest(identity), bindingDigest:canonicalDigest({ materialKey:identity.materialKey, endpointId:primary[0].endpoint_id,
        location:primary[0].location, bindingRevision:Number(primary[0].binding_revision) }) },
    manualPersonSnapshot:personSnapshot, ...library, faceModelRef:faceModelReference('western_frame_set'),
    referenceModelRefDigest:faceModelReference('single_reference_face').digest, rendererVersion:US_ADULT_PRESENTATION_VERSION };
  const result = { ...value, intentDigest:canonicalDigest(value) };
  if (Buffer.byteLength(canonicalJson(result)) > 256 * 1024) fail('ARCA_US_ADULT_REFRESH_INTENT_TOO_LARGE', 'Actor refresh exceeds its exact frozen input budget.');
  assertIntent(result, contractValidator);
  return immutable(JSON.parse(canonicalJson(result)));
}

module.exports = Object.freeze({ SCHEMA, POLICY, assertRequest, assertPerson, intentId, assertIntent, buildIntent, referencePages, requirement, readRequirement });
