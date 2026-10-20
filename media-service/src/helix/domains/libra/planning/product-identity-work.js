'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { subjectRatingTarget } = require('../model/subject-rating-target');
const { frozenSeriesSeasonNumber } = require('../model/series-identity-contracts');

const IDENTITY_EVIDENCE_RESULT =
  'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result';
const IDENTITY_RESULT =
  'helix://contracts/capabilities/libra.product_identity.resolve/v1/result';

function stable(prefix, value) {
  return prefix + canonicalDigest(value).slice(0, 40);
}

function definition(snapshot, stage, outputContractRef, dependencyRefs = [], source = null) {
  const basis = {
    libraRunId: snapshot.run.libraRunId,
    executionBasisDigest: snapshot.run.executionBasisDigest,
    acceptanceSpecId: snapshot.run.acceptanceSpecId,
    stage,
    sourceWorkId: source?.workId || null,
    sourceResultDigest: source?.resultDigest || null,
  };
  return Object.freeze({
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1',
    schemaVersion: 1,
    workId: stable('libra-product-identity-' + stage + '-work-', basis),
    ownerDomain: 'libra',
    processType: 'libra_run',
    processId: snapshot.run.libraRunId,
    workKind: 'product_identity',
    workObjectiveTypeRef:
      'helix://libra/work/product-identity-' + stage.replaceAll('_', '-') + '/v1',
    workObjectiveVersion: 1,
    executionBasisId: stable('libra-product-identity-' + stage + '-basis-', basis),
    executionBasisDigest: snapshot.run.executionBasisDigest,
    dependencyRefs: Object.freeze(dependencyRefs),
    priorityClass: snapshot.run.priorityClass === 'expedited'
      ? 'expedited_formation' : 'normal_foreground',
    priorityRevision: snapshot.run.priorityRevision || 1,
    capabilityCatalogScope: 'libra',
    workspaceMaterialScope: Object.freeze([]),
    idempotencyKey: stable('libra-product-identity-' + stage + '-key-', basis),
    concurrencyScope: snapshot.run.libraRunId + '/product-identity/' + stage,
    outputContractRef,
  });
}

function establishedSubjectIdentity(options, snapshot) {
  const context = options.routingContextReader?.read(snapshot.run.subjectId);
  if (!context?.rows?.identity) return null;
  if(snapshot.spec?.contentProfile==='series'||context.subject?.contentProfile==='series') {
    const identity=context.rows.identity,display=JSON.parse(identity.display_identity);
    const values=new Map((display.entries||[]).map(item=>[item.key,item.value]));
    if(context.subject.subjectId!==snapshot.run.subjectId||identity.identity_kind!=='tmdb_series_season'||
        identity.identity_digest!==context.subject.currentIdentityDigest||
        display.recordDigest!==canonicalDigest(Object.fromEntries(Object.entries(display).filter(([key])=>key!=='recordDigest')))||
        values.get('season_number')!==frozenSeriesSeasonNumber(snapshot)||
        typeof values.get('tmdb_series_id')!=='string'||!/^\d+$/.test(values.get('tmdb_series_id'))||
        typeof values.get('title')!=='string'||!values.get('title').trim())
      throw new Error('Established Series identity does not conserve the frozen Subject and Season.');
    return Object.freeze({workId:stable('libra-established-subject-identity-',{subjectId:snapshot.run.subjectId,revision:Number(identity.revision)}),
      resultDigest:identity.identity_digest,providerKey:values.get('tmdb_series_id'),title:values.get('title'),
      year:values.has('year')?Number(values.get('year')):null});
  }
  const target = subjectRatingTarget(context);
  if (!target?.providerIdentity?.startsWith('tmdb:')) return null;
  const identity = context.rows.identity;
  if (context.subject.subjectId !== snapshot.run.subjectId) throw new Error('Product Identity belongs to another Subject.');
  return Object.freeze({
    workId: stable('libra-established-subject-identity-', { subjectId: snapshot.run.subjectId, revision: Number(identity.revision) }),
    resultDigest: identity.identity_digest,
    providerKey: target.providerIdentity.slice(5), title: target.title, year: target.year,
  });
}

function identityObservationWork(snapshot, sourceKind = 'provider_search', source = null) {
  if (!['related_nfo', 'provider_exact', 'provider_search','internal_source'].includes(sourceKind)) {
    throw new TypeError('Product Identity observation source kind is invalid.');
  }
  return definition(snapshot, 'observation_' + sourceKind, IDENTITY_EVIDENCE_RESULT, [], source);
}

function identityCommitWork(snapshot, source) {
  if (!source || typeof source.workId !== 'string' ||
      typeof source.resultDigest !== 'string') {
    throw new TypeError('Product Identity commit Work requires its exact observation Result.');
  }
  const observation = Object.freeze({ workId:source.workId, executionBasisDigest:snapshot.run.executionBasisDigest });
  const dependency = Object.freeze({
    ownerDomain: 'libra',
    objectType: 'supporting_work',
    objectId: observation.workId,
    revision: 1,
    digest: observation.executionBasisDigest,
  });
  return definition(snapshot, 'commit', IDENTITY_RESULT, [dependency], source);
}

module.exports = Object.freeze({
  establishedSubjectIdentity,
  IDENTITY_RESULT,
  IDENTITY_EVIDENCE_RESULT,
  identityCommitWork,
  identityObservationWork,
});
