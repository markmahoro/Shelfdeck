'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { assertProbeEvidence } = require('../model/media-production-contracts');
const { sourceMediaObservationWork } = require('./media-production-work');
const { createProductionSourceScopeResolver } = require('./production-source-scope-resolver');

function readSourceMediaObservations(options, snapshot) {
  const resolver = createProductionSourceScopeResolver({movieProductionReader:options.movieProductionReader,
    productionPort:options.productProductionPort});
  const sources = resolver.primarySources(snapshot);
  const records = options.workResultReader.read(sourceMediaObservationWork(snapshot).workId)
    .filter(item => item.outcomeKind === 'succeeded' && item.capabilityRef === 'shared.material.media.probe@1');
  const byHandle = new Map();
  for (const record of records) {
    assertProbeEvidence(record.result);
    const key = record.result.sourceHandleDigest;
    if (byHandle.has(key)) throw new Error('Source media observations duplicate a Primary Handle.');
    byHandle.set(key, record);
  }
  if (records.length !== sources.length || sources.some(item => !byHandle.has(canonicalDigest(item.readHandle)))) {
    throw new Error('Source media observations do not exactly cover the frozen Primary Handle set.');
  }
  return Object.freeze(sources.map(item => Object.freeze({...item,
    record:byHandle.get(canonicalDigest(item.readHandle))})));
}

module.exports = Object.freeze({readSourceMediaObservations});
