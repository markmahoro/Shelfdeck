'use strict';

const path = require('node:path');
const { planTestJobs, executeTestJobs } = require('./helix-architecture/test-execution');
const serviceRoot = path.resolve(__dirname, '..');
(async () => {
  const files = process.argv.slice(2);
  if (!files.length) throw new Error('Architecture suite cannot be empty.');
  const jobs = planTestJobs({ serviceRoot, files });
  const result = await executeTestJobs({ serviceRoot, jobs });
  process.stdout.write(JSON.stringify({ ...result, strategy: 'bounded-files-with-complete-jav-case-shards', sourceFileCount: files.length }) + '\n');
  if (!result.ok) process.exitCode = 1;
})().catch(error => { process.stderr.write(error.stack + '\n'); process.exitCode = 1; });
