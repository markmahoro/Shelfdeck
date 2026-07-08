#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.SHELFDECK_BASE_URL || 'http://192.168.12.230:18080',
    apiKey: process.env.SHELFDECK_API_KEY || '',
    canaryItemId: '',
    destructiveLibraryName: process.env.SHELFDECK_E2E_LIBRARY_NAME || '公共 国产剧库',
    out: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--api-key=')) args.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--canary-item-id=')) args.canaryItemId = arg.slice('--canary-item-id='.length);
    else if (arg.startsWith('--destructive-library-name=')) args.destructiveLibraryName = arg.slice('--destructive-library-name='.length);
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
  }
  args.baseUrl = String(args.baseUrl || '').replace(/\/+$/, '');
  return args;
}

function nowIso() {
  return new Date().toISOString();
}

function headers(args) {
  return args.apiKey ? { 'X-Api-Key': args.apiKey } : {};
}

async function requestJson(args, label, route, options = {}) {
  const started = performance.now();
  const url = `${args.baseUrl}${route}`;
  let status = 0;
  let body = null;
  let error = '';
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        ...headers(args),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  const elapsedMs = Math.round(performance.now() - started);
  return { label, route, status, elapsedMs, ok: status >= 200 && status < 300 && !error, body, error };
}

function pass(check, details = {}) {
  return { ...details, status: check ? 'pass' : 'fail' };
}

function tasksFrom(result) {
  return result && result.body && Array.isArray(result.body.tasks) ? result.body.tasks : [];
}

function configFrom(result) {
  return result && result.body && typeof result.body === 'object' ? result.body : {};
}

function libraryItemsFrom(result) {
  return result && result.body && Array.isArray(result.body.items) ? result.body.items : [];
}

function forbiddenMetadataReasons(item = {}) {
  const gate = item.metadataGate || item.lifecycleProjection && item.lifecycleProjection.metadataGate || {};
  const reasons = [
    ...(Array.isArray(gate.missingReasons) ? gate.missingReasons : []),
    ...(Array.isArray(item.metadataMissingReasons) ? item.metadataMissingReasons : []),
  ];
  return reasons.filter((reason) => [
    'decision.rating',
    'decision.watched',
    'userRating',
    'doubanRating',
    'watched',
    'playCount',
  ].includes(String(reason)));
}

function summarizeChecks(results, args) {
  const byLabel = Object.fromEntries(results.map((result) => [result.label, result]));
  const config = configFrom(byLabel.config);
  const tasks = tasksFrom(byLabel.tasks);
  const optimizeDeleteTasks = tasks.filter((task) => {
    const targetGate = task.taskTarget && task.taskTarget.targetGate || task.targetGate || task.taskBridge && task.taskBridge.kind;
    const operation = task.flowPlan && task.flowPlan.operationKind || task.operationKind;
    return targetGate === 'optimize' && operation === 'delete';
  });
  const actionTypeLeaks = tasks.filter((task) => Object.prototype.hasOwnProperty.call(task, 'actionType'));
  const removeMediaTasks = tasks.filter((task) => {
    const objective = task.taskTarget && task.taskTarget.gateObjective || {};
    return objective.kind === 'remove_media';
  });
  const canaryItems = args.canaryItemId
    ? libraryItemsFrom(byLabel.canaryLibrary).filter((item) => item.itemId === args.canaryItemId)
    : [];
  const canaryItem = byLabel.canaryDetail && byLabel.canaryDetail.body || canaryItems[0] || null;

  const checks = [
    {
      id: 'api_hot_paths_ok',
      name: 'API hot paths return successfully',
      ...pass(results.every((result) => result.ok), {
        failedRoutes: results.filter((result) => !result.ok).map((result) => `${result.label}:${result.status || result.error}`),
      }),
    },
    {
      id: 'api_hot_paths_seconds_level',
      name: 'API hot paths are seconds-level',
      ...pass(results.every((result) => result.elapsedMs < 5000), {
        slowRoutes: results.filter((result) => result.elapsedMs >= 5000).map((result) => `${result.label}:${result.elapsedMs}ms`),
      }),
    },
    {
      id: 'optimize_operations_no_delete',
      name: 'optimizeAllowedOperations does not contain delete',
      ...pass(!Array.isArray(config.optimizeAllowedOperations) || !config.optimizeAllowedOperations.includes('delete'), {
        optimizeAllowedOperations: config.optimizeAllowedOperations || [],
      }),
    },
    {
      id: 'automatic_targets_can_express_delete',
      name: 'automaticTaskTargets may express delete independently',
      ...pass(Array.isArray(config.automaticTaskTargets), {
        automaticTaskTargets: config.automaticTaskTargets || [],
      }),
    },
    {
      id: 'no_active_optimize_delete_task',
      name: 'No active targetGate=optimize task uses delete operation',
      ...pass(optimizeDeleteTasks.length === 0, { count: optimizeDeleteTasks.length }),
    },
    {
      id: 'no_remove_media_task_objective',
      name: 'No active task uses remove_media objective',
      ...pass(removeMediaTasks.length === 0, { count: removeMediaTasks.length }),
    },
    {
      id: 'no_action_type_projection',
      name: 'Task API does not expose actionType compatibility fields',
      ...pass(actionTypeLeaks.length === 0, { count: actionTypeLeaks.length }),
    },
  ];

  if (canaryItem) {
    checks.push({
      id: 'canary_metadata_gate_no_perception_blocker',
      name: 'Canary metadata gate does not wait for perception facts',
      ...pass(forbiddenMetadataReasons(canaryItem).length === 0, {
        forbiddenReasons: forbiddenMetadataReasons(canaryItem),
      }),
    });
    checks.push({
      id: 'canary_has_kairox_projection',
      name: 'Canary item exposes Kairox projection fields',
      ...pass(!!(
        canaryItem.optimizeObjectiveStatus
        || canaryItem.optimizeObjective
        || canaryItem.lifecycleNextTask
        || canaryItem.taskTarget
      ), {
        itemId: canaryItem.itemId,
        optimizeObjectiveStatus: canaryItem.optimizeObjectiveStatus || '',
        lifecycleNextTask: canaryItem.lifecycleNextTask || '',
      }),
    });
  }

  return checks;
}

