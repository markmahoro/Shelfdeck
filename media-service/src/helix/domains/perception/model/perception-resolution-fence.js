'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const RESOLUTION_DRAFT_SCHEMA = 'helix://contracts/types/PerceptionResolutionDraft/v1';
const RESOLUTION_RESULT_SCHEMA = 'helix://contracts/types/PerceptionResolutionRevision/v1';
const RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS = 'perception-resolution-input-contract-repair@1';

class PerceptionStoreError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PerceptionStoreError'; this.code = code; this.details = details; }
}
function fail(code, message, details) { throw new PerceptionStoreError(code, message, details); }
function resolutionBasis(context){return {queryInputDigest:context.query.queryInputDigest,recordSetDigest:context.recordSet.recordSetDigest,ruleDigest:context.ruleSnapshot.ruleDigest};}
function matchesResolutionBasis(base,digest){return digest===canonicalDigest(base)||digest===canonicalDigest({...base,recoveryBasis:RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS});}

function validateResolutionCommit(handle, draft) {
  const requiredKeys = ['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs',
    'queryContract','querySchemaRef','queryInputDigest','factKind','recordSetDigest','ruleRevision','ruleDigest',
    'resultKind','duplicateRelationDrafts'];
  const optionalKeys = ['winningPerceptionId','resolvedValue','resolvedProvenance','reasonCode'];
  const body = draft && Object.fromEntries(Object.entries(draft).filter(([key]) => !['schemaRef','schemaVersion','draftId','draftKind','basisDigest','draftDigest','producedAtMs'].includes(key)));
  const found = draft?.resultKind === 'found';
  const foundFields = draft && ['winningPerceptionId','resolvedValue','resolvedProvenance'].every((key) => Object.hasOwn(draft,key));
  const notFoundFields = draft && Object.hasOwn(draft,'reasonCode');
  if (!handle || handle.ownerDomain !== 'perception' || handle.aggregateType !== 'perception-resolution' ||
      handle.factType !== 'PerceptionResolutionDraft' || handle.factSchemaRef !== RESOLUTION_DRAFT_SCHEMA ||
      handle.resultSchemaRef !== RESOLUTION_RESULT_SCHEMA || !draft || draft.schemaRef !== RESOLUTION_DRAFT_SCHEMA ||
      draft.schemaVersion !== 1 || draft.draftKind !== 'perception_resolution' ||
      requiredKeys.some((key) => !Object.hasOwn(draft, key)) || Object.keys(draft).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key)) ||
      draft.draftDigest !== canonicalDigest(body) ||
      handle.aggregateId !== 'perception-resolution:' + canonicalDigest({
        queryContract:draft.queryContract, queryInputDigest:draft.queryInputDigest
      }) || handle.payloadDigest !== canonicalDigest(draft) || !Array.isArray(draft.duplicateRelationDrafts) ||
      draft.duplicateRelationDrafts.length > 1024 || !Number.isSafeInteger(draft.ruleRevision) || draft.ruleRevision < 1 ||
      !['rating','watched'].includes(draft.factKind) || !['found','not_found'].includes(draft.resultKind) ||
      (found ? (!foundFields || notFoundFields) : (foundFields || !notFoundFields || !['no_matching_record','requested_fact_absent','strongest_value_conflict'].includes(draft.reasonCode))) ||
      (found && (draft.resolvedValue?.factKind !== draft.factKind || draft.resolvedProvenance?.winningPerceptionId !== draft.winningPerceptionId))) {
    fail('P6_PERCEPTION_RESOLUTION_COMMIT_MISMATCH', 'Resolution Commit Handle does not fence the exact typed Resolution Draft.');
  }
  for (const relation of draft.duplicateRelationDrafts) {
    if (!relation || Object.keys(relation).length !== 4 ||
        ['sourcePerceptionId','targetPerceptionId','ruleRevision','evidenceDigest'].some((key) => !Object.hasOwn(relation, key)) ||
        relation.sourcePerceptionId >= relation.targetPerceptionId || relation.ruleRevision !== draft.ruleRevision) {
      fail('P6_PERCEPTION_DUPLICATE_RELATION_INVALID', 'Duplicate relation pairs must be normalized and use the frozen Resolution rule revision.');
    }
  }
}

module.exports = Object.freeze({ PerceptionStoreError, RESOLUTION_DRAFT_SCHEMA, RESOLUTION_RESULT_SCHEMA,
  RESOLUTION_INPUT_CONTRACT_REPAIR_BASIS, resolutionBasis, matchesResolutionBasis, validateResolutionCommit });
