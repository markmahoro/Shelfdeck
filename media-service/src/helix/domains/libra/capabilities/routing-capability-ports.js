'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createDecisionBasisStore, RESULT_SCHEMA: DECISION_BASIS_SCHEMA } = require('../persistence/decision-basis-store');

const BASE = 'helix://contracts/capabilities/';
const FACT_RESULT = 'helix://contracts/types/RoutingFactObservation/v1';
const FACT_REF = 'libra.routing.fact.observe@1';
const BASIS_REF = 'libra.decision_basis.commit@1';

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }
function normalize(value) { return String(value || '').normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' '); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort(); }

function evidence(ref, basisDigest, result, at) {
  return Object.freeze({ evidenceId: stable('libra-routing-evidence-', { ref, basisDigest, resultDigest: canonicalDigest(result) }),
    evidenceKind: ref === FACT_REF ? 'routing_fact_observation' : 'routing_decision_basis_commit', producerRef: ref,
    basisDigest, payloadDigest: canonicalDigest(result), observedAtMs: at });
}

function succeeded(ref, result, observedAtMs, effectReceipt = null, suppliedEvidence = null) {
  const resultEvidence = suppliedEvidence || evidence(ref, result.intentId || result.inputSetDigest || canonicalDigest(result), result, observedAtMs);
  return Object.freeze({ kind: 'succeeded', resultSchemaRef: BASE + ref.replace('@1', '/v1/result'), result,
    evidenceSchemaRef: BASE + ref.replace('@1', '/v1/evidence'), evidence: resultEvidence,
    ...(effectReceipt ? { effectReceipt } : {}) });
}

function routingFact(intent, factKind, body, sourceObjectId, sourceRevision) {
  const value = { sourceObjectId, sourceRevision, schemaRef: 'RoutingDecisionFact@1', factKind, ...body };
  return Object.freeze({ ...value, factDigest: canonicalDigest(value) });
}

function result(intent, sourceRef, outcome, reasonCode, facts, candidateMatchCount) {
  const body = { schemaRef: FACT_RESULT, schemaVersion: 1,
    observationId: stable('libra-routing-observation-', { intentId: intent.intentId, sourceRef, outcome, facts }),
    intentId: intent.intentId, subjectId: intent.subjectId, sourceKind: intent.sourceKind, sourceRef,
    result: outcome, reasonCode, facts: Object.freeze(facts), candidateMatchCount,
    evidenceDigest: canonicalDigest({ schema: 'libra.routing-source-evidence@1', intentDigest: intent.intentDigest,
      sourceRef, outcome, facts: facts.map((fact) => fact.factDigest), candidateMatchCount }) };
  return Object.freeze({ ...body, observationDigest: canonicalDigest(body) });
}

function decodeXmlText(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
      if (entity[0] === '#') {
        const numeric = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
        return Number.isSafeInteger(numeric) ? String.fromCodePoint(numeric) : '';
      }
      return entities[entity.toLowerCase()];
    }).trim();
}

function tagValues(xml, tagName, attributePattern = '') {
  const expression = new RegExp('<' + tagName + attributePattern + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tagName + '>', 'gi');
  const values = [];
  for (const match of xml.matchAll(expression)) {
    const value = decodeXmlText(match[1]);
    if (value) values.push(value);
  }
  return unique(values);
}

