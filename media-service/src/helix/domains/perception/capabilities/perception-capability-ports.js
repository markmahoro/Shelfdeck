'use strict';

const acquisitionTransaction = require('../../../contracts/transaction-contracts/helix.transaction.perception-acquisition-page-commit/v1/contract.json');
const resolutionTransaction = require('../../../contracts/transaction-contracts/helix.transaction.perception-resolution-commit/v1/contract.json');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { titleAliases } = require('../model/perception-aliases');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../../foundation/persistence/domain-commit-registry');
const { createPerceptionAcquisitionPipeline, createPerceptionRecordCommitRegistration } = require('./perception-acquisition-pipeline');
const { createPerceptionResolutionCommitRegistration } = require('../model/perception-resolution-lifecycle');
const { resolvePerception } = require('../model/perception-resolution-resolver');
const { createPerceptionStore } = require('../persistence/perception-store');

const BASE = 'helix://contracts/capabilities/';
const REFS = Object.freeze({
  acquire: 'perception.source.acquire@1', normalize: 'perception.record.normalize@1', commit: 'perception.record.commit@1',
  resolve: 'perception.dedup.resolve@1', resolutionCommit: 'perception.resolution.commit@1',
});
const RESULT = Object.freeze({
  commit: 'helix://contracts/types/PerceptionRecordCommitResult/v1',
  resolution: 'helix://contracts/types/PerceptionResolutionRevision/v1',
});

function freeze(value) { return Array.isArray(value) ? Object.freeze(value.map(freeze)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)]))) : value; }
function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function envelope(ref, result, evidence, effectReceipt) {
  return Object.freeze({ kind: 'succeeded', resultSchemaRef: BASE + ref.replace('@1', '/v1/result'), result,
    evidenceSchemaRef: BASE + ref.replace('@1', '/v1/evidence'), evidence, ...(effectReceipt ? { effectReceipt } : {}) });
}
function evidence(ref, basisDigest, result, at) { return Object.freeze({ evidenceId: stable('perception-evidence-', { ref, basisDigest, result: canonicalDigest(result) }),
  evidenceKind: ref.replace('@1', '').replaceAll('.', '_'), producerRef: ref, basisDigest, payloadDigest: canonicalDigest(result), observedAtMs: at }); }
function receipt(context, result, marker, at) { const effectId = canonicalDigest(['domain_fact_commit', context.idempotencyKey]);
  return Object.freeze({ schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1,
    effectReceiptId: stable('perception-effect-', { eventId: context.eventId }), effectId, effectClass: 'domain_fact_commit',
    idempotencyKey: context.idempotencyKey, commitMarker: marker, externalReceiptRef: null,
    outputDigest: canonicalDigest(result), verificationEvidenceDigest: result.commitDigest || null, committedAtMs: at }); }

