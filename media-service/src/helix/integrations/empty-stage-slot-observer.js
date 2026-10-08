'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { canonicalDigest } = require('../contracts/canonical-json');

function observeEmptyStageSlot({ targetRoot, targetCommitSlotHandle:slot }) {
  const fail = message => { throw Object.assign(new Error(message), {code:'ARCA_STAGE_REALITY_UNPROVEN'}); };
  if (typeof targetRoot !== 'string' || !path.isAbsolute(targetRoot) || !slot || !path.isAbsolute(slot.slotDirectory)) fail('Exact absolute stage scope required.');
  const root = path.resolve(targetRoot), directory = path.resolve(slot.slotDirectory);
  const relative = path.relative(root, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('Stage slot escapes its trusted Shelf root.');
  const normalize = value => process.platform === 'win32' ? value.toLowerCase() : value;
  function inspect() {
    const parts = directory.slice(path.parse(directory).root.length).split(path.sep).filter(Boolean);
    let current = path.parse(directory).root;
    const rows = [];
    for (const part of ['', ...parts]) {
      if (part) current = path.join(current, part);
      // Missing/inaccessible directories deliberately throw, including ENOENT.
      const stat = fs.lstatSync(current, {bigint:true});
      if (!stat.isDirectory() || stat.isSymbolicLink() || normalize(fs.realpathSync(current)) !== normalize(path.resolve(current))) fail('Stage path contains a link or non-directory.');
      const identity = {path:current,device:String(stat.dev),inode:String(stat.ino),mode:String(stat.mode)};
      // Ancestor directory timestamps include unrelated sibling activity. Fence
      // their identity and permissions, but content timestamps only for this slot.
      if (normalize(current) === normalize(directory)) {
        identity.mtimeNs = String(stat.mtimeNs);
        identity.ctimeNs = String(stat.ctimeNs);
      }
      rows.push(identity);
    }
    return rows;
  }
  const before = inspect();
  if (fs.readdirSync(directory).length !== 0) fail('Stage slot has remaining output.');
  const after = inspect();
  if (canonicalDigest(before) !== canonicalDigest(after) || fs.readdirSync(directory).length !== 0) fail('Stage path changed during observation.');
  return Object.freeze({schemaRef:'arca.empty-stage-slot-observation@1',slotId:slot.slotId,slotDigest:canonicalDigest(slot),
    targetRoot:root,slotDirectory:directory,memberCount:0,pathIdentityDigest:canonicalDigest(after)});
}
module.exports = Object.freeze({ observeEmptyStageSlot });
