'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createTriageEvidenceIndex, candidateWorkId } = require('../../src/helix/domains/procurement/persistence/triage-evidence-index');

const STRUCTURE_RESULT = 'helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result';
const D = (value) => canonicalDigest({ value });

function structurePage(pageOrdinal, units, cursorOut = null) {
  return {
    schemaRef: 'helix://contracts/types/TriageStructureEvidence/v1',
    evidenceId: D(['evidence', pageOrdinal]), payloadDigest: D(['payload', pageOrdinal]), pageOrdinal,
    cursorIn: pageOrdinal ? `offset:${pageOrdinal}` : null, cursorOut, units, unassignedMaterials: [],
  };
}

function unit(id, materialKey) {
  return { unitId: id, unitDigest: D(['unit', id]), members: [{ materialKey }], relatedReferences: [] };
}

test('Triage Evidence Index resolves Units and reuses immutable Work Results', () => {
  const a = unit(D('unit-a'), D('material-a'));
  const b = unit(D('unit-b'), D('material-b'));
  const rows = [
    { eventId: 'structure-1', resultSchemaRef: STRUCTURE_RESULT, outcomeKind: 'succeeded', resultDigest: D('result-1'), result: structurePage(0, [a], 'offset:1') },
    { eventId: 'structure-2', resultSchemaRef: STRUCTURE_RESULT, outcomeKind: 'succeeded', resultDigest: D('result-2'), result: structurePage(1, [b], null) },
  ];
  let reads = 0;
  const index = createTriageEvidenceIndex({ workResultReader: { read() { reads += 1; return rows; } } });
  const first = index.read('evidence-work');
  assert.equal(reads, 1);
  assert.equal(index.find('evidence-work', a.unitId).evidenceId, rows[0].result.evidenceId);
  assert.equal(index.find('evidence-work', b.unitId).pageOrdinal, 1);
  assert.equal(index.findCandidate(candidateWorkId('run-1', b.unitId, 1), 'run-1', 'evidence-work').unitId, b.unitId);
  assert.equal(index.findCandidate(candidateWorkId('run-2', b.unitId, 1), 'run-1', 'evidence-work'), null);
  assert.equal(index.findCandidate('procurement-candidate-work-invalid', 'run-1', 'evidence-work'), null);
  assert.strictEqual(index.read('evidence-work'), first);
  assert.equal(reads, 1);
  index.invalidate('evidence-work');
  assert.notStrictEqual(index.read('evidence-work'), first);
  assert.equal(reads, 2);
});

test('Triage Evidence Index rejects duplicate Units and overlapping Materials', () => {
  const duplicate = unit(D('unit-a'), D('material-a'));
  const duplicateIndex = createTriageEvidenceIndex({ workResultReader: { read() {
    return [{ eventId: 'one', resultSchemaRef: STRUCTURE_RESULT, outcomeKind: 'succeeded', resultDigest: D('one'), result: structurePage(0, [duplicate]) },
      { eventId: 'two', resultSchemaRef: STRUCTURE_RESULT, outcomeKind: 'succeeded', resultDigest: D('two'), result: structurePage(1, [duplicate]) }];
  } } });
  assert.throws(() => duplicateIndex.read('evidence-work'), /duplicate Triage Unit/);

  const overlap = createTriageEvidenceIndex({ workResultReader: { read() {
    return [{ eventId: 'one', resultSchemaRef: STRUCTURE_RESULT, outcomeKind: 'succeeded', resultDigest: D('one'), result: structurePage(0, [unit(D('unit-a'), D('material-a')), unit(D('unit-b'), D('material-a'))]) }];
  } } });
  assert.throws(() => overlap.read('evidence-work'), /more than one Triage Unit/);
});