function parseNfo(intent, xml, handle) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > 256 * 1024) {
    const error = new Error('Routing NFO exceeds its bounded transport.'); error.code = 'LIBRA_ROUTING_NFO_BOUND'; throw error;
  }
  if (!/<movie(?:\s|>)/i.test(xml) || !/<\/movie\s*>/i.test(xml) || /<!DOCTYPE/i.test(xml)) {
    const error = new Error('Routing NFO is not valid XML.'); error.code = 'LIBRA_ROUTING_NFO_PROTOCOL'; throw error;
  }
  const facts = [], sourceObjectId = intent.relatedReferenceId, sourceRevision = handle.bindingRevision;
  for (const factKind of intent.requestedFactKinds) {
    if (factKind === 'release_year') {
      const values = unique(['year', 'premiered', 'releasedate'].flatMap((tag) => tagValues(xml, tag))
        .map((value) => String(value).match(/(?:18|19|20|21)\d{2}/)?.[0] || null));
      if (values.length > 1) return result(intent, handle.location, 'ambiguous', 'source_fact_conflicting', [], values.length);
      if (values.length === 1) facts.push(routingFact(intent, factKind, { year: Number(values[0]) }, sourceObjectId, sourceRevision));
    } else if (factKind === 'region') {
      const values = unique(['country', 'countrycode'].flatMap((tag) => tagValues(xml, tag)).map((value) => value.toUpperCase()).filter((value) => /^[A-Z]{2}$/.test(value)));
      if (values.length) facts.push(routingFact(intent, factKind, { countryCodes: Object.freeze(values) }, sourceObjectId, sourceRevision));
    } else if (factKind === 'genre') {
      const values = tagValues(xml, 'genre').map(normalize);
      if (values.length) facts.push(routingFact(intent, factKind, { genreCodes: Object.freeze(values) }, sourceObjectId, sourceRevision));
    } else if (factKind === 'resolved_provider_identity') {
      const values = unique([...tagValues(xml, 'tmdbid'), ...tagValues(xml, 'uniqueid', '(?=[^>]*\\btype\\s*=\\s*["\\\']tmdb["\\\'])')]
        .filter((value) => /^\d+$/.test(value)));
      if (values.length > 1) return result(intent, handle.location, 'ambiguous', 'source_fact_conflicting', [], values.length);
      if (values.length === 1) {
        const identity = { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: values[0], identityRevision: 1 };
        facts.push(routingFact(intent, factKind, { ...identity, identityDigest: canonicalDigest(identity) }, sourceObjectId, sourceRevision));
      }
    }
  }
  return facts.length ? result(intent, handle.location, 'observed', null, facts, 1) :
    result(intent, handle.location, 'not_found', 'requested_fact_absent', [], 0);
}

function providerCandidateSelection(intent, candidates) {
  if (!Array.isArray(candidates) || candidates.length > 20) {
    const error = new Error('Routing Provider returned an invalid candidate set.'); error.code = 'LIBRA_ROUTING_PROVIDER_PROTOCOL'; throw error;
  }
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.providerKey !== 'string' || seen.has(candidate.providerKey)) {
      const error = new Error('Routing Provider candidate identity is invalid.'); error.code = 'LIBRA_ROUTING_PROVIDER_PROTOCOL'; throw error;
    }
    seen.add(candidate.providerKey);
  }
  if (intent.strongProviderAnchor) return candidates.filter((item) => item.providerKey === intent.strongProviderAnchor.providerKey);
  const title = normalize(intent.candidateDisplayTitle);
  return candidates.filter((item) => [item.title, item.originalTitle].some((value) => normalize(value) === title) &&
    (intent.yearHint === null || item.releaseYear === intent.yearHint));
}

function parseProvider(intent, candidates, handle) {
  const matches = providerCandidateSelection(intent, candidates);
  if (!matches.length) return result(intent, handle.integrationId, 'not_found', 'provider_no_match', [], 0);
  if (matches.length > 1) return result(intent, handle.integrationId, 'ambiguous', 'provider_identity_ambiguous', [], matches.length);
  const candidate = matches[0], facts = [], sourceRevision = handle.configRevision;
  for (const factKind of intent.requestedFactKinds) {
    if (factKind === 'release_year' && Number.isSafeInteger(candidate.releaseYear))
      facts.push(routingFact(intent, factKind, { year: candidate.releaseYear }, candidate.providerKey, sourceRevision));
    if (factKind === 'region' && Array.isArray(candidate.regionCodes) && candidate.regionCodes.length)
      facts.push(routingFact(intent, factKind, { countryCodes: Object.freeze(unique(candidate.regionCodes)) }, candidate.providerKey, sourceRevision));
    if (factKind === 'genre' && Array.isArray(candidate.genreCodes) && candidate.genreCodes.length)
      facts.push(routingFact(intent, factKind, { genreCodes: Object.freeze(unique(candidate.genreCodes)) }, candidate.providerKey, sourceRevision));
    if (factKind === 'resolved_provider_identity') {
      const identity = { provider: 'tmdb', namespace: 'tmdb_movie', providerKey: candidate.providerKey, identityRevision: 1 };
      facts.push(routingFact(intent, factKind, { ...identity, identityDigest: canonicalDigest(identity) }, candidate.providerKey, sourceRevision));
    }
  }
  return facts.length ? result(intent, handle.integrationId, 'observed', null, facts, 1) :
    result(intent, handle.integrationId, 'not_found', 'requested_fact_absent', [], 1);
}

