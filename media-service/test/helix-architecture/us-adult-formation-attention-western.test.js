'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFormation, westernAdultProductIdentityIssue } = require('../../src/helix/domains/libra/application/formation-query');

function work(workId, state) {
  return { workId, state, events: [] };
}

const observation = work('libra-us-adult-catalogue-observation-work-abc', 'succeeded');
const openFrames = work('libra-us-adult-catalogue-initial-frames-work-abc', 'running');
const idleFrames = work('libra-us-adult-catalogue-initial-frames-work-abc', 'succeeded');

test('open catalogue frame work does not raise product identity Attention', () => {
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [openFrames],
  }), null);
});

test('catalogue Basis without a succeeded observation stays in progress', () => {
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [idleFrames],
  }), null);
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [],
  }), null);
});

test('idle succeeded catalogue observation stays in progress (name-first; no fake registration Attention)', () => {
  const issue = westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [idleFrames, observation],
  });
  assert.equal(issue, null);
  assert.equal(classifyFormation({
    run: { state: 'active' }, works: [idleFrames, observation], issue,
  }), 'in_progress');
});

test('open People catalogue image prep suppresses product identity Attention', () => {
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [idleFrames, observation], peoplePrepOpen: true,
  }), null);
});

test('local analysis and blocked catalogue work stay out of registration Attention', () => {
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis',
    works: [observation, work('libra-us-adult-match-1-work-x', 'succeeded')],
  }), null);
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis',
    works: [work('libra-us-adult-catalogue-observation-work-abc', 'failed')],
  }), null);
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis',
    works: [observation, work('libra-us-adult-frames-work-1', 'succeeded')],
  }), null);
});

test('a closed match without a winner stays unmatched Attention', () => {
  const withBasis = westernAdultProductIdentityIssue({
    basisDigest: 'basis',
    completion: { winner: null, completionDigest: 'done' },
    works: [observation],
  });
  assert.equal(withBasis.reasonCode, 'us_adult_catalogue_unresolved');
  assert.equal(withBasis.candidateSetDigest, 'done');
  const local = westernAdultProductIdentityIssue({
    completion: { winner: null, completionDigest: 'local' },
    works: [work('libra-us-adult-frames-work-1', 'succeeded')],
  });
  assert.equal(local.reasonCode, 'us_adult_actor_unmatched');
});

test('a package, choice, decision, or winner suppresses the registration wait', () => {
  const closed = { basisDigest: 'basis', works: [idleFrames, observation] };
  assert.equal(westernAdultProductIdentityIssue({ ...closed, packaged: true }), null);
  assert.equal(westernAdultProductIdentityIssue({ ...closed, hasChoice: true }), null);
  assert.equal(westernAdultProductIdentityIssue({ ...closed, catalogueDecision: true }), null);
  assert.equal(westernAdultProductIdentityIssue({
    ...closed, completion: { winner: { personId: 'person' }, completionDigest: 'won' },
  }), null);
});

test('catalogue settlement provider failure is Attention-visible productIdentityIssue', () => {
  const issue = westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [idleFrames, observation],
    settlementFailure: { reasonCode: 'PEOPLE_CATALOGUE_PROVIDER_FAILED' },
  });
  assert.equal(issue.reasonCode, 'PEOPLE_CATALOGUE_PROVIDER_FAILED');
  assert.equal(issue.result, 'unachievable');
  assert.equal(classifyFormation({
    run: { state: 'active' }, works: [idleFrames, observation], issue,
  }), 'attention_required');
  assert.equal(westernAdultProductIdentityIssue({
    basisDigest: 'basis', works: [idleFrames, observation], catalogueDecision: true,
    settlementFailure: { reasonCode: 'PEOPLE_CATALOGUE_PROVIDER_FAILED' },
  }), null);
});
