'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Kairox rebaseline docs define User Perception and active roadmap', () => {
  const architecture = readRepoFile('docs/v3/KAIROX_ARCHITECTURE.md');
  const rebaseline = readRepoFile('docs/v3/V3_4_REBASELINE_PLAN.md');
  const adr = readRepoFile('docs/v3/adr/0004-user-perception-management.md');

  assert.match(architecture, /User Perception Management/);
  assert.match(architecture, /metadata gate 不覆盖 user perception facts/);
  assert.match(architecture, /metadata gate passed` 不等于 `optimize objective ready/);
  assert.match(rebaseline, /Status: Active plan after Kairox User Perception update/);
  assert.match(rebaseline, /Flow Planner Gap Analysis/);
  assert.match(adr, /Douban 私人评分/);
});

test('Kairox metadata gate no longer derives required inputs from perception fields', () => {
  const metadataStatus = readRepoFile('media-service/src/metadataStatus.js');

  assert.match(metadataStatus, /'decision\.watched': \(\) => true/);
  assert.match(metadataStatus, /case 'watched':/);
  assert.match(metadataStatus, /case 'userRating':/);
  assert.match(metadataStatus, /case 'doubanRating':/);
  assert.match(metadataStatus, /collectSubLibraryStrategyInputRequirements/);
});

test('Kairox Beta audit prevents delete-as-optimize regression', () => {
  const businessFlowPolicy = readRepoFile('media-service/src/businessFlowPolicy.js');
  const flowPlanner = readRepoFile('media-service/src/flowPlanner.js');

  assert.match(businessFlowPolicy, /const TASK_TARGETS = new Set\(\['ingest', 'metadata', 'optimize', 'archive', 'delete'\]\)/);
  assert.match(businessFlowPolicy, /const OPTIMIZE_OPERATIONS = new Set\(\['transcode', 'upgrade'\]\)/);
  assert.doesNotMatch(businessFlowPolicy, /optimize: \['transcode', 'upgrade', 'delete'\]/);
  assert.doesNotMatch(flowPlanner, /direction: 'optimize\.delete'/);
  assert.match(flowPlanner, /direction: 'delete\.execute'/);
  assert.match(flowPlanner, /delete_is_not_optimize/);
});

test('Kairox objective template audit records v3.7 target schema', () => {
  const configStoreSource = readRepoFile('media-service/src/configStore.js');
  const ruleTemplatesPage = readRepoFile('media-service/web/src/pages/RuleTemplatesPage.tsx');

  assert.match(configStoreSource, /targetMediaFacts/);
  assert.match(configStoreSource, /qualityTier: 'premium'/);
  assert.match(configStoreSource, /qualityTier: 'baseline'/);
  assert.doesNotMatch(configStoreSource, /action: 'delete'/);
  assert.doesNotMatch(ruleTemplatesPage, /动作:/);
  assert.doesNotMatch(ruleTemplatesPage, /ACTION_LABELS/);
  assert.match(ruleTemplatesPage, /归档前目标/);
  assert.match(ruleTemplatesPage, /TARGET_TIER_LABELS/);
});
