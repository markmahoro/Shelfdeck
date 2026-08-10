'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createProcurementCandidateContextReader } = require('../../src/helix/domains/procurement/persistence/procurement-candidate-context-reader');
const { createCandidateManifestInputProjection } = require('../../src/helix/domains/procurement/planning/candidate-assembly-planner');

const D = (label) => canonicalDigest({ label });

function identity(label, inode) {
  const value = {
    schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',
    schemaVersion:2,
    mountScopeId:'mount-1',
    inode:String(inode),
    sizeBytes:100,
    fingerprintAlgorithm:'middle-256k-sha256',
    fingerprintVersion:1,
    contentFingerprint:D(`content:${label}`),
  };
  return { ...value, materialKey:canonicalDigest({ schema:'physical-material-identity@2', ...value }) };
}

function relatedScope(parentRelativeLocation, stemKey, associationMode) {
  const value = {
    scopeKind:'ordinary_parent',
    parentRelativeLocation,
    stemKey,
    associationMode,
    observationProjectionRevision:1,
    relatedRuleRevision:1,
  };
  return { ...value, scopeDigest:canonicalDigest({ schema:'procurement.related-scope@1', ...value }) };
}

function fixture({ primaryLocation, scopeRoot, scopeKind, associationMode, observed }) {
  const primaryIdentity = identity('primary', 1);
  const scopeKey = scopeKind === 'standalone_file'
    ? `standalone-file:${primaryLocation}`
    : `ordinary-directory:${scopeRoot}`;
  const memberSetDigest = canonicalDigest({
    schema:'procurement.selection-scope-members@1',
    items:[{ materialKey:primaryIdentity.materialKey, fieldRelativeLocation:primaryLocation, scopeMemberOrdinal:0 }],
  });
  const scopeValue = {
    scopeOrdinal:0,
    scopeKind,
    scopeKey,
    scopeRootRelativeLocation:scopeRoot,
    memberCount:1,
    memberSetDigest,
  };
  const scope = {
    ...scopeValue,
    scopeDigest:canonicalDigest({
      schema:'procurement.selection-scope@1',
      scopeKind,
      scopeKey,
      scopeRootRelativeLocation:scopeRoot,
      memberCount:1,
      memberSetDigest,
    }),
  };
  const scopeSetDigest = canonicalDigest({ schema:'procurement.selection-scope-set@1', scopes:[scope] });
  const controlEvidence = D('control-evidence');
  const controlValue = {
    materialKey:primaryIdentity.materialKey,
    resultKind:'available',
    controlRevision:0,
    controlState:'uncontrolled',
    regionProjection:'uncontrolled',
    evidenceDigest:controlEvidence,
  };
  const controlProjectionDigest = canonicalDigest(controlValue);
  const member = {
    procurement_run_id:'run-1',
    ordinal:0,
    material_key:primaryIdentity.materialKey,
    selection_role:'triage_input',
    field_relative_location:primaryLocation,
    selection_scope_kind:scopeKind,
    selection_scope_key:scopeKey,
    selection_scope_root_relative_location:scopeRoot,
    selection_scope_ordinal:0,
    scope_member_ordinal:0,
    selection_scope_member_count:1,
    selection_scope_member_set_digest:memberSetDigest,
    selection_scope_digest:scope.scopeDigest,
    mount_scope_id:primaryIdentity.mountScopeId,
    inode:primaryIdentity.inode,
    size_bytes:primaryIdentity.sizeBytes,
    fingerprint_algorithm:primaryIdentity.fingerprintAlgorithm,
    fingerprint_version:primaryIdentity.fingerprintVersion,
    content_fingerprint:primaryIdentity.contentFingerprint,
    binding_revision:1,
    eligibility_revision:1,
    eligibility_basis_digest:D('eligibility'),
    last_snapshot_digest:D('snapshot'),
    last_observation_id:'observation-1',
    endpoint_id:'endpoint-1',
    location:primaryLocation,
    reality_digest:D('reality'),
    provenance_digest:D('provenance'),
    expected_control_revision:0,
    expected_control_state:'uncontrolled',
    expected_control_owner_domain:null,
    expected_control_owner_scope_type:null,
    expected_control_owner_scope_id:null,
    expected_control_region_projection:'uncontrolled',
    expected_control_evidence_digest:controlEvidence,
    expected_control_projection_digest:controlProjectionDigest,
    admission_control_action:'acquire',
    admitted_control_revision:1,
    admitted_control_projection_digest:D('admitted-control'),
    basis_member_digest:D('basis-member'),
  };
  const run = {
    procurement_run_id:'run-1',
    field_id:'field-1',
    selected_material_count:1,
    selection_scope_count:1,
    selection_scope_set_digest:scopeSetDigest,
    run_basis_digest:D('run-basis'),
  };
  const access = { root_location:'.' };
  const materialContext = { member, identity:primaryIdentity, current:null };
  const queriedScopes = [];
  const scopeValueForUnit = relatedScope(
    primaryLocation.includes('/') ? primaryLocation.slice(0, primaryLocation.lastIndexOf('/')) : '.',
    primaryLocation.split('/').at(-1).replace(/\.[^.]+$/, '').toLocaleLowerCase('en-US'),
    associationMode,
  );
  const entry = {
    unit:{
      unitId:'unit-1',
      relatedScope:scopeValueForUnit,
      members:[{
        materialKey:primaryIdentity.materialKey,
        bindingRevision:1,
        admittedControlRevision:1,
        admittedControlProjectionDigest:member.admitted_control_projection_digest,
        role:'primary_payload',
        episodeClaims:[],
      }],
    },
    structure:{ evidenceId:'structure-1' },
    ordinal:0,
    evidenceId:'structure-1',
    payloadDigest:D('structure-payload'),
  };
  const reader = createProcurementCandidateContextReader({
    triageRuleRegistry:createDefaultTriageRuleRegistry(),
    evidenceIndex:{ find:() => entry },
    triageReader:{
      readRunBasis:() => ({ run, access, selectionScopes:[scope], members:[member] }),
      readCandidate:() => ({
        run,
        access,
        selectionScopes:[scope],
        materials:[materialContext],
        candidateMaterials:[materialContext],
      }),
      listObservedMaterialsInScope(runId, requestedScope) {
        queriedScopes.push([runId, requestedScope]);
        return observed;
      },
    },
  });
  return {
    context:reader.read({
      runId:'run-1',
      evidenceWorkId:'evidence-work-1',
      unitId:'unit-1',
      workId:'candidate-work-1',
      executionBasisDigest:run.run_basis_digest,
    }),
    queriedScopes,
  };
}

