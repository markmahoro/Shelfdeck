'use strict';

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.SHELFDECK_BASE_URL || 'http://127.0.0.1:18080',
    apiKey: process.env.SHELFDECK_API_KEY || '',
    dataDir: process.env.SHELFDECK_DATA_DIR || path.join(__dirname, '..', 'data'),
    out: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--base-url=')) args.baseUrl = arg.slice('--base-url='.length);
    else if (arg.startsWith('--api-key=')) args.apiKey = arg.slice('--api-key='.length);
    else if (arg.startsWith('--data-dir=')) args.dataDir = arg.slice('--data-dir='.length);
    else if (arg.startsWith('--out=')) args.out = arg.slice('--out='.length);
  }
  args.baseUrl = args.baseUrl.replace(/\/+$/, '');
  return args;
}

function headers(args) {
  return args.apiKey ? { 'X-Api-Key': args.apiKey } : {};
}

async function fetchJson(args, label, route) {
  const started = Date.now();
  try {
    const res = await fetch(`${args.baseUrl}${route}`, { headers: headers(args) });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (_) {
      body = text;
    }
    return {
      label,
      route,
      status: res.status,
      elapsedMs: Date.now() - started,
      ok: res.ok,
      body,
      error: '',
    };
  } catch (e) {
    return {
      label,
      route,
      status: 0,
      elapsedMs: Date.now() - started,
      ok: false,
      body: null,
      error: e.message,
    };
  }
}

function fileSize(file) {
  try {
    const st = fs.statSync(file);
    return st.size;
  } catch (_) {
    return null;
  }
}

function dataFileSizes(dataDir) {
  const files = [
    'config.json',
    'library.json',
    'library.db',
    'library.db-wal',
    'library.db-shm',
    'tasks.json',
    'tasks.db',
    'tasks.db-wal',
    'tasks.db-shm',
    'diagnostic-log.jsonl',
  ];
  return files.map((name) => ({
    name,
    path: path.join(dataDir, name),
    sizeBytes: fileSize(path.join(dataDir, name)),
  }));
}

function safeGet(obj, pathParts, fallback = null) {
  let cur = obj;
  for (const part of pathParts) {
    if (!cur || typeof cur !== 'object') return fallback;
    cur = cur[part];
  }
  return cur === undefined ? fallback : cur;
}

function summarize(results, dataFiles) {
  const dashboard = results.find((r) => r.label === 'dashboardHealth') || {};
  const resources = results.find((r) => r.label === 'resources') || {};
  const tasks = results.find((r) => r.label === 'tasks') || {};
  const smartTask = safeGet(dashboard.body, ['automation', 'smartTask'], {});
  const lastScan = smartTask && smartTask.lastScanSummary || null;
  const resourceSummary = safeGet(resources.body, ['summary'], {});
  const taskSummary = safeGet(tasks.body, ['summary'], {});
  return {
    generatedAt: new Date().toISOString(),
    api: results.map((r) => ({
      label: r.label,
      route: r.route,
      status: r.status,
      elapsedMs: r.elapsedMs,
      ok: r.ok,
      error: r.error,
    })),
    smartTask: {
      status: smartTask && smartTask.status,
      enabled: smartTask && smartTask.enabled,
      enabledTaskTargets: smartTask && smartTask.enabledTaskTargets,
      allowedOptimizeFlows: smartTask && smartTask.allowedOptimizeFlows,
      lastRunAt: smartTask && smartTask.lastRunAt,
      lastScanSummary: lastScan ? {
        status: lastScan.status,
        candidateCount: lastScan.candidateCount,
        evaluatedCandidates: lastScan.evaluatedCandidates,
        enqueued: lastScan.enqueued,
        candidatesByTargetGate: lastScan.candidatesByTargetGate,
        candidatesBySelectedFlow: lastScan.candidatesBySelectedFlow,
        enqueuedByTargetGate: lastScan.enqueuedByTargetGate,
        enqueuedBySelectedFlow: lastScan.enqueuedBySelectedFlow,
        admissionRejected: lastScan.admissionRejected,
        admissionRejectedByReason: lastScan.admissionRejectedByReason,
        skippedByQueueCap: lastScan.skippedByQueueCap,
        skippedByQueueCapByTargetGate: lastScan.skippedByQueueCapByTargetGate,
        skippedByQueueCapBySelectedFlow: lastScan.skippedByQueueCapBySelectedFlow,
        skippedByResourcePressure: lastScan.skippedByResourcePressure,
        skippedByResourcePressureByResource: lastScan.skippedByResourcePressureByResource,
        skippedByResourcePressureBySelectedFlow: lastScan.skippedByResourcePressureBySelectedFlow,
        activeBacklog: lastScan.activeBacklog,
        activeBacklogByTargetGate: lastScan.activeBacklogByTargetGate,
        activeBacklogByResource: lastScan.activeBacklogByResource,
        maxPerRunReached: lastScan.maxPerRunReached,
        deferredByActiveBacklog: lastScan.deferredByActiveBacklog,
        supplyPolicy: lastScan.supplyPolicy,
        reason: lastScan.reason,
      } : null,
    },
    resources: {
      totalTasks: resourceSummary.totalTasks,
      totalEvents: resourceSummary.totalEvents,
      byState: resourceSummary.byState,
      byResourceType: resourceSummary.byResourceType,
      buckets: Array.isArray(resources.body && resources.body.resources)
        ? resources.body.resources.map((bucket) => ({
          resourceKey: bucket.resourceKey,
          configuredSlots: bucket.configuredSlots,
          running: bucket.running,
          waiting: bucket.waiting,
          blocked: bucket.blocked,
        }))
        : [],
    },
    tasks: {
      total: taskSummary.total || taskSummary.totalTasks,
      active: taskSummary.active || taskSummary.activeTasks,
      byStatus: taskSummary.byStatus,
      attention: taskSummary.attention,
    },
    dataFiles,
  };
}

