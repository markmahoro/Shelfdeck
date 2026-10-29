'use strict';

const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { createHash } = require('node:crypto');
const { createSqliteUnitOfWork } = require('../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFreshResetOfferWithdrawalRetention } = require('../src/helix/domains/arca/public');

function fail(code) { throw Object.assign(new Error(code), { code }); }

function readOnlyUnitOfWork(database) {
  if (!database.readonly || !database.inTransaction) fail('RESET_WITHDRAWAL_SNAPSHOT_REQUIRED');
  return createSqliteUnitOfWork({ kernel: { runPrimitive(operation) {
    return operation(Object.freeze({ commitTimeMs:0, prepare:sql => database.prepare(sql) }));
  } } });
}

// Source and candidate are the same frozen reset operation. Only exact retained
// producer or consumer responsibilities make an old withdrawal necessary.
function createWithdrawalDependencies({ source, target, schemaManifest }) {
  const exists = Boolean(source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='arca_offer_withdrawal_receipts'").get());
  if (!exists) return Object.freeze({ sourceAvailable:false, eachRequired() {}, verifyProof() { fail('RESET_WITHDRAWAL_PROOF_INVALID'); } });
  const owner = createFreshResetOfferWithdrawalRetention({ schemaManifest, unitOfWork:readOnlyUnitOfWork(source) });
  const run = target.prepare('SELECT 1 FROM libra_runs WHERE libra_run_id=?');
  const pkg = target.prepare('SELECT 1 FROM libra_product_packages WHERE on_deck_package_id=? OR offer_id=?');
  const work = target.prepare("SELECT 1 FROM fx_supporting_works WHERE (owner_domain='libra' AND process_type='libra_run' AND process_id=?) OR (owner_domain='arca' AND process_type='arca_acceptance' AND process_id=?) LIMIT 1");
  const outbox = target.prepare("SELECT 1 FROM fx_outbox WHERE producer_domain='libra' AND ((aggregate_type='on_deck_package' AND aggregate_id=?) OR (message_kind='libra.product-offer.available@1' AND json_extract(payload_json,'$.offerId')=?)) LIMIT 1");
  const command = target.prepare("SELECT 1 FROM fx_command_receipts WHERE owner_domain='arca' AND target_type='handoff_b_offer' AND target_id=? LIMIT 1");
  function required(receipt) {
    const offer=receipt.offer;
    return Boolean(run.get(offer.libraRunId)||pkg.get(offer.onDeckPackageId,offer.offerId)||
      work.get(offer.libraRunId,offer.offerId)||outbox.get(offer.onDeckPackageId,offer.offerId)||command.get(offer.offerId));
  }
  function eachRequired(callback) {
    let cursor=null, rows;
    while ((rows=owner.page(cursor)).length) {
      for (const receipt of rows) if (required(receipt)) {
        owner.assertNotAccepted(receipt);
        callback(receipt);
      }
      cursor=rows.at(-1).offer.offerId;
    }
  }
  function verifyProof(database, receipt) {
    const offer=receipt.offer, id=canonicalDigest({schema:'arca.offer-withdrawal-command@1',offer}),
      requestDigest=canonicalDigest({schema:'arca.offer-withdrawal@1',offer,reasonCode:'target_not_current'}),
      cmd=database.prepare('SELECT * FROM fx_command_receipts WHERE command_receipt_id=?').get(id),
      marker=database.prepare('SELECT * FROM fx_commit_markers WHERE commit_marker=?').get(id),
      audit=database.prepare('SELECT * FROM fx_audit_records WHERE audit_id=?').get(id),
      at=receipt.closedAtMs;
    if (!cmd || cmd.owner_domain!=='arca' || cmd.command_contract!=='arca.offer-withdrawal@1' ||
        cmd.caller_scope!=='arca.offer-lifecycle' || cmd.idempotency_key!==offer.offerId || cmd.request_digest!==requestDigest ||
        cmd.target_type!=='handoff_b_offer' || cmd.target_id!==offer.offerId || cmd.result_schema_ref!==receipt.schemaRef ||
        cmd.result_ref_json!==canonicalJson(receipt) || cmd.result_digest!==canonicalDigest(receipt) || Number(cmd.committed_at_ms)!==at ||
        !marker || marker.owner_domain!=='arca' || marker.scope_type!=='handoff_b_offer' || marker.scope_id!==offer.offerId ||
        marker.commit_digest!==requestDigest || marker.effect_id!==null || Number(marker.committed_at_ms)!==at ||
        !audit || audit.owner_domain!=='arca' || audit.actor_type!=='system' || audit.actor_id!=='arca.offer-lifecycle' ||
        audit.action!=='arca.offer.withdraw' || audit.scope_type!=='handoff_b_offer' || audit.scope_id!==offer.offerId ||
        audit.evidence_digest!==requestDigest || Number(audit.occurred_at_ms)!==at) fail('RESET_WITHDRAWAL_PROOF_INVALID');
    return id;
  }
  return Object.freeze({ sourceAvailable:true, eachRequired, verifyProof });
}

function verifyRetainedWithdrawals(source,target,schemaManifest) {
  const dependencies=createWithdrawalDependencies({source,target,schemaManifest});
  const targetOwner=createFreshResetOfferWithdrawalRetention({schemaManifest,unitOfWork:readOnlyUnitOfWork(target)});
  let count=0;
  const hash=createHash('sha256');hash.update('[');
  dependencies.eachRequired(receipt=>{
    const kept=targetOwner.read(receipt.offer.offerId);
    if (!kept || canonicalJson(kept)!==canonicalJson(receipt)) fail('RESET_WITHDRAWAL_PROOF_INVALID');
    dependencies.verifyProof(source,receipt);
    dependencies.verifyProof(target,receipt);
    if(count++)hash.update(',');
    hash.update(canonicalJson({offerId:receipt.offer.offerId,receiptDigest:receipt.receiptDigest}));
  });
  let cursor=null,rows,total=0;
  while((rows=targetOwner.page(cursor)).length){
    total+=rows.length;
    cursor=rows.at(-1).offer.offerId;
  }
  if(total!==count)fail('RESET_WITHDRAWAL_PROOF_INVALID');
  hash.update(']');
  return Object.freeze({count,digest:hash.digest('hex')});
}

module.exports = Object.freeze({ createWithdrawalDependencies, verifyRetainedWithdrawals });