function entryMap(payload) { return Object.fromEntries((payload.entries || []).map((item) => [item.key, item.value])); }
function normalizationRuleEvaluator() {
  return Object.freeze({ async normalize({ observation, rule }) {
    const values = observation.inlinePayload?.entries ? entryMap(observation.inlinePayload) : observation.inlinePayload;
    const direct = rule.sourceKind === 'shelfdeck_direct';
    const rating = values.rating === null || values.rating === undefined ? undefined : Number(values.rating);
    if (rating !== undefined && (!Number.isSafeInteger(rating) || rating < 1 || rating > 5)) throw new TypeError('Perception rating must be an integer from 1 to 5.');
    const title = String(values.title || '').normalize('NFKC').trim();
    if (!title) throw new TypeError('Perception observation title is required.');
    const anchors = [], anchorKeys = new Set();
    const add = (anchorKind, anchorValue, confidenceClass) => { if (!anchorValue) return; const key=anchorKind+'\0'+String(anchorValue);if(anchorKeys.has(key)||anchors.length>=16)return;anchorKeys.add(key);anchors.push(Object.freeze({ anchorKind, anchorValue:String(anchorValue), confidenceClass,
      evidenceDigest:canonicalDigest({ observationId:observation.observationId, anchorKind, anchorValue:String(anchorValue), confidenceClass }) })); };
    if (direct) add(values.targetType === 'shelf_entry' ? 'shelf_entry_id' : 'subject_id', values.targetId, 'exact');
    if (values.providerIdentity) add('provider_identity', values.providerIdentity, 'strong');
    if (values.doubanSubjectId) add('provider_identity', 'douban:movie:' + values.doubanSubjectId, 'strong');
    let aliasTitles=[];
    if(values.aliasTitlesJson!==undefined){try{aliasTitles=JSON.parse(values.aliasTitlesJson);}catch{throw new TypeError('Perception alias title set is invalid.');}}
    if (!Array.isArray(aliasTitles) || aliasTitles.length > 12 || aliasTitles.some((item)=>typeof item!=='string'||!item.trim()||Buffer.byteLength(item,'utf8')>1024)) {
      throw new TypeError('Perception alias title set is invalid.');
    }
    if (values.year) {
      for (const alias of titleAliases([title, ...aliasTitles].join(' / '), { providerDelimited:true })) {
        add('title_year', alias + '\0' + values.year, 'medium');
      }
    }
    anchors.sort((a, b) => a.anchorKind.localeCompare(b.anchorKind) || a.anchorValue.localeCompare(b.anchorValue));
    const supersedes = values.supersedesSourceRecordKey ? freeze({ sourceRecordKey:String(values.supersedesSourceRecordKey),
      sourceRecordRevision:Number(values.supersedesSourceRecordRevision), sourceRecordDigest:String(values.supersedesSourceRecordDigest) }) : null;
    const retracts = values.retractsSourceRecordKey ? freeze({ sourceRecordKey:String(values.retractsSourceRecordKey),
      sourceRecordRevision:Number(values.retractsSourceRecordRevision), sourceRecordDigest:String(values.retractsSourceRecordDigest) }) : null;
    if (supersedes && (!Number.isSafeInteger(supersedes.sourceRecordRevision) || supersedes.sourceRecordRevision < 1 || !supersedes.sourceRecordDigest)) {
      throw new TypeError('Perception correction lineage is invalid.');
    }
    if (retracts && (!Number.isSafeInteger(retracts.sourceRecordRevision) || retracts.sourceRecordRevision < 1 || !retracts.sourceRecordDigest) || supersedes && retracts) {
      throw new TypeError('Perception retraction lineage is invalid.');
    }
    const recordKind = retracts ? 'retraction' : supersedes ? 'correction' : 'observation';
    const draftId = stable('perception-record-', { sourceRecordKey:observation.sourceRecordKey, sourceRecordRevision:observation.sourceRecordRevision, sourceRecordDigest:observation.sourceRecordDigest });
    const record = freeze({ draftId, recordKind, sourceRecordKey:observation.sourceRecordKey,
      sourceRecordRevision:observation.sourceRecordRevision, sourceRecordDigest:observation.sourceRecordDigest,
      ...(rating === undefined ? {} : { rating }), watchedState: values.watched === undefined || values.watched === null ? null : Boolean(values.watched),
      observedTitle:title, observedAtMs:observation.observedAtMs, identityAnchors:anchors,
      provenanceRef:observation.observationId, provenanceDigest:observation.provenanceDigest });
    const lineage = retracts || supersedes, relationKind = retracts ? 'retracts' : 'supersedes';
    const relations = lineage ? [freeze({ relationKind, sourceDraftId:draftId,
      targetSourceRecord:lineage, ruleRevision:1,
      evidenceDigest:canonicalDigest({ sourceDraftId:draftId, target:lineage,
        rule:retracts?'direct-retraction@1':'direct-correction@1' }) })] : [];
    return freeze({ record, sourceLineageRelations:relations });
  } });
}