function markdownReport({ args, imageTag, backupManifest, results, checks }) {
  const rows = results.map((result) => (
    `| ${result.label} | ${result.route} | ${result.status || '-'} | ${result.elapsedMs} | ${result.ok ? 'PASS' : 'FAIL'} | ${result.error || ''} |`
  )).join('\n');
  const checkRows = checks.map((check) => (
    `| ${check.id} | ${check.name} | ${check.status.toUpperCase()} | ${JSON.stringify(Object.fromEntries(Object.entries(check).filter(([key]) => !['id', 'name', 'status'].includes(key))))} |`
  )).join('\n');
  return `# Kairox Beta Production E2E

> 本文件由 \`media-service/scripts/kairox-beta-production-e2e.js\` 生成或补充。破坏性验收只能使用本次明确授权的 E2E 白名单库，不能扩散到其他生产库。

## Run Metadata

- 时间: ${nowIso()}
- 目标: \`${args.baseUrl}\`
- 镜像: ${imageTag || '待填写'}
- 备份 manifest: ${backupManifest || '待填写'}
- Canary item: ${args.canaryItemId || '未提供'}
- Destructive E2E library: ${args.destructiveLibraryName || '未提供'}

## API Timing

| Name | Route | Status | ms | Result | Error |
| --- | --- | ---: | ---: | --- | --- |
${rows}

## Automated Checks

| ID | Check | Result | Detail |
| --- | --- | --- | --- |
${checkRows}

## Manual User-View E2E

| Case | 用户视角证明 | Result | Notes |
| --- | --- | --- | --- |
| 1 Basic Navigation | Dashboard / 媒体库 / 任务中心 / 归档前目标 / 处置队列均可打开，无全页崩溃 | TODO |  |
| 2 Metadata vs Perception | 无评分 canary 不因评分缺失卡 metadata gate；需要评分时显示 pending_perception | TODO |  |
| 3 Perception Revision | 修改 canary 评分后 perceptionVersion 增加，objectiveVersion/hash 按目标变化 | TODO |  |
| 4 Optimize TargetGate | 需要本地转换时任务为 targetGate=optimize，flow selection 为 transcode | TODO |  |
| 5 Transcode Objective Verify | 转码完成后 optimize gate facts 携带 objectiveHash，生命周期进入 archive ready | TODO |  |
| 6 Archive Gate | archive task 为 targetGate=archive，archive facts/history 存在 | TODO |  |
| 7 Delete Candidate Review | 低评分 archived canary 进入处置队列，未确认前无 delete task | TODO |  |
| 8 Confirmed Delete | 确认后创建 targetGate=delete task；delete gate facts 写入，archive facts 保留 | TODO |  |
| 9 No Legacy Regression | 无 optimize.delete 新事件/任务，无 remove_media 新 objective | TODO |  |
| 10 Control Plane Smoke | 后台任务运行时页面和热路径 API 保持秒级 | TODO |  |

## Rollback Notes

- 如 cutover apply 已执行，优先使用 cutover manifest 中的备份路径恢复数据。
- 回滚前记录当前镜像、容器状态、\`/v1/health\`、任务列表和最新错误事件。
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) throw new Error('Missing --base-url');
  const imageTag = process.env.SHELFDECK_IMAGE_TAG || '';
  const backupManifest = process.env.SHELFDECK_BACKUP_MANIFEST || '';

  const routes = [
    ['health', '/v1/health'],
    ['dashboardHealth', '/v1/admin/dashboard/health'],
    ['library', '/v1/library?page=1&pageSize=20'],
    ['tasks', '/v1/tasks?activeOnly=1'],
    ['adminTasksOptimizeDelete', '/v1/admin/tasks?targetGate=optimize&selectedFlow=delete&page=1&pageSize=20'],
    ['deleteCandidates', '/v1/admin/delete-candidates'],
    ['config', '/v1/config'],
  ];
  if (args.canaryItemId) {
    routes.push(['canaryDetail', `/v1/library/items/${encodeURIComponent(args.canaryItemId)}`]);
    routes.push(['canaryLibrary', `/v1/library?itemId=${encodeURIComponent(args.canaryItemId)}&page=1&pageSize=20`]);
  }

  const results = [];
  for (const [label, route] of routes) {
    results.push(await requestJson(args, label, route));
  }
  const checks = summarizeChecks(results, args);
  const report = { generatedAt: nowIso(), baseUrl: args.baseUrl, results, checks };
  const failed = checks.filter((check) => check.status !== 'pass');

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, markdownReport({ args, imageTag, backupManifest, results, checks }), 'utf8');
  }

  console.log(JSON.stringify(report, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
