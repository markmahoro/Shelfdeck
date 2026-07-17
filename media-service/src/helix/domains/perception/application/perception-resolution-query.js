'use strict';

const DIGEST = /^[a-f0-9]{64}$/;

class PerceptionResolutionQueryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionResolutionQueryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PerceptionResolutionQueryError(code, message, details);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  }
  return value;
}

function createPerceptionResolutionQuery(options) {
  if (!options || !options.store || typeof options.store.getResolution !== 'function' || typeof options.now !== 'function' ||
      !Number.isSafeInteger(options.freshnessTtlMs) || options.freshnessTtlMs < 0) {
    fail('P6_PERCEPTION_RESOLUTION_QUERY_DEPENDENCIES', 'Resolution Store, clock, and freshness TTL are required.');
  }
  return Object.freeze({
    resolveDecisionFact(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 2 || typeof input.queryContract !== 'string' ||
          input.queryContract.length < 1 || !DIGEST.test(input.queryInputDigest || '')) {
        fail('P6_PERCEPTION_RESOLUTION_QUERY_INVALID', 'Resolution query requires one versioned contract and its exact input digest.');
      }
      const resolution = options.store.getResolution(input.queryContract, input.queryInputDigest);
      if (!resolution) {
        fail('P6_PERCEPTION_RESOLUTION_NOT_COMMITTED', 'No committed Resolution exists for the requested contract and input anchors.');
      }
      const contract = freeze({ contractRef:resolution.queryContract, factKind:resolution.factKind, version:parseContractVersion(resolution.queryContract) });
      const freshness = freeze({
        status: options.now() - resolution.committedAtMs <= options.freshnessTtlMs ? 'fresh' : 'stale',
        resolvedAtMs: resolution.committedAtMs,
        validForMs: options.freshnessTtlMs
      });
      if (resolution.resultKind === 'not_found') {
        return freeze({ kind:'not_found', providerDomain:'perception', contract,
          inputAnchorsDigest:resolution.queryInputDigest, revision:resolution.revision,
          reasonCode:resolution.reasonCode, evidence:[], resolvedAtMs:resolution.committedAtMs, freshness });
      }
      return freeze({ kind:'found', providerDomain:'perception', contract,
        inputAnchorsDigest:resolution.queryInputDigest, revision:resolution.revision,
        value:resolution.resolvedValue, evidence:[resolution.resolvedProvenance],
        resolvedAtMs:resolution.committedAtMs, freshness });
    }
  });
}

function parseContractVersion(value) {
  const match = /@(\d+)$/.exec(value);
  if (!match) fail('P6_PERCEPTION_QUERY_CONTRACT_INVALID', 'Perception query contract must declare a version.');
  return Number(match[1]);
}

module.exports = Object.freeze({ PerceptionResolutionQueryError, createPerceptionResolutionQuery });
