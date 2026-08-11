'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const {
  FINGERPRINT_SAMPLE_BYTES,
} = require('../src/helix/integrations/bounded-material-fingerprint');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function emit(kind, value = {}) {
  process.stdout.write(`${JSON.stringify({
    kind,
    at: new Date().toISOString(),
    ...value,
  })}\n`);
}

function sourceReality(root) {
  const pending = [root];
  const facts = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    entries.sort((left, right) => Buffer.compare(
      Buffer.from(left.name, 'utf8'),
      Buffer.from(right.name, 'utf8'),
    ));
    for (const entry of entries) {
      const location = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(location);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(location, { bigint: true });
      facts.push([
        path.relative(root, location).replace(/\\/gu, '/'),
        String(stat.ino),
        String(stat.size),
        String(stat.mtimeNs),
        String(stat.ctimeNs),
      ]);
    }
  }
  facts.sort((left, right) => Buffer.compare(
    Buffer.from(left[0], 'utf8'),
    Buffer.from(right[0], 'utf8'),
  ));
  return Object.freeze({
    regularFileCount: facts.length,
    digest: canonicalDigest({
      schema: 'helix.local-intake-canary-source-reality@1',
      facts,
    }),
  });
}

function count(database, table, where = '1=1') {
  return database.prepare(
    `SELECT count(*) count FROM ${table} WHERE ${where}`,
  ).get().count;
}

function snapshot(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const runRows = database.prepare(
      'SELECT state,count(*) count FROM proc_procurement_runs GROUP BY state ORDER BY state',
    ).all();
    const workRows = database.prepare(
      'SELECT state,count(*) count FROM fx_supporting_works GROUP BY state ORDER BY state',
    ).all();
    const eventRows = database.prepare(
      'SELECT state,count(*) count FROM fx_workflow_events GROUP BY state ORDER BY state',
    ).all();
    return Object.freeze({
      observationEntries: count(database, 'proc_field_observation_entries'),
      observations: count(database, 'proc_field_observations'),
      observationState: database.prepare(
        "SELECT state FROM fx_supporting_works WHERE work_kind='field_observation' ORDER BY created_at_ms DESC LIMIT 1",
      ).get()?.state || null,
      runs: runRows,
      runCount: runRows.reduce((total, row) => total + row.count, 0),
      sealedRuns: runRows.find((row) => row.state === 'sealed')?.count || 0,
      works: workRows,
      nonterminalWorks: workRows
        .filter((row) => !['succeeded', 'failed', 'cancelled'].includes(row.state))
        .reduce((total, row) => total + row.count, 0),
      events: eventRows,
      candidates: count(database, 'proc_candidate_packages'),
      openOffers: count(database, 'proc_candidate_deliveries', "state='open'"),
      acceptedDeliveries: count(
        database,
        'proc_candidate_deliveries',
        "state='accepted'",
      ),
      rejectedDeliveries: count(
        database,
        'proc_candidate_deliveries',
        "state='rejected'",
      ),
      acceptedIntakes: count(
        database,
        'libra_intake_decisions',
        "decision_kind='accepted_resolution'",
      ),
      rejectedIntakes: count(
        database,
        'libra_intake_decisions',
        "decision_kind='rejected_resolution'",
      ),
      subjects: count(database, 'libra_subjects'),
      primaryBindings: count(
        database,
        'libra_material_bindings',
        "authority_kind='primary_control'",
      ),
      relatedBindings: count(
        database,
        'libra_material_bindings',
        "authority_kind='related_derived'",
      ),
      libraRuns: count(database, 'libra_runs'),
      libraWorkspaces: count(database, 'libra_workspaces'),
      arcaMediaFacts:
        count(database, 'arca_shelf_entries') +
        count(database, 'arca_ondeck_runs') +
        count(database, 'arca_material_bindings') +
        count(database, 'arca_deck_fact_revisions'),
      failedWorks: count(database, 'fx_supporting_works', "state='failed'"),
      expectedBusinessFailedWorks: database.prepare(
        `SELECT count(DISTINCT w.work_id) count
         FROM fx_supporting_works w
         JOIN fx_work_attempts a ON a.work_id=w.work_id
         WHERE w.state='failed'
           AND a.failure_code='candidate_disposition_scope_unrepresentable'`,
      ).get().count,
      technicalFailedWorks: database.prepare(
        `SELECT count(DISTINCT w.work_id) count
         FROM fx_supporting_works w
         LEFT JOIN fx_work_attempts a ON a.work_id=w.work_id
         WHERE w.state='failed'
           AND COALESCE(a.failure_code,'')<>'candidate_disposition_scope_unrepresentable'`,
      ).get().count,
      failedWorkCodes: database.prepare(
        `SELECT a.failure_code failureCode,count(DISTINCT w.work_id) count
         FROM fx_supporting_works w
         JOIN fx_work_attempts a ON a.work_id=w.work_id
         WHERE w.state='failed'
         GROUP BY a.failure_code ORDER BY a.failure_code`,
      ).all(),
      failedEvents: count(database, 'fx_workflow_events', "state='failed'"),
      formationStages: database.prepare(
        `SELECT CASE
           WHEN r.libra_run_id IS NOT NULL THEN 'run_exists'
           ELSE 'awaiting_destination'
         END stage,count(*) count
         FROM libra_subjects s
         LEFT JOIN libra_runs r ON r.subject_id=s.subject_id
         GROUP BY stage ORDER BY stage`,
      ).all(),
    });
  } finally {
    database.close();
  }
}

