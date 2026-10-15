'use strict';
const {createJavCorrectionWorkStore}=require('../persistence/jav-correction-work-store');
const {projectArcaProcess}=require('./aftercare-process-projection');
const workLabels=Object.freeze(Object.fromEntries([
  ['jav_correction_assets','准备纠正资料'],['jav_correction_files','暂存纠正文件'],['jav_correction_publish','更新文件位置'],
  ['jav_correction_verify','核验纠正文件'],['jav_correction_commit','提交影片身份'],
  ['jav_correction_formal_retirement','清理旧资料'],['jav_correction_workspace_reclaim','回收临时文件'],
].map(([kind,label])=>[kind,[kind,label,label]])));
const capabilityLabels=Object.freeze(Object.fromEntries([
  ['source.verify','核验影片资料'],['assets.prepare','准备影片资料'],['files.stage','暂存文件'],['files.publish','更新正式文件'],
  ['files.verify','核验正式文件'],['inventory.commit','提交影片身份'],['formal_retirement.execute','清理旧资料'],['workspace.reclaim','回收临时文件'],
].map(([ref,label])=>['arca.jav_correction.'+ref+'@1',label])));
function createJavCorrectionWorkQuery(options){
  const store=createJavCorrectionWorkStore(options);
  return Object.freeze({list(query={}){
    const page=store.list(query),records=page.items.map(item=>({...item,record:options.correctionStore.get(item.correctionId)}));
    if(records.some(item=>!item.record))throw Object.assign(new Error('Correction page lost its durable record.'),{code:'ARCA_JAV_CORRECTION_RECORD_CORRUPT'});
    const display=options.contextReader.store.workDisplay(records.map(item=>item.record.shelfEntryId));
    return {...page,items:records.map(({record,classification})=>{
      const summary=display.get(record.shelfEntryId),detail=query.correctionId?
        projectArcaProcess(options.progressProjectionReader.read([record.correctionId],{includePlans:true,resultCapabilityRefs:[]})
          .filter(work=>work.ownerDomain==='arca'&&work.processType==='arca_jav_identity_correction'),Date.now(),
          {workLabels,capabilityLabels,contract:'jav_correction_process_actual_plans@1'}):null;
      return Object.freeze({...options.admin.status(record.shelfEntryId,record.correctionId),taskType:'jav_identity_correction',classification,
        displayIdentity:summary?.displayIdentity||record.proof.proposal.oldJavCode,targetShelfId:summary?.targetShelfId||null,targetShelfName:summary?.targetShelfName||null,
        createdAtMs:record.createdAtMs,terminalAtMs:['completed','ended'].includes(classification)?record.updatedAtMs:null,
        processDetail:detail?{contract:detail.contract,stages:detail.stages}:null});
    })};
  }});
}
module.exports=Object.freeze({createJavCorrectionWorkQuery});
