'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const ACTION_ID = 'formation-retirement-history-integrity';
const CONTRACT = 'libra.formation-retirement@1';
const RESULT = 'libra.formation-retirement-receipt@1';
const STATE = 'administratively_retired';
const SCHEMA = 'platform.operator-maintenance.formation-retirement-history-integrity@1';

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, statusCode: 409, details });
}

function parseResult(row) {
  try {
    return JSON.parse(row.result_ref_json);
  } catch {
    return null;
  }
}

function inspect(database) {
  const receipts = database.prepare(`
    SELECT receipt.command_receipt_id, receipt.request_digest, receipt.target_id, receipt.result_schema_ref,
           receipt.result_ref_json, receipt.result_digest, receipt.committed_at_ms,
           subject.subject_id AS subject_row_id, subject.status AS subject_status, subject.terminal_at_ms,
           marker.commit_marker AS marker_id, marker.owner_domain AS marker_owner_domain,
           marker.scope_type AS marker_scope_type, marker.scope_id AS marker_scope_id,
           marker.commit_digest AS marker_commit_digest
      FROM fx_command_receipts receipt
      LEFT JOIN libra_subjects subject
        ON subject.subject_id = receipt.target_id
      LEFT JOIN fx_commit_markers marker
        ON marker.commit_marker = receipt.command_receipt_id
     WHERE receipt.owner_domain = 'libra'
       AND receipt.command_contract = ?
       AND receipt.target_type = 'subject'
     ORDER BY receipt.command_receipt_id
  `).all(CONTRACT);

  const bySubject = new Map();
  const rebuildMarkers = [];
  const orphanReceipts = [];
  const blockers = [];

  for (const row of receipts) {
    if (!row.subject_row_id) {
      orphanReceipts.push(Object.freeze({
        commandReceiptId: row.command_receipt_id,
        targetId: row.target_id,
        hasMarker: Boolean(row.marker_id),
        committedAtMs: Number(row.committed_at_ms),
      }));
      continue;
    }

    const bucket = bySubject.get(row.target_id) || [];
    bucket.push(row);
    bySubject.set(row.target_id, bucket);
  }

  for (const [subjectId, rows] of bySubject) {
    if (rows.length !== 1) {
      blockers.push(Object.freeze({
        code: 'RETIREMENT_RECEIPT_NOT_UNIQUE',
        subjectId,
        receiptCount: rows.length,
        message: 'Subject has multiple formation-retirement receipts; refuse automatic repair.',
      }));
      continue;
    }
    const row = rows[0];
    const result = parseResult(row);
    const resultOk = row.result_schema_ref === RESULT && result && result.resultKind === STATE &&
      result.subjectId === subjectId && canonicalDigest(result) === row.result_digest &&
      Number(row.committed_at_ms) === Number(row.terminal_at_ms);

    if (row.subject_status !== STATE) {
      if (!row.marker_id || !resultOk) {
        blockers.push(Object.freeze({
          code: 'RETIREMENT_SUBJECT_STATUS_UNEXPECTED',
          subjectId,
          status: row.subject_status,
          message: 'Retirement receipt exists but Subject is not administratively_retired.',
        }));
      }
      continue;
    }

    if (!resultOk) {
      blockers.push(Object.freeze({
        code: 'RETIREMENT_RECEIPT_CORRUPT',
        subjectId,
        commandReceiptId: row.command_receipt_id,
        message: 'Retirement receipt result does not match Subject retirement evidence.',
      }));
      continue;
    }

    if (!row.marker_id) {
      rebuildMarkers.push(Object.freeze({
        subjectId,
        commandReceiptId: row.command_receipt_id,
        requestDigest: row.request_digest,
        committedAtMs: Number(row.committed_at_ms),
      }));
      continue;
    }

    if (row.marker_owner_domain !== 'libra' || row.marker_scope_type !== 'subject' ||
        row.marker_scope_id !== subjectId || row.marker_commit_digest !== row.request_digest) {
      blockers.push(Object.freeze({
        code: 'RETIREMENT_MARKER_MISMATCH',
        subjectId,
        commandReceiptId: row.command_receipt_id,
        message: 'Existing retirement commit marker does not match the receipt; refuse overwrite.',
      }));
    }
  }

  const retiredWithoutReceipt = database.prepare(`
    SELECT subject.subject_id
      FROM libra_subjects subject
      LEFT JOIN fx_command_receipts receipt
        ON receipt.owner_domain = 'libra'
       AND receipt.command_contract = ?
       AND receipt.target_type = 'subject'
       AND receipt.target_id = subject.subject_id
     WHERE subject.status = ?
       AND receipt.command_receipt_id IS NULL
     ORDER BY subject.subject_id
  `).all(CONTRACT, STATE);

  for (const row of retiredWithoutReceipt) {
    blockers.push(Object.freeze({
      code: 'RETIREMENT_RECEIPT_MISSING',
      subjectId: row.subject_id,
      message: 'Administratively retired Subject has no formation-retirement receipt; refuse invention.',
    }));
  }

  return Object.freeze({
    rebuildMarkers: Object.freeze(rebuildMarkers),
    orphanReceipts: Object.freeze(orphanReceipts),
    blockers: Object.freeze(blockers),
  });
}

