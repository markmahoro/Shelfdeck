'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) =>
  `helix://contracts/application-types/${name}/v1`;
const digest = () => ({ type: 'string', pattern: '^[a-f0-9]{64}$' });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
  ...options,
});

function arcaMaterialEpisodeClaims() {
  return {
    $schema: DRAFT,
    $id: typeId('ArcaMaterialEpisodeClaims'),
    title: 'ArcaMaterialEpisodeClaims@1',
    'x-helix-ssotRefs': ['3.3.1', '8.5.13', '8.6.19'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({
      items: {
        type: 'array',
        minItems: 0,
        maxItems: 32,
        uniqueItems: true,
        items: object({
          episodeKey: { type: 'string', minLength: 1, maxLength: 256 },
          seasonClaimDigest: digest(),
          claimDigest: digest(),
        }),
      },
      episodeClaimSetDigest: digest(),
    }),
  };
}

function buildArcaApplicationSchemas() {
  const correction=require('../../src/helix/domains/arca/model/jav-identity-correction-schemas');
  const correctionType=(name,body,maxBytes)=>({$schema:DRAFT,$id:typeId(name),title:name+'@1',
    'x-helix-ssotRefs':['3.5.5','8.5.12','8.6.19'],'x-helix-maxCanonicalBytes':maxBytes,...body});
  return Object.freeze({
    ArcaJavCorrectionCancellationReceipt:correctionType('ArcaJavCorrectionCancellationReceipt',require('../../src/helix/domains/arca/model/jav-correction-cancellation').javCorrectionCancellationReceiptSchema(),16384),
    ArcaJavCorrectionRecoveryIntentReceipt:correctionType('ArcaJavCorrectionRecoveryIntentReceipt',require('../../src/helix/domains/arca/model/jav-correction-recovery').javCorrectionRecoveryReceiptSchema(),16384),
    ArcaJavCorrectionRecoveryObservation:correctionType('ArcaJavCorrectionRecoveryObservation',require('../../src/helix/domains/arca/model/jav-correction-recovery').javCorrectionRecoveryObservationSchema(),1024*1024),
    ArcaJavCorrectionDirectoryChecks:correctionType('ArcaJavCorrectionDirectoryChecks',require('../../src/helix/domains/arca/model/jav-correction-directory-scope').javCorrectionDirectoryChecksSchema(),65536),
    ArcaJavCorrectionDirectoryScope:correctionType('ArcaJavCorrectionDirectoryScope',require('../../src/helix/domains/arca/model/jav-correction-directory-scope').javCorrectionDirectoryScopeSchema(),65536),
    ArcaJavPerceptionContinuity:correctionType('ArcaJavPerceptionContinuity',require('../../src/helix/contracts/jav-perception-continuity').javPerceptionContinuitySchema(),16384),
    ...require('./defect-outcome-schema-builder').arcaSchemas(),
    ArcaJavCorrectionBasis:correctionType('ArcaJavCorrectionBasis',correction.javCorrectionBasisSchema(),1024*1024),
    ArcaJavCorrectionProposal:correctionType('ArcaJavCorrectionProposal',correction.javCorrectionProposalSchema(),64*1024),
    ArcaJavCorrectionPreviewProof:correctionType('ArcaJavCorrectionPreviewProof',correction.javCorrectionPreviewProofSchema(),2*1024*1024),
    ArcaJavCorrectionAdmissionReceipt:correctionType('ArcaJavCorrectionAdmissionReceipt',correction.javCorrectionAdmissionReceiptSchema(),16*1024),
    ArcaJavCorrectionMetadataFact:correctionType('ArcaJavCorrectionMetadataFact',correction.javCorrectionMetadataFactSchema(),128*1024),
    ArcaJavCorrectionIdentityFact:correctionType('ArcaJavCorrectionIdentityFact',correction.javCorrectionIdentitySchema(),64*1024),
    ArcaJavCorrectionCastFact:correctionType('ArcaJavCorrectionCastFact',correction.javCorrectionCastFactSchema(),256*1024),
    ArcaJavCorrectionMetadataRecord:correctionType('ArcaJavCorrectionMetadataRecord',correction.javCorrectionMetadataRecordSchema(),64*1024),
    ArcaJavCorrectionCastRecord:correctionType('ArcaJavCorrectionCastRecord',correction.javCorrectionCastRecordSchema(),64*1024),
    ArcaJavCorrectionFilePlan:correctionType('ArcaJavCorrectionFilePlan',correction.javCorrectionFilePlanSchema(),2*1024*1024),
    ArcaJavCorrectionFormalRetirementPlan:correctionType('ArcaJavCorrectionFormalRetirementPlan',require('../../src/helix/domains/arca/model/jav-correction-formal-retirement').javCorrectionFormalRetirementSchema(),4*1024*1024),
    ArcaJavCorrectionCommittedContext:correctionType('ArcaJavCorrectionCommittedContext',require('../../src/helix/domains/arca/model/jav-correction-committed-context').javCorrectionCommittedContextSchema(),4*1024*1024),
    ArcaJavCorrectionCleanupReceipt:correctionType('ArcaJavCorrectionCleanupReceipt',require('../../src/helix/domains/arca/model/jav-correction-cleanup-receipt').javCorrectionCleanupReceiptSchema(),16*1024),
    ArcaJavCorrectionWorkspaceReclaimPlan:correctionType('ArcaJavCorrectionWorkspaceReclaimPlan',require('../../src/helix/domains/arca/model/jav-correction-workspace-reclaim').javCorrectionWorkspaceReclaimSchema(),256*1024),
    ArcaMaterialEpisodeClaims: arcaMaterialEpisodeClaims(),
    OffdeckShelfCoverage: {
      $schema:DRAFT,$id:typeId('OffdeckShelfCoverage'),title:'OffdeckShelfCoverage@1',
      'x-helix-ssotRefs':['8.5.12','9.5.5'],'x-helix-maxCanonicalBytes':65536,
      type:'object',minProperties:1,maxProperties:1024,propertyNames:{minLength:1,maxLength:256},
      additionalProperties:{type:'number',minimum:0,maximum:1},
    },
    SourceCleanupChecks: {
      $schema:DRAFT,$id:typeId('SourceCleanupChecks'),title:'SourceCleanupChecks@1',
      'x-helix-ssotRefs':['8.5.14'],'x-helix-maxCanonicalBytes':65536,
      type:'array',maxItems:32,items:object({
        state:{enum:['absent','archived','recycle_pending','awaiting_confirmation','retained_in_use','retained_after_restore','blocked']},
        sourceLocation:{type:'string',minLength:1,maxLength:4096},
        recycleEntryId:{type:'string',minLength:1,maxLength:200},
        errorCode:{type:['string','null'],maxLength:256},
      },['state']),
    },
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function schemaDigest(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value))).digest('hex');
}

module.exports = Object.freeze({
  buildArcaApplicationSchemas,
  schemaDigest,
  typeId,
});
