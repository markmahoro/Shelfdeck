'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {writeAtomic}=require('../src/clean-runtime-operations');
const {inspectRetirementPlan}=require('./formation-retirement-plan');
const {createFormationRetirementOperator}=require('./formation-retirement-operator');

function fail(code,message){throw Object.assign(new Error(message),{code,statusCode:409});}
function assertSafeWorkspaceRoot(workspaceRoot,dataDir) {
  if(typeof workspaceRoot!=='string'||!path.isAbsolute(workspaceRoot))fail('RESET_WORKSPACE_ROOT_UNSAFE','工作区必须为已登记的绝对路径。');
  const root=path.resolve(workspaceRoot),data=path.resolve(dataDir);
  const canonical=value=>process.platform==='win32'?value.toLowerCase():value;
  if(canonical(root)===canonical(path.parse(root).root)||canonical(root)===canonical(data)||canonical(data).startsWith(canonical(root)+path.sep))
    fail('RESET_WORKSPACE_ROOT_UNSAFE','工作区不能覆盖数据目录或文件系统根目录。');
  const stat=fs.lstatSync(root);
  if(!stat.isDirectory()||stat.isSymbolicLink()||canonical(fs.realpathSync.native(root))!==canonical(root))
    fail('RESET_WORKSPACE_ROOT_UNSAFE','工作区必须为实际目录，不能经符号链接或别名访问。');
}

const blockerLabels={FORMATION_RESET_COMMITTED_SUBJECT_REFUSED:'整理关联已有正式收藏，不能以Reset清除。',
  RESET_ENDED_HISTORY_OVERLAP:'已完成/已结束历史不能清理。',RESET_UNRESOLVED_EFFECT:'存在尚未确认的文件操作，不能清除。',
  RESET_UNSCOPED_RESPONSIBILITY:'存在无法归属到清单的整理残留，须先核查，不能清理。'};

