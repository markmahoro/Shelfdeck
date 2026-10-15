'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {createBackup,verifyBackup,restoreBackup}=require('../../../scripts/helix-operational-safety');
const [root,digest]=process.argv.slice(2),resolved=path.resolve(root);
assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('helix-p13-'));
assert.match(digest,/^[a-f0-9]{64}$/);
const source=path.join(resolved,'source'),backup=path.join(resolved,'backup'),restored=path.join(resolved,'restored'),
  receipt=createBackup({sourceDir:source,backupDir:backup,createdAt:'2026-10-15T00:00:00.000Z'});
assert.equal(receipt.files.find(item=>item.path==='large.bin').digest,digest);
assert.equal(receipt.files.find(item=>item.path==='large.bin').bytes,256*1024*1024);
assert.equal(verifyBackup(backup).aggregateDigest,receipt.aggregateDigest);
assert.equal(restoreBackup({backupDir:backup,targetDir:restored}).aggregateDigest,receipt.aggregateDigest);
const original=fs.statSync(path.join(source,'large.bin')),restoredStat=fs.statSync(path.join(restored,'large.bin'));assert.equal(restoredStat.size,original.size);
assert.equal(fs.readFileSync(path.join(restored,'credential.bin'),'utf8'),'private-fixture-bytes');
const descriptor=fs.openSync(path.join(backup,'large.bin'),'r+');try{fs.writeSync(descriptor,Buffer.from([1]),0,1,128*1024*1024);}finally{fs.closeSync(descriptor);}
assert.throws(()=>verifyBackup(backup),/P13_BACKUP_DIGEST_MISMATCH/);
const peakRssKiB=process.resourceUsage().maxRSS;assert.ok(peakRssKiB>0&&peakRssKiB<224*1024,'Backup peak RSS exceeded its bounded fixture budget: '+peakRssKiB);
console.log(JSON.stringify({ok:true,fileBytes:original.size,files:receipt.files.length,peakRssKiB,wholeFileReadRequired:false,tamperingRejected:true,restored:true}));
