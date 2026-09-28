'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchBytes } = require('../../src/helix/integrations/h1-provider-adapters');

for (const timeout of [false,true]) test('UAT-277 Provider fetch preserves safe network diagnostics: '+timeout, async () => {
  const controller = new AbortController();
  if (timeout) controller.abort();
  await assert.rejects(fetchBytes(async () => {
    const error = new Error('request https://provider.test/?token=private-secret');
    error.cause = {code:'ECONNRESET',address:'private-address'};
    throw error;
  },'https://provider.test/?token=private-secret',{signal:controller.signal},1024), error => {
    assert.equal(error.code,'P5_PROVIDER_TRANSPORT_FAILED');
    assert.deepEqual(error.details,{networkCode:'ECONNRESET',...(timeout?{timeout:true}:{})});
    assert.equal(JSON.stringify(error).includes('private-secret'),false);
    assert.equal(JSON.stringify(error).includes('private-address'),false);
    return true;
  });
});
