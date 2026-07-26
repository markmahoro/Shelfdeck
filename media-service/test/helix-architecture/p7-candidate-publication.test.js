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
const { buildOffer } = require('../../src/helix/domains/procurement/model/candidate-publication-contracts');
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

function candidateDraft() {
  const physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-1',inode:'41',contentHashAlgorithm:'sha256',contentHash:D('material-content')};
  physicalIdentity.materialKey=canonicalDigest({schema:'physical-material-identity@1',mountScopeId:physicalIdentity.mountScopeId,inode:physicalIdentity.inode,contentHashAlgorithm:'sha256',contentHash:physicalIdentity.contentHash});
  const materialKey = physicalIdentity.materialKey;
  const episodeBase = { episodeKey:'E001', seasonClaimDigest:D('season'), claimDigest:'' };
  episodeBase.claimDigest = canonicalDigest(without(episodeBase, 'claimDigest'));
  const member = { materialKey, bindingRevision:1, admittedControlRevision:1, admittedControlProjectionDigest:D('control'),
    role:'primary_payload', episodeClaims:[episodeBase], memberClaimDigest:'' };
  member.memberClaimDigest = canonicalDigest(without(member, 'memberClaimDigest'));
  const metadata = { claimedTitle:'Series One', seasonClaim:{ claimKind:'explicit_number', seasonNumber:1, claimDigest:D('season-claim') },
    contentProfileHint:'series', sourceHints:[{ hintKind:'filename_title', hintValue:'Series.One.S01E01', evidenceDigest:D('hint') }],
    metadataDigest:'' };
  metadata.metadataDigest = canonicalDigest(without(metadata, 'metadataDigest'));
  const identityPayload = { claimKind:'series_season', mediaType:'group', contentProfile:'series', claimedTitle:metadata.claimedTitle,
    displayIdentity:metadata.claimedTitle, seasonClaim:metadata.seasonClaim, identityMetadataDigest:metadata.metadataDigest,
    structureUnitDigest:'', sourceHints:metadata.sourceHints };
  const referenceIdentity = { schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion:1,
    materialKey:'', mountScopeId:'mount-1', inode:'42', contentHashAlgorithm:'sha256', contentHash:D('reference-content') };
  referenceIdentity.materialKey = canonicalDigest({ schema:'physical-material-identity@1', mountScopeId:referenceIdentity.mountScopeId,
    inode:referenceIdentity.inode, contentHashAlgorithm:'sha256', contentHash:referenceIdentity.contentHash });
  const referenceBase = { referenceId:'', primaryMaterialKey:materialKey, role:'nfo', identity:referenceIdentity,
    endpointId:'endpoint-1', location:'/field/series.nfo', checksumAlgorithm:'sha256', checksumHex:D('reference-content'),
    associationEvidenceDigest:D('reference-evidence'), referenceDigest:'' };
  referenceBase.referenceId = canonicalDigest({ schema:'procurement.related-material-reference-id@1', primaryMaterialKey:materialKey,
    role:referenceBase.role, relatedMaterialKey:referenceIdentity.materialKey, endpointId:referenceBase.endpointId,
    location:referenceBase.location });
  referenceBase.referenceDigest = canonicalDigest(without(referenceBase, 'referenceDigest'));
  const continuity = [];
  const continuityDigest = canonicalDigest({ schema:'season-continuity-claim-set@1', items:continuity });
  const unit = { unitId:'', mediaType:'group', contentProfile:'series', structureKind:'season', displayIdentity:metadata.claimedTitle,
    identityMetadata:metadata, seasonContinuityClaims:continuity, seasonContinuityClaimSetDigest:continuityDigest,
    members:[member], relatedReferences:[referenceBase], unitDigest:'' };
  unit.unitId = canonicalDigest({ schema:'procurement.triage-unit-id@1', mediaType:unit.mediaType, contentProfile:unit.contentProfile,
    structureKind:unit.structureKind, members:unit.members.map(({ materialKey:key, role, episodeClaims }) => ({ materialKey:key, role, episodeClaims })) });
  unit.unitDigest = canonicalDigest(without(unit, 'unitDigest'));
  identityPayload.structureUnitDigest = unit.unitDigest;
  const identityClaim = { schemaRef:'helix://contracts/types/IdentityClaim/v1', schemaVersion:1, draftId:'identity-1',
    draftKind:'procurement_identity_claim', basisDigest:D('identity-basis'), draftDigest:'', producedAtMs:1,
    ...identityPayload, claimDigest:'' };
  identityClaim.claimDigest = canonicalDigest(identityPayload); identityClaim.draftDigest = identityClaim.claimDigest;
  const manifestMembers = [{ ordinal:0, materialKey, role:member.role, physicalIdentity,sizeBytes:100,bindingRevision:1, admittedControlRevision:1,
    admittedControlProjectionDigest:member.admittedControlProjectionDigest, episodeClaims:member.episodeClaims }];
  const manifestPayload = { preallocatedManifestId:'manifest-1', procurementRunId:'run-1', runBasisDigest:D('run-basis'),
    structureEvidencePayloadDigest:D('structure-evidence'), unitId:unit.unitId, structureKind:'season', memberCount:1,
    membersDigest:canonicalDigest({ schema:'procurement.primary-input-manifest-members@1', items:manifestMembers }), memberSourceDigest:unit.unitDigest };
  const manifestDraftDigest = canonicalDigest(manifestPayload);
  const manifestDraft = { schemaRef:'helix://contracts/types/PrimaryInputManifestDraft/v1', schemaVersion:1, draftId:'manifest-draft-1',
    draftKind:'procurement_primary_input_manifest', basisDigest:D('manifest-basis'), draftDigest:manifestDraftDigest, producedAtMs:1,
    ...manifestPayload, manifestDraftDigest };
  const value = { draftId:'candidate-draft-1', draftKind:'procurement_candidate', basisDigest:D('candidate-basis'), draftDigest:'',
    producedAtMs:1, candidatePackageId:'candidate-1', expectedPackageRevision:1, procurementRunId:'run-1', runBasisDigest:D('run-basis'),
    triageRule:{ ruleRef:'procurement.triage.default', revision:1, authorityDigest:D('authority') },
    materialFieldContextRef:{ fieldId:'field-1', accessRevision:1, contextDigest:D('context') }, mediaType:'group', contentProfile:'series',
    displayIdentity:metadata.claimedTitle, identityMetadata:metadata, identityClaim,
    structureEvidence:{ evidenceId:'structure-1', payloadDigest:D('structure-evidence'), unit }, primaryInputManifestDraft:manifestDraft,
    seasonContinuityClaims:continuity, seasonContinuityClaimSetDigest:continuityDigest, relatedReferences:[referenceBase],
    relatedReferenceSetDigest:canonicalDigest({ schema:'procurement.related-reference-set@1', items:[referenceBase] }),
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
    factSchemaRef:'helix://contracts/domain-types/CandidateDraft/v1', expectedRevision:draft.expectedPackageRevision - 1,
    payloadDigest:canonicalDigest(draft), resultSchemaRef:'helix://contracts/types/CandidatePackage/v1',
    commitIdempotencyKey:'candidate-publish-1', eventFenceDigest:D('event-fence') };
}

