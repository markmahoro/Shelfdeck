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
  return Object.freeze({
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
