'use strict';

const { canonicalDigest, canonicalJson } = require('../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../persistence/owner-repository');

const FORMAT = 'helix://foundation/evidence/PlanHistoryAudit/v1';
const KEY = Object.freeze({ ownerDomain: 'execution-foundation', reconcilerKey: 'plan-history-audit-progress' });
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const VERIFIER = 'stored-plan-contract-proof@1';

function createPlanHistoryAudit(options) {
  const { schemaManifest, unitOfWork, proofReader, verifier, cursorStore, now } = options;
  const repo = createRepositoryDefinition({ repositoryId: 'plan_history_audit', owner: 'execution-foundation', schemaManifest,
    statements: {
      page: { kind: 'select-page-after', tableId: 'fx_workflow_plans', columns: ['plan_id'], keyColumn: 'plan_id', maxItems: 32 },
      find: { kind: 'select-one', tableId: 'fx_plan_history_audits', columns: ['audit_json'], keyColumns: ['audit_id'] },
      insert: { kind: 'insert', tableId: 'fx_plan_history_audits', columns: ['audit_id', 'plan_id', 'audit_schema_ref', 'audit_json', 'created_at_ms'] },
    } });
  const execute = callback => unitOfWork.execute([{ participantId: 'plan_history_audit', owner: 'execution-foundation',
    repositories: [repo], execute: context => callback(context.repository(repo.repositoryId), context) }]).plan_history_audit;
  let pending = null;

  async function scan({ limit = 8, budgetMs = 1000 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 || !Number.isSafeInteger(budgetMs) || budgetMs < 1 || budgetMs > 5000)
      throw new Error('History audit limits are invalid.');
    const head = cursorStore.read(KEY), progress = head.cursor ? JSON.parse(head.cursor) : { after: null, nextSweepAtMs: 0 };
    if (now() < progress.nextSweepAtMs) return { kind: 'not_due', processed: 0 };
    const started = now(), rows = execute(repository => repository.invoke('page', { cursor: progress.after, limit }));
    let processed = 0, failed = 0, after = progress.after;
    for (const row of rows) {
      if (processed && now() - started >= budgetMs) break;
      const before = proofReader.verify(reader => reader.read(row.plan_id));
      if (!before?.workAttempt || !before.work || TERMINAL.has(before.workAttempt.state)) {
        let contractDigest = null, findingCode = null;
        try {
          const saved = proofReader.verify(reader => reader.readContract(row.plan_id));
          contractDigest = saved?.binding.contract_digest || null;
          if (!saved) findingCode = 'PLAN_CONTRACT_EVIDENCE_MISSING';
          else if (!verifier.verify(before)) findingCode = 'PLAN_HISTORY_PROOF_REJECTED';
        } catch { findingCode = 'PLAN_CONTRACT_EVIDENCE_CORRUPT'; }
        // Owner effect observations can happen outside the proof transaction.
        // A changed snapshot is never recorded as a successful historical proof.
        const afterFacts = proofReader.verify(reader => reader.read(row.plan_id));
        const factsDigest = canonicalDigest(afterFacts);
        if (canonicalDigest(before) !== factsDigest) findingCode = 'PLAN_HISTORY_CHANGED_DURING_AUDIT';
        const receipt = { schemaRef: FORMAT, schemaVersion: 1, verifier: VERIFIER, planId: row.plan_id,
          contractDigest, factsDigest, verdict: findingCode ? 'failed' : 'verified', findingCode };
        const auditId = canonicalDigest(receipt), json = canonicalJson(receipt);
        execute((repository, context) => {
          const existing = repository.invoke('find', { audit_id: auditId });
          if (existing && existing.audit_json !== json) throw new Error('History audit receipt collision.');
          if (!existing) repository.invoke('insert', { audit_id: auditId, plan_id: row.plan_id, audit_schema_ref: FORMAT,
            audit_json: json, created_at_ms: context.commitTimeMs });
        });
        if (findingCode) { failed++; options.onFinding?.(Object.freeze({ planId: row.plan_id, auditId, findingCode })); }
      }
      processed++; after = row.plan_id;
      await new Promise(resolve => setImmediate(resolve));
    }
    const finished = processed === rows.length && rows.length < limit;
    cursorStore.advance({ ...KEY, expectedRevision: head.revision,
      cursor: JSON.stringify({ after: finished ? null : after, nextSweepAtMs: finished ? now() + 24 * 60 * 60 * 1000 : 0 }) });
    return { kind: 'audited', processed, failed, finished };
  }
  return Object.freeze({
    scan(options) {
      if (!pending) pending = scan(options).finally(() => { pending = null; });
      return pending;
    },
  });
}

module.exports = Object.freeze({ createPlanHistoryAudit });
