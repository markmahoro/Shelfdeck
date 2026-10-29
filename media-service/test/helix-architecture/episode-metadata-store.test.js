'use strict';

const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, schemaManifest, D, Database } = require('./fixtures/us-adult-analysis-basis-harness');
const { canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createEpisodeMetadataMappingStore } = require('../../src/helix/domains/libra/persistence/episode-metadata-mapping-store');
const { createEpisodeMetadataMappingService } = require('../../src/helix/domains/libra/application/episode-metadata-mapping-service');

function harness(callback, hooks = {}) {
  return fixture(async input => {
    const db = new Database(input.databasePath);
    try {
      const factValue = { subjectId: 'subject-1', contentProfile: 'series', structureKind: 'season', identityDigest: D('show'), identityKind:'tmdb_series_season',providerIdentitySetDigest:D('provider-set'),
        providerIdentities: [{ provider: 'tmdb', namespace: 'tmdb_series', providerKey: '999', seasonNumber: 2 }] };
      db.exec("INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision) VALUES('subject-1','season','series','active',1)");
      db.prepare('INSERT INTO libra_product_identity_revisions(subject_id,revision,identity_digest,structure_kind,content_profile,identity_kind,provider_identity_set_digest) VALUES(?,?,?,?,?,?,?)').run('subject-1', 1, factValue.identityDigest,'season','series','tmdb_series_season',factValue.providerIdentitySetDigest);
      db.exec('UPDATE libra_subjects SET current_identity_revision=1');
      db.exec("UPDATE libra_runs SET subject_id='subject-1',state='frozen'; INSERT INTO libra_run_material_episode_claims(run_material_manifest_id,member_ordinal,episode_key) VALUES('manifest-1',0,'E009')");
      db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,schema_ref,fact_json,fact_digest,result_digest) VALUES(?,?,?,?,?,?,?,?)')
        .run('identity-fact', 'run-1', 'resolved_identity', 1, 'fixture', canonicalJson(factValue), factValue.identityDigest, D('result'));
      const snapshot = { spec: { contentProfile: 'series', productScope: { episodeKeys: ['E009'] } },
        run: { libraRunId: 'run-1', subjectId: 'subject-1', state: 'frozen', stateRevision: 1, executionBasisDigest: D('basis'), packageRevisionHead: 0 },
        episodeClaims: [{ episodeKey: 'E009' }], members: [{ materialKey: 'material-1', role: 'primary_payload', location: '/source/Local.S02E09.mkv', episodeClaims: [{ episodeKey: 'E009' }] }] };
      let observations = 0, online = true;
      const options = { ...input, schemaManifest, ...hooks, now: () => 200,
        movieProductionReader: { readRunSnapshot: () => snapshot, readFact: () => ({ factValue }) },
        async observeEpisodeMetadataCandidates() {
          observations++; if (!online) throw new Error('Provider offline');
          return { integrationId: 'tmdb', configRevision: 1, language: 'zh-CN', episodes: [{
            providerEpisode: { provider: 'tmdb', providerKey: '999', seasonNumber: 0, episodeNumber: 1, episodeId: 501 },
            title: 'Synthetic special', airDate: '2011-12-25', plot: 'Fixture evidence only', observedAtMs: 100,
          }] };
        } };
      const store = createEpisodeMetadataMappingStore(options);
      const service = createEpisodeMetadataMappingService({ ...options, episodeMetadataMappingStore: store });
      await callback({ db, store, service, snapshot, factValue, unitOfWork:input.unitOfWork, observations: () => observations, offline: () => { online = false; } });
    } finally { db.close(); }
  });
}
const inspectBody = { idempotencyKey: 'review-1', expectedRunStateRevision: 1, expectedMappingRevision: 0, providerSeasons: [0] };
async function review(h) {
  const result = await h.service.inspect('run-1', inspectBody, 'admin');
  const value = result.reviewRecord.review;
  return { idempotencyKey: 'confirm-1', reviewId: result.reviewRecord.recordId, reviewDigest: value.reviewDigest,
    choices: [{ materialKey: 'material-1', localScope: value.members[0].localScope, evidenceDigest: value.evidence[0].evidenceDigest }] };
}

