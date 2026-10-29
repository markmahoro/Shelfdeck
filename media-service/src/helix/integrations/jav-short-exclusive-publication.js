'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../contracts/canonical-json');
const { computeBoundedMaterialFingerprint } = require('./bounded-material-fingerprint');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function targetOccupied(message) {
  throw Object.assign(new Error(message), {code:'CLEAN_ARCA_TARGET_OCCUPIED',
    details:{shortPublication:true,effectWriteStarted:false,boundary:'before_publication'}});
}
function childOf(root, value) {
  const relative = path.relative(root, value);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function inspect(location) {
  try { return fs.lstatSync(location, { bigint:true }); }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}
function validateInput({ decision, slot, stagedManifest, verification, productManifestDigest, recoveryDecision }) {
  if (recoveryDecision != null && !['safe_retry', 'safe_retry_before_intent', 'continue_forward', 'already_committed'].includes(recoveryDecision)) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication recovery classification is invalid.');
  }
  if (!decision || decision.schemaRef !== 'helix://contracts/domain-types/FinalInventoryDecision/v1' ||
      decision.decisionDigest !== decision.digest || !Array.isArray(decision.members) || !decision.members.length ||
      !slot || slot.schemaRef !== 'helix://contracts/types/TargetCommitSlotHandle/v1' ||
      slot.finalInventoryDecisionDigest !== decision.decisionDigest || slot.onDeckRunId !== decision.onDeckRunId ||
      !path.isAbsolute(slot.targetDirectory) || !path.isAbsolute(slot.slotDirectory)) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication requires its exact Decision and Target Commit Slot.');
  }
  const targetDirectory = path.resolve(slot.targetDirectory), stageDirectory = path.resolve(slot.slotDirectory);
  const suffix = canonicalDigest({schema:'arca.inventory-stage-slot@1',onDeckRunId:decision.onDeckRunId,
    finalInventoryDecisionDigest:decision.decisionDigest}).slice(0,16);
  if (targetDirectory === stageDirectory || path.dirname(targetDirectory) !== path.dirname(stageDirectory) ||
      stageDirectory !== path.join(path.dirname(targetDirectory),'.shelfdeck-stage-'+suffix) ||
      slot.slotId !== canonicalDigest({schema:'arca.target-commit-slot-id@1',onDeckRunId:decision.onDeckRunId,
        targetEndpointId:slot.targetEndpointId,targetLocation:targetDirectory,finalInventoryDecisionDigest:decision.decisionDigest}) ||
      slot.containmentDigest !== canonicalDigest({schema:'arca.target-slot-containment@1',
        targetRoot:path.dirname(targetDirectory),targetDirectory,slotDirectory:stageDirectory})) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication requires sibling paths within the exact Shelf root.');
  }
  const {manifestDigest, ...manifestBody} = stagedManifest || {};
  if (stagedManifest?.schemaRef !== 'helix://contracts/types/StagedInventoryManifest/v1' ||
      stagedManifest.ownerDomain !== 'arca' || stagedManifest.manifestKind !== 'staged_inventory' ||
      stagedManifest.targetCommitSlotId !== slot.slotId || manifestDigest !== canonicalDigest(manifestBody) ||
      typeof productManifestDigest !== 'string' || !productManifestDigest ||
      stagedManifest.sourceProductManifestDigest !== productManifestDigest ||
      !Array.isArray(stagedManifest.stagedMembers) || stagedManifest.memberCount !== decision.members.length ||
      stagedManifest.memberCount !== stagedManifest.stagedMembers.length ||
      stagedManifest.membersDigest !== canonicalDigest({schema:'arca.staged-inventory-members@1',items:stagedManifest.stagedMembers}) ||
      verification?.schemaRef !== 'helix://contracts/types/StagedInventoryVerification/v1' ||
      verification.result !== 'passed' || verification.stagedInventoryManifestDigest !== manifestDigest ||
      verification.finalInventoryDecisionDigest !== decision.decisionDigest) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication requires the exact verified Stage Manifest.');
  }
  const bySource = new Map(stagedManifest.stagedMembers.map(item => [item.sourceMaterialKey, item]));
  if (bySource.size !== stagedManifest.stagedMembers.length ||
      new Set(stagedManifest.stagedMembers.map(item => item.physicalIdentity?.materialKey)).size !== stagedManifest.stagedMembers.length ||
      new Set(decision.members.map(item => item.sourceMaterialKey)).size !== decision.members.length ||
      new Set(decision.members.map(item => item.finalName)).size !== decision.members.length) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication members are ambiguous.');
  }
  const items = decision.members.map(member => {
    const staged = bySource.get(member.sourceMaterialKey), target = path.resolve(member.targetLocation);
    const physical = staged?.physicalIdentity;
    const tuple = physical && {mountScopeId:physical.mountScopeId,inode:physical.inode,sizeBytes:physical.sizeBytes,
      fingerprintAlgorithm:physical.fingerprintAlgorithm,fingerprintVersion:physical.fingerprintVersion,contentFingerprint:physical.contentFingerprint};
    if (!staged || staged.role !== member.role || staged.endpointId !== slot.targetEndpointId ||
        member.targetEndpointId !== slot.targetEndpointId || path.dirname(target) !== targetDirectory ||
        path.basename(target) !== member.finalName || path.resolve(staged.location) !== target ||
        !physical || physical.schemaRef !== 'helix://contracts/types/PhysicalMaterialIdentity/v2' || physical.schemaVersion !== 2 ||
        typeof physical.mountScopeId !== 'string' || !physical.mountScopeId || !/^[0-9]+$/.test(physical.inode || '') ||
        !/[1-9]/.test(physical.inode) ||
        !Number.isSafeInteger(physical.sizeBytes) || physical.sizeBytes < 0 || typeof physical.fingerprintAlgorithm !== 'string' ||
        !Number.isSafeInteger(physical.fingerprintVersion) || typeof physical.contentFingerprint !== 'string' ||
        physical.materialKey !== canonicalDigest({schema:'physical-material-identity@2',...tuple})) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication member differs from its frozen target and Stage identity.');
    }
    const stage = path.resolve(stageDirectory, member.finalName);
    if (!childOf(stageDirectory, stage) || path.dirname(stage) !== stageDirectory) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication member escaped its Target Commit Slot.');
    }
    return Object.freeze({member, staged, target, stage});
  });
  return Object.freeze({targetDirectory, stageDirectory, items:Object.freeze(items)});
}