function seed(database, draft) {
  database.pragma('foreign_keys = OFF');
  database.prepare('INSERT INTO fx_workflow_events(event_id) VALUES(?)').run('candidate-event-1');
  database.prepare('INSERT INTO proc_material_fields(field_id,status,current_access_revision) VALUES(?,?,?)').run('field-1','active',1);
  database.prepare('INSERT INTO proc_field_access_revisions(field_id,revision,access_digest) VALUES(?,?,?)').run('field-1',1,D('access'));
  database.prepare(`INSERT INTO proc_procurement_runs(procurement_run_id,field_id,access_revision,triage_rule_ref,triage_rule_revision,
    triage_rule_authority_digest,run_basis_digest,state,state_revision,candidate_package_revision_head) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
    'run-1','field-1',1,draft.triageRule.ruleRef,1,draft.triageRule.authorityDigest,draft.runBasisDigest,'active',1,0);
  const member = draft.structureEvidence.unit.members[0];
  const physicalIdentity={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-1',inode:'41',contentHashAlgorithm:'sha256',contentHash:D('material-content')};
  database.prepare(`INSERT INTO proc_run_materials(procurement_run_id,ordinal,material_key,mount_scope_id,inode,content_hash_algorithm,content_hash,size_bytes,binding_revision,admitted_control_revision,
    admitted_control_projection_digest,selection_state,candidate_package_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'run-1',0,member.materialKey,physicalIdentity.mountScopeId,physicalIdentity.inode,physicalIdentity.contentHashAlgorithm,physicalIdentity.contentHash,100,member.bindingRevision,member.admittedControlRevision,member.admittedControlProjectionDigest,'run_selection',null);
  database.pragma('foreign_keys = ON');
}

function request(draft) {
  const evidence = { schemaRef:'helix://contracts/types/TriageStructureEvidence/v1', schemaVersion:1,
    evidenceId:'structure-1', payloadDigest:draft.structureEvidence.payloadDigest };
  return { candidateDraft:draft, domainFactCommitHandle:handle(draft),
    commitMarker:{ commitMarker:'candidate-marker-1', commitDigest:D('candidate-commit') },
    resultBinding:{ resultId:'candidate-result-1', eventId:'candidate-event-1', evidenceSchemaRef:evidence.schemaRef, evidence } };
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
  const snapshot = deliveryService.readSnapshot(buildQuery(buildOffer(committed.typedResult, committed.acceptanceBasis).message));
  assert.equal(snapshot.resultKind, 'found');
  assert.deepEqual(snapshot.snapshot.candidatePackage, committed.typedResult);
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

test('rejects legacy continuity aliases before persistence', () => {
  const draft = candidateDraft();
  draft.seasonContinuityClaims = [{ claimKind:'exact_provider_season', claimNamespace:'provider', claimKey:'season-1',
    claimDigest:D('legacy'), evidenceDigest:D('evidence') }];
  draft.seasonContinuityClaimSetDigest = canonicalDigest({ schema:'season-continuity-claim-set@1', items:draft.seasonContinuityClaims });
  assert.throws(() => buildPublication(draft, 1), (error) => error.code === 'P7_CANDIDATE_CONTINUITY_INVALID');
});