test('native SQLite stores explicit special mapping, preserves local number and replays without re-querying Provider', () => harness(async h => {
  const body = await review(h); const confirmed = h.service.confirm('run-1', body, 'admin');
  const current = h.store.current('subject-1');
  assert.equal(current.mapping.entries[0].localScope.seasonNumber, 2);
  assert.equal(current.mapping.entries[0].localScope.episodeNumber, 9);
  assert.equal(current.mapping.entries[0].providerEpisode.seasonNumber, 0);
  h.offline(); h.db.exec("UPDATE libra_runs SET state='completed',state_revision=2");
  assert.equal((await h.service.inspect('run-1', inspectBody, 'admin')).replayed, true);
  const replay = h.service.confirm('run-1', body, 'admin');
  assert.equal(replay.replayed, true); assert.deepEqual(replay.receipt, confirmed.receipt);
  assert.equal(h.observations(), 1);
  assert.throws(() => h.service.confirm('run-1', { ...body, choices: [] }, 'admin'), { code: 'P3_COMMAND_IDEMPOTENCY_CONFLICT' });
}));

test('Run, material, identity, head and delivery changes reject stale confirmation without changing the mapping', () => harness(async h => {
  const body = await review(h);
  for (const [change, restore, code] of [
    ["UPDATE libra_runs SET state_revision=2", "UPDATE libra_runs SET state_revision=1", 'LIBRA_EPISODE_REVIEW_STALE'],
    ["UPDATE libra_runs SET package_revision_head=1", "UPDATE libra_runs SET package_revision_head=0", 'LIBRA_EPISODE_MAPPING_HANDOFF_CONFLICT'],
    ["UPDATE libra_runs SET execution_basis_digest='" + D('changed') + "'", "UPDATE libra_runs SET execution_basis_digest='" + D('basis') + "'", 'LIBRA_EPISODE_REVIEW_STALE'],
    ["UPDATE libra_product_identity_revisions SET identity_digest='"+D('different identity')+"'", "UPDATE libra_product_identity_revisions SET identity_digest='"+D('show')+"'", 'LIBRA_EPISODE_MAPPING_IDENTITY'],
    ["UPDATE libra_run_material_episode_claims SET episode_key='E010'", "UPDATE libra_run_material_episode_claims SET episode_key='E009'", 'LIBRA_EPISODE_MAPPING_MATERIAL'],
  ]) {
    h.db.exec(change); assert.throws(() => h.service.confirm('run-1', body, 'admin'), { code }); h.db.exec(restore);
  }
  h.service.confirm('run-1', body, 'admin');
  assert.throws(() => h.service.confirm('run-1', { ...body, idempotencyKey: 'another' }, 'admin'), { code: 'LIBRA_EPISODE_REVIEW_STALE' });
  assert.equal(h.db.prepare('SELECT count(*) n FROM libra_episode_metadata_mapping_intents').get().n, 1);
}));

test('an interrupted confirmation rolls back Intent, head and all command evidence', () => harness(async h => {
  const body = await review(h), tables = ['libra_episode_metadata_mapping_intents', 'libra_episode_metadata_mapping_heads', 'fx_command_receipts', 'fx_commit_markers', 'fx_audit_records'];
  const before = tables.map(table => h.db.prepare('SELECT count(*) n FROM ' + table).get().n);
  assert.throws(() => h.service.confirm('run-1', body, 'admin'), /injected confirmation interruption/);
  assert.deepEqual(tables.map(table => h.db.prepare('SELECT count(*) n FROM ' + table).get().n), before);
}, { afterInsert(kind) { if (kind === 'mapping') throw new Error('injected confirmation interruption'); } }));

