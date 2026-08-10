'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCandidatePublicationCapability } = require('../../src/helix/domains/procurement/capabilities/candidate-publication');
const { buildPublication } = require('../../src/helix/domains/procurement/model/candidate-publication-contracts');
const { buildQuery, createCandidateDeliveryService } = require('../../src/helix/domains/procurement/application/candidate-delivery-service');
const { createCandidateDeliveryReader } = require('../../src/helix/domains/procurement/persistence/candidate-delivery-reader');
const { createCandidatePublicationStore } = require('../../src/helix/domains/procurement/persistence/candidate-publication-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const D = (value) => canonicalDigest({ value });
const without = (value, ...fields) => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

function candidateDraft(options = {}) {
  const suffix = options.suffix || '';
  const tag = suffix ? '-' + suffix : '';
  const inode = options.inode || '41';
  const referenceCount = options.referenceCount === undefined ? 1 : options.referenceCount;
  const physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,mountScopeId:'mount-1',inode,sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('material-content'+tag)};
  physicalIdentity.materialKey=canonicalDigest({schema:'physical-material-identity@2',mountScopeId:physicalIdentity.mountScopeId,inode:physicalIdentity.inode,sizeBytes:physicalIdentity.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:physicalIdentity.contentFingerprint});
  const materialKey = physicalIdentity.materialKey;
  const episodeBase = { episodeKey:'E'+String((options.ordinal || 0) + 1).padStart(3, '0'), seasonClaimDigest:D('season'), claimDigest:'' };
  episodeBase.claimDigest = canonicalDigest(without(episodeBase, 'claimDigest'));
  const member = { materialKey, bindingRevision:1, admittedControlRevision:1, admittedControlProjectionDigest:D('control'),
    role:'primary_payload', episodeClaims:[episodeBase], memberClaimDigest:'' };
  member.memberClaimDigest = canonicalDigest(without(member, 'memberClaimDigest'));
  const metadata = { claimedTitle:'Series One'+tag, seasonClaim:{ claimKind:'explicit_number', seasonNumber:1, claimDigest:D('season-claim'+tag) },
    contentProfileHint:'series', sourceHints:[{ hintKind:'filename_title', hintValue:'Series.One'+tag, evidenceDigest:D('hint'+tag) }],
    metadataDigest:'' };
  metadata.metadataDigest = canonicalDigest(without(metadata, 'metadataDigest'));
  const identityPayload = { claimKind:'series_season', mediaType:'group', contentProfile:'series', claimedTitle:metadata.claimedTitle,
    displayIdentity:metadata.claimedTitle, seasonClaim:metadata.seasonClaim, identityMetadataDigest:metadata.metadataDigest,
    structureUnitDigest:'', sourceHints:metadata.sourceHints };
  const relatedReferences = Array.from({ length:referenceCount }, (_, index) => {
    const referenceIdentity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
      materialKey:'', mountScopeId:'mount-1', inode:String(10000 + Number(inode) + index), sizeBytes:50 + index,
      fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:D('reference-content'+tag+'-'+index) };
    referenceIdentity.materialKey = canonicalDigest({ schema:'physical-material-identity@2', mountScopeId:referenceIdentity.mountScopeId,
      inode:referenceIdentity.inode, sizeBytes:referenceIdentity.sizeBytes, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
      contentFingerprint:referenceIdentity.contentFingerprint });
    const reference = { referenceId:'', primaryMaterialKey:materialKey, role:'nfo', identity:referenceIdentity,
      endpointId:'endpoint-1', location:'/field/series'+tag+'-'+String(index).padStart(4,'0')+'.nfo',
      fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:referenceIdentity.contentFingerprint,
      associationEvidenceDigest:D('reference-evidence'+tag+'-'+index), referenceDigest:'' };
    reference.referenceId = canonicalDigest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey:materialKey,
      role:reference.role, relatedMaterialKey:referenceIdentity.materialKey, endpointId:reference.endpointId, location:reference.location });
    reference.referenceDigest = canonicalDigest(without(reference, 'referenceDigest'));
    return reference;
  }).sort((left, right) => Buffer.compare(Buffer.from(left.referenceId), Buffer.from(right.referenceId)));
  const relatedScopeBase = { scopeKind:'ordinary_parent', parentRelativeLocation:'field', stemKey:'series', associationMode:'multi_movie_directory',
    observationProjectionRevision:1, relatedRuleRevision:1 };
  const relatedScope = { ...relatedScopeBase, scopeDigest:canonicalDigest({ schema:'procurement.related-scope@1', ...relatedScopeBase }) };
  const continuity = [];
  const continuityDigest = canonicalDigest({ schema:'season-continuity-claim-set@1', items:continuity });
  const unit = { unitId:'', mediaType:'group', contentProfile:'series', structureKind:'season', displayIdentity:metadata.claimedTitle,
    identityMetadata:metadata, seasonContinuityClaims:continuity, seasonContinuityClaimSetDigest:continuityDigest,
    members:[member], relatedScope, materialInputForm:'stream_file', unitDigest:'' };
  unit.unitId = canonicalDigest({ schema:'procurement.triage-unit-id@1', mediaType:unit.mediaType, contentProfile:unit.contentProfile,
    structureKind:unit.structureKind, materialInputForm:unit.materialInputForm, relatedScope:unit.relatedScope,
    members:unit.members.map(({ materialKey:key, role, episodeClaims }) => ({ materialKey:key, role, episodeClaims })) });
  unit.unitDigest = canonicalDigest(without(unit, 'unitDigest'));
  identityPayload.structureUnitDigest = unit.unitDigest;
  const identityClaim = { schemaRef:'helix://contracts/types/IdentityClaim/v1', schemaVersion:1, draftId:'identity-1'+tag,
    draftKind:'procurement_identity_claim', basisDigest:D('identity-basis'), draftDigest:'', producedAtMs:1,
    ...identityPayload, claimDigest:'' };
  identityClaim.claimDigest = canonicalDigest(identityPayload); identityClaim.draftDigest = identityClaim.claimDigest;
  const manifestMembers = [{ ordinal:0, materialKey, role:member.role, physicalIdentity,sizeBytes:100,bindingRevision:1, admittedControlRevision:1,
    admittedControlProjectionDigest:member.admittedControlProjectionDigest, episodeClaims:member.episodeClaims }];
  const manifestPayload = { preallocatedManifestId:'manifest-1'+tag, procurementRunId:'run-1', runBasisDigest:D('run-basis'),
    structureEvidencePayloadDigest:D('structure-evidence'), unitId:unit.unitId, structureKind:'season', memberCount:1,
    members:manifestMembers,
    membersDigest:canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:manifestMembers }), memberSourceDigest:unit.unitDigest };
  const manifestDraftDigest = canonicalDigest(manifestPayload);
  const manifestDraft = { schemaRef:'helix://contracts/types/PrimaryInputManifestDraft/v1', schemaVersion:1, draftId:'manifest-draft-1'+tag,
    draftKind:'procurement_primary_input_manifest', basisDigest:D('manifest-basis'), draftDigest:manifestDraftDigest, producedAtMs:1,
    ...manifestPayload, manifestDraftDigest };
  const value = { draftId:'candidate-draft-1'+tag, draftKind:'procurement_candidate', basisDigest:D('candidate-basis'+tag), draftDigest:'',
    producedAtMs:1, candidatePackageId:'candidate-1'+tag, procurementRunId:'run-1', runBasisDigest:D('run-basis'),
    triageRule:{ ruleRef:'procurement.triage.default', revision:1, authorityDigest:D('authority') },
    materialFieldContextRef:{ fieldId:'field-1', accessRevision:1, contextDigest:D('context') }, mediaType:'group', contentProfile:'series',
    materialInputForm:'stream_file',
    displayIdentity:metadata.claimedTitle, identityMetadata:metadata, identityClaim,
    structureEvidence:{ evidenceId:'structure-1', payloadDigest:D('structure-evidence'), unit }, primaryInputManifestDraft:manifestDraft,
    seasonContinuityClaims:continuity, seasonContinuityClaimSetDigest:continuityDigest, relatedReferences,
    relatedReferenceSetDigest:canonicalDigest({ schema:'procurement.related-reference-set@1', items:relatedReferences }),
    memberControlEvidenceSetDigest:canonicalDigest({ schema:'procurement.candidate-member-control-evidence@1',
      items:[{ materialKey, admittedControlRevision:1, admittedControlProjectionDigest:member.admittedControlProjectionDigest }] }),
    candidateDraftDigest:'' };
  value.candidateDraftDigest = canonicalDigest(without(value, 'draftDigest', 'candidateDraftDigest'));
  value.draftDigest = value.candidateDraftDigest;
  return value;
}

