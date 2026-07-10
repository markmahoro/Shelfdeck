'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..', '..');

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Kairox rebaseline docs preserve User Perception and closure boundary', () => {
  const architecture = readRepoFile('docs/v3/KAIROX_ARCHITECTURE.md');
  const currentPlan = readRepoFile('docs/v3/CURRENT_PLAN.md');
  const releaseGoals = readRepoFile('docs/v3/RELEASE_GOALS.md');
  const playbook = readRepoFile('docs/v3/KAIROX_ENGINEERING_PLAYBOOK.md');
  const adr = readRepoFile('docs/v3/adr/0004-user-perception-management.md');

  assert.match(architecture, /User Perception Management/);
  assert.match(architecture, /metadata gate 不覆盖 user perception facts/);
  assert.match(architecture, /metadata gate passed` 不等于 `optimize objective ready/);
  assert.match(currentPlan, /Kairox Beta/);
  assert.match(currentPlan, /completed transitional architecture phase/);
  assert.match(currentPlan, /There is no active Kairox implementation plan/);
  assert.doesNotMatch(currentPlan, /## Kairox Usable/);
  assert.match(architecture, /Media Freeze/);
  assert.match(releaseGoals, /Kairox Beta/);
  assert.match(playbook, /User Perception Management/);
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

test('Helix clean Kairox audit exposes only Basedata, Metadata and Optimize targets', () => {
  const automationPolicy = readRepoFile('media-service/src/automationPolicy.js');
  const taskCreationPolicy = readRepoFile('media-service/src/taskCreationPolicy.js');
  const flowPlanner = readRepoFile('media-service/src/flowPlanner.js');

  assert.strictEqual(fs.existsSync(path.join(repoRoot, 'media-service/src/businessFlowPolicy.js')), false);
  assert.strictEqual(fs.existsSync(path.join(repoRoot, 'media-service/src/lifecycleTaskPlanner.js')), false);
  assert.match(automationPolicy, /TASK_TARGETS = new Set\(\['basedata', 'metadata', 'optimize'\]\)/);
  assert.match(automationPolicy, /OPTIMIZE_FLOW_KINDS = new Set\(\['transcode', 'upgrade'\]\)/);
  assert.match(taskCreationPolicy, /targetGate === 'basedata'/);
  assert.doesNotMatch(automationPolicy, /OPTIMIZE_FLOW_KINDS = new Set\(\['transcode', 'upgrade', 'delete'\]\)/);
  assert.doesNotMatch(flowPlanner, /direction: 'optimize\.delete'/);
  assert.doesNotMatch(flowPlanner, /direction: 'delete\.execute'/);
  assert.doesNotMatch(flowPlanner, /direction: 'archive\.finalize'/);
  assert.match(flowPlanner, /direction: 'basedata\.observe'/);
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
