'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { writeAtomic } = require('../src/clean-runtime-operations');

function fail(code) { throw Object.assign(new Error(code), { code }); }
function realDirectory(value) {
  const key = text => process.platform === 'win32' ? text.toLowerCase() : text;
  if (!path.isAbsolute(value) || !fs.lstatSync(value).isDirectory() || fs.lstatSync(value).isSymbolicLink() ||
      key(fs.realpathSync.native(value)) !== key(path.resolve(value))) fail('RESET_PROCESS_DIRECTORY_UNSAFE');
}

// A separate process is required: SQLite's temporary-directory choice is
// process-wide. Worker threads must not change the running Host's environment,
// and an on-disk sort must not silently consume the small application volume.
function runFreshResetProcess({ spec, action, request }) {
  if (!spec || !/^[a-f0-9]{64}$/.test(spec.generationId) || !['inspect', 'prepare', 'apply', 'run'].includes(action))
    fail('RESET_PROCESS_INPUT_INVALID');
  realDirectory(spec.operationRoot);
  const privateRoot = path.join(spec.operationRoot, spec.generationId + '-operator');
  if (!fs.existsSync(privateRoot)) fs.mkdirSync(privateRoot, { mode: 0o700 });
  realDirectory(privateRoot);
  const temporaryRoot = path.join(privateRoot, 'sqlite-temp');
  if (!fs.existsSync(temporaryRoot)) fs.mkdirSync(temporaryRoot, { mode: 0o700 });
  realDirectory(temporaryRoot);
  if (fs.statSync(temporaryRoot).dev !== fs.statSync(spec.operationRoot).dev) fail('RESET_PROCESS_TEMP_VOLUME_MISMATCH');
  const body = { schemaRef: 'formation-reset-process-request@1', spec, action, request: request || null, temporaryRoot };
  const requestDigest = canonicalDigest(body), requestFile = path.join(privateRoot, requestDigest + '.json');
  if (fs.existsSync(requestFile)) {
    if (fs.lstatSync(requestFile).isSymbolicLink() || canonicalDigest(JSON.parse(fs.readFileSync(requestFile, 'utf8'))) !== requestDigest)
      fail('RESET_PROCESS_REQUEST_CHANGED');
  } else writeAtomic(requestFile, body);
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, 'formation-reset-process-child.js'), [requestFile, requestDigest], {
      env: { ...process.env, SQLITE_TMPDIR: temporaryRoot, TMPDIR: temporaryRoot, TMP: temporaryRoot, TEMP: temporaryRoot },
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    let result, failure, resultCount = 0;
    child.on('message', message => {
      if (++resultCount !== 1 || message?.requestDigest !== requestDigest) {
        failure = Object.assign(new Error('RESET_PROCESS_PROTOCOL_INVALID'), { code: 'RESET_PROCESS_PROTOCOL_INVALID' });
        return;
      }
      if (message.kind === 'result') result = message.value;
      else failure = Object.assign(new Error(message.code || 'RESET_PROCESS_FAILED'), { code: message.code || 'RESET_PROCESS_FAILED' });
    });
    child.on('error', error => { failure = error; });
    // Do not report success on an IPC message while the child can still write.
    // Its actual process close is part of the cold Operator's completion fence.
    child.on('close', (code, signal) => {
      if (failure) reject(failure);
      else if (code !== 0 || signal || resultCount !== 1 || !result)
        reject(Object.assign(new Error('RESET_PROCESS_EXITED'), { code: 'RESET_PROCESS_EXITED' }));
      else resolve(result);
    });
  });
}

module.exports = Object.freeze({ runFreshResetProcess });