async function session(host, apiKey) {
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  if (response.statusCode !== 204) {
    fail('CANARY_SESSION_FAILED', response.body);
  }
  return response.headers['set-cookie'];
}

async function main() {
  const root = path.resolve(process.argv[2] || '');
  const expectedCandidates = Number(process.argv[3] || 19);
  if (!root || !fs.statSync(root).isDirectory() ||
      !Number.isSafeInteger(expectedCandidates) || expectedCandidates < 1) {
    fail(
      'CANARY_ARGUMENT_INVALID',
      'Usage: node scripts/helix-local-intake-canary.js <movie-field-root> [expected-candidates]',
    );
  }

  const startedAtMs = Date.now();
  const sourceBefore = sourceReality(root);
  const canaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'helix-local-intake-canary-'),
  );
  const dataDir = path.join(canaryRoot, 'data');
  const adminDistDir = path.join(canaryRoot, 'admin');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.writeFileSync(
    path.join(adminDistDir, 'index.html'),
    '<div id="root"></div>',
  );
  const secretRoot = `helix-local-intake-${crypto.randomUUID()}`;
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  const fingerprintReads = new Map();
  let logicalReadBytes = 0;
  let readCalls = 0;
  let runtimeError = null;
  let restarted = false;

  function onFingerprintRead(read) {
    if (read.requestedBytes > FINGERPRINT_SAMPLE_BYTES ||
        read.bytesRead > FINGERPRINT_SAMPLE_BYTES) {
      fail(
        'CANARY_FINGERPRINT_READ_LIMIT_EXCEEDED',
        'One Physical Material read exceeded 256 KiB.',
      );
    }
    const next = (fingerprintReads.get(read.location) || 0) + read.bytesRead;
    fingerprintReads.set(read.location, next);
    logicalReadBytes += read.bytesRead;
    readCalls += 1;
    if (next > FINGERPRINT_SAMPLE_BYTES ||
        logicalReadBytes > fingerprintReads.size * FINGERPRINT_SAMPLE_BYTES) {
      fail(
        'CANARY_FINGERPRINT_TOTAL_LIMIT_EXCEEDED',
        'Cumulative Physical Material reads exceeded N x 256 KiB.',
      );
    }
  }

  const hostOptions = {
    dataDir,
    adminDistDir,
    secretRoot,
    onPhysicalMaterialFingerprintRead: onFingerprintRead,
    onExecutionRuntimeError(error) {
      runtimeError = error;
      emit('runtime_error', {
        code: error.code || error.name,
        message: error.message,
      });
    },
  };
  let host = await createCleanServiceHost(hostOptions);
  let closing = false;
  async function close() {
    if (closing) return;
    closing = true;
    await host.close();
  }

  emit('started', {
    root,
    expectedCandidates,
    sourceBefore,
    canaryRoot,
    databasePath,
  });

  try {
    const cookie = await session(host, initialized.adminApiKey);
    const fieldId = 'local-intake-canary-field';
    const policyValue = {
      includedDirectories: [],
      excludedDirectories: [],
      allowedExtensions: [
        '.avi', '.bdmv', '.bup', '.clpi', '.ifo', '.iso', '.m2ts',
        '.mkv', '.mov', '.mp4', '.mpls', '.ts', '.vob',
      ],
      minimumSizeBytes: 0,
      excludedMaterialKeys: [],
    };
    const policyBasis = {
      extractionPolicyId: 'local-intake-canary-policy',
      revision: 1,
      ...policyValue,
    };
    const rootDigest = canonicalDigest(root);
    const accessBasis = {
      fieldId,
      revision: 1,
      endpointId: `local-readonly-${rootDigest.slice(0, 16)}`,
      rootLocation: root,
      mountScopeId: `local-intake-${rootDigest.slice(0, 16)}`,
      mountScopeRevision: 1,
      accessSchemaRef: 'helix://canary/local-readonly-field/v1',
    };
    const created = await host.inject({
      method: 'POST',
      url: '/v1/admin/material-fields',
      headers: { cookie },
      payload: {
        idempotencyKey: 'local-intake-canary-register',
        fieldId,
        name: 'Local Intake Canary Field',
        contentProfileHint: 'movie',
        policy: {
          extractionPolicyId: policyBasis.extractionPolicyId,
          revision: 1,
          policySchemaRef:
            'helix://contracts/domain-types/ExtractionPolicy/v1',
          policy: policyValue,
          policyDigest: canonicalDigest(policyBasis),
        },
        access: {
          ...accessBasis,
          accessDigest: canonicalDigest(accessBasis),
        },
      },
    });
    if (created.statusCode !== 201) {
      fail('CANARY_FIELD_REGISTRATION_FAILED', created.body);
    }
    const observed = await host.inject({
      method: 'POST',
      url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
      headers: { cookie },
      payload: {
        idempotencyKey: 'local-intake-canary-observe',
        fieldId,
        expectedAccessRevision: 1,
        expectedObservationRevision: 0,
        pageBudget: 256,
      },
    });
    if (observed.statusCode !== 202) {
      fail('CANARY_OBSERVATION_ADMISSION_FAILED', observed.body);
    }

    const deadline = Date.now() + 10 * 60 * 1000;
    let lastProgressAtMs = Date.now();
    let previousSignature = null;
    let finalFacts = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const facts = snapshot(databasePath);
      finalFacts = facts;
      const signature = canonicalDigest(facts);
      if (signature !== previousSignature) {
        previousSignature = signature;
        lastProgressAtMs = Date.now();
      }
      emit('progress', {
        elapsedMs: Date.now() - startedAtMs,
        ...facts,
        logicalReadBytes,
        fingerprintedRegularFiles: fingerprintReads.size,
        readCalls,
        rssBytes: process.memoryUsage().rss,
        restarted,
      });
      if (runtimeError) throw runtimeError;
      if (facts.technicalFailedWorks > 0 || facts.failedEvents > 0) {
        fail(
          'CANARY_FOUNDATION_FAILURE',
          'A Foundation Work or Event failed.',
        );
      }
      if (facts.libraRuns > 0 || facts.libraWorkspaces > 0 ||
          facts.arcaMediaFacts > 0) {
        fail(
          'CANARY_SCOPE_BOUNDARY_VIOLATION',
          'Canary crossed the Intake-only boundary.',
        );
      }
      if (!restarted && facts.observationEntries > 0 &&
          facts.nonterminalWorks > 0 &&
          (facts.observationState !== 'succeeded' ||
            facts.acceptedIntakes < expectedCandidates)) {
        await host.close();
        closing = false;
        host = await createCleanServiceHost(hostOptions);
        restarted = true;
        emit('restart_complete', {
          observationEntries: facts.observationEntries,
          logicalReadBytes,
        });
      }
      const terminal =
        facts.observationState === 'succeeded' &&
        facts.runCount > 0 && facts.sealedRuns === facts.runCount &&
        facts.candidates === expectedCandidates &&
        facts.acceptedDeliveries === expectedCandidates &&
        facts.openOffers === 0 &&
        facts.acceptedIntakes === expectedCandidates &&
        facts.subjects === expectedCandidates &&
        facts.nonterminalWorks === 0;
      if (terminal) break;
      if (Date.now() - lastProgressAtMs > 60_000) {
        fail(
          'CANARY_UNEXPLAINED_STALL',
          'No durable progress was observed for 60 seconds.',
        );
      }
    }

    if (!finalFacts ||
        finalFacts.candidates !== expectedCandidates ||
        finalFacts.acceptedDeliveries !== expectedCandidates ||
        finalFacts.acceptedIntakes !== expectedCandidates ||
        finalFacts.subjects !== expectedCandidates ||
        finalFacts.openOffers !== 0 ||
        finalFacts.rejectedDeliveries !== 0 ||
        finalFacts.rejectedIntakes !== 0 ||
        finalFacts.runCount < 1 ||
        finalFacts.sealedRuns !== finalFacts.runCount ||
        finalFacts.observationState !== 'succeeded' ||
        finalFacts.nonterminalWorks !== 0) {
      fail(
        'CANARY_TERMINAL_FACTS_MISMATCH',
        `Intake facts did not reach the expected terminal state: ${JSON.stringify(finalFacts)}`,
      );
    }
    if (!restarted) {
      fail(
        'CANARY_RECOVERY_NOT_EXERCISED',
        'The Intake Canary reached terminal state without exercising process recovery.',
      );
    }

    const verificationDatabase = new Database(databasePath, { readonly: true });
    const inputForms = verificationDatabase.prepare(
      `SELECT display_identity displayIdentity,material_input_form materialInputForm
       FROM proc_candidate_packages
       WHERE display_identity IN ('SDT-G08-ISO (2008)','SDT-G09-DVD (1989)')
       ORDER BY display_identity`,
    ).all();
    verificationDatabase.close();
    const byIdentity = new Map(inputForms.map((item) => [item.displayIdentity, item.materialInputForm]));
    if (byIdentity.get('SDT-G08-ISO (2008)') !== 'iso' ||
        byIdentity.get('SDT-G09-DVD (1989)') !== 'dvd') {
      fail(
        'CANARY_DISC_INPUT_FORM_INVALID',
        `ISO/DVD Handoff A input form is invalid: ${JSON.stringify(inputForms)}`,
      );
    }

    const queryCookie = await session(host, initialized.adminApiKey);
    const formation = await host.inject({
      method: 'GET',
      url: '/v1/admin/formation',
      headers: { cookie: queryCookie },
    });
    if (formation.statusCode !== 200) {
      fail('CANARY_FORMATION_QUERY_FAILED', formation.body);
    }
    const formationBody = formation.json();
    if (formationBody.summary.subjectCount !== expectedCandidates ||
        formationBody.summary.awaitingDestinationCount !== expectedCandidates ||
        formationBody.items.length !== expectedCandidates ||
        new Set(formationBody.items.map((item) => item.subjectId)).size !==
          expectedCandidates ||
        formationBody.items.some((item) =>
          item.stage !== 'awaiting_destination' || item.intakeCount !== 1)) {
      fail(
        'CANARY_FORMATION_PROJECTION_MISMATCH',
        JSON.stringify(formationBody),
      );
    }

    const sourceAfter = sourceReality(root);
    if (sourceAfter.regularFileCount !== sourceBefore.regularFileCount ||
        sourceAfter.digest !== sourceBefore.digest) {
      fail(
        'CANARY_SOURCE_REALITY_CHANGED',
        'The read-only Movie Field changed during Intake Canary.',
      );
    }
    const database = new Database(databasePath, { readonly: true });
    const integrity = database.pragma('integrity_check', { simple: true });
    database.close();
    if (integrity !== 'ok') {
      fail('CANARY_DATABASE_INTEGRITY_FAILED', String(integrity));
    }
    emit('complete', {
      elapsedMs: Date.now() - startedAtMs,
      sourceBefore,
      sourceAfter,
      canaryRoot,
      databasePath,
      logicalReadBytes,
      fingerprintedRegularFiles: fingerprintReads.size,
      readCalls,
      restarted,
      facts: finalFacts,
      formationSummary: formationBody.summary,
    });
  } finally {
    await close();
  }
}

main().catch((error) => {
  emit('fatal', {
    code: error.code || error.name,
    message: error.message,
    stack: error.stack,
  });
  process.exitCode = 1;
});
