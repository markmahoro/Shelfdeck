'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const model = require('../model/us-adult-actor-refresh');
const { readUsAdultInventoryPresentation } = require('../model/us-adult-inventory-presentation');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function createUsAdultActorRefreshCommand(options) {
  const { actorRefreshStore:store, aftercareContextReader:reader, peopleReferenceQuery, contractValidator } = options;
  if (!store || !reader?.store || !peopleReferenceQuery || !contractValidator) {
    throw new TypeError('Actor refresh requires formal Arca context, Intent persistence and public People snapshots.');
  }
  function receipt(record, replayed) {
    const care = reader.store.getCase(record.aftercareCaseId), objective = care && model.readRequirement(care.careRequirement);
    if (!objective || objective.intentId !== record.intent.intentId || objective.intentDigest !== record.intent.intentDigest ||
        care.shelfEntryId !== record.intent.shelfEntryId || care.careBasisDigest !== record.intent.careBasisDigest) {
      fail('ARCA_US_ADULT_REFRESH_RECORD_CORRUPT', 'Actor refresh no longer points to its exact Aftercare Case.');
    }
    return Object.freeze({ intentId:record.intent.intentId, aftercareCaseId:record.aftercareCaseId,
      shelfEntryId:record.intent.shelfEntryId, mode:record.intent.mode, state:care.state, replayed });
  }
  function request(shelfEntryId, requestBody, actorId) {
    const body = JSON.parse(canonicalJson(model.assertRequest(requestBody)));
    if (typeof shelfEntryId !== 'string' || !shelfEntryId || shelfEntryId.length > 256) {
      fail('ARCA_US_ADULT_REFRESH_REQUEST_INVALID', 'Actor refresh requires one explicit Shelf Entry.');
    }
    model.intentId(actorId, body.idempotencyKey);
    const requestDigest = canonicalDigest({ shelfEntryId, ...body }), prior = store.findCommand(actorId, body.idempotencyKey);
    if (prior) {
      if (prior.intent.requestDigest !== requestDigest) fail('ARCA_US_ADULT_REFRESH_IDEMPOTENCY_CONFLICT', 'The actor refresh key already belongs to a different request.');
      return receipt(prior, true);
    }
    const context = reader.read(shelfEntryId);
    if (!context) fail('ARCA_US_ADULT_REFRESH_ENTRY_NOT_FOUND', 'The active Shelf Entry is absent.');
    const current = readUsAdultInventoryPresentation(context);
    if (current.inventoryRevision !== body.expectedInventoryRevision || context.raw.inventory.representation_digest !== body.expectedRepresentationDigest) {
      fail('ARCA_US_ADULT_REFRESH_BASIS_STALE', 'The current Inventory differs from the user request.');
    }
    const activeCases = reader.store.history(shelfEntryId).cases.filter(care => ['queued', 'active'].includes(care.state));
    if (activeCases.length) fail('ARCA_US_ADULT_REFRESH_BUSY', 'An existing Aftercare Case must finish before a new actor refresh.');
    let personSnapshot = null;
    const pages = [];
    if (body.mode === 'specified') {
      personSnapshot = peopleReferenceQuery.readUsAdultPersonSnapshot({ personId:body.personId,
        expectedPersonRevision:body.expectedPersonRevision, expectedReferenceRevision:body.expectedReferenceRevision });
      if (!personSnapshot) fail('ARCA_US_ADULT_REFRESH_PERSON_NOT_FOUND', 'The selected US Adult actor is unavailable.');
    } else {
      let cursor = null, expectedLibraryDigest = null;
      do {
        const page = peopleReferenceQuery.readUsAdultReferencePage({ cursor, limit:256, expectedLibraryDigest });
        contractValidator.validate('helix://contracts/domain-types/PeopleReferenceLibraryPage/v1', page);
        if (page.nextCursor !== null && (page.items.length === 0 ||
            page.nextCursor !== page.items.at(-1).personId || cursor !== null && Buffer.compare(Buffer.from(page.nextCursor), Buffer.from(cursor)) <= 0) ||
            expectedLibraryDigest !== null && page.libraryDigest !== expectedLibraryDigest) {
          fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Reference pagination changed version or failed to advance.');
        }
        pages.push(page); expectedLibraryDigest = page.libraryDigest; cursor = page.nextCursor;
      } while (cursor !== null);
    }
    const intent = model.buildIntent({ context, body, actorId, personSnapshot, pages, activeCases, contractValidator }),
      requirement = model.requirement(intent), findingSetDigest = canonicalDigest({ schema:'arca.user-actor-refresh-objective@1', intentDigest:intent.intentDigest });
    contractValidator.validate(requirement.schemaRef, requirement);
    const care = reader.store.createCase({ shelfEntryId, careBasis:context.basis, careRequirement:requirement, findingSetDigest,
      triggerDigest:canonicalDigest({ schema:'arca.user-actor-refresh-trigger@1', intentId:intent.intentId, requestDigest }),
      basisInputs:[{ inputKind:'actor_refresh_intent', ownerDomain:'arca', aggregateType:'us_adult_actor_refresh',
        aggregateId:intent.intentId, revision:1, inputDigest:intent.intentDigest }],
      atomicParticipants:caseId => [store.participant(intent, pages, caseId)] });
    const record = store.get(intent.intentId);
    if (!record || record.aftercareCaseId !== care.aftercareCaseId) {
      fail('ARCA_US_ADULT_REFRESH_RECORD_CORRUPT', 'Actor refresh admission did not atomically retain its Intent.');
    }
    options.onAdmitted?.({ shelfEntryId, aftercareCaseId:record.aftercareCaseId });
    return receipt(record, false);
  }
  return Object.freeze({ request });
}
module.exports = Object.freeze({ createUsAdultActorRefreshCommand });
