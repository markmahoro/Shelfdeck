'use strict';

function runCheck(checkName, check) {
  try {
    const result = check();
    if (!result || typeof result.ok !== 'boolean') throw new TypeError('Architecture check returned no explicit outcome.');
    return result;
  } catch (error) {
    return { ok:false, findings:[{ code:'ARCHITECTURE_CHECK_EXCEPTION', checkName,
      errorCode:typeof error?.code === 'string' ? error.code : null, message:String(error?.message || error) }] };
  }
}

function fixtureReport(run, files, checks) {
  const ok = run.status === 0 && !run.error && !run.signal, allChecksPassed = checks.every(check => check.ok === true);
  return { ok, fileCount:files.length, files,
    exitCode:run.status ?? null, signal:run.signal || null,
    executionError:run.error ? { code:run.error.code || null, message:run.error.message } : null,
    // Preserve the expensive fixture evidence even when a later check fails.
    // A captured exception must fail the Gate, never erase its prior results.
    failureOutput:ok && allChecksPassed ? undefined : `${run.stdout || ''}${run.stderr || ''}` };
}

module.exports = Object.freeze({ runCheck, fixtureReport });
