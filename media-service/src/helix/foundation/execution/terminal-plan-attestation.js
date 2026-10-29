'use strict';

const { canonicalDigest } = require('../../contracts/canonical-json');
const FORMAT = 'helix://foundation/evidence/VerifiedTerminalPlan/v1';
const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);
const EVENTS = new Set([...TERMINAL, 'skipped']);
const HASH = /^[a-f0-9]{64}$/;
function check(value, message) { if (!value) throw new Error(message); }

// Work.state can change when another Attempt advances. It is not part of the
// completed Attempt's evidence. All original identities, payloads and results
// remain bound; rows are sorted so SQL enumeration order is not provenance.
function terminalFactsDigest(facts) {
  const { state, ...work } = facts.work;
  const value = { ...facts, work };
  for (const key of ['nodes', 'edges', 'events', 'attempts', 'effects', 'results', 'markers'])
    value[key] = facts[key].slice().sort((a, b) => canonicalDigest(a).localeCompare(canonicalDigest(b), 'en'));
  return canonicalDigest(value);
}

function validateTerminalAttestation(evidence) {
  check(evidence && evidence.schemaRef === FORMAT && evidence.schemaVersion === 1 &&
    Object.keys(evidence).sort().join(',') === 'catalogDigest,footprint,planId,schemaRef,schemaVersion,sourceArchiveDigest,sourceCommit,verifierDigest' &&
    typeof evidence.planId === 'string' && evidence.planId.length > 0 && /^[a-f0-9]{40}$/.test(evidence.sourceCommit) &&
    ['catalogDigest', 'sourceArchiveDigest', 'verifierDigest'].every(key => HASH.test(evidence[key])) &&
    Array.isArray(evidence.footprint) && evidence.footprint.length > 0 && evidence.footprint.length <= 4096 &&
    evidence.footprint.every(row => row && Object.keys(row).sort().join(',') === 'factsDigest,planId' &&
      typeof row.planId === 'string' && row.planId.length > 0 && HASH.test(row.factsDigest)) &&
    new Set(evidence.footprint.map(row => row.planId)).size === evidence.footprint.length &&
    evidence.footprint.some(row => row.planId === evidence.planId), 'Invalid terminal attestation envelope.');
}

function proveTerminalAttestation(reader, planId, evidence) {
  validateTerminalAttestation(evidence);
  check(planId === evidence.planId, 'Terminal attestation belongs to another Plan.');
  let root;
  for (const item of evidence.footprint) {
    const facts = reader.read(item.planId);
    check(facts && facts.work && facts.workAttempt && TERMINAL.has(facts.workAttempt.state) &&
      facts.events.every(event => EVENTS.has(event.state)) && facts.attempts.every(attempt => attempt.state === 'completed') &&
      terminalFactsDigest(facts) === item.factsDigest, 'Previously verified terminal evidence changed or became active.');
    if (item.planId === planId) root = facts;
  }
  check(root.plan.catalog_digest === evidence.catalogDigest, 'Terminal attestation Catalog binding differs.');
  return root;
}

module.exports = Object.freeze({ FORMAT, terminalFactsDigest, validateTerminalAttestation, proveTerminalAttestation });
