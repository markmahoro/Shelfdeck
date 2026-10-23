'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createWorkLifecycle } = require('../src/helix/foundation/execution/work-lifecycle');
const { createStoppedExecutionTerminationStore } = require('../src/helix/foundation/execution/stopped-execution-termination');
const { observeStoppedTranscode } = require('./formation-stopped-transcode');
const { createFormationRetirementStore, createIntakeRetirementStore, createProductDeliveryReader } = require('../src/helix/domains/libra/public');
const { createCandidateRetirementStore, createCandidateAcceptanceConsumer } = require('../src/helix/domains/procurement/public');
const { createArcaFormationRetirementStore, createFormationSharedRetirement } = require('../src/helix/domains/arca/public');
const { createRetirementJournal } = require('./formation-retirement-journal');
const { inspectRetirementPlan } = require('./formation-retirement-plan');
const schemaManifest = require('../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

function createFormationRetirementOperator(options) {
  const databasePath = path.join(options.dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) fail('RESET_DATABASE_MISSING', 'Reset requires an existing database.');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest });
  try {
    const unitOfWork = createSqliteUnitOfWork({ kernel });
    const dependencies = { schemaManifest, unitOfWork, now: Date.now };
    const acceptance=createCandidateAcceptanceConsumer(dependencies);
    let intake;
    const procurement=createCandidateRetirementStore({...dependencies,readIntakeRetirementReceipt:processId=>intake.readReceipt(processId)});
    intake=createIntakeRetirementStore({...dependencies,readCandidateSnapshot:procurement.inspect});
    const delivery = createProductDeliveryReader(dependencies);
    const arca = createArcaFormationRetirementStore({ ...dependencies, readPublishedProduct: delivery.readPackage });
    const shared = createFormationSharedRetirement({...dependencies,contractValidator:
      require('../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas:[
        require('../src/helix/contracts/domain-types/SeriesPresentationManifest/v1/schema.json'),
        require('../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json')]})});
    const libra = createFormationRetirementStore({ ...dependencies, readArcaRetirementProof: arca.readRetirementProof });
    const execution = createWorkLifecycle({ ...dependencies, nextWorkAttemptId: () => crypto.randomUUID() });
    function query(read) {
      const db = new Database(databasePath, { readonly: true, fileMustExist: true });
      try { return read(db); } finally { db.close(); }
    }
    function assertAuthorized(journal) {
      const filename = path.join(options.dataDir, 'operator-runtime', 'intent.json');
      if (!fs.existsSync(filename) || fs.lstatSync(filename).isSymbolicLink())
        fail('RESET_STOPPED_INTENT_REQUIRED', 'Reset requires the persisted stopped-runtime intent.');
      const intent = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (intent.schema !== 'shelfdeck.runtime-intent@1' || intent.desiredMode !== 'stopped' ||
          intent.pendingReset?.resetId !== journal.resetId || intent.pendingReset.backupId !== journal.backup.backupId ||
          intent.pendingReset.backupDigest !== journal.backup.backupDigest ||
          intent.pendingReset.previewDigest !== journal.manifest.previewDigest)
        fail('RESET_JOURNAL_NOT_AUTHORIZED', 'Reset journal is not the exact pending stopped-runtime operation.');
    }
    const journal = createRetirementJournal({ dataDir: options.dataDir, assertAuthorized,
      verifyBackup: options.verifyBackup,
      prepareRequest(step, record) {
        const common = { retirementId: record.resetId, backupDigest: record.backup.backupDigest, manifestDigest: record.manifestDigest };
        if (step.owner === 'execution_termination') {
          const value = record.manifest.plan.terminations.find(row => row.eventId === step.eventId);
          if (!value) fail('RESET_JOURNAL_SCOPE_INVALID', 'Execution termination is outside the frozen manifest.');
          return {...common, eventId:value.eventId, snapshotDigest:value.snapshotDigest, realityDigest:value.realityDigest};
        }
        if(step.owner==='procurement_acceptance'){
          const value=record.manifest.plan.acceptanceClosures.find(row=>row.envelope.messageId===step.messageId);
          if(!value)fail('RESET_JOURNAL_SCOPE_INVALID','Acceptance acknowledgement is outside the frozen manifest.');
          return value.envelope;
        }
        if (step.owner === 'execution') return { ...step.scope, reasonCode: 'administrative_formation_retirement' };
        if (step.owner === 'arca_shared') {
          const value=record.manifest.shared.find(row=>row.current.scope_id===step.scopeId);
          if(!value)fail('RESET_JOURNAL_SCOPE_INVALID','Shared scope is outside the frozen manifest.');
          return value;
        }
        if (['intake','procurement'].includes(step.owner)) {
          const value=record.manifest.intakes.find(row=>row.processId===step.processId);
          if(!value)fail('RESET_JOURNAL_SCOPE_INVALID','Intake step is outside the frozen manifest.');
          if(step.owner==='intake')return {...common,processId:step.processId,offerId:value.offer.offerId,
            candidatePackageId:value.offer.candidatePackageId,packageDigest:value.offer.packageDigest,
            expectedSnapshotDigest:value.intake.snapshotDigest,candidateSnapshotDigest:value.candidate.snapshotDigest};
          return {...common,intakeProcessId:step.processId,offerId:value.offer.offerId,
            expectedSnapshotDigest:value.candidate.snapshotDigest,intakeReceiptDigest:intake.readReceipt(step.processId).receiptDigest};
        }
        if (step.owner === 'arca') {
          const value = record.manifest.arca.find(row => row.package.offer_id === step.offerId);
          if (!value) fail('RESET_JOURNAL_SCOPE_INVALID', 'Arca step is outside the frozen manifest.');
          return { ...common, offerId: step.offerId, packageId: value.package.on_deck_package_id,
            packageDigest: value.package.package_digest, expectedSnapshotDigest: value.snapshot.snapshotDigest,
            packageRevision: value.package.package_revision, expectedDeliveryReadDigest: value.deliveryReadDigest,
            expectedControls: value.controls };
        }
        const value = record.manifest.libra.find(row => row.subjectId === step.subjectId);
        if (!value) fail('RESET_JOURNAL_SCOPE_INVALID', 'Libra step is outside the frozen manifest.');
        const proof = arca.readRetirementProof(value.snapshot.packages.map(row => ({ offerId: row.offer_id,
          packageId: row.on_deck_package_id, packageDigest: row.package_digest })));
        let expectedSnapshotDigest=value.snapshot.snapshotDigest;
        if(value.snapshot.token && record.manifest.intakes.some(row=>row.processId===value.snapshot.token.source_process_id)) {
          // The preceding Intake command removes this exact token. Derive that
          // one declared postcondition from the frozen snapshot; never accept
          // an arbitrary fresh Subject snapshot during recovery.
          const {snapshotDigest:_digest,...expected}=value.snapshot;
          expectedSnapshotDigest=canonicalDigest({...expected,token:null});
        }
        return { ...common, subjectId: step.subjectId, expectedSnapshotDigest,
          retiringRunIds: value.snapshot.runs.filter(row => ['active','suspended','frozen'].includes(row.state)).map(row => row.libra_run_id),
          expectedArcaProofDigest: canonicalDigest(proof), expectedControls: value.controls };
      },
      commitStep(step, request, record) {
        if (step.owner === 'execution_termination') return createStoppedExecutionTerminationStore({...dependencies,
          assertStopped:() => assertAuthorized(record),
          observeWorkspace:snapshot => query(db => observeStoppedTranscode(db, options.workspaceRoot, snapshot)),
        }).commit(request);
        if(step.owner==='procurement_acceptance')return acceptance.consume(request);
        if(step.owner==='arca_shared')return shared.execute(request);
        if (step.owner === 'execution') {
          const result = execution.cancelProcess(request);
          if (result.drainingWorks) fail('RESET_EXECUTION_NOT_DRAINED', 'Execution became active during Reset.');
          return result;
        }
        const ports={arca,libra,intake,procurement};
        const result = ports[step.owner].commit(request);
        return { replayed: result.replayed, receipt: result.receipt };
      },
      afterCommit: options.afterCommit,
      verifyCompleted(record) {
        for (const step of record.steps.filter(row => row.owner === 'execution_termination')) {
          const frozen = record.manifest.plan.terminations.find(row => row.eventId === step.eventId);
          const result = createStoppedExecutionTerminationStore({...dependencies, assertStopped:() => assertAuthorized(record),
            observeWorkspace:() => fail('RESET_CLOSURE_INCOMPLETE', 'Completed termination must have a durable receipt.'),
          }).commit({retirementId:record.resetId, manifestDigest:record.manifestDigest, backupDigest:record.backup.backupDigest,
            eventId:step.eventId, snapshotDigest:frozen.snapshotDigest, realityDigest:frozen.realityDigest});
          if (canonicalDigest(result.receipt) !== canonicalDigest(record.completed[step.ordinal].result.receipt))
            fail('RESET_CLOSURE_INCOMPLETE', 'Execution termination does not match its frozen receipt.');
        }
        for(const value of record.manifest.shared) {
          const step=record.steps.find(row=>row.owner==='arca_shared' && row.scopeId===value.current.scope_id);
          shared.verify(value,record.completed[step.ordinal].result);
        }
        function exactReceipt(receipt, contract, target) {
          return receipt && receipt.receiptId === canonicalDigest({contract,retirementId:record.resetId,...target}) &&
            receipt.manifestDigest === record.manifestDigest && receipt.backupDigest === record.backup.backupDigest;
        }
        for(const value of record.manifest.intakes) {
          const intakeReceipt=intake.readReceipt(value.processId),candidateReceipt=procurement.readReceipt(value.offer.offerId);
          const current=procurement.inspect(value.offer.offerId);
          if(!exactReceipt(intakeReceipt,'libra.intake-retirement@1',{processId:value.processId}) ||
              !exactReceipt(candidateReceipt,'procurement.candidate-retirement@1',{offerId:value.offer.offerId}) ||
              candidateReceipt.intakeRetirementReceiptDigest !== intakeReceipt.receiptDigest ||
              candidateReceipt.afterDigest !== current.snapshotDigest || current.delivery.state !== 'administratively_retired')
            fail('RESET_CLOSURE_INCOMPLETE','Pending Intake has no exact retirement proof in both Owners.');
        }
        for (const value of record.manifest.libra) {
          const current=libra.inspect(value.subjectId),receipt=libra.readReceipt(value.subjectId);
          if (current.subject.status !== 'administratively_retired' || current.token || current.workshop ||
              current.runs.some(run=>['active','suspended','frozen'].includes(run.state)) ||
              !receipt || receipt.receiptId !== canonicalDigest({contract:'libra.formation-retirement@1',retirementId:record.resetId,subjectId:value.subjectId}) ||
              receipt.manifestDigest !== record.manifestDigest || receipt.backupDigest !== record.backup.backupDigest)
            fail('RESET_CLOSURE_INCOMPLETE', 'Subject retirement has no exact command receipt or retains active responsibility.');
        }
        for (const value of record.manifest.arca) {
          const current=arca.inspect(value.package.offer_id,value.package.on_deck_package_id);
          if (!exactReceipt(arca.readReceipt(value.package.offer_id),'arca.formation-retirement@1',{offerId:value.package.offer_id}) ||
              current.custodies.some(row=>row.state==='active') || current.runs.some(row=>row.state!=='administratively_retired'||row.target_reserved_at_ms!==null) ||
              current.attempts.some(row=>['active','waiting'].includes(row.state)) || current.reservations.some(row=>row.state==='pending') ||
              current.approvals.some(row=>row.state==='active') || current.recovery && current.recovery.recovery_state!=='administratively_retired')
            fail('RESET_CLOSURE_INCOMPLETE', 'Arca lacks exact retirement proof or still holds current responsibility.');
        }
        query(db => {
          for(const value of record.manifest.plan.acceptanceClosures){
            const message=value.envelope.payload,delivery=db.prepare('SELECT * FROM proc_candidate_deliveries WHERE offer_id=?').get(message.offerId),
              receipt=db.prepare('SELECT * FROM libra_handoff_a_receipts WHERE receipt_id=?').get(message.receiptId),
              members=db.prepare('SELECT * FROM proc_run_materials WHERE candidate_package_id=?').all(message.candidatePackageId),
              inbox=db.prepare("SELECT * FROM fx_inbox WHERE consumer_domain='procurement' AND message_id=?").get(value.envelope.messageId),
              step=record.steps.find(row=>row.owner==='procurement_acceptance'&&row.messageId===value.envelope.messageId),
              result=record.completed[step.ordinal].result;
            if(!delivery||delivery.state!=='accepted'||delivery.handoff_receipt_id!==message.receiptId||delivery.handoff_receipt_digest!==message.receiptDigest||
                !receipt||canonicalDigest(receipt)!==canonicalDigest(value.receipt)||!members.length||
                members.some(row=>row.selection_state!=='transferred'||row.terminal_disposition!=='handoff_accepted'||row.terminal_evidence_digest!==message.receiptDigest)||
                !inbox||inbox.dedup_key!==value.envelope.dedupKey||inbox.result_digest!==result.closure.closureDigest)
              fail('RESET_CLOSURE_INCOMPLETE','Committed Handoff A lacks its original Procurement acknowledgement.');
          }
          if (db.pragma('foreign_key_check').length) fail('RESET_CLOSURE_INTEGRITY', 'Reset left invalid foreign keys.');
          // Verify the frozen scope directly. Rediscovery excludes retired
          // Subjects and therefore cannot prove their complete release.
          for(const scope of record.manifest.plan.ownerScopes)
            if(db.prepare("SELECT 1 FROM fx_material_controls WHERE state='controlled' AND owner_domain=? AND owner_scope_type=? AND owner_scope_id=?")
              .get(scope.ownerDomain,scope.scopeType,scope.scopeId))
              fail('RESET_CLOSURE_INCOMPLETE','A frozen retired scope still holds Material Control.');
          for(const before of record.manifest.plan.controls) {
            const current=db.prepare('SELECT * FROM fx_material_controls WHERE material_key=?').get(before.material_key);
            const revision=db.prepare('SELECT * FROM fx_material_control_revisions WHERE material_key=? AND revision=?')
              .get(before.material_key,Number(before.control_revision)+1);
            if(!current || current.state!=='released' || current.control_revision!==Number(before.control_revision)+1 ||
                current.owner_domain!==null || current.owner_scope_type!==null || current.owner_scope_id!==null ||
                !revision || revision.operation_kind!=='release' || revision.from_owner_domain!==before.owner_domain ||
                revision.from_scope_type!==before.owner_scope_type || revision.from_scope_id!==before.owner_scope_id ||
                revision.to_owner_domain!==null || revision.to_scope_type!==null || revision.to_scope_id!==null)
              fail('RESET_CONTROL_RELEASE_INCOMPLETE','Frozen Material Control has no exact appended release.');
          }
          for(const scope of record.manifest.plan.processScopes)
            if(db.prepare("SELECT 1 FROM fx_supporting_works WHERE owner_domain=? AND process_type=? AND process_id=? AND state NOT IN ('succeeded','failed','cancelled')")
              .get(scope.ownerDomain,scope.processType,scope.processId))
              fail('RESET_CLOSURE_INCOMPLETE','A frozen execution scope still has open Work.');
          for(const [table,key,rows] of [
            ['libra_runs','libra_run_id',record.manifest.plan.preserved.runs],
            ['arca_ondeck_commit_receipts','receipt_id',record.manifest.plan.preserved.commits],
            ['libra_product_packages','on_deck_package_id',record.manifest.plan.preserved.committedPackages],
          ]) for(const row of rows) {
            const current=db.prepare('SELECT * FROM '+table+' WHERE '+key+'=?').get(row[key]);
            if(!current || canonicalDigest(current)!==canonicalDigest(row))
              fail('RESET_HISTORY_PROTECTION_FAILED','A frozen protected historical record changed.');
          }
          const plan = inspectRetirementPlan(db);
          if (plan.blockers.length) fail('RESET_CLOSURE_INCOMPLETE', 'Unsettled responsibility remains after Reset.');
        });
        return { retiredSubjects: record.manifest.libra.length,
          retiredRunIds: record.manifest.plan.runs.map(row => row.libra_run_id),
          retainedWorkspaces: record.manifest.plan.workspaces.length };
      },
    });
    return Object.freeze({
      prepare({ resetId, expectedPlanDigest, previewDigest, backup }) {
        const plan = query(db => inspectRetirementPlan(db,{workspaceRoot:options.workspaceRoot}));
        if (plan.planDigest !== expectedPlanDigest || plan.blockers.length)
          fail('RUNTIME_RESET_PREVIEW_STALE', 'Reset scope changed or is blocked.');
        const intakeItems=plan.pendingIntakes.map(value=>({...value,intake:intake.inspect(value.processId),candidate:procurement.inspect(value.offer.offerId)}));
        const sharedItems=plan.sharedScopes.map(row=>shared.inspect(row.scope_id,plan.onDeckRuns.map(run=>run.on_deck_run_id)));
        const arcaItems = plan.packages.map(pkg => {
          const snapshot = arca.inspect(pkg.offer_id, pkg.on_deck_package_id);
          let deliveryReadDigest = null;
          if (!snapshot.attempts.length && !snapshot.decisions.length && !snapshot.custodies.length && !snapshot.recovery) {
            const proof = delivery.readPackage({ queryContract:'libra.product-delivery@1',readPurpose:'historical',offerId:pkg.offer_id,
              onDeckPackageId:pkg.on_deck_package_id,expectedPackageRevision:pkg.package_revision,expectedPackageDigest:pkg.package_digest });
            if (proof.resultKind !== 'found') fail('ARCA_RETIREMENT_OFFER_UNOBSERVED', 'Published Offer has no verified immutable delivery.');
            deliveryReadDigest = proof.readDigest;
          }
          const custodyIds = new Set(snapshot.custodies.map(row => row.custody_id));
          return { package: pkg, snapshot, deliveryReadDigest, controls: plan.controls.filter(row => row.owner_domain === 'arca' &&
            row.owner_scope_type === 'on_deck_custody' && custodyIds.has(row.owner_scope_id)) };
        });
        const selectedOffers = new Set(arcaItems.map(row => row.package.offer_id));
        const libraItems = plan.subjects.map(subject => {
          const snapshot = libra.inspect(subject.subject_id);
          // Prove every excluded historical package is already closed before
          // changing anything, rather than discovering it halfway through Reset.
          arca.readRetirementProof(snapshot.packages.filter(row => !selectedOffers.has(row.offer_id)).map(row => ({
            offerId: row.offer_id, packageId: row.on_deck_package_id, packageDigest: row.package_digest })));
          const runIds = new Set(snapshot.runs.map(row => row.libra_run_id));
          const workspaceIds = new Set(snapshot.workspaces.map(row => row.workspace_id));
          const packageIds = new Set(snapshot.packages.map(row => row.on_deck_package_id));
          return { subjectId: subject.subject_id, snapshot, controls: plan.controls.filter(row => row.owner_domain === 'libra' &&
            (row.owner_scope_type === 'subject' && row.owner_scope_id === subject.subject_id ||
             row.owner_scope_type === 'libra_run' && runIds.has(row.owner_scope_id) ||
             ['workspace','libra_workspace'].includes(row.owner_scope_type) && workspaceIds.has(row.owner_scope_id) ||
             row.owner_scope_type === 'on_deck_package' && packageIds.has(row.owner_scope_id))) };
        });
        // Persist cancellation only for scopes with open Work in the frozen
        // snapshot. Owner commits and final verification still fence every scope.
        const openScopeKeys=new Set(plan.works.map(row=>JSON.stringify([row.owner_domain,row.process_type,row.process_id])));
        const executionScopes=plan.processScopes.filter(scope=>openScopeKeys.has(JSON.stringify([scope.ownerDomain,scope.processType,scope.processId])));
        return journal.prepare({ resetId, backup, manifest: { previewDigest, plan, arca: arcaItems, libra: libraItems,intakes:intakeItems,shared:sharedItems }, steps: [
          ...plan.terminations.map(row => ({owner:'execution_termination', eventId:row.eventId})),
          ...executionScopes.map(scope => ({ owner: 'execution', scope })),
          ...sharedItems.filter(row=>row.retire && row.current.active_build_id).map(row=>({owner:'execution',scope:{ownerDomain:'arca',processType:'arca_series_presentation',processId:row.current.active_build_id}})),
          ...plan.acceptanceClosures.map(row=>({owner:'procurement_acceptance',messageId:row.envelope.messageId})),
          ...intakeItems.flatMap(row=>[{owner:'intake',processId:row.processId},{owner:'procurement',processId:row.processId}]),
          ...arcaItems.map(row => ({ owner: 'arca', offerId: row.package.offer_id })),
          ...sharedItems.map(row=>({owner:'arca_shared',scopeId:row.current.scope_id})),
          ...libraItems.map(row => ({ owner: 'libra', subjectId: row.subjectId })),
        ] });
      },
      execute: journal.execute, read: journal.read, close: () => kernel.close(),
    });
  } catch (error) { kernel.close(); throw error; }
}

module.exports = Object.freeze({ createFormationRetirementOperator });