function effectReceipt(context, resultValue, marker, verificationEvidenceDigest, committedAtMs) {
  const effectId = canonicalDigest(['domain_fact_commit', context.idempotencyKey]);
  return Object.freeze({ schemaRef: 'helix://contracts/types/EffectReceipt/v1', schemaVersion: 1,
    effectReceiptId: stable('libra-routing-basis-effect-', { eventId: context.eventId }), effectId,
    effectClass: 'domain_fact_commit', idempotencyKey: context.idempotencyKey, commitMarker: marker,
    externalReceiptRef: null, outputDigest: canonicalDigest(resultValue), verificationEvidenceDigest,
    committedAtMs });
}

function createRoutingCapabilityPorts(options) {
  if (typeof options?.readRelatedNfo !== 'function' || typeof options.observeRoutingProvider !== 'function') {
    throw new TypeError('Routing Capability ports require bounded NFO and Provider observation adapters.');
  }
  const now = options.now || Date.now, basisStore = createDecisionBasisStore(options);
  return Object.freeze({
    [FACT_REF]: Object.freeze({
      validateInputs(context) { if (!context?.namedInputs?.routingFactObservationIntent || !context.namedInputs.physicalMaterialReadHandleOrIntegrationHandle) throw new TypeError('Routing Fact inputs are required.'); },
      async execute(context) {
        const intent = context.namedInputs.routingFactObservationIntent, handle = context.namedInputs.physicalMaterialReadHandleOrIntegrationHandle;
        const observed = intent.sourceKind === 'related_nfo' ? parseNfo(intent, await options.readRelatedNfo(handle), handle) :
          parseProvider(intent, await options.observeRoutingProvider({ intent, integrationHandle: handle }), handle);
        const observedAtMs = now();
        return succeeded(FACT_REF, observed, observedAtMs, null, evidence(FACT_REF, intent.intentDigest, observed, observedAtMs));
      },
      validateResult(_context, value) { if (!value?.result?.observationDigest) throw new TypeError('Routing Fact Observation is absent.'); },
    }),
    [BASIS_REF]: Object.freeze({
      validateInputs(context) { if (!context?.namedInputs?.decisionInputSet || !context.namedInputs.domainFactCommitHandle) throw new TypeError('Decision Basis inputs are required.'); },
      execute(context) {
        const inputSet = context.namedInputs.decisionInputSet, marker = stable('libra-routing-basis-marker-', { eventId: context.eventId, inputSetDigest: inputSet.inputSetDigest });
        const resultId = stable('libra-routing-basis-result-', { eventId: context.eventId });
        const receiptId = stable('libra-routing-basis-effect-', { eventId: context.eventId });
        const effectId = canonicalDigest(['domain_fact_commit', context.idempotencyKey]);
        const commitDigest = context.namedInputs.domainFactCommitHandle.payloadDigest;
        const committed = basisStore.commit({ decisionInputSet: inputSet, domainFactCommitHandle: context.namedInputs.domainFactCommitHandle,
          commitMarker: Object.freeze({ commitMarker: marker, effectId, commitDigest }), resultId, eventId: context.eventId, evidenceSchemaRef: BASE + BASIS_REF.replace('@1', '/v1/evidence'),
          evidenceFactory: (basis) => evidence(BASIS_REF, inputSet.inputSetDigest, basis, basis.committedAtMs), effectReceiptId: receiptId });
        const finalEvidence = evidence(BASIS_REF, inputSet.inputSetDigest, committed.result, committed.result.committedAtMs);
        const receipt = effectReceipt(context, committed.result, marker, commitDigest, committed.result.committedAtMs);
        return succeeded(BASIS_REF, committed.result, committed.result.committedAtMs, receipt, finalEvidence);
      },
      validateResult(_context, value) { if (!value?.result?.basisDigest) throw new TypeError('Decision Basis Result is absent.'); },
    }),
  });
}

module.exports = Object.freeze({ createRoutingCapabilityPorts, parseNfo, parseProvider, providerCandidateSelection });
