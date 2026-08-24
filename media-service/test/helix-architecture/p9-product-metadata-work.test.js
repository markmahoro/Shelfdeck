'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  metadataObservationWork,
  nextMetadataStage,
} = require('../../src/helix/domains/libra/planning/product-metadata-work');

const D = (value) => canonicalDigest({ value });

function providerIdentity() {
  const value = {
    provider: 'tmdb',
    namespace: 'tmdb_movie',
    providerKey: '123',
    seasonNumber: null,
  };
  return Object.freeze({ ...value, identityAnchorDigest: canonicalDigest(value) });
}

function snapshot(requiredFieldCodes = ['plot','title','year']) {
  return Object.freeze({
    run: Object.freeze({ libraRunId:'run-metadata', executionBasisDigest:D('run-basis'),
      priorityClass:'normal', priorityRevision:1 }),
    spec: Object.freeze({ contentProfile:'movie', requirements:Object.freeze({ metadata:Object.freeze({
      requiredFieldCodes:Object.freeze(requiredFieldCodes),
    }) }) }),
    relatedReferences: Object.freeze([Object.freeze({
      role:'nfo', referenceId:'nfo-1', referenceDigest:D('nfo-reference'),
      identity:Object.freeze({ contentFingerprint:D('nfo-bytes') }),
    })]),
  });
}

function identity() {
  return Object.freeze({ factValue:Object.freeze({
    identityDigest:D('resolved-identity'),
    providerIdentities:Object.freeze([providerIdentity()]),
  }) });
}

function options(results, onProvider = () => {}) {
  return {
    workResultReader: {
      listWorks() { return results.map((_, ordinal) => ({ work_id:'source-work-' + ordinal })); },
      read(workId) { return [results[Number(workId.slice('source-work-'.length))]]; },
    },
    productProductionPort: {
      resolveCurrentIntegrationHandle(request) {
        onProvider(request);
        return Object.freeze({ integrationId:'tmdb-main', configRevision:7 });
      },
    },
  };
}

function result(sourcePriority, sourceKind, fields, peopleHints = []) {
  return Object.freeze({
    outcomeKind:'succeeded', capabilityRef:'libra.product_metadata.fetch@1',
    result:Object.freeze({
      sourcePriority, sourceKind,
      sourceRef:sourceKind === 'related_nfo' ? 'nfo-1' : 'tmdb-main',
      evidenceId:'evidence-' + sourcePriority,
      descriptiveFacts:Object.freeze({ entries:Object.freeze(fields.map((key) => Object.freeze({ key, value:key + '-value' }))) }),
      peopleHints:Object.freeze(peopleHints),
    }),
  });
}

test('Product Metadata signs one NFO source Work first and does not contact TMDB when NFO closes the gap', () => {
  let providerCalls=0;
  const first=nextMetadataStage(options([],()=>{providerCalls+=1;}),snapshot(),identity());
  assert.equal(first.kind,'source');
  assert.equal(first.source.kind,'related_nfo');
  assert.deepEqual(first.source.intent.requestedFields,['plot','title','year']);
  const work=metadataObservationWork(snapshot(),first.source);
  assert.equal(work.workKind,'product_metadata_observation');
  assert.equal(work.outputContractRef,'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result');

  const complete=nextMetadataStage(options([
    result(0,'related_nfo',['plot','title','year']),
  ],()=>{providerCalls+=1;}),snapshot(),identity());
  assert.equal(complete.kind,'ready');
  assert.equal(providerCalls,0);
});

test('Product Metadata creates a distinct provider Work only for fields still missing after durable NFO evidence', () => {
  let providerCalls=0,providerRequest=null;
  const first=nextMetadataStage(options([]),snapshot(),identity());
  const firstWork=metadataObservationWork(snapshot(),first.source);
  const second=nextMetadataStage(options([
    result(0,'related_nfo',['title','year']),
  ],(request)=>{providerCalls+=1;providerRequest=request;}),snapshot(),identity());
  assert.equal(second.kind,'source');
  assert.equal(second.source.kind,'provider');
  assert.deepEqual(second.source.intent.requestedFields,['plot']);
  assert.equal(providerCalls,1);
  assert.deepEqual(providerRequest, {
    sourceKind:'provider', providerKind:'tmdb',
    operationId:'libra.product_metadata.fetch@1',
  });
  assert.equal(second.source.intent.integrationId,'tmdb-main');
  assert.equal(second.source.intent.configRevision,7);
  const secondWork=metadataObservationWork(snapshot(),second.source);
  assert.notEqual(secondWork.workId,firstWork.workId);
  assert.notEqual(secondWork.idempotencyKey,firstWork.idempotencyKey);
  assert.equal(second.source.intent.sourcePriority,1);
});

test('Product Metadata freezes the currently resolved Integration revision instead of assuming revision one', () => {
  const source=nextMetadataStage(options([
    result(0,'related_nfo',['title','year']),
  ]),snapshot(),identity()).source;
  assert.equal(source.kind,'provider');
  assert.equal(source.intent.integrationId,'tmdb-main');
  assert.equal(source.intent.configRevision,7);
  assert.equal(source.intent.providerKind,'tmdb');
});

test('missing provider Integration leaves staged Product Metadata waiting without fabricating not-found evidence', () => {
  const blocked=nextMetadataStage({
    workResultReader:options([result(0,'related_nfo',['title'])]).workResultReader,
    productProductionPort:{resolveCurrentIntegrationHandle(){const error=new Error('unavailable');
      error.code='CLEAN_PRODUCT_INTEGRATION_UNAVAILABLE';throw error;}},
  },snapshot(),identity());
  assert.equal(blocked.kind,'unavailable');
  assert.equal(blocked.reasonCode,'product_metadata_integration_unavailable');
  assert.deepEqual(blocked.missingFields,['plot','year']);
});

test('actor-only NFO gap creates a provider Work and becomes ready only after durable cast evidence', () => {
  const actorSnapshot = snapshot(['actor','plot','title','year']);
  const provider = nextMetadataStage(options([
    result(0,'related_nfo',['plot','title','year']),
  ]),actorSnapshot,identity());
  assert.equal(provider.kind,'source');
  assert.equal(provider.source.kind,'provider');
  assert.deepEqual(provider.source.intent.requestedFields,[]);
  assert.deepEqual(provider.missingFields,[]);
  assert.deepEqual(provider.missingCastRoles,['actor']);

  const ready = nextMetadataStage(options([
    result(0,'related_nfo',['plot','title','year']),
    result(1,'provider',[],[Object.freeze({
      role:'actor', displayName:'演员甲', providerIdentities:Object.freeze([]),
    })]),
  ]),actorSnapshot,identity());
  assert.equal(ready.kind,'ready');
  assert.deepEqual(ready.missingFields,[]);
  assert.deepEqual(ready.missingCastRoles,[]);
});

test('provider result without a required actor remains unresolved', () => {
  const unresolved = nextMetadataStage(options([
    result(0,'related_nfo',['plot','title','year']),
    result(1,'provider',[]),
  ]),snapshot(['actor','plot','title','year']),identity());
  assert.equal(unresolved.kind,'unresolved');
  assert.equal(unresolved.reasonCode,'product_metadata_required_cast_missing');
  assert.deepEqual(unresolved.missingCastRoles,['actor']);
});