function handle(draft) {
  return { schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1', schemaVersion:1, handleId:'candidate-handle-1',
    ownerDomain:'procurement', aggregateType:'candidate_package', aggregateId:draft.candidatePackageId, factType:'CandidateDraft',
    factSchemaRef:'helix://contracts/domain-types/CandidateDraft/v1', expectedRevision:0,
    payloadDigest:canonicalDigest(draft), resultSchemaRef:'helix://contracts/types/CandidatePublicationReceipt/v1',
    commitIdempotencyKey:'candidate-publish-1', eventFenceDigest:D('event-fence') };
}

function seed(database, draft, options = {}) {
  const initialize = options.initialize !== false;
  const ordinal = options.ordinal || 0;
  database.pragma('foreign_keys = OFF');
  database.prepare('INSERT INTO fx_workflow_events(event_id) VALUES(?)').run('candidate-event-'+draft.candidatePackageId);
  if (initialize) {
    database.prepare('INSERT INTO proc_material_fields(field_id,status,current_access_revision) VALUES(?,?,?)').run('field-1','active',1);
    database.prepare('INSERT INTO proc_field_access_revisions(field_id,revision,access_digest) VALUES(?,?,?)').run('field-1',1,D('access'));
    database.prepare(`INSERT INTO proc_procurement_runs(procurement_run_id,field_id,access_revision,triage_rule_ref,triage_rule_revision,
      triage_rule_authority_digest,run_basis_digest,state,state_revision,candidate_package_revision_head) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      'run-1','field-1',1,draft.triageRule.ruleRef,1,draft.triageRule.authorityDigest,draft.runBasisDigest,'active',1,0);
  }
  const member = draft.structureEvidence.unit.members[0];
  const physicalIdentity=draft.primaryInputManifestDraft.members[0].physicalIdentity;
  database.prepare(`INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,binding_revision,admitted_control_revision,
    admitted_control_projection_digest,selection_state,candidate_package_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'run-1',ordinal,member.materialKey,physicalIdentity.mountScopeId,physicalIdentity.inode,physicalIdentity.sizeBytes,physicalIdentity.fingerprintAlgorithm,physicalIdentity.fingerprintVersion,physicalIdentity.contentFingerprint,member.bindingRevision,member.admittedControlRevision,member.admittedControlProjectionDigest,'run_selection',null);
  database.pragma('foreign_keys = ON');
}

function request(draft) {
  const evidence = { schemaRef:'helix://contracts/types/TriageStructureEvidence/v1', schemaVersion:1,
    evidenceId:'structure-1', payloadDigest:draft.structureEvidence.payloadDigest };
  return { candidateDraft:draft, domainFactCommitHandle:handle(draft),
    commitMarker:{ commitMarker:'candidate-marker-'+draft.candidatePackageId, commitDigest:D('candidate-commit-'+draft.candidatePackageId) },
    resultBinding:{ resultId:'candidate-result-'+draft.candidatePackageId, eventId:'candidate-event-'+draft.candidatePackageId,
      evidenceSchemaRef:evidence.schemaRef, evidence } };
}

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-candidate-publication-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => 100 });
  try { return run({ databasePath, unitOfWork:createSqliteUnitOfWork({ kernel }) }); }
  finally { kernel.close(); try { fs.rmSync(root, { recursive:true, force:true }); } catch {} }
}