function createPerceptionCapabilityPorts(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.acquirePerceptionProvider !== 'function' || typeof options.readPerceptionObservation !== 'function') {
    throw new TypeError('Perception Capability ports require persistence and a typed Provider observation adapter.');
  }
  const now = options.now || Date.now, store = options.perceptionStore || createPerceptionStore(options);
  const pipeline = createPerceptionAcquisitionPipeline({
    providerObservation:{ execute:options.acquirePerceptionProvider }, observationReader:{ read:options.readPerceptionObservation },
    ruleEvaluator:normalizationRuleEvaluator(), digest:(value)=>canonicalDigest(typeof value === 'string' ? value : value),
  });
  const registry = createDomainCommitRegistry({ registrations:[createPerceptionRecordCommitRegistration(store), createPerceptionResolutionCommitRegistration(store)] });
  const transactionRegistry = createCanonicalTransactionRegistry({ contracts:[acquisitionTransaction, resolutionTransaction] });
  const commits = createDomainCommitCoordinator({ schemaManifest:options.schemaManifest, registry, transactionRegistry, unitOfWork:options.unitOfWork });

  function domainCommit(context, transactionId, handle, payload, outboxKind) {
    const marker = handle.commitIdempotencyKey, resultId = stable('perception-result-', { eventId:context.eventId, marker });
    const effectReceiptId = stable('perception-effect-', { eventId: context.eventId });
    const proof = evidence(context.capabilityRef, handle.payloadDigest, payload, now());
    const committed = commits.execute({ transactionId, handle, payload, supportingWorkId:context.workId,
      commitMarker:{ commitMarker:marker, effectId:canonicalDigest(['domain_fact_commit', context.idempotencyKey]), commitDigest:handle.payloadDigest },
      resultBinding:{ resultId, eventId:context.eventId, evidenceSchemaRef:BASE + context.capabilityRef.replace('@1','/v1/evidence'), evidence:proof, effectReceiptId },
      outboxMessages:[{ messageId:stable('perception-outbox-', { marker }), producerDomain:'perception', messageKind:outboxKind,
        aggregateType:handle.aggregateType, aggregateId:handle.aggregateId, aggregateRevision:handle.expectedRevision + 1,
        dedupKey:marker, intendedConsumers:['perception'], payloadSchemaRef:'helix://contracts/types/PerceptionProcessWakeSignal/v1',
        payload:{ messageKind:outboxKind, aggregateId:handle.aggregateId, aggregateRevision:handle.expectedRevision + 1,
          factDigest:canonicalDigest(payload) } }] });
    const result = committed.typedResult, at = result.committedAtMs || now();
    return envelope(context.capabilityRef, result, committed.typedEvidence,
      Object.freeze({ ...receipt(context, result, marker, at), verificationEvidenceDigest:handle.payloadDigest }));
  }

  return Object.freeze({
    [REFS.acquire]:Object.freeze({ validateInputs(c){ if(!c?.namedInputs?.perceptionSourceSnapshot||!c.namedInputs.integrationHandle||!c.namedInputs.perceptionAcquisitionCursor)throw new TypeError('Perception Acquire inputs are required.'); },
      async execute(context){ const inputs=context.namedInputs, at=now(); const result=await pipeline.acquirePage({ sourceSnapshot:inputs.perceptionSourceSnapshot,
        cursor:inputs.perceptionAcquisitionCursor, integrationHandle:inputs.integrationHandle, secretLeaseHandle:{ leaseId:'platform-owned-lease' },
        idempotencyKey:context.idempotencyKey, timeoutMs:60_000, evidenceId:stable('perception-page-', { eventId:context.eventId }), observedAtMs:at });
        return envelope(REFS.acquire,result,evidence(REFS.acquire,result.basisDigest,result,at),null); }, validateResult(_c,v){if(!v?.result?.observationPageDigest)throw new TypeError('Perception Observation Page is absent.');} }),
    [REFS.normalize]:Object.freeze({ validateInputs(c){if(!c?.namedInputs?.perceptionObservationPage||!c.namedInputs.perceptionNormalizationRuleRef)throw new TypeError('Perception Normalize inputs are required.');},
      async execute(context){const page=context.namedInputs.perceptionObservationPage, result=await pipeline.normalizePage({observationPage:page,
        normalizationRule:context.namedInputs.perceptionNormalizationRuleRef,draftId:stable('perception-page-draft-',{eventId:context.eventId}),producedAtMs:now()});
        return envelope(REFS.normalize,result,evidence(REFS.normalize,page.observationPageDigest,result,now()),null);},validateResult(_c,v){if(!v?.result?.draftDigest)throw new TypeError('Perception Commit Draft is absent.');} }),
    [REFS.commit]:Object.freeze({validateInputs(c){if(!c?.namedInputs?.perceptionAcquisitionCommitDraft||!c.namedInputs.domainFactCommitHandle)throw new TypeError('Perception Record Commit inputs are required.');},
      execute(context){return domainCommit(context,'helix.transaction.perception-acquisition-page-commit',context.namedInputs.domainFactCommitHandle,
        context.namedInputs.perceptionAcquisitionCommitDraft,'perception.records.committed');},validateResult(_c,v){if(!v?.result?.receiptId)throw new TypeError('Perception Record Commit Result is absent.');} }),
    [REFS.resolve]:Object.freeze({validateInputs(c){if(!c?.namedInputs?.perceptionResolutionQuery||!c.namedInputs.perceptionResolutionRecordSet||!c.namedInputs.perceptionResolutionRuleSnapshot)throw new TypeError('Perception Resolution inputs are required.');},
      execute(context){const i=context.namedInputs,result=resolvePerception({query:i.perceptionResolutionQuery,recordSet:i.perceptionResolutionRecordSet,ruleSnapshot:i.perceptionResolutionRuleSnapshot},
        {draftId:stable('perception-resolution-draft-',{eventId:context.eventId}),producedAtMs:now()});return envelope(REFS.resolve,result,evidence(REFS.resolve,result.basisDigest,result,now()),null);},
      validateResult(_c,v){if(!v?.result?.draftDigest)throw new TypeError('Perception Resolution Draft is absent.');} }),
    [REFS.resolutionCommit]:Object.freeze({validateInputs(c){if(!c?.namedInputs?.perceptionResolutionDraft||!c.namedInputs.domainFactCommitHandle)throw new TypeError('Perception Resolution Commit inputs are required.');},
      execute(context){return domainCommit(context,'helix.transaction.perception-resolution-commit',context.namedInputs.domainFactCommitHandle,
        context.namedInputs.perceptionResolutionDraft,'perception.resolution.committed');},validateResult(_c,v){if(!v?.result?.factId)throw new TypeError('Perception Resolution Revision is absent.');} }),
  });
}

module.exports = Object.freeze({ createPerceptionCapabilityPorts });
