'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildEpisodeMetadataBasis } = require('../model/episode-metadata-basis');
const { episodeMetadataIdentityScope } = require('../model/episode-metadata-identity-scope');
const { REVIEW_SCHEMA, MAPPING_SCHEMA, assertReviewRecord, assertMappingRecord } = require('../model/episode-metadata-records');
function fail(code) { throw Object.assign(new Error(code), { code }); }
const common = ['libra_run_id', 'subject_id', 'actor_id', 'idempotency_key', 'request_digest', 'record_schema_ref', 'record_json', 'record_digest', 'created_at_ms'];
const reviewColumns = ['review_id', ...common], mappingColumns = ['intent_id', 'review_id', 'mapping_revision', ...common];
const headColumns = ['subject_id', 'current_revision', 'intent_id', 'record_digest'];

function createEpisodeMetadataMappingStore(options) {
  const statements = {};
  for (const [kind, tableId, columns, key] of [
    ['review', 'libra_episode_metadata_reviews', reviewColumns, 'review_id'],
    ['mapping', 'libra_episode_metadata_mapping_intents', mappingColumns, 'intent_id'],
  ]) {
    statements[kind] = { kind: 'select-one', tableId, columns, keyColumns: [key] };
    statements[kind + '_command'] = { kind: 'select-one', tableId, columns, keyColumns: ['actor_id', 'idempotency_key'] };
    statements['insert_' + kind] = { kind: 'insert', tableId, columns };
  }
  Object.assign(statements, {
    head: { kind: 'select-one', tableId: 'libra_episode_metadata_mapping_heads', columns: headColumns, keyColumns: ['subject_id'] },
    insert_head: { kind: 'insert', tableId: 'libra_episode_metadata_mapping_heads', columns: headColumns },
    advance_head: { kind: 'update', tableId: 'libra_episode_metadata_mapping_heads', setColumns: ['current_revision', 'intent_id', 'record_digest'],
      keyColumns: ['subject_id'], compareColumns: [{ column: 'current_revision', parameter: 'expected_revision' },
        { column: 'intent_id', parameter: 'expected_intent_id' }, { column: 'record_digest', parameter: 'expected_digest' }] },
    run: { kind: 'select-one', tableId: 'libra_runs', keyColumns: ['libra_run_id'],
      columns: ['libra_run_id', 'subject_id', 'state', 'state_revision', 'execution_basis_digest', 'package_revision_head', 'run_material_manifest_id'] },
    subject: { kind: 'select-one', tableId: 'libra_subjects', keyColumns: ['subject_id'], columns: ['subject_id', 'structure_kind', 'content_profile', 'status', 'current_identity_revision'] },
    subject_identity: { kind: 'select-one', tableId: 'libra_product_identity_revisions', keyColumns: ['subject_id', 'revision'], columns: ['subject_id','structure_kind','content_profile','identity_kind','provider_identity_set_digest','identity_digest'] },
    identity: { kind: 'select-one', tableId: 'libra_product_fact_revisions', keyColumns: ['libra_run_id', 'fact_kind', 'fact_revision'], columns: ['fact_digest', 'fact_json'] },
    members: { kind: 'select-all', tableId: 'libra_run_material_members', keyColumns: ['run_material_manifest_id'], columns: ['ordinal', 'material_key', 'role', 'location'] },
    claims: { kind: 'select-all', tableId: 'libra_run_material_episode_claims', keyColumns: ['run_material_manifest_id'], columns: ['member_ordinal', 'episode_key'] },
  });
  const repository = createRepositoryDefinition({ repositoryId: 'libra_episode_metadata_mapping', owner: 'libra', schemaManifest: options.schemaManifest, statements });
  const read = callback => options.unitOfWork.execute([{ participantId: 'episode_mapping_read', owner: 'libra', repositories: [repository],
    execute: context => callback(context.repository(repository.repositoryId)) }]).episode_mapping_read;
  function decode(repo, kind, row) {
    if (!row) return null;
    let value; try { value = JSON.parse(row.record_json); } catch { fail('LIBRA_EPISODE_MAPPING_RECORD_INVALID'); }
    const record = kind === 'review' ? assertReviewRecord(value) : assertMappingRecord(value, getReview(repo, row.review_id));
    if (record.recordId !== row[kind === 'review' ? 'review_id' : 'intent_id'] || record.schemaRef !== row.record_schema_ref ||
        record.recordDigest !== row.record_digest || canonicalJson(record) !== row.record_json ||
        record.libraRunId !== row.libra_run_id || record.subjectId !== row.subject_id || record.actorId !== row.actor_id ||
        record.idempotencyKey !== row.idempotency_key || record.requestDigest !== row.request_digest ||
        kind === 'mapping' && record.mapping.revision !== row.mapping_revision) fail('LIBRA_EPISODE_MAPPING_RECORD_INVALID');
    return record;
  }
  function getReview(repo, reviewId) {
    const value = decode(repo, 'review', repo.invoke('review', { review_id: reviewId }));
    if (!value) fail('LIBRA_EPISODE_REVIEW_NOT_FOUND');
    return value;
  }
  function current(repo, subjectId) {
    const head = repo.invoke('head', { subject_id: subjectId });
    if (!head) return null;
    const record = decode(repo, 'mapping', repo.invoke('mapping', { intent_id: head.intent_id }));
    if (!record || record.subjectId !== subjectId || record.mapping.revision !== head.current_revision || record.recordDigest !== head.record_digest)
      fail('LIBRA_EPISODE_MAPPING_RECORD_INVALID');
    return record;
  }
  function assertCurrentBasis(repo, review, expectedMappingRevision = review.expectedMappingRevision) {
    const run = repo.invoke('run', { libra_run_id: review.libraRunId }), subject = repo.invoke('subject', { subject_id: review.subjectId });
    if (!run || !subject || run.subject_id !== subject.subject_id || subject.status !== 'active' || subject.content_profile !== 'series' ||
        subject.structure_kind !== 'season' || !['active', 'suspended', 'frozen'].includes(run.state) ||
        run.state_revision !== review.runStateRevision || run.execution_basis_digest !== review.runExecutionBasisDigest)
      fail('LIBRA_EPISODE_REVIEW_STALE');
    if (run.package_revision_head !== 0) fail('LIBRA_EPISODE_MAPPING_HANDOFF_CONFLICT');
    if (!subject.current_identity_revision || repo.invoke('subject_identity', {
      subject_id: subject.subject_id, revision: subject.current_identity_revision })?.identity_digest !== review.identityDigest)
      fail('LIBRA_EPISODE_MAPPING_IDENTITY');
    const identity = repo.invoke('identity', { libra_run_id: review.libraRunId, fact_kind: 'resolved_identity', fact_revision: 1 });
    if (!identity || identity.fact_digest !== review.identityDigest) fail('LIBRA_EPISODE_MAPPING_IDENTITY');
    const claims = repo.invoke('claims', { run_material_manifest_id: run.run_material_manifest_id });
    const members = repo.invoke('members', { run_material_manifest_id: run.run_material_manifest_id }).map(member => ({
      materialKey: member.material_key, role: member.role, location: member.location,
      episodeClaims: claims.filter(claim => claim.member_ordinal === member.ordinal).map(claim => ({ episodeKey: claim.episode_key })),
    }));
    const episodeKeys = [...new Set(claims.map(claim => claim.episode_key))].sort();
    const basis = buildEpisodeMetadataBasis({ spec: { contentProfile: 'series', productScope: { episodeKeys } },
      run: { subjectId: run.subject_id, libraRunId: run.libra_run_id, executionBasisDigest: run.execution_basis_digest, stateRevision: run.state_revision },
      members, episodeClaims: episodeKeys.map(episodeKey => ({ episodeKey })) }, { factValue: JSON.parse(identity.fact_json) });
    if (basis.identityDigest !== review.identityDigest || basis.providerKey !== review.providerKey || basis.materialSetDigest !== review.materialSetDigest ||
        canonicalDigest(basis.members.map(({ materialKey, localScope }) => ({ materialKey, localScope }))) !==
          canonicalDigest(review.members.map(({ materialKey, localScope }) => ({ materialKey, localScope })))) fail('LIBRA_EPISODE_MAPPING_MATERIAL');
    if ((current(repo, review.subjectId)?.mapping.revision || 0) !== expectedMappingRevision) fail('LIBRA_EPISODE_REVIEW_STALE');
  }
  return Object.freeze({
    readReview: reviewId => read(repo => getReview(repo, reviewId)),
    readReference: reference => read(repo => {
      const ref = require('../../../contracts/episode-metadata-mapping-reference').buildEpisodeMetadataMappingReference(reference);
      const record = decode(repo, 'mapping', repo.invoke('mapping', { intent_id: ref.intentId }));
      if (!record || record.recordDigest !== ref.recordDigest || record.mapping.mappingDigest !== ref.mappingDigest || record.mapping.revision !== ref.mappingRevision)
        fail('LIBRA_EPISODE_MAPPING_REFERENCE_INVALID');
      return record;
    }),
    admissionValidation(basis, replacementRunId, onValidated) {
      return { participantId: 'episode_mapping_admission', owner: 'libra', readOnly: true, repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const ref = require('../../../contracts/episode-metadata-mapping-reference').buildEpisodeMetadataMappingReference(basis.episodeMetadataMappingRef);
        const record = current(repo, basis.subjectSnapshot.subjectId);
        if (!record || record.recordId !== ref.intentId || record.recordDigest !== ref.recordDigest ||
            record.mapping.mappingDigest !== ref.mappingDigest || record.mapping.revision !== ref.mappingRevision)
          fail('LIBRA_EPISODE_MAPPING_REFERENCE_INVALID');
        const review = getReview(repo, record.reviewId).review;
        const subject = repo.invoke('subject', { subject_id: record.subjectId });
        const identity=subject?.current_identity_revision?repo.invoke('subject_identity', {
          subject_id: record.subjectId, revision: subject.current_identity_revision }):null;
        if (!identity || episodeMetadataIdentityScope({subjectId:identity.subject_id,structureKind:identity.structure_kind,
          contentProfile:identity.content_profile,identityKind:identity.identity_kind,providerIdentitySetDigest:identity.provider_identity_set_digest})!==record.mapping.identityScopeDigest)
          fail('LIBRA_EPISODE_MAPPING_IDENTITY');
        const old = replacementRunId ? repo.invoke('run', { libra_run_id: replacementRunId }) : null;
        if (old?.state === 'frozen') {
          if (record.libraRunId !== replacementRunId) fail('LIBRA_EPISODE_REVIEW_STALE');
          assertCurrentBasis(repo, review, record.mapping.revision);
        }
        const members = basis.productionMaterialManifest.members.filter(member => member.role === 'primary_payload').map(member => {
          if (member.episodeClaims.length !== 1) fail('LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED');
          const local = review.members.find(item => item.materialKey === member.materialKey && item.localScope.episodeKey === member.episodeClaims[0].episodeKey);
          if (!local) fail('LIBRA_EPISODE_MAPPING_MATERIAL');
          return { materialKey: member.materialKey, localScope: local.localScope };
        }).sort((a, b) => a.localScope.seasonNumber - b.localScope.seasonNumber || a.localScope.episodeNumber - b.localScope.episodeNumber);
        if (canonicalDigest({ schema: 'libra.episode-metadata-material-set@1', members }) !== record.mapping.materialSetDigest)
          fail('LIBRA_EPISODE_MAPPING_MATERIAL');
        onValidated(record);
        return { intentId: record.recordId };
      } };
    },
    current: subjectId => read(repo => current(repo, subjectId)),
    findCommand: (kind, actorId, idempotencyKey) => read(repo => decode(repo, kind, repo.invoke(kind + '_command', { actor_id: actorId, idempotency_key: idempotencyKey }))),
    participant(kind, record) {
      if (!['review', 'mapping'].includes(kind)) fail('LIBRA_EPISODE_MAPPING_RECORD_INVALID');
      return { participantId: 'episode_mapping_commit', owner: 'libra', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const review = kind === 'review' ? assertReviewRecord(record).review : getReview(repo, record.reviewId).review;
        if (kind === 'mapping') assertMappingRecord(record, getReview(repo, record.reviewId));
        assertCurrentBasis(repo, review);
        const values = { libra_run_id: record.libraRunId, subject_id: record.subjectId, actor_id: record.actorId,
          idempotency_key: record.idempotencyKey, request_digest: record.requestDigest,
          record_schema_ref: kind === 'review' ? REVIEW_SCHEMA : MAPPING_SCHEMA, record_json: canonicalJson(record), record_digest: record.recordDigest, created_at_ms: context.commitTimeMs };
        repo.invoke('insert_' + kind, kind === 'review' ? { ...values, review_id: record.recordId } :
          { ...values, intent_id: record.recordId, review_id: record.reviewId, mapping_revision: record.mapping.revision });
        options.afterInsert?.(kind);
        if (kind === 'mapping') {
          const head = repo.invoke('head', { subject_id: record.subjectId });
          const next = { subject_id: record.subjectId, current_revision: record.mapping.revision, intent_id: record.recordId, record_digest: record.recordDigest };
          if (!head) repo.invoke('insert_head', next);
          else if (repo.invoke('advance_head', { ...next, expected_revision: head.current_revision,
            expected_intent_id: head.intent_id, expected_digest: head.record_digest }).changes !== 1) fail('LIBRA_EPISODE_REVIEW_STALE');
        }
        return { recordId: record.recordId, recordDigest: record.recordDigest, subjectId: record.subjectId, libraRunId: record.libraRunId,
          kind, revision: kind === 'mapping' ? record.mapping.revision : review.expectedMappingRevision,
          evidenceDigest: kind === 'mapping' ? record.mapping.mappingDigest : review.reviewDigest };
      } };
    },
  });
}

module.exports = Object.freeze({ createEpisodeMetadataMappingStore });