test('publishes immutable Package, Manifest relations, Run Reservation, stable Offer, Result, marker, and exact Outbox atomically', () => fixture(({ databasePath, unitOfWork }) => {
  const draft = candidateDraft(); const database = new Database(databasePath); seed(database, draft); database.close();
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork });
  const capability = createCandidatePublicationCapability({ store });
  assert.equal(capability.capabilityRef, 'procurement.candidate.publish@1');
  assert.equal(capability.effectClass, 'domain_fact_commit');
  const committed = capability.execute(request(draft));
  assert.equal(committed.replayed, false); assert.equal(committed.typedResult.packageRevision, 1);
  assert.equal(committed.typedResult.schemaRef, 'helix://contracts/types/CandidatePublicationReceipt/v1');
  assert.ok(Buffer.byteLength(JSON.stringify(committed.typedResult)) < 16 * 1024);
  const replay = store.publish(request(draft)); assert.equal(replay.replayed, true); assert.deepEqual(replay.typedResult, committed.typedResult);
  const check = new Database(databasePath, { readonly:true });
  assert.equal(Number(check.prepare('SELECT candidate_package_revision_head FROM proc_procurement_runs').get().candidate_package_revision_head), 1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_candidate_packages').get().count, 1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_candidate_primary_materials').get().count, 1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_candidate_primary_material_episode_claims').get().count, 1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_candidate_related_references').get().count, 1);
  assert.deepEqual(check.prepare('SELECT selection_state,candidate_package_id FROM proc_run_materials').get(),
    { selection_state:'candidate_delivery', candidate_package_id:'candidate-1' });
  const delivery = check.prepare('SELECT offer_id,acceptance_basis_digest,state FROM proc_candidate_deliveries').get();
  assert.equal(delivery.offer_id, committed.outboxResult.offerId); assert.equal(delivery.state, 'open');
  const outbox = check.prepare('SELECT message_id,dedup_key,consumer_set_digest,payload_schema_ref,payload_json FROM fx_outbox').get();
  assert.equal(outbox.message_id, canonicalDigest({ schema:'foundation.outbox-message-id@1', producerDomain:'procurement', dedupKey:outbox.dedup_key }));
  assert.equal(outbox.consumer_set_digest, canonicalDigest(['libra']));
  assert.equal(JSON.parse(outbox.payload_json).acceptanceBasisDigest, delivery.acceptance_basis_digest);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_outbox_deliveries').get().count, 1);
  assert.deepEqual(check.prepare('SELECT consumer_domain,state FROM fx_outbox_deliveries').get(), { consumer_domain:'libra', state:'pending' });
  check.close();
  const reader = createCandidateDeliveryReader({ schemaManifest, unitOfWork });
  const deliveryService = createCandidateDeliveryService({ candidateDeliveryReader:reader, contractValidator:{ validate() {} } });
  const snapshot = deliveryService.readSnapshot(buildQuery({ offerId:committed.typedResult.offerId,
    candidatePackageId:committed.typedResult.candidatePackageId, packageRevision:committed.typedResult.packageRevision,
    packageDigest:committed.typedResult.packageDigest, acceptanceBasisDigest:committed.typedResult.acceptanceBasisDigest }));
  assert.equal(snapshot.resultKind, 'found');
  assert.equal(snapshot.snapshot.candidatePackage.packageDigest, committed.typedResult.packageDigest);
  assert.equal(snapshot.snapshot.candidatePackage.packageRevision, committed.typedResult.packageRevision);
  assert.equal(snapshot.snapshot.candidatePackage.relatedReferences[0].identity.mountScopeId, 'mount-1');
}));

