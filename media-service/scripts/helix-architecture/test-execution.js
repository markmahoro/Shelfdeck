'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function planTestJobs({ serviceRoot, files, javShards = 4 }) {
  if (!Number.isSafeInteger(javShards) || javShards < 1 || javShards > 4 || new Set(files).size !== files.length) {
    throw new Error('Architecture test jobs require unique files and one to four JAV shards.');
  }
  const regular = [], shards = [];
  for (const file of files) {
    const relative = path.relative(path.join(serviceRoot, 'test/helix-architecture'), path.resolve(serviceRoot, file));
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.test.js')) throw new Error('Test file escapes the architecture suite.');
    if (path.basename(file) !== 'jav-host-journey.test.js') {
      regular.push({ file, selectedNames: null, pattern: null }); continue;
    }
    const source = fs.readFileSync(path.resolve(serviceRoot, file), 'utf8');
    const declarations = source.match(/^\s*test(?:\.(?:skip|only|todo))?\(/gm) || [];
    const names = [...source.matchAll(/^\s*test\('([^'\\\r\n]+)'\s*,/gm)].map(match => match[1]);
    if (!names.length || names.length !== declarations.length || new Set(names).size !== names.length) {
      throw new Error('JAV sharding requires unique simple literal top-level tests; unsupported declarations cannot be omitted.');
    }
    for (let index = 0; index < Math.min(javShards, names.length); index++) {
      const selectedNames = names.filter((_, ordinal) => ordinal % javShards === index);
      const escaped = selectedNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      shards.push({ file, selectedNames, pattern: '^(?:' + escaped.join('|') + ')$' });
    }
  }
  // Long, isolated JAV groups run first. The remaining independent files use
  // the same four-process ceiling instead of adding parallel work on top.
  return [...shards, ...regular];
}

function summaryOf(stdout) {
  const values = {};
  for (const name of ['tests', 'pass', 'fail', 'skipped']) {
    const matches = [...stdout.matchAll(new RegExp('^# ' + name + ' (\\d+)\\r?$', 'gm'))];
    if (matches.length !== 1) throw new Error('Test process did not produce one complete TAP summary.');
    values[name] = Number(matches[0][1]);
  }
  const filtered = (stdout.match(/# SKIP test name does not match pattern\r?$/gm) || []).length;
  if (filtered > values.skipped) throw new Error('Filtered test accounting exceeds reported skips.');
  return { ...values, filtered };
}

async function executeTestJobs({ serviceRoot, jobs, concurrency = 4, spawnProcess = spawn }) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('At most four architecture processes may run concurrently.');
  const results = new Array(jobs.length); let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const index = cursor++, job = jobs[index];
      results[index] = await new Promise(resolve => {
        const args = ['--test', '--test-concurrency=1', '--test-reporter=tap',
          ...(job.pattern ? ['--test-name-pattern=' + job.pattern] : []), job.file];
        let stdout = '', stderr = '', settled = false;
        const finish = (status, signal, error = null) => {
          if (settled) return; settled = true;
          let summary = null;
          try {
            summary = summaryOf(stdout);
            if (job.selectedNames && summary.tests - summary.filtered !== job.selectedNames.length) throw new Error('JAV shard did not account for every selected test.');
          } catch (failure) { error ||= failure.message; }
          resolve({ file: job.file, selectedNames: job.selectedNames, status, signal, error, summary, stdout, stderr });
        };
        try {
          const env = { ...process.env, NODE_ENV: 'test' }; delete env.NODE_TEST_CONTEXT;
          const child = spawnProcess(process.execPath, args, { cwd: serviceRoot, windowsHide: true,
            env, stdio: ['ignore', 'pipe', 'pipe'] });
          child.stdout.on('data', chunk => { stdout += chunk; });
          child.stderr.on('data', chunk => { stderr += chunk; });
          child.once('error', error => finish(null, null, error.message));
          child.once('close', (status, signal) => finish(status, signal));
        } catch (error) { finish(null, null, error.message); }
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const counts = results.reduce((sum, result) => {
    if (result.summary) {
      for (const key of ['tests', 'pass', 'fail', 'skipped']) sum[key] += result.summary[key] - (['tests', 'skipped'].includes(key) ? result.summary.filtered : 0);
      sum.filteredCaseExecutions += result.summary.filtered;
    }
    return sum;
  }, { tests: 0, pass: 0, fail: 0, skipped: 0, filteredCaseExecutions: 0 });
  return { ok: results.every(result => result.status === 0 && !result.signal && !result.error && result.summary?.fail === 0),
    concurrency, counts, jobs: results };
}

module.exports = Object.freeze({ planTestJobs, executeTestJobs, summaryOf });
