'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const inventoryStatements = require('./inventory-context-statements');
const model = require('../model/us-adult-actor-refresh');
const admissions = new WeakMap();

const COLUMNS = ['intent_id', 'aftercare_case_id', 'shelf_entry_id', 'actor_id', 'idempotency_key', 'request_digest',
  'payload_schema_ref', 'payload_json', 'payload_digest', 'created_at_ms'];
const PAGE_COLUMNS = ['intent_id', 'page_ordinal', 'page_schema_ref', 'page_json', 'page_digest'];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function immutable(value) {
  if(value&&typeof value==='object'){Object.values(value).forEach(immutable);Object.freeze(value);}
  return value;
}
function assertActorRefreshAdmissionParticipant(participants, objective, caseId) {
  const exact = participants.filter(participant => {
    const proof = admissions.get(participant);
    return proof?.intentId === objective.intentId && proof.intentDigest === objective.intentDigest && proof.aftercareCaseId === caseId;
  });
  if (exact.length !== 1) fail('ARCA_US_ADULT_REFRESH_INTENT_REQUIRED', 'Actor refresh Case admission requires its exact Owner Intent participant.');
}
function createUsAdultActorRefreshStore(options) {
  if (typeof options.contractValidator?.validate !== 'function') throw new TypeError('Actor refresh persistence requires nominal validation.');
  const repository = createRepositoryDefinition({ repositoryId:'arca_us_actor_refresh', owner:'arca', schemaManifest:options.schemaManifest,
    statements:{ ...inventoryStatements,
      get:{ kind:'select-one', tableId:'arca_us_actor_refresh_intents', columns:COLUMNS, keyColumns:['intent_id'], safeIntegers:true },
      command:{ kind:'select-one', tableId:'arca_us_actor_refresh_intents', columns:COLUMNS, keyColumns:['actor_id', 'idempotency_key'], safeIntegers:true },
      by_case:{ kind:'select-one', tableId:'arca_us_actor_refresh_intents', columns:COLUMNS, keyColumns:['aftercare_case_id'], safeIntegers:true },
      insert:{ kind:'insert', tableId:'arca_us_actor_refresh_intents', columns:COLUMNS },
      insert_page:{ kind:'insert', tableId:'arca_us_actor_refresh_pages', columns:PAGE_COLUMNS },
      page:{ kind:'select-one', tableId:'arca_us_actor_refresh_pages', columns:PAGE_COLUMNS, keyColumns:['intent_id', 'page_ordinal'], safeIntegers:true },
      case:{ kind:'select-one', tableId:'arca_aftercare_cases', keyColumns:['aftercare_case_id'],
        columns:['aftercare_case_id', 'shelf_entry_id', 'care_basis_json', 'care_basis_digest', 'care_requirement_json', 'care_requirement_digest'] },
    } });
  const read = execute => options.unitOfWork.execute([{ participantId:'arca_us_actor_refresh_read', owner:'arca', repositories:[repository],
    execute:context => execute(context.repository(repository.repositoryId)) }]).arca_us_actor_refresh_read;

  function map(row) {
    if (!row) return null;
    let intent;
    try { intent = JSON.parse(row.payload_json); } catch { fail('ARCA_US_ADULT_REFRESH_RECORD_CORRUPT', 'Actor refresh Intent JSON is corrupt.'); }
    model.assertIntent(intent, options.contractValidator);
    if (row.payload_schema_ref !== model.SCHEMA || row.payload_json !== canonicalJson(intent) || row.payload_digest !== canonicalDigest(intent) ||
        row.intent_id !== intent.intentId || row.shelf_entry_id !== intent.shelfEntryId || row.actor_id !== intent.actorId ||
        row.idempotency_key !== intent.idempotencyKey || row.request_digest !== intent.requestDigest ||
        typeof row.aftercare_case_id !== 'string' || !row.aftercare_case_id ||
        !Number.isSafeInteger(Number(row.created_at_ms)) || Number(row.created_at_ms) < 0) {
      fail('ARCA_US_ADULT_REFRESH_RECORD_CORRUPT', 'Actor refresh columns do not match their immutable Intent.');
    }
    return immutable({ intent, aftercareCaseId:row.aftercare_case_id, createdAtMs:Number(row.created_at_ms) });
  }
  function page(intentId, ordinal) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0) fail('ARCA_US_ADULT_REFRESH_PAGE_INVALID', 'Reference page ordinal is invalid.');
    return read(repo => {
      const record = map(repo.invoke('get', { intent_id:intentId })), row = repo.invoke('page', { intent_id:intentId, page_ordinal:ordinal });
      if (!record || record.intent.mode !== 'automatic' || ordinal >= record.intent.pageCount || !row) {
        fail('ARCA_US_ADULT_REFRESH_PAGE_MISSING', 'The exact frozen automatic reference page is absent.');
      }
      if(Buffer.byteLength(row.page_json)>512*1024)fail('ARCA_US_ADULT_REFRESH_PAGE_CORRUPT','Frozen reference page exceeds its byte budget.');
      let value;
      try { value = JSON.parse(row.page_json); } catch { fail('ARCA_US_ADULT_REFRESH_PAGE_CORRUPT', 'Frozen reference page JSON is corrupt.'); }
      options.contractValidator.validate('helix://contracts/domain-types/PeopleReferenceLibraryPage/v1', value);
      const { pageDigest, ...body } = value;
      if (row.intent_id !== intentId || Number(row.page_ordinal) !== ordinal || row.page_schema_ref !== value.schemaRef ||
          canonicalJson(value) !== row.page_json || canonicalDigest(value) !== row.page_digest || pageDigest !== canonicalDigest(body) ||
          value.libraryDigest !== record.intent.libraryDigest || value.totalPersonCount !== record.intent.personCount ||
          (ordinal === record.intent.pageCount - 1) !== (value.nextCursor === null)) {
        fail('ARCA_US_ADULT_REFRESH_PAGE_CORRUPT', 'Frozen reference page no longer explains the admitted complete library.');
      }
      value.items.forEach(person=>model.assertPerson(person,options.contractValidator));
      return immutable(value);
    });
  }
  function participant(intent, pages, aftercareCaseId) {
    model.assertIntent(intent, options.contractValidator);
    if (intent.mode === 'automatic') {
      const summary = model.referencePages(pages, options.contractValidator);
      if (['libraryDigest', 'personCount', 'pageCount', 'pageSetDigest'].some(key => summary[key] !== intent[key])) {
        fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Frozen pages differ from the admitted library commitment.');
      }
    } else if (pages.length !== 0) fail('ARCA_US_ADULT_REFRESH_LIBRARY_INVALID', 'Specified actor refresh cannot persist library pages.');
    // Copy before returning a participant: callers cannot mutate admission inputs
    // between validation and the Owner transaction's execution.
    const payloadJson = canonicalJson(intent), pageValues = pages.map((value, ordinal) => ({
      intent_id:intent.intentId, page_ordinal:ordinal, page_schema_ref:value.schemaRef,
      page_json:canonicalJson(value), page_digest:canonicalDigest(value),
    })), frozen = JSON.parse(payloadJson);
    const admission = Object.freeze({ participantId:'arca_us_actor_refresh_admission', owner:'arca', repositories:[repository], execute(context) {
      const repo = context.repository(repository.repositoryId), entry = repo.invoke('find_entry', { shelf_entry_id:frozen.shelfEntryId }),
        inventory = entry && repo.invoke('find_inventory', { shelf_entry_id:frozen.shelfEntryId, revision:frozen.inventoryRevision }),
        identity = entry && repo.invoke('find_identity', { shelf_entry_id:frozen.shelfEntryId, revision:frozen.canonicalIdentityRevision }),
        care = repo.invoke('case', { aftercare_case_id:aftercareCaseId });
      if (!entry || entry.status !== 'active' || Number(entry.current_inventory_revision) !== frozen.inventoryRevision ||
          Number(entry.current_deck_fact_revision) !== frozen.deckFactRevision || Number(entry.canonical_identity_revision) !== frozen.canonicalIdentityRevision ||
          entry.canonical_identity_key !== frozen.canonicalIdentityKey || inventory?.representation_digest !== frozen.representationDigest ||
          identity?.identity_digest !== frozen.canonicalIdentityDigest || !care || care.shelf_entry_id !== frozen.shelfEntryId ||
          care.care_basis_digest !== frozen.careBasisDigest) {
        fail('ARCA_US_ADULT_REFRESH_BASIS_STALE', 'Entry or Aftercare Basis changed before actor refresh admission.');
      }
      const basis = JSON.parse(care.care_basis_json), requirement = JSON.parse(care.care_requirement_json), objective = model.readRequirement(requirement),
        shelf = repo.invoke('find_shelf', { shelf_id:entry.shelf_id });
      if (!shelf || shelf.status !== 'active' || Number(shelf.current_standard_revision) !== basis.standardRevision ||
          Number(shelf.current_placement_revision) !== basis.placementRevision || !objective || objective.intentId !== frozen.intentId ||
          objective.intentDigest !== frozen.intentDigest || requirement.digest !== care.care_requirement_digest) {
        fail('ARCA_US_ADULT_REFRESH_BASIS_STALE', 'The exact actor objective and current Shelf revisions are required.');
      }
      repo.invoke('insert', { intent_id:frozen.intentId, aftercare_case_id:aftercareCaseId, shelf_entry_id:frozen.shelfEntryId,
        actor_id:frozen.actorId, idempotency_key:frozen.idempotencyKey, request_digest:frozen.requestDigest,
        payload_schema_ref:model.SCHEMA, payload_json:payloadJson, payload_digest:canonicalDigest(frozen), created_at_ms:context.commitTimeMs });
      for (const value of pageValues) repo.invoke('insert_page', value);
      return Object.freeze({ intentId:frozen.intentId, aftercareCaseId });
    } });
    admissions.set(admission, Object.freeze({ intentId:frozen.intentId, intentDigest:frozen.intentDigest, aftercareCaseId }));
    return admission;
  }
  return Object.freeze({ get:intentId => read(repo => map(repo.invoke('get', { intent_id:intentId }))),
    findCommand:(actorId, idempotencyKey) => read(repo => map(repo.invoke('command', { actor_id:actorId, idempotency_key:idempotencyKey }))),
    byCase:aftercareCaseId => read(repo => map(repo.invoke('by_case', { aftercare_case_id:aftercareCaseId }))), page, participant });
}
module.exports = Object.freeze({ createUsAdultActorRefreshStore, assertActorRefreshAdmissionParticipant });