test('rolls back all eleven canonical write tables when Outbox publication crashes', () => fixture(({ databasePath, unitOfWork }) => {
  const draft = candidateDraft(); const database = new Database(databasePath); seed(database, draft);
  database.exec("CREATE TRIGGER fail_candidate_outbox BEFORE INSERT ON fx_outbox BEGIN SELECT RAISE(ABORT, 'injected'); END"); database.close();
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork });
  assert.throws(() => store.publish(request(draft)));
  const check = new Database(databasePath, { readonly:true });
  assert.equal(Number(check.prepare('SELECT candidate_package_revision_head FROM proc_procurement_runs').get().candidate_package_revision_head), 0);
  for (const table of ['proc_candidate_packages','proc_candidate_season_continuity_claims','proc_candidate_primary_materials',
    'proc_candidate_primary_material_episode_claims','proc_candidate_related_references','proc_candidate_deliveries','fx_event_result_bindings',
    'fx_commit_markers','fx_outbox']) assert.equal(check.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count, 0, table);
  assert.equal(check.prepare('SELECT selection_state FROM proc_run_materials').get().selection_state, 'run_selection'); check.close();
}));

test('rejects stale Run member fences without any visible publication writes', () => fixture(({ databasePath, unitOfWork }) => {
  const draft = candidateDraft(); const database = new Database(databasePath); seed(database, draft);
  database.prepare("UPDATE proc_run_materials SET selection_state='released'").run(); database.close();
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork });
  assert.throws(() => store.publish(request(draft)), (error) => error.code === 'P7_CANDIDATE_MEMBER_FENCE_STALE');
  const check = new Database(databasePath, { readonly:true }); assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_candidate_packages').get().count, 0);
  assert.equal(Number(check.prepare('SELECT candidate_package_revision_head FROM proc_procurement_runs').get().candidate_package_revision_head), 0); check.close();
}));

