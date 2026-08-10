'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

/*
 * Structure Results are immutable durable facts.  This index is deliberately
 * process-local: it is rebuilt from the durable Work Results after restart and
 * never becomes a second business fact or schema.
 */
class TriageEvidenceIndexError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'TriageEvidenceIndexError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new TriageEvidenceIndexError(code, message, details); }

const STRUCTURE_RESULT = 'helix://contracts/capabilities/procurement.triage.structure.inspect/v1/result';
const BDMV_ASSESSMENT_RESULT = 'helix://contracts/capabilities/procurement.triage.bdmv.assess/v1/result';

function candidateWorkId(runId, unitId, ordinal) {
  return 'procurement-candidate-work-' + String(ordinal).padStart(4, '0') + '-' + canonicalDigest({ runId, unitId }).slice(0, 32);
}

function createTriageEvidenceIndex(options) {
  if (!options || !options.workResultReader || typeof options.workResultReader.read !== 'function') {
    fail('P7_TRIAGE_INDEX_DEPENDENCIES', 'Triage Evidence Index requires a Work Result Reader.');
  }
  const cache = new Map();

  function build(workId) {
    const allRows = options.workResultReader.read(workId);
    const rows = allRows
      .filter((item) => item.outcomeKind === 'succeeded' && item.resultSchemaRef === STRUCTURE_RESULT)
      .sort((left, right) => Number(left.result.pageOrdinal) - Number(right.result.pageOrdinal));
    const unitsById = new Map();
    const materialToUnit = new Map();
    const units = [];
    for (const row of rows) {
      const result = row.result;
      for (const unit of result.units || []) {
        if (unitsById.has(unit.unitId)) {
          fail('P7_TRIAGE_INDEX_DUPLICATE_UNIT', 'Structure Evidence contains a duplicate Triage Unit.', { workId, unitId: unit.unitId });
        }
        const entry = Object.freeze({
          unitId: unit.unitId,
          unitDigest: unit.unitDigest,
          evidenceId: result.evidenceId,
          payloadDigest: result.payloadDigest,
          pageOrdinal: Number(result.pageOrdinal),
          pageCursorIn: result.cursorIn,
          pageCursorOut: result.cursorOut,
          structure: Object.freeze(result),
          unit: Object.freeze(unit),
          ordinal: units.length,
        });
        unitsById.set(unit.unitId, entry);
        units.push(entry);
        for (const member of unit.members || []) {
          if (materialToUnit.has(member.materialKey) && materialToUnit.get(member.materialKey) !== unit.unitId) {
            fail('P7_TRIAGE_INDEX_MATERIAL_OVERLAP', 'A Material belongs to more than one Triage Unit.', {
              workId, materialKey: member.materialKey, leftUnitId: materialToUnit.get(member.materialKey), rightUnitId: unit.unitId,
            });
          }
          materialToUnit.set(member.materialKey, unit.unitId);
        }
      }
    }
    const signature = rows.map((row) => String(row.eventId) + ':' + String(row.resultDigest)).join('|');
    return Object.freeze({
      workId,
      signature,
      structurePages: Object.freeze(rows.map((row) => Object.freeze({
        eventId: row.eventId, evidenceId: row.result.evidenceId, payloadDigest: row.result.payloadDigest,
        pageOrdinal: Number(row.result.pageOrdinal), cursorIn: row.result.cursorIn, cursorOut: row.result.cursorOut,
      }))),
      structureResults: Object.freeze(rows.map((row) => Object.freeze(row.result))),
      units: Object.freeze(units),
      unitsById,
      materialToUnit,
      bdmvAssessments: new Map(allRows
        .filter((item) => item.outcomeKind === 'succeeded' && item.resultSchemaRef === BDMV_ASSESSMENT_RESULT && item.result?.scopeDigest)
        .map((item) => [item.result.scopeDigest, Object.freeze(item.result)])),
      terminal: rows.length > 0 && rows.at(-1).result.cursorOut === null,
    });
  }

  function read(workId, optionsForRead = {}) {
    if (typeof workId !== 'string' || !workId) fail('P7_TRIAGE_INDEX_WORK_ID', 'Evidence Work id is required.');
    const cached = cache.get(workId);
    if (cached && !optionsForRead.refresh) return cached;
    const index = build(workId);
    cache.set(workId, index);
    return index;
  }

  return Object.freeze({
    read,
    find(workId, unitId) {
      const entry = read(workId).unitsById.get(unitId);
      return entry || null;
    },
    findBdmvAssessment(workId, scopeDigest) {
      if (typeof scopeDigest !== 'string' || !scopeDigest) return null;
      return read(workId).bdmvAssessments.get(scopeDigest) || null;
    },
    findCandidate(workId, runId, evidenceWorkId) {
      if (typeof runId !== 'string' || typeof evidenceWorkId !== 'string') return null;
      return read(evidenceWorkId).units.find((entry) => candidateWorkId(runId, entry.unitId, entry.ordinal) === workId) || null;
    },
    invalidate(workId) { if (typeof workId === 'string' && workId) cache.delete(workId); },
    clear() { cache.clear(); },
  });
}

module.exports = Object.freeze({ TriageEvidenceIndexError, createTriageEvidenceIndex, STRUCTURE_RESULT, BDMV_ASSESSMENT_RESULT, candidateWorkId });
