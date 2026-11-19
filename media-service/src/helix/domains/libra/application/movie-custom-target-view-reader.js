'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { describeCustomRequirement } = require('../../../contracts/custom-acceptance-requirements');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { assertStandardAcceptanceSpec, assertCustomAcceptanceSpec } = require('../model/custom-acceptance-spec');
const { validateBasis } = require('../model/custom-target-records');
const { observeLocalMovieMediaGaps } = require('../model/custom-target-local-media-gaps');
const { readMovieCustomSearchEvidence } = require('../planning/movie-custom-search-evidence');
const { sourceMediaObservationWork } = require('../planning/media-production-work');
const { createProductionSourceScopeResolver } = require('../planning/production-source-scope-resolver');
const { metadataResultItems, observedFieldKeys, observedMediaCastRoles } = require('../planning/product-metadata-work');
const { createCustomTargetStore } = require('../persistence/custom-target-store');

const RELAXABLE_MOVIE_FIELDS = new Set([
  'plot',
  'genre',
  'actor',
  'director',
  'release_date',
  'year_or_release_date',
]);
const RELAXABLE_MEDIA_CODES = new Set([
  'minimum_raster_unmet',
  'primary_audio_unmet',
  'video_codec_unmet',
  'container_unmet',
  'file_extension_unmet',
  'max_size_exceeded',
]);
const EXPECTED_DECODE_POINTS = Object.freeze([5, 50, 95]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function parseJson(value, message) {
  try {
    return JSON.parse(value);
  } catch {
    fail('LIBRA_CUSTOM_TARGET_VIEW_INVALID', message);
  }
}

function dedupeRefs(refs) {
  const byId = new Map();
  for (const ref of refs || []) {
    if (!ref || typeof ref.resultId !== 'string' || !ref.resultId || !/^[a-f0-9]{64}$/.test(ref.resultDigest || '')) continue;
    const existing = byId.get(ref.resultId);
    if (existing && existing.resultDigest !== ref.resultDigest) {
      fail('LIBRA_CUSTOM_TARGET_EVIDENCE', 'Conflicting result digest for custom target evidence reference.');
    }
    if (!existing) byId.set(ref.resultId, Object.freeze({ resultId: ref.resultId, resultDigest: ref.resultDigest }));
  }
  return Object.freeze([...byId.values()].sort((a, b) => Buffer.compare(Buffer.from(a.resultId), Buffer.from(b.resultId))));
}

function decodeSamplesPassed(verification) {
  const decode = verification?.decodeSummary;
  if (!decode) return false;
  return canonicalJson(decode.samplePointsPercent) === canonicalJson(EXPECTED_DECODE_POINTS) &&
    canonicalJson(decode.passedSamplePointsPercent) === canonicalJson(EXPECTED_DECODE_POINTS) &&
    /^[a-f0-9]{64}$/.test(decode.decodeDigest || '');
}

function artifactKindOfRecord(record) {
  if (record?.result?.artifactKind) return record.result.artifactKind;
  if (record?.result?.artifactHandle?.artifactKind) return record.result.artifactHandle.artifactKind;
  const req = record?.inputBindings?.bindings?.find(item => item.portName === 'artifactRequirement');
  return req?.parameters?.artifactKind || null;
}

function createMovieCustomTargetViewReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.movieProductionReader || !options.workResultReader ||
      !options.productProductionPort || !options.acquisitionCandidateEvidenceStore ||
      typeof options.readHandoffResponsibility !== 'function') {
    throw new TypeError('Movie custom target view reader requires Libra, Foundation, and Handoff owners.');
  }
  const customTargetStore = options.customTargetStore || createCustomTargetStore(options);
  const sourceScopeResolver = createProductionSourceScopeResolver({
    movieProductionReader: Object.freeze({
      ...options.movieProductionReader,
      readRun: (libraRunId) => options.movieProductionReader.readRunSnapshot(libraRunId),
    }),
    productionPort: options.productProductionPort,
  });
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_movie_custom_view_reader',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    readOnly: true,
    statements: {
      find_subject: {
        kind: 'select-one',
        tableId: 'libra_subjects',
        keyColumns: ['subject_id'],
        columns: ['subject_id', 'status', 'content_profile', 'structure_kind'],
      },
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        keyColumns: ['libra_run_id'],
        columns: ['libra_run_id', 'subject_id', 'acceptance_spec_id', 'state', 'state_revision',
          'state_digest', 'package_revision_head', 'execution_basis_digest', 'run_material_manifest_id'],
        safeIntegers: true,
      },
      find_spec: {
        kind: 'select-one',
        tableId: 'libra_acceptance_specs',
        keyColumns: ['acceptance_spec_id'],
        columns: ['acceptance_spec_id', 'subject_id', 'shelf_id', 'shelf_standard_revision', 'shelf_standard_digest',
          'product_scope_digest', 'spec_digest', 'record_digest', 'spec_json'],
        safeIntegers: true,
      },
      find_decision_head: {
        kind: 'select-one',
        tableId: 'libra_subject_decision_heads',
        keyColumns: ['subject_id'],
        columns: ['head_digest', 'current_acceptance_spec_id'],
      },
      find_manifest: {
        kind: 'select-one',
        tableId: 'libra_run_material_manifests',
        keyColumns: ['run_material_manifest_id'],
        columns: ['libra_run_id', 'member_set_digest'],
      },
    },
  });

  function readOwnerState(subjectId, libraRunId) {
    return options.unitOfWork.execute([{
      participantId: 'libra_movie_custom_view_state',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        return Object.freeze({
          subject: repo.invoke('find_subject', { subject_id: subjectId }),
          run: repo.invoke('find_run', { libra_run_id: libraRunId }),
          decisionHead: repo.invoke('find_decision_head', { subject_id: subjectId }),
        });
      },
    }]).libra_movie_custom_view_state;
  }

  function readSpecAndManifest(run) {
    return options.unitOfWork.execute([{
      participantId: 'libra_movie_custom_view_spec',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const runSpecRow = repo.invoke('find_spec', { acceptance_spec_id: run.acceptance_spec_id });
        const manifest = repo.invoke('find_manifest', { run_material_manifest_id: run.run_material_manifest_id });
        let baseSpecRow = runSpecRow;
        if (runSpecRow) {
          const parsedRunSpec = parseJson(runSpecRow.spec_json, 'Run Spec JSON is corrupt.');
          if (parsedRunSpec.targetKind === 'user_custom') {
            baseSpecRow = repo.invoke('find_spec', { acceptance_spec_id: parsedRunSpec.originalTarget?.acceptanceSpecId });
          }
        }
        return Object.freeze({ runSpecRow, baseSpecRow, manifest });
      },
    }]).libra_movie_custom_view_spec;
  }

  function read(request) {
    if (!request || typeof request.subjectId !== 'string' || !request.subjectId ||
        typeof request.libraRunId !== 'string' || !request.libraRunId) {
      fail('LIBRA_CUSTOM_TARGET_VIEW_INVALID', 'Custom target view requires exact Subject and Run identities.');
    }
    const { subjectId, libraRunId } = request;
    const owner = readOwnerState(subjectId, libraRunId);
    const { subject, run, decisionHead } = owner;
    if (!subject || subject.status !== 'active' || subject.content_profile !== 'movie' || subject.structure_kind !== 'single') {
      return Object.freeze({ kind: 'ineligible', reasonCode: 'movie_single_scope_required' });
    }
    if (!run || run.subject_id !== subjectId || !['active', 'suspended', 'frozen'].includes(run.state)) {
      return Object.freeze({ kind: 'ineligible', reasonCode: 'run_not_customizable' });
    }
    const { runSpecRow, baseSpecRow, manifest } = readSpecAndManifest(run);
    if (!runSpecRow || runSpecRow.subject_id !== subjectId || !baseSpecRow || baseSpecRow.subject_id !== subjectId ||
        !decisionHead?.head_digest || !decisionHead.current_acceptance_spec_id ||
        !manifest || manifest.libra_run_id !== libraRunId) {
      return Object.freeze({ kind: 'pending', reasonCode: 'owner_spec_context_pending' });
    }
    if (decisionHead.current_acceptance_spec_id !== run.acceptance_spec_id) {
      return Object.freeze({ kind: 'ineligible', reasonCode: 'run_spec_not_current' });
    }

    const runSpec = parseJson(runSpecRow.spec_json, 'Run Acceptance Spec is corrupt.');
    const baseSpec = assertStandardAcceptanceSpec(parseJson(baseSpecRow.spec_json, 'Base Acceptance Spec is corrupt.'));
    const priorIntent = customTargetStore.current({ subjectId, productScopeDigest: baseSpec.productScope.scopeDigest });
    let priorEvidence = null;
    if (priorIntent) {
      priorEvidence = customTargetStore.intentEvidence(priorIntent.intentId);
      if (runSpec.targetKind === 'user_custom') {
        assertCustomAcceptanceSpec({
          spec: runSpec,
          baseSpec,
          preview: priorEvidence.preview,
          intent: priorEvidence.intent,
        });
      } else if (priorIntent.basis?.libraRunId === libraRunId) {
        return Object.freeze({ kind: 'ineligible', reasonCode: 'custom_target_continuation_pending' });
      }
    } else if (runSpec.targetKind === 'user_custom') {
      fail('LIBRA_CUSTOM_TARGET_VIEW_INVALID', 'Custom Run lacks a current custom target head.');
    }

    const identityFact = options.movieProductionReader.readFact(libraRunId, 'resolved_identity', 1);
    if (!identityFact) return Object.freeze({ kind: 'pending', reasonCode: 'resolved_identity_pending' });

    const responsibility = options.readHandoffResponsibility(Object.freeze({
      subjectId,
      libraRunId,
      productScopeDigest: baseSpec.productScope.scopeDigest,
    }));
    if (!responsibility || responsibility.kind !== 'ready') {
      return Object.freeze({ kind: 'pending', reasonCode: 'handoff_responsibility_pending' });
    }
    if (responsibility.handoffState === 'accepted') {
      fail('LIBRA_CUSTOM_TARGET_ARCA_RESPONSIBILITY', 'Arca owns this accepted product; Libra cannot replace its target.');
    }

    const snapshot = options.movieProductionReader.readRunSnapshot(libraRunId);
    const sourceWork = sourceMediaObservationWork(snapshot);
    const sourceStatus = options.workResultReader.status(sourceWork.workId);
    if (!sourceStatus || sourceStatus.state !== 'succeeded') {
      return Object.freeze({ kind: 'pending', reasonCode: 'source_probe_missing' });
    }
    const sources = sourceScopeResolver.primarySources(snapshot);
    if (sources.length !== 1) return Object.freeze({ kind: 'ineligible', reasonCode: 'single_primary_required' });
    const sourceHandleDigest = canonicalDigest(sources[0].readHandle);
    const probeRecord = options.workResultReader.read(sourceWork.workId).find(item =>
      item.capabilityRef === 'shared.material.media.probe@1' &&
      item.outcomeKind === 'succeeded' &&
      item.result?.sourceHandleDigest === sourceHandleDigest) || null;
    const sourceObs = observeLocalMovieMediaGaps({
      libraRunId,
      acceptanceSpec: baseSpec,
      sourceHandleDigest,
      sourceProbeRecord: probeRecord,
    });
    if (sourceObs.status === 'evidence_pending') {
      return Object.freeze({ kind: 'pending', reasonCode: sourceObs.reasonCode });
    }

    const proposalMap = new Map();
    const addProposal = (rawChange, refs) => {
      const normalized = describeCustomRequirement(baseSpec.requirements, rawChange, []);
      const key = normalized.requirementCode + ':' + normalized.targetId;
      const existing = proposalMap.get(key);
      const mergedRefs = dedupeRefs([...(existing?.evidenceRefs || []), ...(refs || [])]);
      if (!mergedRefs.length) return;
      proposalMap.set(key, Object.freeze({ change: normalized, evidenceRefs: mergedRefs }));
    };

    const priorProposalByKey = new Map(
      (priorEvidence?.preview?.proposals || []).map(item => [
        item.change.requirementCode + ':' + item.change.targetId,
        item,
      ]),
    );

    const mediaWorks = options.workResultReader.listWorks({
      ownerDomain: 'libra', processType: 'libra_run', processId: libraRunId, workKind: 'workspace_media_production',
    });
    const mediaVerifyRecords = mediaWorks.flatMap(work =>
      options.workResultReader.read(work.work_id)
        .filter(item => item.outcomeKind === 'succeeded' && item.capabilityRef === 'libra.product_media.verify@1')
        .map(item => ({ work, item })),
    );
    const hasPassedVerify = mediaVerifyRecords.some(({ item }) => item.result?.result === 'passed');
    const externalOutputPassed = mediaVerifyRecords.some(({ work, item }) =>
      item.result?.result === 'passed' &&
      item.result.candidateKind === 'workspace_output' &&
      String(work.work_id || '').includes('import_selection'));

    if (!hasPassedVerify) {
      const fatalVerify = mediaVerifyRecords.find(({ item }) =>
        item.result?.result === 'failed' &&
        Array.isArray(item.result.reasonCodes) &&
        item.result.reasonCodes.some(code => !RELAXABLE_MEDIA_CODES.has(code)));
      if (fatalVerify && run.state === 'frozen') {
        return Object.freeze({ kind: 'ineligible', reasonCode: 'protected_media_failure' });
      }
    }

    for (const { item } of mediaVerifyRecords) {
      const verify = item.result;
      if (verify?.result !== 'failed' || !Array.isArray(verify.reasonCodes)) continue;
      if (verify.reasonCodes.includes('max_size_exceeded') &&
          verify.spaceSummary?.withinLimit === false &&
          baseSpec.requirements.space.maxSizeBytes != null &&
          decodeSamplesPassed(verify)) {
        addProposal({ requirementCode: 'max_size_exceeded', targetId: 'maxSizeBytes' }, [
          { resultId: item.resultId, resultDigest: item.resultDigest },
        ]);
      }
      if (run.state === 'frozen' && !hasPassedVerify && verify.candidateKind === 'workspace_output' && decodeSamplesPassed(verify)) {
        const formatTargets = {
          video_codec_unmet: 'videoCodec',
          container_unmet: 'container',
          file_extension_unmet: 'fileExtension',
        };
        for (const code of verify.reasonCodes) {
          if (Object.hasOwn(formatTargets, code)) {
            addProposal({ requirementCode: code, targetId: formatTargets[code] }, [
              { resultId: item.resultId, resultDigest: item.resultDigest },
            ]);
          }
        }
      }
    }

    let searchObs = null;
    if (!externalOutputPassed && sourceObs.differences.length > 0) {
      const diffToChange = {
        source_raster_below_target: { requirementCode: 'minimum_raster_unmet', targetId: 'minimumRasterClass' },
        source_audio_classes_differ: { requirementCode: 'primary_audio_unmet', targetId: 'acceptedPrimaryAudioClasses' },
      };
      const pendingChanges = [];
      for (const diff of sourceObs.differences) {
        const rawChange = diffToChange[diff.factKind];
        if (!rawChange) continue;
        const key = rawChange.requirementCode + ':' + rawChange.targetId;
        const priorMatch = runSpec.targetKind === 'user_custom' ? priorProposalByKey.get(key) : null;
        if (priorMatch) addProposal(rawChange, [sourceObs.probeResultRef, ...priorMatch.evidenceRefs]);
        else pendingChanges.push(rawChange);
      }
      if (pendingChanges.length > 0) {
        if (runSpec.targetKind === 'user_custom') {
          // A custom Run runs external search against the relaxed Spec rather than baseSpec;
          // wait for an observed search only if the base standard still needs evidence.
          return Object.freeze({ kind: 'pending', reasonCode: 'external_search_required_for_base_gap' });
        }
        searchObs = readMovieCustomSearchEvidence({
          libraRunId,
          movieProductionReader: options.movieProductionReader,
          workResultReader: options.workResultReader,
          acquisitionCandidateEvidenceStore: options.acquisitionCandidateEvidenceStore,
        });
        if (searchObs.status === 'evidence_pending') {
          return Object.freeze({ kind: 'pending', reasonCode: searchObs.reasonCode });
        }
        if (searchObs.selection.result === 'selected' && run.state !== 'frozen') {
          return Object.freeze({ kind: 'pending', reasonCode: 'external_acquisition_in_progress' });
        }
        for (const rawChange of pendingChanges) {
          addProposal(rawChange, [
            sourceObs.probeResultRef,
            { resultId: searchObs.selectionResultRef.resultId, resultDigest: searchObs.selectionResultRef.resultDigest },
          ]);
        }
      }
    }

    const metaWorks = options.workResultReader.listWorks({
      ownerDomain: 'libra', processType: 'libra_run', processId: libraRunId, workKind: 'product_metadata_observation',
    });
    const metaItems = metadataResultItems({ workResultReader: options.workResultReader }, libraRunId);
    const mediaCastFact = options.movieProductionReader.readFact(libraRunId, 'media_cast', 1);
    if (metaItems.length > 0) {
      const fields = observedFieldKeys(metaItems);
      const roles = observedMediaCastRoles(metaItems);
      const hasActor = roles.has('actor') || Boolean(mediaCastFact?.factValue?.relations?.length);
      const metaRefs = metaItems.map(item => ({ resultId: item.resultId, resultDigest: item.resultDigest }));
      for (const fieldCode of baseSpec.requirements.metadata.requiredFieldCodes || []) {
        const missing = fieldCode === 'actor' ? !hasActor : !fields.has(fieldCode);
        if (!missing) continue;
        if (!RELAXABLE_MOVIE_FIELDS.has(fieldCode)) {
          return Object.freeze({ kind: 'ineligible', reasonCode: 'protected_metadata_missing' });
        }
        addProposal({ requirementCode: 'metadata_field_unmet', targetId: fieldCode }, metaRefs);
      }
    }

    const artifactWorks = options.workResultReader.listWorks({
      ownerDomain: 'libra', processType: 'libra_run', processId: libraRunId, workKind: 'artifact_production',
    });
    for (const work of artifactWorks) {
      for (const record of options.workResultReader.read(work.work_id)) {
        if (record.capabilityRef === 'libra.product_artifact.acquire@1' &&
            record.outcomeKind === 'succeeded' &&
            record.result?.resultKind === 'not_available') {
          const kind = artifactKindOfRecord(record);
          if (kind === 'nfo') {
            return Object.freeze({ kind: 'ineligible', reasonCode: 'protected_artifact_missing' });
          }
          if (['poster', 'fanart'].includes(kind) &&
              baseSpec.requirements.metadata.requiredArtifactKinds.includes(kind)) {
            addProposal({ requirementCode: 'metadata_artifact_unmet', targetId: kind }, [
              { resultId: record.resultId, resultDigest: record.resultDigest },
            ]);
          }
        }
        if (run.state === 'frozen' &&
            ['libra.product_sidecar.render@1', 'shared.artifact.manifest.verify@1'].includes(record.capabilityRef) &&
            (record.outcomeKind === 'failed' || record.result?.result === 'failed')) {
          const kind = artifactKindOfRecord(record);
          if (!kind || kind === 'nfo') {
            return Object.freeze({ kind: 'ineligible', reasonCode: 'protected_artifact_missing' });
          }
        }
      }
    }

    if (runSpec.targetKind === 'user_custom' && priorEvidence?.preview?.proposals?.length) {
      for (const priorProposal of priorEvidence.preview.proposals) {
        if (['max_size_exceeded', 'metadata_field_unmet', 'metadata_artifact_unmet', 'video_codec_unmet',
          'container_unmet', 'file_extension_unmet'].includes(priorProposal.change.requirementCode)) {
          addProposal(priorProposal.change, priorProposal.evidenceRefs);
        }
      }
    }

    const proposals = [...proposalMap.values()].sort((left, right) =>
      Buffer.compare(Buffer.from(canonicalJson(left.change)), Buffer.from(canonicalJson(right.change))));

    if (!proposals.length) {
      const hasOpenProduction = [...metaWorks, ...artifactWorks, ...mediaWorks].some(work =>
        ['admitted', 'ready', 'running', 'blocked'].includes(work.state));
      if (run.state !== 'frozen' && (hasOpenProduction || metaWorks.some(w => w.state !== 'succeeded'))) {
        return Object.freeze({ kind: 'pending', reasonCode: 'production_in_progress' });
      }
      return Object.freeze({ kind: 'ineligible', reasonCode: 'no_relaxable_gaps' });
    }

    const gapEvidenceSetDigest = canonicalDigest({
      schema: 'libra.movie-custom-gap-evidence@1',
      libraRunId,
      baseAcceptanceSpecId: baseSpec.acceptanceSpecId,
      sourceObservationDigest: sourceObs.observationDigest,
      searchObservationDigest: searchObs?.observationDigest || null,
      proposals: proposals.map(item => ({ change: item.change, evidenceRefs: item.evidenceRefs })),
    });

    const basis = validateBasis({
      subjectId,
      libraRunId,
      runState: run.state,
      runStateRevision: Number(run.state_revision),
      runStateDigest: run.state_digest,
      runPackageRevisionHead: Number(run.package_revision_head),
      runExecutionBasisDigest: run.execution_basis_digest,
      runAcceptanceSpecId: runSpec.acceptanceSpecId,
      runSpecRecordDigest: runSpec.recordDigest,
      runSpecDigest: runSpec.specDigest,
      baseAcceptanceSpecId: baseSpec.acceptanceSpecId,
      baseSpecRecordDigest: baseSpec.recordDigest,
      baseSpecDigest: baseSpec.specDigest,
      decisionHeadDigest: decisionHead.head_digest,
      decisionHeadAcceptanceSpecId: decisionHead.current_acceptance_spec_id,
      shelfId: baseSpec.targetShelfId,
      shelfStandardDigest: baseSpec.shelfStandardDigest,
      shelfStandardRevision: baseSpec.shelfStandardRevision,
      productScopeDigest: baseSpec.productScope.scopeDigest,
      materialSetDigest: manifest.member_set_digest,
      identityDigest: identityFact.factDigest,
      gapEvidenceSetDigest,
      customTargetRevision: priorIntent ? priorIntent.revision : 0,
      handoffState: responsibility.handoffState,
      contentProfile: baseSpec.contentProfile,
      structureKind: baseSpec.structureKind,
    });

    return Object.freeze({
      kind: 'ready',
      basis,
      requirements: baseSpec.requirements,
      episodeScopes: Object.freeze([]),
      proposals: Object.freeze(proposals),
    });
  }

  return Object.freeze({ read });
}

module.exports = Object.freeze({ createMovieCustomTargetViewReader });