function createUserFormationReset(options){
  const databasePath=path.join(options.dataDir,'shelfdeck.db');
  function inspect(){
    const db=new Database(databasePath,{readonly:true,fileMustExist:true});
    try {
      const plan=inspectRetirementPlan(db,{workspaceRoot:options.workspaceRoot});
      const selected=plan.subjects.map(row=>({subjectId:row.subject_id,contentProfile:row.content_profile,
        displayIdentity:db.prepare('SELECT display_identity FROM libra_formation_projections WHERE subject_id=?').get(row.subject_id)?.display_identity||'待识别媒体'}));
      const selectedIds=new Set(selected.map(row=>row.subjectId));
      for(const token of plan.tokens)if(!selectedIds.has(token.subject_id)){
        selected.push({subjectId:token.subject_id,contentProfile:'unknown',displayIdentity:'待识别媒体'});selectedIds.add(token.subject_id);
      }
      const value={items:selected,counts:{subjects:selected.length,intakes:plan.pendingIntakes.length,runs:plan.runs.length,
          works:plan.works.length,workspaces:plan.workspaces.length},
        protected:{collectionCount:db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,
          endedRunCount:db.prepare("SELECT count(*) n FROM libra_runs WHERE state NOT IN ('active','suspended','frozen')").get().n},
        blockers:plan.blockers.map(item=>({code:item.code,message:blockerLabels[item.code]||'存在尚未收口或无法确认的责任，暂不能重置。'})),
        empty:!plan.subjects.length&&!plan.pendingIntakes.length&&!plan.tokens.length,
        ready:(plan.subjects.length>0||plan.pendingIntakes.length>0)&&plan.blockers.length===0,scopeDigest:plan.planDigest};
      return {value:Object.freeze({...value,previewDigest:canonicalDigest(value)}),plan};
    }finally{db.close();}
  }
  async function digest(file){const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex');}
  async function syncDirectories(root){
    if(process.platform!=='linux')return;
    for(const entry of await fs.promises.readdir(root,{withFileTypes:true}))if(entry.isDirectory())await syncDirectories(path.join(root,entry.name));
    const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  async function files(root,relative='',exclude=new Set()){
    const list=[];
    for(const entry of await fs.promises.readdir(path.join(root,relative),{withFileTypes:true})){
      if(!relative&&exclude.has(entry.name))continue;
      const key=path.join(relative,entry.name),absolute=path.join(root,key);
      if(entry.isSymbolicLink())fail('RESET_BACKUP_SYMLINK_REFUSED','备份中发现符号链接，已停止清理。');
      if(entry.isDirectory())list.push(...await files(root,key));
      else if(entry.isFile())list.push({path:key,bytes:(await fs.promises.stat(absolute)).size,sha256:await digest(absolute)});
      else fail('RESET_BACKUP_FILE_UNSUPPORTED','备份中发现不支持的文件。');
    }
    return list.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  }
  async function copyVerified(source,target,exclude=new Set()){
    const before=await files(source,'',exclude);
    for(const item of before){const dest=path.join(target,item.path);await fs.promises.mkdir(path.dirname(dest),{recursive:true});await fs.promises.copyFile(path.join(source,item.path),dest);
      const fd=fs.openSync(dest,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      if(process.platform==='linux'){const parent=fs.openSync(path.dirname(dest),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
    }
    const after=await files(source,'',exclude),copied=await files(target);
    if(canonicalDigest(before)!==canonicalDigest(after)||canonicalDigest(before)!==canonicalDigest(copied))fail('RESET_BACKUP_DRIFT','备份期间文件发生变化，未执行Reset。');
    return copied;
  }
  async function backup(captured){
    assertSafeWorkspaceRoot(options.workspaceRoot,options.dataDir);
    if(fs.lstatSync(options.workspaceRoot).isSymbolicLink())fail('RESET_BACKUP_SYMLINK_REFUSED','工作区根目录不安全。');
    const backupRoot=path.join(options.dataDir,'operator-backups');
    await fs.promises.mkdir(backupRoot,{recursive:true,mode:0o700});
    if(fs.lstatSync(backupRoot).isSymbolicLink())fail('RESET_BACKUP_PATH_UNSAFE','备份位置不安全。');
    const inventory=await files(options.dataDir,'',new Set(['shelfdeck.db','shelfdeck.db-wal','shelfdeck.db-shm','operator-backups']));
    let required=BigInt(fs.statSync(databasePath).size)+inventory.reduce((total,item)=>total+BigInt(item.bytes),0n);
    if(fs.existsSync(databasePath+'-wal'))required+=BigInt(fs.statSync(databasePath+'-wal').size);
    for(const id of captured.plan.workspaces.map(row=>row.workspace_id)){
      if(!/^[a-f0-9]{64}$/i.test(id))fail('RESET_WORKSPACE_ID_INVALID','工作区标识无效。');
      const source=path.join(options.workspaceRoot,id);if(fs.existsSync(source)){
        if(fs.lstatSync(source).isSymbolicLink())fail('RESET_BACKUP_SYMLINK_REFUSED','工作区备份包含符号链接。');
        required+=(await files(source)).reduce((total,item)=>total+BigInt(item.bytes),0n);
      }
    }
    const space=fs.statfsSync(backupRoot,{bigint:true});
    if(space.bavail*space.bsize<required+64n*1024n*1024n)fail('RESET_BACKUP_SPACE_INSUFFICIENT','备份空间不足，未执行Reset。');
    const backupId='formation-reset-'+crypto.randomUUID(),target=path.join(backupRoot,backupId);
    await fs.promises.mkdir(target,{mode:0o700});await fs.promises.mkdir(path.join(target,'data'));
    const skip=new Set(['shelfdeck.db','shelfdeck.db-wal','shelfdeck.db-shm','operator-backups']);
    const companions=await copyVerified(options.dataDir,path.join(target,'data'),skip);
    const db=new Database(databasePath,{readonly:true,fileMustExist:true});
    try{db.exec('BEGIN');db.prepare('SELECT count(*) FROM sqlite_master').get();await db.backup(path.join(target,'data','shelfdeck.db'));}finally{db.close();}
    assertSafeWorkspaceRoot(options.workspaceRoot,options.dataDir);
    const workspaces=[];
    for(const id of captured.plan.workspaces.map(row=>row.workspace_id)){
      if(!/^[a-f0-9]{64}$/i.test(id))fail('RESET_WORKSPACE_ID_INVALID','工作区标识无效。');
      const source=path.join(options.workspaceRoot,id);if(!fs.existsSync(source)){workspaces.push({workspaceId:id,absent:true});continue;}
      if(fs.lstatSync(source).isSymbolicLink())fail('RESET_BACKUP_SYMLINK_REFUSED','工作区备份包含符号链接。');
      const dest=path.join(target,'workspaces',id);await fs.promises.mkdir(dest,{recursive:true});
      workspaces.push({workspaceId:id,files:await copyVerified(source,dest)});
    }
    const copy=new Database(path.join(target,'data','shelfdeck.db'));
    try{copy.pragma('wal_checkpoint(TRUNCATE)');const integrity=copy.pragma('integrity_check');
      if(integrity.length!==1||integrity[0].integrity_check!=='ok'||copy.pragma('foreign_key_check').length)fail('RESET_BACKUP_INTEGRITY_FAILED','备份完整性验证失败，未执行Reset。');
    }finally{copy.close();}
    const databaseFile=path.join(target,'data','shelfdeck.db'),databaseFd=fs.openSync(databaseFile,'r+');
    try{fs.fsyncSync(databaseFd);}finally{fs.closeSync(databaseFd);}
    const receipt={schema:'shelfdeck.user-formation-reset-backup@1',backupId,previewDigest:captured.value.previewDigest,
      databaseSha256:await digest(path.join(target,'data','shelfdeck.db')),companions,workspaces,createdAt:new Date().toISOString()};
    writeAtomic(path.join(target,'receipt.json'),receipt);
    await syncDirectories(target);
    if(process.platform==='linux')for(const directory of [backupRoot,options.dataDir]){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    return {backupId,backupDigest:canonicalDigest(receipt)};
  }
  async function verifyBackup(saved){
    if(!/^formation-reset-[a-zA-Z0-9-]{1,100}$/.test(saved.backupId||''))fail('RESET_BACKUP_ID_INVALID','备份标识无效。');
    const root=path.join(options.dataDir,'operator-backups',saved.backupId);
    if(fs.lstatSync(root).isSymbolicLink())fail('RESET_BACKUP_PATH_UNSAFE','备份位置不安全。');
    const receiptPath=path.join(root,'receipt.json');
    if(fs.lstatSync(receiptPath).isSymbolicLink())fail('RESET_BACKUP_PATH_UNSAFE','备份记录不安全。');
    const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8'));
    if(receipt.schema!=='shelfdeck.user-formation-reset-backup@1'||canonicalDigest(receipt)!==saved.backupDigest||receipt.backupId!==saved.backupId)
      fail('RESET_BACKUP_INTEGRITY_FAILED','备份记录校验失败，保持停机。');
    const copied=await files(path.join(root,'data'));
    const database=copied.find(row=>row.path==='shelfdeck.db');
    if(!database||database.sha256!==receipt.databaseSha256||canonicalDigest(copied.filter(row=>row.path!=='shelfdeck.db'))!==canonicalDigest(receipt.companions))
      fail('RESET_BACKUP_INTEGRITY_FAILED','备份文件校验失败，保持停机。');
    for(const workspace of receipt.workspaces)if(!workspace.absent){
      if(!/^[a-f0-9]{64}$/.test(workspace.workspaceId)||
          canonicalDigest(await files(path.join(root,'workspaces',workspace.workspaceId)))!==canonicalDigest(workspace.files))
        fail('RESET_BACKUP_INTEGRITY_FAILED','工作区备份校验失败，保持停机。');
    }
  }
  async function finish(record){
    const receipt={schema:'shelfdeck.user-formation-reset-receipt@2',resetId:record.resetId,...record.backup,
      previewDigest:record.manifest.previewDigest,scopeDigest:record.manifest.plan.planDigest,
      retiredSubjects:record.verification.retiredSubjects,retiredIntakes:record.manifest.intakes.length,
      retiredRunIds:record.verification.retiredRunIds,retainedWorkspaces:record.verification.retainedWorkspaces,
      journalDigest:record.journalDigest,verification:record.verification};
    const directory=path.join(options.dataDir,'reset-receipts');await fs.promises.mkdir(directory,{recursive:true,mode:0o700});
    if(fs.lstatSync(directory).isSymbolicLink())fail('RESET_RECEIPT_PATH_UNSAFE','重置记录位置不安全。');
    const filename=path.join(directory,record.resetId+'.json');
    if(fs.existsSync(filename)){
      if(fs.lstatSync(filename).isSymbolicLink()||canonicalDigest(JSON.parse(fs.readFileSync(filename,'utf8')))!==canonicalDigest(receipt))
        fail('RESET_RECEIPT_CONFLICT','重置记录与已提交结果不一致。');
    }else writeAtomic(filename,receipt);
    return {...receipt,receipt};
  }
  return Object.freeze({preview:()=>inspect().value,
    async apply(preview,beforeApply){
      let captured=inspect();if(captured.value.previewDigest!==preview.previewDigest||!captured.value.ready)
        fail('RUNTIME_RESET_PREVIEW_STALE','重置范围已变化，请重新核对。');
      const saved=await backup(captured);captured=inspect();
      if(captured.value.previewDigest!==preview.previewDigest||!captured.value.ready)
        fail('RUNTIME_RESET_PREVIEW_STALE','备份后重置范围发生变化，未执行Reset。');
      const resetId='formation-reset-'+crypto.randomUUID();
      const operator=createFormationRetirementOperator({...options,verifyBackup});
      try{
        operator.prepare({resetId,expectedPlanDigest:captured.plan.planDigest,previewDigest:preview.previewDigest,backup:saved});
        await beforeApply({...saved,resetId});
        return await finish(await operator.execute(resetId));
      }finally{operator.close();}
    },
    async recover(resetId){
      const operator=createFormationRetirementOperator({...options,verifyBackup});
      try{return await finish(await operator.execute(resetId));}finally{operator.close();}
    },
  });
}
module.exports=Object.freeze({createUserFormationReset});