function mdTable(rows, columns) {
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map((c) => c.align || '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((c) => String(c.value(row) ?? '')).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function renderMarkdown(args, summary) {
  const apiRows = summary.api;
  const dataRows = summary.dataFiles.filter((f) => f.sizeBytes !== null);
  const scan = summary.smartTask.lastScanSummary || {};
  return [
    '# Kairox Performance Smoke',
    '',
    `- 时间: ${summary.generatedAt}`,
    `- 目标: \`${args.baseUrl}\``,
    `- dataDir: \`${args.dataDir}\``,
    '',
    '## API Timing',
    '',
    mdTable(apiRows, [
      { label: 'Name', value: (r) => r.label },
      { label: 'Route', value: (r) => `\`${r.route}\`` },
      { label: 'Status', align: '---:', value: (r) => r.status },
      { label: 'ms', align: '---:', value: (r) => r.elapsedMs },
      { label: 'Result', value: (r) => (r.ok ? 'PASS' : 'FAIL') },
      { label: 'Error', value: (r) => r.error },
    ]),
    '',
    '## SmartTask Supply',
    '',
    '```json',
    JSON.stringify(scan, null, 2),
    '```',
    '',
    '## Resource Backlog',
    '',
    mdTable(summary.resources.buckets, [
      { label: 'Resource', value: (r) => `\`${r.resourceKey}\`` },
      { label: 'Slots', align: '---:', value: (r) => r.configuredSlots },
      { label: 'Running', align: '---:', value: (r) => r.running },
      { label: 'Waiting', align: '---:', value: (r) => r.waiting },
      { label: 'Blocked', align: '---:', value: (r) => r.blocked },
    ]),
    '',
    '## Data Files',
    '',
    mdTable(dataRows, [
      { label: 'File', value: (r) => `\`${r.name}\`` },
      { label: 'Bytes', align: '---:', value: (r) => r.sizeBytes },
    ]),
    '',
  ].join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const routes = [
    ['health', '/v1/health'],
    ['dashboardHealth', '/v1/admin/dashboard/health'],
    ['library', '/v1/library?page=1&pageSize=20'],
    ['tasks', '/v1/tasks?activeOnly=1'],
    ['adminTasks', '/v1/admin/tasks?page=1&pageSize=20'],
    ['resources', '/v1/admin/resources'],
    ['deleteCandidates', '/v1/admin/delete-candidates'],
    ['config', '/v1/config'],
  ];
  const results = [];
  for (const [label, route] of routes) {
    results.push(await fetchJson(args, label, route));
  }
  const summary = summarize(results, dataFileSizes(args.dataDir));
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, renderMarkdown(args, summary));
  }
  console.log(JSON.stringify(summary, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
