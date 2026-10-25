'use strict';

// Offline evidence import only. This module is never loaded by the service.
// Its caller supplies exact archived contracts and a qualified historical
// verifier; no Catalog/state allowlist can authorize a write.
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { createPlanContractEvidenceStore, capturePlanContracts, planFromFacts, verifyPlanContractBinding } = require('../../src/helix/foundation/execution/plan-contract-evidence');
const { FORMAT, terminalFactsDigest, proveTerminalAttestation } = require('../../src/helix/foundation/execution/terminal-plan-attestation');
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

function createPlanContractImporter(options) {
  const { proofReader, unitOfWork, schemaManifest, sourceForCatalog, verifierDigest } = options;
  if (!/^[a-f0-9]{64}$/.test(verifierDigest)) throw new Error('Importer implementation provenance is required.');
  const store = createPlanContractEvidenceStore({ schemaManifest, unitOfWork });
  const audits = createRepositoryDefinition({ repositoryId: 'plan_import_audits', owner: 'execution-foundation', schemaManifest,
    statements: {
      find: { kind: 'select-one', tableId: 'fx_plan_history_audits', columns: ['audit_json'], keyColumns: ['audit_id'] },
      insert: { kind: 'insert', tableId: 'fx_plan_history_audits', columns: ['audit_id', 'plan_id', 'audit_schema_ref', 'audit_json', 'created_at_ms'] },
    } });
  function recordFailure(result) {
    const facts = proofReader.verify(reader => reader.read(result.planId));
    const receipt = { schemaRef: 'helix://foundation/evidence/PlanHistoryAudit/v1', schemaVersion: 1,
      verifier: 'contract-import@1:' + verifierDigest, planId: result.planId, contractDigest: null,
      factsDigest: canonicalDigest(facts), verdict: 'failed', findingCode: result.reason };
    const auditId = canonicalDigest(receipt), json = canonicalJson(receipt);
    unitOfWork.execute([{ participantId: 'plan_import_audit', owner: 'execution-foundation', repositories: [audits], execute(context) {
      const repository = context.repository(audits.repositoryId), existing = repository.invoke('find', { audit_id: auditId });
      if (existing && existing.audit_json !== json) throw new Error('Import audit receipt collision.');
      if (!existing) repository.invoke('insert', { audit_id: auditId, plan_id: result.planId, audit_schema_ref: receipt.schemaRef,
        audit_json: json, created_at_ms: context.commitTimeMs });
    } }]);
    return { ...result, auditId };
  }
  let footprint = null;
  const collectingReader = { verify(callback) {
    return proofReader.verify(reader => callback({ ...reader, read(planId) {
      const facts = reader.read(planId);
      if (footprint && facts) footprint.set(planId, facts);
      return facts;
    } }));
  } };
  const verifier = options.createHistoricalVerifier(collectingReader);
  function importPlan(planId) {
    const facts = proofReader.verify(reader => reader.read(planId));
    if (!facts?.work || !facts.workAttempt) return { planId, kind: 'unverified', reason: 'PLAN_OWNER_CHAIN_MISSING' };
    const existing = store.read(planId);
    if (existing) {
      verifyPlanContractBinding(existing, facts);
      if (existing.evidence.schemaRef === FORMAT) proofReader.verify(reader => proveTerminalAttestation(reader, planId, existing.evidence));
      return { planId, kind: 'already_present', contractDigest: existing.binding.contract_digest };
    }
    const source = sourceForCatalog(facts.plan.catalog_digest);
    if (!source || !/^[a-f0-9]{40}$/.test(source.sourceCommit) || !/^[a-f0-9]{64}$/.test(source.archiveDigest))
      return { planId, kind: 'unverified', reason: 'EXACT_SOURCE_CONTRACT_UNAVAILABLE' };
    let captured, observed;
    footprint = new Map();
    try {
      if (verifier.verify(facts) !== true) return { planId, kind: 'unverified', reason: 'ORIGINAL_CONTRACT_PROOF_REJECTED' };
      observed = new Map(footprint);
      if (!observed.has(planId)) throw new Error('Historical verifier did not read its claimed Plan.');
      if (TERMINAL.has(facts.workAttempt.state)) {
        const evidence = { schemaRef: FORMAT, schemaVersion: 1, planId, catalogDigest: facts.plan.catalog_digest,
          sourceCommit: source.sourceCommit, sourceArchiveDigest: source.archiveDigest, verifierDigest,
          footprint: [...observed].map(([id, value]) => ({ planId: id, factsDigest: terminalFactsDigest(value) }))
            .sort((a, b) => a.planId.localeCompare(b.planId, 'en')) };
        proofReader.verify(reader => proveTerminalAttestation(reader, planId, evidence));
        captured = { evidence, digest: canonicalDigest(evidence) };
      } else {
        // The only permitted live import is an explicitly scoped, unchanged
        // technical batch. Unfinished Formation has no continuity entitlement.
        if (!source.activeContracts || !source.allowActive?.(facts))
          return { planId, kind: 'unverified', reason: 'ACTIVE_OWNER_SCOPE_NOT_AUTHORIZED' };
        captured = capturePlanContracts(planFromFacts(facts), source.activeContracts);
        const current = capturePlanContracts(planFromFacts(facts), options.currentContracts);
        if (captured.digest !== current.digest) return { planId, kind: 'unverified', reason: 'ACTIVE_USED_CONTRACT_CHANGED' };
      }
    } finally { footprint = null; }
    const rawPlan = { ...planFromFacts(facts), planId, capabilityCatalogDigest: facts.plan.catalog_digest };
    const result = unitOfWork.execute([{ participantId: 'plan_contract_import', owner: 'execution-foundation',
      repositories: proofReader.repositories, execute(context) {
        return proofReader.withReaderInTransaction(context, reader => {
          for (const [id, before] of observed) {
            const after = reader.read(id);
            if (!after || canonicalDigest(before) !== canonicalDigest(after)) throw new Error('Import facts changed after verification.');
          }
          if (reader.readContract(planId)) throw new Error('Plan was concurrently imported.');
          store.publish(context, rawPlan, facts.plan.graph_digest, captured, { kind: 'verified_contract_import',
            sourceCommit: source.sourceCommit, sourceArchiveDigest: source.archiveDigest, verifierDigest });
          return { planId, kind: 'imported', contractDigest: captured.digest, proofPlanCount: observed.size };
        });
      } }]).plan_contract_import;
    return result;
  }
  return Object.freeze({ importPlan(planId) {
    const result = importPlan(planId);
    return result.kind === 'unverified' ? recordFailure(result) : result;
  } });
}

module.exports = Object.freeze({ createPlanContractImporter });
