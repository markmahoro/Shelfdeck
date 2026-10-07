'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildMediaRequirement, buildProductMediaCandidateInput, buildProductOutputSelectionInput,
  selectProductOutput } = require('../model/media-production-contracts');
const { directMediaSelectionWork } = require('./media-production-work');
const { readSourceMediaObservations } = require('./source-media-observations');
const stable = (prefix, value) => prefix + canonicalDigest(value).slice(0, 40);

function directCandidateNodeId(snapshot, member) {
  return snapshot.spec.contentProfile === 'series'
    ? stable('direct_input_', {materialKey:member.materialKey,memberDigest:canonicalDigest(member)})
    : 'direct_input';
}

function directRequirement(snapshot, sources) {
  const requirement = buildMediaRequirement(snapshot.spec);
  if (snapshot.spec.contentProfile === 'series' && requirement.space.maxSizeBytes !== null) {
    const keys = sources.flatMap(item => item.member.episodeClaims.map(claim => claim.episodeKey));
    if (sources.some(item => item.member.episodeClaims.length !== 1) || new Set(keys).size !== keys.length) {
      const error = new Error('Bounded N:M Series verification requires complete Episode allocation evidence before per-member selection.');
      error.code = 'LIBRA_SERIES_SPACE_AGGREGATION_REQUIRED';
      throw error;
    }
  }
  return requirement;
}

// Reconstruct the whole frozen set before any caller consumes a selected member.
function readDirectMediaSelections(options, snapshot, workId) {
  if (workId !== directMediaSelectionWork(snapshot).workId) throw new Error('Direct Selection Work does not match the frozen Run.');
  const sources = readSourceMediaObservations(options, snapshot);
  const requirement = directRequirement(snapshot, sources);
  const records = options.workResultReader.read(workId).filter(item => item.outcomeKind === 'succeeded');
  const verifications = records.filter(item => item.capabilityRef === 'libra.product_media.verify@1');
  const selections = records.filter(item => item.capabilityRef === 'libra.product_output.select@1');
  if (verifications.length !== sources.length || selections.length !== sources.length)
    throw new Error('Direct Results do not cover the complete frozen Primary set.');
  const used = new Set();
  return Object.freeze(sources.map(source => {
    const input = buildProductMediaCandidateInput({libraRunId:snapshot.run.libraRunId,
      candidateNodeId:directCandidateNodeId(snapshot, source.member),candidateKind:'direct_input',
      mediaRequirement:requirement,sourceMaterialHandle:source.readHandle,sourceProbeEvidence:source.record.result});
    const matches = verifications.filter(item => item.result.candidateId === input.candidateId);
    if (matches.length !== 1) throw new Error('Direct Verification is missing or ambiguous for a Primary.');
    const verification = matches[0].result;
    if (verification.libraRunId !== snapshot.run.libraRunId || verification.candidateKind !== 'direct_input' ||
        verification.candidateNodeId !== input.candidateNodeId || verification.candidateBasisDigest !== input.candidateBasisDigest ||
        verification.productMaterialHandleId !== source.readHandle.handleId ||
        verification.productMaterialHandleDigest !== canonicalDigest(source.readHandle) ||
        verification.productMaterialFenceDigest !== source.readHandle.fenceDigest ||
        verification.mediaRequirementDigest !== requirement.requirementDigest ||
        verification.sourceProbeEvidenceDigest !== canonicalDigest(source.record.result))
      throw new Error('Direct Verification differs from its frozen Primary basis.');
    const selectionInput = buildProductOutputSelectionInput({libraRunId:snapshot.run.libraRunId,
      acceptanceSpecId:snapshot.spec.acceptanceSpecId,acceptanceSpecRecordDigest:snapshot.spec.recordDigest,
      mediaRequirementDigest:requirement.requirementDigest,
      rankedCandidates:[{rank:1,candidateId:input.candidateId,candidateNodeId:input.candidateNodeId}],candidates:[verification]});
    const selected = selections.filter(item => item.result.criteriaId === selectionInput.criteria.criteriaId);
    if (selected.length !== 1 || used.has(selected[0])) throw new Error('Direct Selection is missing or duplicated for a Primary.');
    used.add(selected[0]);
    const selection = selected[0].result;
    if (canonicalJson(selection) !== canonicalJson(selectProductOutput({input:selectionInput,producedAtMs:selection.producedAtMs})))
      throw new Error('Direct Selection differs from the exact member Verification.');
    return Object.freeze({...source,verification,selection,verificationRecord:matches[0],selectionRecord:selected[0]});
  }));
}

module.exports = Object.freeze({directCandidateNodeId, directRequirement, readDirectMediaSelections});
