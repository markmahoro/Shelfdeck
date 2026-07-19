'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');
const {createMaterialControlParticipant,createMaterialControlProjectionPort,materialKey}=require('../../src/helix/foundation/persistence/material-control');
const {createLibraIntakeStore}=require('../../src/helix/domains/libra/persistence/libra-intake-store');
const {createIntakeAcceptanceStore}=require('../../src/helix/domains/libra/persistence/intake-acceptance-store');
const {buildAcceptedIntakePayload,buildLibraBindingDraft}=require('../../src/helix/domains/libra/model/intake-acceptance-contracts');
const {continuityHeadDigest}=require('../../src/helix/domains/libra/model/libra-intake-contracts');

const root=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaDdl=fs.readFileSync(path.join(root,'clean-schema.sql'),'utf8');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(root,'clean-schema.manifest.json'),'utf8'));
const D=(value)=>canonicalDigest({value});
const without=(value,...fields)=>Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));
const markers=createRepositoryDefinition({repositoryId:'acceptance_seed_marker',owner:'execution-foundation',schemaManifest,statements:{insert:{kind:'insert',tableId:'fx_commit_markers',columns:['commit_marker','owner_domain','scope_type','scope_id','commit_digest','committed_at_ms']}}});
const procurementNoop=createRepositoryDefinition({repositoryId:'acceptance_seed_procurement',owner:'procurement',schemaManifest,statements:{find:{kind:'select-one',tableId:'proc_material_fields',columns:['field_id'],keyColumns:['field_id']}}});

function fixture(run){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p8-accepted-')),databasePath=path.join(directory,'shelfdeck.db');let now=1700080000000;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}),unitOfWork=createSqliteUnitOfWork({kernel});
  try{return run({databasePath,kernel,unitOfWork});}finally{kernel.close();fs.rmSync(directory,{recursive:true,force:true});}}
function identity(){const value={schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1',schemaVersion:1,mountScopeId:'mount-1',inode:'123',contentHashAlgorithm:'sha256',contentHash:D('content')};value.materialKey=materialKey(value);return value;}
function seedControl(unitOfWork,material){const field={ownerDomain:'procurement',scopeType:'material_field',scopeId:'field-1'},change={action:'acquire',identity:material,expectedRevision:0,fromScope:null,toScope:field};
  const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'seed-control',operationKind:'acquire',ownerDomain:'procurement',processType:'seed',processId:'seed-1',
    basisRef:{objectType:'seed',objectId:'seed-1',revision:1,digest:D('basis-ref')},basisDigest:D('basis'),canonicalFactSetDigest:D('facts'),bindingSetDigest:D('bindings'),
    controlScopeDigest:require('../../src/helix/foundation/persistence/material-control').controlScopeDigest([change]),expectedControlRevisions:[{materialKey:material.materialKey,revision:0}],receiptContract:'seed',eventFenceDigest:D('fence')};
  unitOfWork.execute([{participantId:'seed_procurement',owner:'procurement',repositories:[procurementNoop],execute(){return null;}},createMaterialControlParticipant({schemaManifest,handle,changes:[change],commitMarker:'seed-marker'}),{participantId:'seed_foundation',owner:'execution-foundation',boundBusinessOwner:'procurement',repositories:[markers],execute(context){context.repository(markers.repositoryId).invoke('insert',{commit_marker:'seed-marker',owner_domain:'procurement',scope_type:'seed',scope_id:'seed-1',commit_digest:D('seed'),committed_at_ms:context.commitTimeMs});}}]);return field;}
function acceptedBasis(unitOfWork,material){const projection=createMaterialControlProjectionPort({schemaManifest,unitOfWork}).getMaterialControlProjection(material.materialKey);
  const member={ordinal:0,materialKey:material.materialKey,role:'primary_payload',bindingRevision:1,admittedControlRevision:1,admittedControlProjectionDigest:projection.projectionDigest,
    endpointId:'endpoint-1',location:'/field/show.mkv',lastSnapshotDigest:D('snapshot'),realityDigest:D('reality'),provenanceDigest:D('provenance'),manifestMemberDigest:D('manifest-member'),
    episodeClaims:[{episodeKey:'S01E01',seasonClaimDigest:D('season'),claimDigest:D('episode')}],deliveryMemberDigest:D('delivery-member')};
  const claim={claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:1:season:1',claimDigest:D('claim'),evidenceDigest:D('claim-evidence')};
  const candidatePackage={candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),
    materialFieldContextRef:{fieldId:'field-1',accessRevision:1,contextDigest:D('field-context')},contentProfile:'series',
    identityClaim:{claimDigest:D('identity-claim')},seasonContinuityClaims:[claim],seasonContinuityClaimSetDigest:D('claim-set')};
  const snapshot={snapshotContract:'procurement.candidate-delivery@1',offer:{offerId:'offer-1'},acceptanceBasis:{acceptanceBasisDigest:D('acceptance')},candidatePackage,
    primaryInputManifest:{manifestDigest:D('manifest'),structureKind:'season'},primaryMaterialDeliveries:[member],deliveryMemberSetDigest:D('members'),deliverySnapshotDigest:''};snapshot.deliverySnapshotDigest=canonicalDigest(without(snapshot,'deliverySnapshotDigest'));
  const decision={decisionId:canonicalDigest({schema:'libra.intake-decision-id@1',offerId:'offer-1'}),offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:candidatePackage.packageDigest,
    candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest,expectedContinuityHead:{revision:0,digest:continuityHeadDigest(0)},candidateContinuityClaims:[claim],candidateContinuitySetDigest:candidatePackage.seasonContinuityClaimSetDigest,
    candidateEpisodeScope:{structureKind:'season',episodeKeys:['S01E01'],episodeScopeDigest:D('candidate-episodes')},matchCardinality:'none',matchWitnesses:[],matchedSubjectSetDigest:D('matches'),
    overlapEvaluation:'not_applicable_no_match',overlappingEpisodeKeys:[],episodeOverlapDigest:D('overlap'),result:'new_subject',allocatedSubjectId:'subject-1',decisionDigest:''};decision.decisionDigest=canonicalDigest(without(decision,'decisionDigest'));
  const common={result:'passed',reasonCodes:[],candidatePackageId:'candidate-1',packageDigest:candidatePackage.packageDigest,candidateDeliverySnapshotDigest:snapshot.deliverySnapshotDigest};
  const bindingDraft=buildLibraBindingDraft(snapshot,decision,10),payload=buildAcceptedIntakePayload({snapshot,decision,bindingDraft,candidateVerification:{...common,offerId:'offer-1',packageRevision:1,
    acceptanceBasisDigest:snapshot.acceptanceBasis.acceptanceBasisDigest,primaryInputManifestDigest:snapshot.primaryInputManifest.manifestDigest},materialVerification:{...common}});
  const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'handoff-a',operationKind:'transfer',ownerDomain:'libra',receivingDomain:'libra',transferPoint:'handoff_a_accepted',
    processType:'libra_intake',processId:decision.decisionId,basisRef:{objectType:'accepted_intake_payload',objectId:decision.decisionId,revision:1,digest:payload.payloadDigest},basisDigest:payload.payloadDigest,
    canonicalFactSetDigest:decision.decisionDigest,bindingSetDigest:bindingDraft.bindingSetDigest,controlScopeDigest:payload.controlTransferScope.controlScopeDigest,
    expectedControlRevisions:[{materialKey:material.materialKey,revision:1}],receiptContract:{receiptSchemaRef:'SubjectAndTransferReceipt@1',controlRevisionSetSchemaRef:'libra.handoff-a-transferred-control-set@1'},eventFenceDigest:D('fence')};
  return {snapshot,payload,decision,handle};}