test('rejects Result Evidence that does not identify the Draft structure Evidence', () => {
  const draft = candidateDraft();
  const input = request(draft);
  input.resultBinding.evidence = { ...input.resultBinding.evidence, evidenceId:'different-structure' };
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork:{ execute() { throw new Error('must not enter persistence'); } } });
  assert.throws(() => store.publish(input), (error) => error.code === 'P7_CANDIDATE_REQUEST_INVALID');
});

test('keeps a large Related Package in Owner rows while the Event Result remains a bounded receipt', () => fixture(({ databasePath, unitOfWork }) => {
  const draft = candidateDraft({ suffix:'large-related', inode:'51', referenceCount:180 });
  const database = new Database(databasePath); seed(database, draft); database.close();
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork });
  const committed = store.publish(request(draft));
  assert.ok(Buffer.byteLength(JSON.stringify(committed.typedResult)) < 16 * 1024);
  const reader = createCandidateDeliveryReader({ schemaManifest, unitOfWork });
  const service = createCandidateDeliveryService({ candidateDeliveryReader:reader, contractValidator:{ validate() {} } });
  const snapshot = service.readSnapshot(buildQuery({ offerId:committed.typedResult.offerId,
    candidatePackageId:committed.typedResult.candidatePackageId, packageRevision:committed.typedResult.packageRevision,
    packageDigest:committed.typedResult.packageDigest, acceptanceBasisDigest:committed.typedResult.acceptanceBasisDigest })).snapshot;
  assert.equal(snapshot.candidatePackage.relatedReferences.length, 180);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot.candidatePackage)) > 64 * 1024);
}));

test('allocates Run package revisions in commit order when sibling Candidates publish in reverse order', () => fixture(({ databasePath, unitOfWork }) => {
  const firstUnit = candidateDraft({ suffix:'first-unit', inode:'61', ordinal:0 });
  const secondUnit = candidateDraft({ suffix:'second-unit', inode:'62', ordinal:1 });
  const database = new Database(databasePath);
  seed(database, firstUnit, { ordinal:0 });
  seed(database, secondUnit, { initialize:false, ordinal:1 });
  database.close();
  const store = createCandidatePublicationStore({ schemaManifest, unitOfWork });
  const secondCommitted = store.publish(request(secondUnit));
  const firstCommitted = store.publish(request(firstUnit));
  assert.equal(secondCommitted.typedResult.packageRevision, 1);
  assert.equal(firstCommitted.typedResult.packageRevision, 2);
  const check = new Database(databasePath, { readonly:true });
  assert.equal(Number(check.prepare('SELECT candidate_package_revision_head FROM proc_procurement_runs').get().candidate_package_revision_head), 2);
  assert.deepEqual(check.prepare('SELECT candidate_package_id,package_revision FROM proc_candidate_packages ORDER BY package_revision').all(), [
    { candidate_package_id:secondUnit.candidatePackageId, package_revision:1 },
    { candidate_package_id:firstUnit.candidatePackageId, package_revision:2 }
  ]);
  check.close();
}));

test('rejects legacy continuity aliases before persistence', () => {
  const draft = candidateDraft();
  draft.seasonContinuityClaims = [{ claimKind:'exact_provider_season', claimNamespace:'provider', claimKey:'season-1',
    claimDigest:D('legacy'), evidenceDigest:D('evidence') }];
  draft.seasonContinuityClaimSetDigest = canonicalDigest({ schema:'season-continuity-claim-set@1', items:draft.seasonContinuityClaims });
  assert.throws(() => buildPublication(draft, 1), (error) => error.code === 'P7_CANDIDATE_CONTINUITY_INVALID');
});
