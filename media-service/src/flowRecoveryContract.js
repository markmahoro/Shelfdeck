'use strict';

const MAX_MANUAL_RECOVERY_RETRIES = 3;

const FLOW_RECOVERY_CONTRACTS = {
  ingest: {
    flowKey: 'ingest',
    defaultResumePoint: 'ingest_precheck',
    resumePoints: {
      ingest_precheck: {
        label: 'Ingest precheck',
        retryStrategy: 'restart_step',
        idempotency: 'read_only_precheck',
        userAction: 'inspect_file_and_sub_library',
      },
      ingest_commit: {
        label: 'Commit media item',
        retryStrategy: 'resume_step',
        idempotency: 'upsert_item_by_asset_identity',
        userAction: 'inspect_file_path_if_missing',
      },
    },
  },
  scrape: {
    flowKey: 'scrape',
    defaultResumePoint: 'scrape_precheck',
    resumePoints: {
      scrape_precheck: {
        label: 'Scrape precheck',
        retryStrategy: 'restart_step',
        idempotency: 'read_only_precheck',
        userAction: 'inspect_identity_or_source_config',
      },
      scrape_executing: {
        label: 'Fetch or repair metadata',
        retryStrategy: 'resume_step',
        idempotency: 'flow_specific_external_fetch',
        userAction: 'inspect_gate_missing_reasons',
      },
      scrape_write_metadata: {
        label: 'Write metadata facts',
        retryStrategy: 'resume_step',
        idempotency: 'upsert_metadata_facts',
        userAction: 'inspect_partial_metadata_outputs',
      },
      scrape_review: {
        label: 'Review scrape result',
        retryStrategy: 'user_gated',
        idempotency: 'no_external_mutation_until_confirmed',
        userAction: 'confirm_or_correct_metadata',
      },
    },
  },
  transcode: {
    flowKey: 'transcode',
    defaultResumePoint: 'transcode_precheck',
    resumePoints: {
      transcode_precheck: {
        label: 'Transcode precheck',
        retryStrategy: 'restart_step',
        idempotency: 'rebuild_work_dir_and_probe',
        userAction: 'inspect_source_and_encoder_config',
      },
      transcode_executing: {
        label: 'Encode media',
        retryStrategy: 'resume_step',
        idempotency: 'replace_partial_output',
        userAction: 'inspect_encoder_failure',
      },
      transcode_verify: {
        label: 'Verify encoded output',
        retryStrategy: 'resume_step',
        idempotency: 'read_only_probe_partial_output',
        userAction: 'inspect_verify_failure',
      },
      transcode_replace: {
        label: 'Replace source with output',
        retryStrategy: 'resume_step',
        idempotency: 'verify_before_mutation',
        userAction: 'confirm_or_inspect_replace_target',
      },
    },
  },
  upgrade: {
    flowKey: 'upgrade',
    defaultResumePoint: 'upgrade_precheck',
    resumePoints: {
      upgrade_precheck: {
        label: 'Upgrade precheck',
        retryStrategy: 'restart_step',
        idempotency: 'read_only_precheck',
        userAction: 'inspect_moviepilot_config',
      },
      upgrade_planning: {
        label: 'Search and plan upgrade',
        retryStrategy: 'resume_step',
        idempotency: 'read_only_search',
        userAction: 'inspect_candidate_search',
      },
      upgrade_executing: {
        label: 'Request or wait for download',
        retryStrategy: 'resume_step',
        idempotency: 'flow_specific_moviepilot_request',
        userAction: 'inspect_moviepilot_download_state',
      },
      upgrade_pre_replace_verify: {
        label: 'Verify upgraded source',
        retryStrategy: 'resume_step',
        idempotency: 'read_only_verify',
        userAction: 'inspect_identity_mismatch',
      },
      upgrade_replace: {
        label: 'Replace current media',
        retryStrategy: 'resume_step',
        idempotency: 'verify_before_mutation',
        userAction: 'confirm_or_inspect_replace_target',
      },
    },
  },
  delete: {
    flowKey: 'delete',
    defaultResumePoint: 'delete_precheck',
    resumePoints: {
      delete_precheck: {
        label: 'Delete precheck',
        retryStrategy: 'restart_step',
        idempotency: 'read_only_precheck',
        userAction: 'inspect_path_safety',
      },
      delete_executing: {
        label: 'Execute delete',
        retryStrategy: 'user_gated',
        idempotency: 'delete_is_irreversible_but_missing_target_is_success',
        userAction: 'confirm_delete_or_inspect_target',
      },
      delete_verify: {
        label: 'Verify delete result',
        retryStrategy: 'resume_step',
        idempotency: 'read_only_missing_target_check',
        userAction: 'inspect_delete_verify_failure',
      },
    },
  },
};

