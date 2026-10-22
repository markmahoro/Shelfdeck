'use strict';

const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../src/helix/contracts/canonical-json');
const {writeAtomic}=require('../src/clean-runtime-operations');
const {inspectPlan,applyReset,assertSafeTranscodeRoot}=require('./helix-formation-reset');

function fail(code,message){throw Object.assign(new Error(message),{code,statusCode:409});}
const blockerLabels={FORMATION_RESET_COMMITTED_SUBJECT_REFUSED:'整理关联已有正式收藏，不能以Reset清除。',
  RESET_ENDED_HISTORY_OVERLAP:'已完成/已结束历史不能清理。',RESET_UNRESOLVED_EFFECT:'存在尚未确认的文件操作，不能清除。',
  RESET_UNSCOPED_RESPONSIBILITY:'存在无法归属到清单的整理残留，须先核查，不能清理。'};

function createUserFormationReset(options){
  const databasePath=path.join(options.dataDir,'shelfdeck.db');
  function inspect(){
    const db=new Database(databasePath,{readonly:true,fileMustExist:true});
    try {
      const selected=db.prepare(`SELECT s.subject_id,s.content_profile,p.display_identity
        FROM libra_subjects s LEFT JOIN libra_formation_projections p ON p.subject_id=s.subject_id
        WHERE s.status='active' AND (
          p.classification IN ('in_progress','attention_required')
          OR (p.subject_id IS NULL AND (EXISTS(SELECT 1 FROM libra_runs r WHERE r.subject_id=s.subject_id AND r.state IN ('active','suspended','frozen'))
            OR NOT EXISTS(SELECT 1 FROM libra_runs r WHERE r.subject_id=s.subject_id))))
        UNION ALL SELECT token.subject_id,'unknown',NULL FROM libra_predeck_pipeline_tokens token
          LEFT JOIN libra_subjects s ON s.subject_id=token.subject_id WHERE s.subject_id IS NULL
        ORDER BY 1`).all();
      const ids=selected.map(row=>row.subject_id);let plan=null,blockers=[];
      if(ids.length){try{plan=inspectPlan(db,{subjectIds:ids});blockers=[...plan.blockers];}
        catch(error){if(error.message==='FORMATION_RESET_COMMITTED_SUBJECT_REFUSED')blockers.push({code:error.message});else throw error;}}
      const completedSubjects=new Set(db.prepare("SELECT subject_id FROM libra_formation_projections WHERE classification='completed'").all().map(row=>row.subject_id));
      if(ids.some(id=>completedSubjects.has(id)))blockers.push({code:'RESET_ENDED_HISTORY_OVERLAP'});
      const unresolved=db.prepare("SELECT count(*) n FROM fx_effect_journal WHERE effect_class!='pure' AND state IN ('intended','effect_observed','reconcile_required')").get().n;
      if(unresolved)blockers.push({code:'RESET_UNRESOLVED_EFFECT'});
      const includedWorks=new Set((plan?.scope.works||[]).map(row=>row.work_id));
      const detached=db.prepare(`SELECT work.work_id FROM fx_supporting_works work WHERE
        (work.owner_domain='libra' AND work.process_type='libra_run' AND NOT EXISTS(SELECT 1 FROM libra_runs r WHERE r.libra_run_id=work.process_id)) OR
        (work.owner_domain='libra' AND work.process_type='libra_intake' AND NOT EXISTS(SELECT 1 FROM libra_intake_decisions d WHERE d.intake_decision_id=work.process_id)) OR
        (work.owner_domain='libra' AND work.process_type IN ('libra_routing','libra_acceptance_spec') AND NOT EXISTS(SELECT 1 FROM libra_subjects s WHERE s.subject_id=work.process_id)) OR
        (work.owner_domain='arca' AND work.process_type IN ('arca_ondeck_run','arca_on_deck_run') AND NOT EXISTS(SELECT 1 FROM arca_ondeck_runs r WHERE r.on_deck_run_id=work.process_id)) OR
        (work.owner_domain='arca' AND work.process_type='arca_acceptance' AND NOT EXISTS(SELECT 1 FROM libra_product_packages p WHERE p.offer_id=work.process_id))`).all();
      if(detached.some(row=>!includedWorks.has(row.work_id)))blockers.push({code:'RESET_UNSCOPED_RESPONSIBILITY'});
      const value={items:selected.map(row=>({subjectId:row.subject_id,displayIdentity:row.display_identity||'待识别媒体',contentProfile:row.content_profile})),
        counts:{subjects:ids.length,runs:plan?.counts.runs||0,works:plan?.counts.works||0,workspaces:plan?.counts.workspaces||0},
        protected:{collectionCount:db.prepare('SELECT count(*) n FROM arca_shelf_entries').get().n,
          endedRunCount:db.prepare("SELECT count(*) n FROM libra_runs WHERE state NOT IN ('active','suspended','frozen')").get().n},
        blockers:blockers.map(item=>({code:item.code,message:blockerLabels[item.code]||'存在受保护的关联，不能安全清除。'})),
        empty:ids.length===0,ready:ids.length>0&&blockers.length===0,
        scopeDigest:canonicalDigest(plan||{subjectIds:ids})};
      return {value:Object.freeze({...value,previewDigest:canonicalDigest(value)}),plan,subjectIds:ids};
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
    assertSafeTranscodeRoot(options.workspaceRoot,options.dataDir);
    if(fs.lstatSync(options.workspaceRoot).isSymbolicLink())fail('RESET_BACKUP_SYMLINK_REFUSED','工作区根目录不安全。');
    const backupRoot=path.join(options.dataDir,'operator-backups');
    await fs.promises.mkdir(backupRoot,{recursive:true,mode:0o700});
    if(fs.lstatSync(backupRoot).isSymbolicLink())fail('RESET_BACKUP_PATH_UNSAFE','备份位置不安全。');
    const inventory=await files(options.dataDir,'',new Set(['shelfdeck.db','shelfdeck.db-wal','shelfdeck.db-shm','operator-backups']));
    let required=BigInt(fs.statSync(databasePath).size)+inventory.reduce((total,item)=>total+BigInt(item.bytes),0n);
    if(fs.existsSync(databasePath+'-wal'))required+=BigInt(fs.statSync(databasePath+'-wal').size);
    for(const id of captured.plan.scope.workspaceIds){
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
    assertSafeTranscodeRoot(options.workspaceRoot,options.dataDir);
    const workspaces=[];
    for(const id of captured.plan.scope.workspaceIds){
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
  return Object.freeze({preview:()=>inspect().value,
    async apply(preview,beforeApply){
      let captured=inspect();if(captured.value.previewDigest!==preview.previewDigest||!captured.value.ready)fail('RUNTIME_RESET_PREVIEW_STALE','清理范围已变化，请重新核对。');
      const saved=await backup(captured);captured=inspect();
      if(captured.value.previewDigest!==preview.previewDigest||!captured.value.ready)fail('RUNTIME_RESET_PREVIEW_STALE','备份后清理范围发生变化，未执行Reset。');
      await beforeApply(saved);const db=new Database(databasePath);
      try{const result=applyReset({database:db,dataDir:options.dataDir,transcodeDir:options.workspaceRoot,subjectIds:captured.subjectIds});
        const resetId='formation-reset-'+crypto.randomUUID();
        const receipt={schema:'shelfdeck.user-formation-reset-receipt@1',resetId,backupId:saved.backupId,
          previewDigest:preview.previewDigest,scopeDigest:captured.value.scopeDigest,
          removedSubjects:captured.value.counts.subjects,removedRuns:captured.plan.scope.runIds.length,
          removedWorkspaces:captured.plan.scope.workspaceIds.length,counts:captured.value.counts,
          protected:captured.value.protected,verification:result.verification,createdAt:new Date().toISOString()};
        const receiptDirectory=path.join(options.dataDir,'reset-receipts');
        await fs.promises.mkdir(receiptDirectory,{recursive:true,mode:0o700});
        writeAtomic(path.join(receiptDirectory,resetId+'.json'),receipt);
        return {...saved,resetId,receipt,removedSubjects:captured.value.counts.subjects,removedRunIds:captured.plan.scope.runIds,verification:result.verification};
      }finally{db.close();}
    },
  });
}
module.exports=Object.freeze({createUserFormationReset});
