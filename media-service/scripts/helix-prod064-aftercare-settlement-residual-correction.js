'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'PROD064_AFTERCARE_SETTLEMENT_RESIDUAL_CORRECTION_V1';
const ENTRY_ID = '453f70ebe9e4134700d220bf4de54a8fce29192f63afd4d92668267aa75b23fb';
const CURRENT_NFO = 'Film/网络谜踪 (2018)/网络谜踪 (2018).nfo';
const RESIDUALS = Object.freeze([
  Object.freeze({
    caseId:'arca-care-57ac27afdeb1599b0e20e2394bb06d717797c0ab',
    sizeBytes:15930,
    sha256:'983c3aed2798f9abbd763264d74c670e9b52541b324c1d45f1f11a1b1ab050f9',
  }),
  Object.freeze({
    caseId:'arca-care-ca38c6cd6e5e49a507e00de45a3eb9c3eefc0dd9',
    sizeBytes:15911,
    sha256:'f202b5225aa31e9825f05652c1076b75e74c7c295f8e52f890b75b475fa8ffaa',
  }),
]);

function valueAfter(args, flag) {
  const assigned=args.find((item)=>item.startsWith(flag+'='));
  if(assigned)return assigned.slice(flag.length+1);
  const index=args.indexOf(flag);
  return index<0?undefined:args[index+1];
}
function inside(root, relative, label) {
  const resolvedRoot=path.resolve(root),resolved=path.resolve(resolvedRoot,relative);
  if(resolved===resolvedRoot||!resolved.startsWith(resolvedRoot+path.sep))throw new Error('PROD064_RESIDUAL_'+label.toUpperCase()+'_OUTSIDE_ROOT');
  return resolved;
}
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function verifyFile(filePath, expected, label) {
  const stat=fs.statSync(filePath,{bigint:true});
  if(!stat.isFile()||Number(stat.size)!==Number(expected.sizeBytes)||sha256(filePath)!==expected.sha256)
    throw new Error('PROD064_RESIDUAL_'+label.toUpperCase()+'_IDENTITY_MISMATCH');
  return Object.freeze({sizeBytes:Number(stat.size),sha256:expected.sha256,inode:String(stat.ino)});
}
function activeCount(database, table, predicate) {
  return Number(database.prepare('SELECT COUNT(*) AS count FROM '+table+' WHERE '+predicate).get().count);
}
function assertQuiescent(database) {
  const counts={
    activeCases:activeCount(database,'arca_aftercare_cases','terminal_at_ms IS NULL'),
    activeArcaWorks:activeCount(database,'fx_supporting_works',"owner_domain='arca' AND state IN ('admitted','ready','running','blocked')"),
    activeArcaEvents:activeCount(database,'fx_workflow_events',"owner_domain='arca' AND state IN ('pending','ready','waiting_for_resource','waiting_for_external','waiting_for_approval','executing')"),
    reconcileRequiredEffects:activeCount(database,'fx_effect_journal',"state='reconcile_required'"),
  };
  if(Object.values(counts).some(Boolean))throw Object.assign(new Error('PROD064_RESIDUAL_RUNTIME_NOT_QUIESCENT'),{counts});
  return Object.freeze(counts);
}
function inspectPlan(database, options) {
  if(database.pragma('quick_check',{simple:true})!=='ok')throw new Error('PROD064_RESIDUAL_DATABASE_NOT_HEALTHY');
  const mediaRoot=path.resolve(options.mediaRoot),backupRoot=path.resolve(options.backupRoot);
  const backupParent=path.resolve(options.allowedBackupParent||path.join(path.dirname(options.databasePath||'/app/data/shelfdeck.db'),'backups'));
  if(mediaRoot===path.parse(mediaRoot).root||!backupRoot.startsWith(backupParent+path.sep))throw new Error('PROD064_RESIDUAL_ROOT_SCOPE_INVALID');
  const entryId=options.entryId||ENTRY_ID,currentNfo=options.currentNfo||CURRENT_NFO,residuals=options.residuals||RESIDUALS;
  const currentPath=inside(mediaRoot,currentNfo,'current_nfo');
  const entry=database.prepare('SELECT status,current_inventory_revision FROM arca_shelf_entries WHERE shelf_entry_id=?').get(entryId);
  if(!entry||entry.status!=='active'||Number(entry.current_inventory_revision)!==3)throw new Error('PROD064_RESIDUAL_ENTRY_BASIS_MISMATCH');
  const material=database.prepare("SELECT location,size_bytes,digest_hex,inode FROM arca_inventory_materials WHERE shelf_entry_id=? AND inventory_revision=? AND role='metadata_sidecar' AND lower(location) LIKE '%.nfo'").get(entryId,entry.current_inventory_revision);
  if(!material||material.location!=='/media/'+currentNfo.replaceAll('\\','/')||!material.digest_hex)throw new Error('PROD064_RESIDUAL_CURRENT_INVENTORY_MISMATCH');
  const currentIdentity=verifyFile(currentPath,{sizeBytes:Number(material.size_bytes),sha256:material.digest_hex},'current_nfo');
  if(currentIdentity.inode!==String(material.inode))throw new Error('PROD064_RESIDUAL_CURRENT_INODE_MISMATCH');
  const runtime=assertQuiescent(database),directory=path.dirname(currentPath);
  const expectedNames=residuals.map((item)=>path.basename(currentPath)+'.superseded-'+item.caseId).sort();
  const observedNames=fs.readdirSync(directory).filter((name)=>name.includes('.superseded-arca-care-')).sort();
  if(observedNames.some((name)=>!expectedNames.includes(name)))throw new Error('PROD064_RESIDUAL_UNKNOWN_SUPERSEDED_MEMBER');
  const members=residuals.map((item)=>{
    const caseRow=database.prepare('SELECT state,terminal_reason_code FROM arca_aftercare_cases WHERE aftercare_case_id=? AND shelf_entry_id=?').get(item.caseId,entryId);
    const commit=database.prepare('SELECT previous_inventory_revision,new_inventory_revision FROM arca_aftercare_inventory_commits WHERE aftercare_case_id=? AND shelf_entry_id=?').get(item.caseId,entryId);
    if(!caseRow||caseRow.state!=='unresolved'||caseRow.terminal_reason_code!=='settlement_or_commit_failed'||!commit)
      throw new Error('PROD064_RESIDUAL_CASE_PROOF_MISMATCH');
    const name=path.basename(currentPath)+'.superseded-'+item.caseId,sourcePath=inside(mediaRoot,path.join(path.dirname(currentNfo),name),'source'),backupPath=inside(backupRoot,name,'backup');
    const sourceExists=fs.existsSync(sourcePath),backupExists=fs.existsSync(backupPath);
    if(!sourceExists&&!backupExists)throw new Error('PROD064_RESIDUAL_MEMBER_MISSING');
    if(sourceExists)verifyFile(sourcePath,item,'source');
    if(backupExists)verifyFile(backupPath,item,'backup');
    return Object.freeze({...item,name,sourcePath,backupPath,sourceExists,backupExists,
      inventoryTransition:[Number(commit.previous_inventory_revision),Number(commit.new_inventory_revision)]});
  });
  return Object.freeze({schema:'prod064.aftercare-settlement-residual-plan@1',entryId,
    currentInventoryRevision:Number(entry.current_inventory_revision),currentPath,currentIdentity,runtime,members:Object.freeze(members)});
}
function applyCorrection(database, options) {
  if(options.confirm!==CONFIRMATION)throw new Error('PROD064_RESIDUAL_CONFIRMATION_REQUIRED');
  let plan=inspectPlan(database,options);
  fs.mkdirSync(options.backupRoot,{recursive:true});
  for(const member of plan.members){
    if(!member.backupExists){fs.copyFileSync(member.sourcePath,member.backupPath,fs.constants.COPYFILE_EXCL);verifyFile(member.backupPath,member,'backup');}
    if(member.sourceExists){assertQuiescent(database);verifyFile(member.sourcePath,member,'source');verifyFile(member.backupPath,member,'backup');fs.unlinkSync(member.sourcePath);}
  }
  plan=inspectPlan(database,options);
  if(plan.members.some((item)=>item.sourceExists||!item.backupExists))throw new Error('PROD064_RESIDUAL_POSTCONDITION_FAILED');
  const manifest={schema:'prod064.aftercare-settlement-residual-correction@1',entryId:plan.entryId,
    currentInventoryRevision:plan.currentInventoryRevision,currentIdentity:plan.currentIdentity,
    members:plan.members.map((item)=>({caseId:item.caseId,name:item.name,sizeBytes:item.sizeBytes,sha256:item.sha256,inventoryTransition:item.inventoryTransition}))};
  const manifestPath=inside(options.backupRoot,'manifest.json','manifest');
  const output=canonicalJson({...manifest,manifestDigest:canonicalDigest(manifest)})+'\n';
  if(fs.existsSync(manifestPath)){if(fs.readFileSync(manifestPath,'utf8')!==output)throw new Error('PROD064_RESIDUAL_MANIFEST_CONFLICT');}
  else fs.writeFileSync(manifestPath,output,{flag:'wx'});
  return Object.freeze({kind:'applied',backupRoot:path.resolve(options.backupRoot),memberCount:plan.members.length,manifestDigest:canonicalDigest(manifest)});
}
function main(args=process.argv.slice(2)) {
  const databasePath=path.resolve(valueAfter(args,'--database')||'/app/data/shelfdeck.db'),mediaRoot=path.resolve(valueAfter(args,'--media-root')||'/media'),backupRoot=path.resolve(valueAfter(args,'--backup-root')||'/app/data/backups/prod064-aftercare-settlement-residual-20260903T122500Z'),apply=args.includes('--apply'),confirm=valueAfter(args,'--confirm');
  const database=new Database(databasePath,{readonly:true,fileMustExist:true});
  try{const options={databasePath,mediaRoot,backupRoot,confirm},result=apply?applyCorrection(database,options):inspectPlan(database,options);console.log(JSON.stringify({mode:apply?'apply':'dry_run',result},null,2));}
  finally{database.close();}
}
if(require.main===module){try{main();}catch(error){console.error(JSON.stringify({error:{code:error.message,details:error.counts||null}},null,2));process.exitCode=1;}}

module.exports=Object.freeze({CONFIRMATION,ENTRY_ID,CURRENT_NFO,RESIDUALS,inspectPlan,applyCorrection});