function flowKeyForTask(task) {
  return String(
    task && task.flowPlan && task.flowPlan.operationKind
    || task && task.actionType
    || '',
  );
}

function getContract(flowKey) {
  return FLOW_RECOVERY_CONTRACTS[String(flowKey || '')] || null;
}

function resumePointEntries(contract) {
  return Object.entries((contract && contract.resumePoints) || {}).map(([resumePoint, info]) => ({
    resumePoint,
    ...info,
  }));
}

function buildRecoveryPlan(task) {
  const status = task && task.status;
  const flowKey = flowKeyForTask(task);
  const contract = getContract(flowKey);
  const retryCount = Number(task && task.retryCount || 0) || 0;
  const defaultResumePoint = contract && contract.defaultResumePoint || '';
  const resumePoint = task && task.resumePoint || defaultResumePoint;

  if (status === 'interrupted' || status === 'paused') {
    return {
      available: true,
      reason: 'resume_available',
      action: 'execute',
      effect: status === 'paused' ? 'resume_from_pause' : 'resume_after_interruption',
      label: status === 'paused' ? '恢复任务' : '从中断点继续',
      flowKey,
      resumePoint: task && task.resumePoint || '',
      retryCount,
      maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    };
  }

  if (status !== 'failed_hard' && status !== 'failed_soft') {
    return {
      available: false,
      reason: 'not_failed_or_interrupted',
      action: 'inspect_status',
      effect: 'recovery_not_required',
      label: '无需恢复',
      flowKey,
      resumePoint: task && task.resumePoint || '',
      retryCount,
      maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    };
  }

  if (!contract) {
    return {
      available: false,
      reason: 'unsupported_flow',
      action: 'inspect_events',
      effect: 'flow_has_no_recovery_contract',
      label: '查看事件',
      flowKey,
      resumePoint: task && task.resumePoint || '',
      retryCount,
      maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    };
  }

  if (retryCount >= MAX_MANUAL_RECOVERY_RETRIES) {
    return {
      available: false,
      reason: 'retry_limit_reached',
      action: 'inspect_events',
      effect: 'manual_recovery_retry_limit_reached',
      label: '查看事件',
      flowKey,
      resumePoint,
      retryCount,
      maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    };
  }

  if (!contract.resumePoints[resumePoint]) {
    return {
      available: false,
      reason: 'unknown_resume_point',
      action: 'inspect_events',
      effect: 'resume_point_not_in_flow_recovery_contract',
      label: '查看事件',
      flowKey,
      resumePoint,
      retryCount,
      maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    };
  }

  return {
    available: true,
    reason: 'failed_task_retry_available',
    action: 'retry',
    effect: task && task.resumePoint ? 'queue_failed_task_from_resume_point' : 'queue_failed_task_from_flow_start',
    label: task && task.resumePoint ? '从失败点重试' : '重新排队',
    flowKey,
    resumePoint,
    retryCount,
    maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    resumePointContract: contract.resumePoints[resumePoint],
  };
}

function buildContractProjection(task) {
  const flowKey = flowKeyForTask(task);
  const contract = getContract(flowKey);
  const plan = buildRecoveryPlan(task);
  return {
    flowKey,
    available: !!contract,
    reason: contract ? 'contract_available' : 'unsupported_flow',
    defaultResumePoint: contract && contract.defaultResumePoint || '',
    currentResumePoint: plan.resumePoint || task && task.resumePoint || '',
    maxRetryCount: MAX_MANUAL_RECOVERY_RETRIES,
    resumePoints: resumePointEntries(contract),
  };
}

module.exports = {
  MAX_MANUAL_RECOVERY_RETRIES,
  FLOW_RECOVERY_CONTRACTS,
  getContract,
  buildRecoveryPlan,
  buildContractProjection,
};