function createFormationRetirementHistoryIntegrityAction(options = {}) {
  return Object.freeze({
    actionId: ACTION_ID,
    title: 'Formation 退役历史完整性修复',
    summary: '从幸存 retirement receipt 重建缺失的 fx_commit_markers，并清除 Subject 已不存在的孤儿 retirement receipt；不是 Formation Reset，也不软跳过 ended 历史校验。',
    requiresStopped: true,
    preview(context) {
      const found = inspect(context.database);
      const ready = found.blockers.length === 0;
      const body = {
        schemaRef: SCHEMA,
        actionId: ACTION_ID,
        title: 'Formation 退役历史完整性修复',
        ready,
        blockers: found.blockers,
        summary: Object.freeze({
          missingMarkerCount: found.rebuildMarkers.length,
          orphanReceiptCount: found.orphanReceipts.length,
          rebuildMarkerCount: found.rebuildMarkers.length,
          clearOrphanReceiptCount: found.orphanReceipts.length,
          blockerCount: found.blockers.length,
        }),
        rebuildMarkers: found.rebuildMarkers,
        orphanReceipts: found.orphanReceipts,
      };
      return Object.freeze(body);
    },
    apply(preview, context) {
      if (!preview || preview.actionId !== ACTION_ID || preview.schemaRef !== SCHEMA) {
        fail('OPERATOR_MAINTENANCE_PREVIEW_INVALID', '维护预览与已注册动作不匹配。');
      }
      if (!preview.ready) {
        fail('OPERATOR_MAINTENANCE_BLOCKED', '当前维护动作存在阻断项，不能执行。', { blockers: preview.blockers });
      }
      const current = inspect(context.database);
      if (canonicalDigest(current.rebuildMarkers) !== canonicalDigest(preview.rebuildMarkers) ||
          canonicalDigest(current.orphanReceipts) !== canonicalDigest(preview.orphanReceipts) ||
          canonicalDigest(current.blockers) !== canonicalDigest(preview.blockers)) {
        fail('OPERATOR_MAINTENANCE_PREVIEW_STALE', '维护范围已变化，请重新预览并确认。');
      }

      const nowMs = context.nowMs;
      const actorId = context.actor?.actorId || 'admin';
      const rebuilt = [];
      const cleared = [];

      const insertMarker = context.database.prepare(`
        INSERT INTO fx_commit_markers
          (commit_marker, effect_id, owner_domain, scope_type, scope_id, commit_digest,
           result_id, result_schema_ref, result_digest, committed_at_ms)
        VALUES (?, NULL, 'libra', 'subject', ?, ?, NULL, NULL, NULL, ?)
      `);
      const deleteMarker = context.database.prepare('DELETE FROM fx_commit_markers WHERE commit_marker = ?');
      const deleteReceipt = context.database.prepare('DELETE FROM fx_command_receipts WHERE command_receipt_id = ?');
      const insertAudit = context.database.prepare(`
        INSERT INTO fx_audit_records
          (audit_id, owner_domain, actor_type, actor_id, action, scope_type, scope_id,
           work_id, event_id, evidence_digest, occurred_at_ms)
        VALUES (?, 'platform', 'admin', ?, ?, ?, ?, NULL, NULL, ?, ?)
      `);

      const run = context.database.transaction(() => {
        for (const item of current.rebuildMarkers) {
          insertMarker.run(item.commandReceiptId, item.subjectId, item.requestDigest, item.committedAtMs);
          const evidenceDigest = canonicalDigest({
            schema: 'platform.operator-maintenance.rebuild-retirement-marker@1',
            commandReceiptId: item.commandReceiptId,
            subjectId: item.subjectId,
            requestDigest: item.requestDigest,
            committedAtMs: item.committedAtMs,
          });
          insertAudit.run(
            'maintenance-rebuild-marker:' + evidenceDigest,
            actorId,
            'rebuild_formation_retirement_commit_marker',
            'subject',
            item.subjectId,
            evidenceDigest,
            nowMs,
          );
          rebuilt.push(item.commandReceiptId);
        }
        for (const item of current.orphanReceipts) {
          if (item.hasMarker) deleteMarker.run(item.commandReceiptId);
          const removed = deleteReceipt.run(item.commandReceiptId);
          if (removed.changes !== 1) {
            fail('OPERATOR_MAINTENANCE_APPLY_CAS_FAILED', '孤儿 retirement receipt 在执行期间发生变化。', {
              commandReceiptId: item.commandReceiptId,
            });
          }
          const evidenceDigest = canonicalDigest({
            schema: 'platform.operator-maintenance.clear-orphan-retirement-receipt@1',
            commandReceiptId: item.commandReceiptId,
            targetId: item.targetId,
            hadMarker: item.hasMarker,
          });
          insertAudit.run(
            'maintenance-clear-orphan-receipt:' + evidenceDigest,
            actorId,
            'clear_orphan_formation_retirement_receipt',
            'command_receipt',
            item.commandReceiptId,
            evidenceDigest,
            nowMs,
          );
          cleared.push(item.commandReceiptId);
        }
        const fk = context.database.pragma('foreign_key_check');
        if (fk.length) {
          fail('OPERATOR_MAINTENANCE_FOREIGN_KEY_CHECK_FAILED', '维护写入后外键校验失败。', { findings: fk.slice(0, 8) });
        }
      });
      run();

      return Object.freeze({
        schemaRef: 'platform.operator-maintenance-result@1',
        actionId: ACTION_ID,
        rebuiltMarkerCount: rebuilt.length,
        clearedOrphanReceiptCount: cleared.length,
        rebuiltMarkerIds: Object.freeze(rebuilt),
        clearedOrphanReceiptIds: Object.freeze(cleared),
      });
    },
  });
}

module.exports = Object.freeze({
  ACTION_ID,
  createFormationRetirementHistoryIntegrityAction,
});
