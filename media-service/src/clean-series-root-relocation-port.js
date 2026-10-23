'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {canonicalDigest} = require('./helix/contracts/canonical-json');
const {computeBoundedMaterialFingerprintSync} = require('./helix/integrations/bounded-material-fingerprint');
const {assertSeriesRootRelocationPlan} = require('./helix/domains/arca/model/series-root-relocation');
const fail = (code,message) => {throw Object.assign(new Error(message),{code});};

function createCleanSeriesRootRelocationPort(options = {}) {
  function directory(location, absentAllowed = false) {
    let stat;
    try {stat=fs.lstatSync(location);} catch(error) {if(absentAllowed&&error.code==='ENOENT')return false;throw error;}
    const canonical = value => process.platform==='win32'?value.toLowerCase():value;
    if (!stat.isDirectory() || stat.isSymbolicLink() || canonical(fs.realpathSync.native(location))!==canonical(path.resolve(location)))
      fail('ARCA_SERIES_RELOCATION_UNSAFE_PATH','Series root traverses an alias or is not a directory.');
    return true;
  }
  function verifyTree(plan, root) {
    directory(root);
    const expected = new Map(plan.files.map(file=>[file.relativePath,file]));
    const allowedDirectories = new Set(['']);
    for (const file of plan.files) {
      const parts=file.relativePath.split('/');parts.pop();
      while(parts.length){allowedDirectories.add(parts.join('/'));parts.pop();}
    }
    const observations=[];
    function walk(relative) {
      const location=path.join(root,...relative.split('/').filter(Boolean));directory(location);
      for(const entry of fs.readdirSync(location,{withFileTypes:true})) {
        const key=relative?relative+'/'+entry.name:entry.name,absolute=path.join(location,entry.name);
        if(entry.isSymbolicLink())fail('ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER','Series root contains a link.');
        if(entry.isDirectory()) {
          if(!allowedDirectories.has(key))fail('ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER','Series root contains an unregistered directory.');
          walk(key);continue;
        }
        const declared=expected.get(key);
        if(!entry.isFile()||!declared)fail('ARCA_SERIES_RELOCATION_UNKNOWN_MEMBER','Series root contains an unregistered file.');
        const observed=computeBoundedMaterialFingerprintSync(absolute,{requireStableSnapshot:true}),stat=observed.stat;
        if(String(stat.ino)!==declared.identity.inode||Number(stat.size)!==declared.identity.sizeBytes||
            observed.contentFingerprint!==declared.identity.contentFingerprint||stat.nlink!==1n)
          fail('ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT','Series material no longer has its frozen physical identity.');
        if(declared.byteDigest&&crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')!==declared.byteDigest)
          fail('ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT','Shared presentation bytes changed.');
        observations.push({relativePath:key,materialKey:declared.identity.materialKey});
      }
    }
    walk('');
    if(observations.length!==plan.files.length)fail('ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT','Series root is missing a declared material.');
    return canonicalDigest(observations.sort((a,b)=>a.relativePath.localeCompare(b.relativePath)));
  }
  function observe(plan) {
    assertSeriesRootRelocationPlan(plan);directory(plan.shelfRoot);
    directory(path.dirname(plan.oldRoot));directory(path.dirname(plan.newRoot));
    const oldExists=directory(plan.oldRoot,true),newExists=directory(plan.newRoot,true);
    if(oldExists===newExists)fail('ARCA_SERIES_RELOCATION_TARGET_CONFLICT','Relocation requires exactly one matching root, with the other absent.');
    const realityDigest=verifyTree(plan,oldExists?plan.oldRoot:plan.newRoot);
    return {state:oldExists?'source_ready':'target_verified',realityDigest};
  }
  return Object.freeze({observe,
    move(plan, revalidate) {
      if(typeof revalidate!=='function')fail('ARCA_SERIES_RELOCATION_AUTHORITY_REQUIRED','Relocation requires a current Owner and execution fence.');
      revalidate();const before=observe(plan);
      if(before.state==='source_ready') {
        revalidate();
        if(fs.existsSync(plan.newRoot))fail('ARCA_SERIES_RELOCATION_TARGET_CONFLICT','Relocation target appeared before rename.');
        if(fs.statSync(plan.oldRoot).dev!==fs.statSync(path.dirname(plan.newRoot)).dev)
          fail('ARCA_SERIES_RELOCATION_CROSS_VOLUME','Root relocation must preserve identity within one filesystem.');
        // POSIX rename may replace an empty target directory. GNU mv -n uses
        // no-replace semantics; verify the whole result even when it exits zero
        // after refusing an independently created target.
        if(process.platform==='linux')execFileSync('mv',['--no-clobber','--no-target-directory','--',plan.oldRoot,plan.newRoot],
          {timeout:10000,stdio:'pipe',windowsHide:true});
        else fs.renameSync(plan.oldRoot,plan.newRoot);
        options.afterRename?.(plan);
      }
      const after=observe(plan);
      if(after.state!=='target_verified'||after.realityDigest!==before.realityDigest)
        fail('ARCA_SERIES_RELOCATION_PHYSICAL_DRIFT','Relocation did not preserve the complete physical set.');
      revalidate();
      return {planDigest:plan.digest,rootLocation:plan.newRoot,fileCount:plan.files.length,realityDigest:after.realityDigest};
    },
  });
}

module.exports=Object.freeze({createCleanSeriesRootRelocationPort});