async function exactFile(location, expected, check) {
  const stat = inspect(location);
  if (!stat) return false;
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  const actual = await computeBoundedMaterialFingerprint(location);
  check();
  const after = inspect(location);
  if (!after || after.isSymbolicLink() || after.dev !== stat.dev || after.ino !== stat.ino ||
      after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs ||
      actual.stat.dev !== stat.dev || actual.stat.ino !== stat.ino || actual.stat.size !== stat.size ||
      actual.stat.mtimeNs !== stat.mtimeNs || actual.stat.ctimeNs !== stat.ctimeNs) return false;
  return String(actual.stat.ino) === expected.inode && Number(actual.stat.size) === expected.sizeBytes &&
    actual.fingerprintAlgorithm === expected.fingerprintAlgorithm && actual.fingerprintVersion === expected.fingerprintVersion &&
    actual.contentFingerprint === expected.contentFingerprint;
}

// The caller must independently validate the current Arca reservation and the
// exact Foundation Effect. This helper supplies no business authority.
async function publishJavShortTarget(input) {
  const { targetDirectory, stageDirectory, items } = validateInput(input);
  const check = () => {
    if (typeof input.shouldContinue !== 'function' || input.shouldContinue() !== true) {
      fail('CLEAN_ARCA_EFFECT_FENCED', 'Short publication lost its exact current Effect authority.');
    }
  };
  const checkpoint = typeof input.afterPhysicalEffect === 'function' ? input.afterPhysicalEffect : () => {};
  check();
  const root = path.dirname(targetDirectory), rootStat = inspect(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync.native(root) !== root) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication requires an exact unlinked Shelf root.');
  }
  const targetBefore = inspect(targetDirectory);
  const recovering = input.recoveryDecision === 'continue_forward' || input.recoveryDecision === 'already_committed';
  if (!targetBefore && recovering) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'A missing target during Effect recovery requires fresh Owner evidence.');
  }
  if (targetBefore && (!targetBefore.isDirectory() || targetBefore.isSymbolicLink())) {
    if (recovering) fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'A recovery target is not an owned directory.');
    targetOccupied('Short publication target is not an owned directory.');
  }
  if (targetBefore && !recovering) {
    targetOccupied('Short publication target already exists.');
  }
  const stageStat = inspect(stageDirectory);
  if (stageStat && (!stageStat.isDirectory() || stageStat.isSymbolicLink())) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_PROOF_INVALID', 'Short publication Stage is not an exact directory.');
  }
  const knownNames = new Set(items.map(item => item.member.finalName));
  if (stageStat && fs.readdirSync(stageDirectory).some(name => !knownNames.has(name))) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication Stage contains an unknown member.');
  }
  if (targetBefore && fs.readdirSync(targetDirectory).some(name => !knownNames.has(name))) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication target contains an unknown member.');
  }
  let priorFinals = 0;
  for (const item of items) {
    const finalExists = Boolean(inspect(item.target)), stageExists = Boolean(inspect(item.stage));
    if (finalExists) {
      if (!recovering || !await exactFile(item.target, item.staged.physicalIdentity, check)) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Existing target lacks the exact staged physical identity.');
      }
      priorFinals++;
    }
    if (stageExists && !await exactFile(item.stage, item.staged.physicalIdentity, check)) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Staged identity changed before short publication.');
    }
    if (!finalExists && !stageExists) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication has neither the exact stage nor its verified target.');
    }
    if (!finalExists && input.recoveryDecision === 'already_committed') {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'A committed Effect cannot republish a missing final member.');
    }
  }
  if (targetBefore && priorFinals === 0) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'An empty target cannot prove that this Effect created it.');
  }
  check();
  // Replaying a committed Effect may verify its result, but cannot start a
  // new physical effect, including Stage cleanup. Any cleanup needs its own
  // independently authorized and journaled scope.
  if (input.recoveryDecision === 'already_committed') {
    const currentRoot = inspect(root), currentTarget = inspect(targetDirectory);
    if (!currentRoot?.isDirectory() || currentRoot.isSymbolicLink() || currentRoot.dev !== rootStat.dev ||
        currentRoot.ino !== rootStat.ino || !currentTarget?.isDirectory() || currentTarget.isSymbolicLink() ||
        currentTarget.dev !== targetBefore.dev || currentTarget.ino !== targetBefore.ino ||
        fs.readdirSync(targetDirectory).some(name => !knownNames.has(name))) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Committed short publication changed while being verified.');
    }
    check();
    return Object.freeze({targetDirectory, memberCount:items.length});
  }
  if (!targetBefore) {
    try { fs.mkdirSync(targetDirectory); }
    catch (error) {
      if (error?.code === 'EEXIST') targetOccupied('Short publication target was claimed by another writer.');
      throw error;
    }
    checkpoint({phase:'target_directory_created'});
  }
  const targetIdentity = inspect(targetDirectory);
  if (!targetIdentity?.isDirectory() || targetIdentity.isSymbolicLink()) {
    fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication target changed after the claim.');
  }
  function checkDirectory() {
    check();
    const currentRoot = inspect(root);
    if (!currentRoot?.isDirectory() || currentRoot.isSymbolicLink() || currentRoot.dev !== rootStat.dev || currentRoot.ino !== rootStat.ino ||
        fs.realpathSync.native(root) !== root) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication Shelf root changed after preflight.');
    }
    const current = inspect(targetDirectory);
    if (!current?.isDirectory() || current.isSymbolicLink() || current.dev !== targetIdentity.dev || current.ino !== targetIdentity.ino ||
        fs.readdirSync(targetDirectory).some(name => !knownNames.has(name))) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication target changed or gained an unknown member.');
    }
  }
  function checkStageDirectory(allowAbsent = false) {
    const current = inspect(stageDirectory);
    if (!current && allowAbsent) return;
    if (!current?.isDirectory() || current.isSymbolicLink() || !stageStat ||
        current.dev !== stageStat.dev || current.ino !== stageStat.ino) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication Stage directory changed after preflight.');
    }
  }
  for (const item of items) {
    checkDirectory();
    if (inspect(item.target)) {
      if (!recovering || !await exactFile(item.target, item.staged.physicalIdentity, check)) {
        fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication target changed after preflight.');
      }
      continue;
    }
    checkStageDirectory();
    if (!await exactFile(item.stage, item.staged.physicalIdentity, check)) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Short publication Stage disappeared or changed.');
    }
    checkDirectory();
    checkStageDirectory();
    try { fs.linkSync(item.stage, item.target); }
    catch (error) {
      if (error?.code === 'EEXIST') fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'A competing writer claimed a final member.');
      throw error;
    }
    checkpoint({phase:'member_published',sourceMaterialKey:item.member.sourceMaterialKey});
    if (!await exactFile(item.target, item.staged.physicalIdentity, check)) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Published member differs from its exact Stage identity.');
    }
  }
  checkDirectory();
  for (const item of items) {
    if (!await exactFile(item.target, item.staged.physicalIdentity, check)) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Final member changed before Stage retirement.');
    }
  }
  for (const item of items) {
    checkStageDirectory(true);
    if (!inspect(item.stage)) continue;
    if (!await exactFile(item.stage, item.staged.physicalIdentity, check)) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Stage member changed before retirement.');
    }
    checkDirectory();
    checkStageDirectory();
    fs.unlinkSync(item.stage);
    checkpoint({phase:'staged_member_retired',sourceMaterialKey:item.member.sourceMaterialKey});
  }
  if (inspect(stageDirectory)) {
    checkStageDirectory();
    if (fs.readdirSync(stageDirectory).length) {
      fail('CLEAN_ARCA_SHORT_PUBLICATION_UNCERTAIN', 'Stage contains an unplanned member before retirement.');
    }
    fs.rmdirSync(stageDirectory);
    checkpoint({phase:'stage_directory_retired'});
  }
  checkDirectory();
  return Object.freeze({targetDirectory, memberCount:items.length});
}

module.exports = Object.freeze({ publishJavShortTarget });