test('commits new Subject, Binding, exact Control transfer, Receipt and Outbox atomically and replays',()=>fixture(({databasePath,unitOfWork})=>{
  const material=identity();seedControl(unitOfWork,material);createLibraIntakeStore({schemaManifest,unitOfWork}).ensureContinuityHead();const basis=acceptedBasis(unitOfWork,material);
  const store=createIntakeAcceptanceStore({schemaManifest,unitOfWork}),request={deliverySnapshot:basis.snapshot,payload:basis.payload,responsibilityControlCommitHandle:basis.handle,
    commitMarker:{commitMarker:'handoff-a-marker',commitDigest:D('commit')},resultBinding:{resultId:'handoff-a-result',eventId:null}};
  const first=store.accept(request),second=store.accept(request);assert.equal(first.replayed,false);assert.equal(second.replayed,true);assert.equal(first.receipt.receiptDigest,second.receipt.receiptDigest);
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_subjects').get().count,1);assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_material_bindings').get().count,1);
  assert.deepEqual(db.prepare('SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision FROM fx_material_controls').get(),{owner_domain:'libra',owner_scope_type:'subject',owner_scope_id:'subject-1',control_revision:2});
  assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_outbox WHERE message_kind='libra_candidate_accepted'").get().count,1);db.close();
}));

test('stale global head rolls back every accepted participant before Control transfer',()=>fixture(({databasePath,unitOfWork})=>{
  const material=identity();seedControl(unitOfWork,material);const intake=createLibraIntakeStore({schemaManifest,unitOfWork});intake.ensureContinuityHead();const basis=acceptedBasis(unitOfWork,material),subjects=intake.repositories.subjects;
  unitOfWork.execute([{participantId:'advance_head',owner:'libra',repositories:[subjects],execute(context){context.repository(subjects.repositoryId).invoke('advance_head',{
    current_revision:1,head_digest:continuityHeadDigest(1),updated_at_ms:context.commitTimeMs,head_id:'active_subject_continuity',expected_revision:0,expected_digest:continuityHeadDigest(0)});}}]);
  assert.throws(()=>createIntakeAcceptanceStore({schemaManifest,unitOfWork}).accept({deliverySnapshot:basis.snapshot,payload:basis.payload,responsibilityControlCommitHandle:basis.handle,
    commitMarker:{commitMarker:'bad-marker',commitDigest:D('bad')},resultBinding:{resultId:'bad-result',eventId:null}}));
  const db=new Database(databasePath,{readonly:true});assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_intake_decisions').get().count,0);assert.equal(db.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);db.close();
}));

test('Outbox crash rolls back Subject, Binding, Control, Receipt, Result and Marker',()=>fixture(({databasePath,unitOfWork})=>{
  const material=identity();seedControl(unitOfWork,material);createLibraIntakeStore({schemaManifest,unitOfWork}).ensureContinuityHead();const basis=acceptedBasis(unitOfWork,material);
  const db=new Database(databasePath);db.exec("CREATE TRIGGER fail_accept_outbox BEFORE INSERT ON fx_outbox BEGIN SELECT RAISE(ABORT,'injected'); END");db.close();
  assert.throws(()=>createIntakeAcceptanceStore({schemaManifest,unitOfWork}).accept({deliverySnapshot:basis.snapshot,payload:basis.payload,responsibilityControlCommitHandle:basis.handle,
    commitMarker:{commitMarker:'crash-marker',commitDigest:D('crash')},resultBinding:{resultId:'crash-result',eventId:null}}));
  const check=new Database(databasePath,{readonly:true});for(const table of ['libra_subjects','libra_intake_decisions','libra_material_bindings','libra_handoff_a_receipts','fx_event_result_bindings','fx_outbox'])
    assert.equal(check.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0,table);assert.equal(check.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,1);check.close();
}));
