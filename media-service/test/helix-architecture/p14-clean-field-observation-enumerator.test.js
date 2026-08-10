'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createCleanFieldObservationEnumerator, MAX_FINGERPRINTED_FILES_PER_PAGE,
  DEFAULT_FINGERPRINTED_FILES_PER_BATCH } = require('../../src/clean-field-observation-enumerator');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { identityBasis } = require('../../src/helix/domains/procurement/model/field-observation-contracts');

test('Field enumerator fingerprints one bounded canonical path page and resumes without rereading earlier pages', async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-enumerator-page-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(let ordinal=0;ordinal<25;ordinal+=1)fs.writeFileSync(path.join(root,`movie-${String(ordinal).padStart(2,'0')}.mkv`),`bytes-${ordinal}`);
  const enumerator=createCleanFieldObservationEnumerator({now:()=>1000});
  const handle={handleId:'handle-1',accessDigest:'a'.repeat(64),rootLocation:root,mountScopeId:'mount-1'};
  const pages=[];let cursorIn=null;
  for(let ordinal=0;cursorIn!==null||ordinal===0;ordinal+=1){const page=await enumerator.enumeratePage({fieldAccessHandle:handle,pageRequest:{cursorIn,pageBudget:100}});
    pages.push(page);cursorIn=page.hasMore?page.items.at(-1).cursor:null;}
  assert.equal(MAX_FINGERPRINTED_FILES_PER_PAGE,256);
  assert.equal(DEFAULT_FINGERPRINTED_FILES_PER_BATCH,256);
  assert.deepEqual(pages.map((page)=>page.items.length),[25]);
  assert.deepEqual(pages.map((page)=>page.hasMore),[false]);
  const locations=pages.flatMap((page)=>page.items.map((item)=>item.material.location));
  assert.equal(new Set(locations).size,25);
  assert.equal(locations.every((location)=>location.startsWith(root.replace(/\\/g,'/'))),true);
  for(const page of pages){const keys=page.items.map((item)=>canonicalDigest(identityBasis({mountScopeId:'mount-1',inode:item.material.inode,
    sizeBytes:item.material.sizeBytes,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,
    contentFingerprint:item.material.contentFingerprint})));
    assert.deepEqual([...keys].sort((left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right))),keys);}
});

test('Field enumerator never exposes a cursor that advances past an uncommitted item', async (t) => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-enumerator-cursor-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(let ordinal=0;ordinal<20;ordinal+=1)fs.writeFileSync(path.join(root,`movie-${String(ordinal).padStart(2,'0')}.mkv`),`bytes-${ordinal}`);
  const enumerator=createCleanFieldObservationEnumerator({now:()=>1000,batchLimit:4});
  const handle={handleId:'handle-1',accessDigest:'a'.repeat(64),rootLocation:root,mountScopeId:'mount-1'};
  const locations=[];let cursorIn=null;
  do {
    const page=await enumerator.enumeratePage({fieldAccessHandle:handle,pageRequest:{cursorIn,pageBudget:100}});
    locations.push(...page.items.map((item)=>item.material.location));
    cursorIn=page.hasMore?page.items.at(-1).cursor:null;
  } while(cursorIn!==null);
  assert.equal(locations.length,20);
  assert.equal(new Set(locations).size,20);
});