function observed(location, label, inode) {
  const value = identity(label, inode);
  return {
    identity:value,
    relativeLocation:location,
    location,
    endpointId:'endpoint-1',
    entryDigest:D(`entry:${label}`),
  };
}

test('Candidate Context applies bounded Related rules for standalone, single-film and multi-film scopes', () => {
  const standalone = fixture({
    primaryLocation:'苹果.mkv',
    scopeRoot:'苹果.mkv',
    scopeKind:'standalone_file',
    associationMode:'standalone_same_stem',
    observed:[
      observed('苹果.chinese.srt', 'apple-subtitle', 2),
      observed('poster.jpg', 'root-poster', 3),
      observed('Other.srt', 'other-subtitle', 4),
    ],
  });
  assert.deepEqual(standalone.queriedScopes, [['run-1', '.']]);
  assert.deepEqual(standalone.context.relatedReferences.map((item) => item.location), ['苹果.chinese.srt']);

  const single = fixture({
    primaryLocation:'One Movie/Feature.mkv',
    scopeRoot:'One Movie',
    scopeKind:'ordinary_directory',
    associationMode:'single_movie_directory',
    observed:[
      observed('One Movie/Feature.zh.srt', 'feature-subtitle', 5),
      observed('One Movie/movie.nfo', 'movie-nfo', 6),
      observed('One Movie/poster.jpg', 'movie-poster', 7),
      observed('One Movie/Other.srt', 'other-in-directory', 8),
    ],
  });
  assert.deepEqual(single.queriedScopes, [['run-1', 'One Movie']]);
  assert.deepEqual(single.context.relatedReferences.map((item) => item.location).sort(), [
    'One Movie/Feature.zh.srt',
    'One Movie/movie.nfo',
    'One Movie/poster.jpg',
  ]);

  const multi = fixture({
    primaryLocation:'Mixed/First.mkv',
    scopeRoot:'Mixed',
    scopeKind:'ordinary_directory',
    associationMode:'multi_movie_directory',
    observed:[
      observed('Mixed/First.zh.srt', 'first-subtitle', 9),
      observed('Mixed/poster.jpg', 'generic-poster', 10),
      observed('Mixed/Second.nfo', 'second-nfo', 11),
    ],
  });
  assert.deepEqual(multi.queriedScopes, [['run-1', 'Mixed']]);
  assert.deepEqual(multi.context.relatedReferences.map((item) => item.location), ['Mixed/First.zh.srt']);
});

test('Manifest projection carries only the current Candidate members even when its Run has 1024 selected Materials', () => {
  const value = fixture({
    primaryLocation:'苹果.mkv',
    scopeRoot:'苹果.mkv',
    scopeKind:'standalone_file',
    associationMode:'standalone_same_stem',
    observed:[observed('苹果.nfo', 'apple-nfo', 20)],
  }).context;
  const context = Object.freeze({ ...value, snapshot:Object.freeze({ ...value.snapshot,
    run:Object.freeze({ ...value.snapshot.run, selected_material_count:1024, selection_scope_count:1024 }) }) });
  const projection=createCandidateManifestInputProjection({
    triageReader:{readRunHeader:()=>context.snapshot.run},
    candidateContextReader:{read:()=>context},
  });
  const input=projection.project({ownerScope:{processId:'run-1'},parameters:{unitId:'unit-1',workId:'candidate-work-1'}});
  assert.equal(Object.hasOwn(input,'selectedFieldMaterialSet'),false);
  assert.equal(input.candidateMembers.length,1);
  assert.equal(input.candidateMembers[0].materialKey,context.candidateMembers[0].materialKey);
  assert.ok(Buffer.byteLength(JSON.stringify(input))<16*1024);
});