test('frozen Run admission validates the exact confirmation and rejects drift before replacement',()=>harness(async h=>{
  const body=await review(h);h.service.confirm('run-1',body,'admin');const record=h.store.current('subject-1');
  const reference={intentId:record.recordId,recordDigest:record.recordDigest,mappingDigest:record.mapping.mappingDigest,mappingRevision:record.mapping.revision};
  const basis={subjectSnapshot:{subjectId:'subject-1'},episodeMetadataMappingRef:reference,productionMaterialManifest:{members:[
    {role:'primary_payload',materialKey:'material-1',episodeClaims:[{episodeKey:'E009'}]},
    {role:'nfo',materialKey:'related-not-a-primary',episodeClaims:[]},
  ]}};
  let authorized;
  const validate=()=>h.unitOfWork.execute([h.store.admissionValidation(basis,'run-1',value=>{authorized=value;})]);
  validate();assert.equal(authorized.recordId,record.recordId);
  h.db.exec('UPDATE libra_runs SET state_revision=2');
  assert.throws(validate,{code:'LIBRA_EPISODE_REVIEW_STALE'});h.db.exec('UPDATE libra_runs SET state_revision=1');
  basis.productionMaterialManifest.members[0].episodeClaims=[{episodeKey:'E010'}];
  assert.throws(validate,{code:'LIBRA_EPISODE_MAPPING_MATERIAL'});basis.productionMaterialManifest.members[0].episodeClaims=[{episodeKey:'E009'}];
  basis.episodeMetadataMappingRef={...reference,recordDigest:D('forged')};
  assert.throws(validate,{code:'LIBRA_EPISODE_MAPPING_REFERENCE_INVALID'});
}));

test('execution uses the frozen mapping version across fresh identity evidence and rejects another show or local Season',()=>harness(async h=>{
  const body=await review(h);h.service.confirm('run-1',body,'admin');const record=h.store.current('subject-1');
  const snapshot=structuredClone(h.snapshot);
  snapshot.run.libraRunId='replacement';snapshot.run.episodeMetadataMappingRef={intentId:record.recordId,recordDigest:record.recordDigest,
    mappingDigest:record.mapping.mappingDigest,mappingRevision:record.mapping.revision};
  const {resolveEpisodeMetadataQuery}=require('../../src/helix/domains/libra/model/episode-metadata-selection');
  const identity={factValue:{...h.factValue,identityDigest:D('fresh same-identity evidence')}};
  const query=()=>resolveEpisodeMetadataQuery({episodeMetadataMappingStore:h.store},snapshot,identity,h.snapshot.members[0]&&body.choices[0].localScope);
  assert.equal(query().providerEpisode.seasonNumber,0);
  assert.equal(record.mapping.identityDigest,D('show'));
  identity.factValue.providerIdentitySetDigest=D('different season identity');
  assert.throws(query,{code:'LIBRA_EPISODE_MAPPING_STALE'});
}));

test('a mapped Run cannot omit its confirmed Episode input to query local numbering',()=>harness(async h=>{
  const body=await review(h);h.service.confirm('run-1',body,'admin');const record=h.store.current('subject-1');
  const snapshot=structuredClone(h.snapshot);
  snapshot.run.episodeMetadataMappingRef={intentId:record.recordId,recordDigest:record.recordDigest,
    mappingDigest:record.mapping.mappingDigest,mappingRevision:record.mapping.revision};
  const identity={...h.factValue.providerIdentities[0]};
  identity.identityAnchorDigest=require('../../src/helix/contracts/canonical-json').canonicalDigest(identity);
  const intent=require('../../src/helix/domains/libra/model/product-fact-contracts').buildMetadataFetchIntent({
    libraRunId:'run-1',runExecutionBasisDigest:D('basis'),sourceKind:'provider',sourcePriority:0,
    contentProfile:'series',resolvedIdentityDigest:h.factValue.identityDigest,requestedFields:['episode_plot'],
    providerKind:'tmdb',resolvedProviderIdentity:identity,integrationId:'tmdb',configRevision:1,
    episodeScope:body.choices[0].localScope,
  });
  let requests=0;
  const port=require('../../src/helix/domains/libra/capabilities/product-metadata-capability-ports').createProductMetadataCapabilityPorts({
    episodeMetadataMappingStore:h.store,
    movieProductionReader:{readRunSnapshot:()=>snapshot,readFact:()=>({factValue:h.factValue})},
    productProductionPort:{readRelatedNfo(){throw Error('Unexpected NFO access');},async fetchProvider(){requests++;throw Error('Unexpected Provider request');}},
  })['libra.product_metadata.fetch@1'];
  await assert.rejects(port.execute({ownerScope:{processId:'run-1'},namedInputs:{metadataFetchIntent:intent,
    physicalMaterialReadHandleOrIntegrationHandle:{integrationId:'tmdb',configRevision:1}}}),
    {code:'LIBRA_EPISODE_MAPPING_AUTHORITY_REQUIRED'});
  assert.equal(requests,0);
}));
