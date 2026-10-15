'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createJavCorrectionWorkspaceIo}=require('../../src/helix/integrations/jav-correction-workspace-io');
const {createJavCorrectionWorkspaceReclaim}=require('../../src/helix/integrations/jav-correction-workspace-reclaim');
const {buildJavCorrectionWorkspaceReclaimPlan,SCHEMA}=require('../../src/helix/domains/arca/model/jav-correction-workspace-reclaim');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {buildArcaApplicationSchemas}=require('../../scripts/helix-architecture/arca-application-schema-builder');
const {buildSharedTypeSchemas}=require('../../scripts/helix-architecture/shared-type-schema-builder');
const validator=createCapabilityContractValidator({schemas:[...Object.values(buildArcaApplicationSchemas()),...Object.values(buildSharedTypeSchemas())]});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-workspace-reclaim-')),rootSnapshot={rootId:'root',rootHandleRef:canonicalDigest('root'),endpointId:'endpoint',
    mountScopeId:'mount',resolvedRoot:root,configRevision:1,snapshotDigest:canonicalDigest('snapshot')},
    correctionId='arca-jav-correction-'+canonicalDigest('correction').slice(0,40),admissionDigest=canonicalDigest('admission'),scopeDigest=canonicalDigest('scope'),
    io=createJavCorrectionWorkspaceIo({rootSnapshot}),items=['metadata','nfo','poster','fanart'].map(kind=>({kind,...io.write({correctionId,admissionDigest,kind,
      bytes:kind==='poster'?Buffer.alloc(600*1024,42):Buffer.from(kind+' exact prepared bytes'),shouldContinue:()=>true})})),
    payload={correctionId,admissionDigest,confirmedProposalDigest:canonicalDigest('confirmed'),actualProposalDigest:canonicalDigest('actual'),
      sourceObservationDigest:canonicalDigest('source'),metadataFactDigest:canonicalDigest('metadata'),metadataHandle:items[0].workspaceMaterialHandle,
      artifacts:items.slice(1).map(item=>({artifactKind:item.kind,workspaceMaterialHandle:item.workspaceMaterialHandle,artifactHandle:item.artifactHandle}))},
    prepared={schemaRef:'helix://contracts/types/JavCorrectionAssetsPrepared/v1',schemaVersion:1,basisDigest:scopeDigest,...payload,payloadDigest:canonicalDigest(payload)},
    fileBody={correctionId,shelfEntryId:'entry',admissionDigest,scopeDigest,basisDigest:canonicalDigest('basis'),placementPreviewDigest:canonicalDigest('preview'),
      preparedAssetsPayloadDigest:prepared.payloadDigest,members:items.slice(1).map(item=>({source:{workspaceMaterialHandle:item.workspaceMaterialHandle,artifactHandle:item.artifactHandle}}))},
    filePlan={...fileBody,planDigest:canonicalDigest(fileBody)},contextBody={schemaRef:'helix://contracts/application-types/ArcaJavCorrectionCommittedContext/v1',schemaVersion:1,
      correctionId,shelfEntryId:'entry',admissionDigest,receiptDigest:canonicalDigest('commit'),commitReference:{scopeDigest},filePlan},
    committedContext={...contextBody,contextDigest:canonicalDigest(contextBody)},record={correctionId,shelfEntryId:'entry',admissionDigest,state:'committed',cleanupState:'active',
      proof:{basis:{basisDigest:filePlan.basisDigest},placementPreviewDigest:filePlan.placementPreviewDigest}},
    formalRetirementResult={schemaRef:'helix://contracts/types/JavCorrectionFormalRetirementReceipt/v1',receiptKind:'jav_correction_formal_retirement',ownerDomain:'arca',
      scopeType:'jav_identity_correction',scopeId:correctionId,correctionId,shelfEntryId:'entry',committedContextDigest:committedContext.contextDigest,
      commitReceiptDigest:committedContext.receiptDigest,stageDisposition:'absent'},registry={registryExists:true,members:items.map(item=>item.workspaceMaterialHandle),artifacts:items.slice(1).map(item=>item.artifactHandle)},
    input={record,committedContext,prepared,formalRetirementResult,registry,rootSnapshot},plan=buildJavCorrectionWorkspaceReclaimPlan(input),
    port=createJavCorrectionWorkspaceReclaim({validatePlan:value=>validator.validate(SCHEMA,value)}),options={shouldContinue:()=>true,readCurrentGuardDigest:()=>plan.guardDigest},
    workspace=path.join(root,correctionId+'-assets'),paths=plan.members.map(item=>path.join(workspace,...item.relativePath.split('/'))),
    formal=path.join(root,'committed-poster.jpg');fs.linkSync(paths.at(-1),formal);
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-workspace-reclaim-'));fs.rmSync(root,{recursive:true,force:true});});
  validator.validate(SCHEMA,plan);return {root,input,plan,port,options,workspace,paths,formal};
}
test('reclaim removes the four exact working files and empty scope directories, retaining root and committed hard links',t=>{
  const f=fixture(t),before=fs.readFileSync(f.formal),result=f.port.reclaim(f.plan,f.options);
  assert.equal(fs.existsSync(f.workspace),false);assert.equal(fs.existsSync(f.root),true);assert.deepEqual(fs.readFileSync(f.formal),before);
  assert.equal(result.reclaimedHandleCount,4);assert.equal(result.reclaimedArtifactCount,3);assert.deepEqual(f.port.verifyReclaimed(f.plan,f.options),result);
  assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});
});
test('unknown files, producer temporaries and extra directories stop full preflight without deleting registered materials',t=>{
  for(const kind of ['unknown','producer','directory']){const f=fixture(t),foreign=kind==='directory'?path.join(f.workspace,'other'):path.join(path.dirname(f.paths.at(-1)),kind==='producer'?'.shelfdeck-writing-'+f.plan.members.at(-1).digestHex+'.part':'foreign.txt');
    if(kind==='directory')fs.mkdirSync(foreign);else fs.writeFileSync(foreign,'foreign');
    assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});
    assert.ok(fs.existsSync(foreign));for(const location of f.paths)assert.ok(fs.existsSync(location));}
});
test('full digest verification rejects drift outside the bounded fingerprint and preserves every registered file',t=>{
  const f=fixture(t),poster=f.paths.at(-1),descriptor=fs.openSync(poster,'r+');try{fs.writeSync(descriptor,Buffer.from([43]),0,1,0);}finally{fs.closeSync(descriptor);}
  assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});for(const location of f.paths)assert.ok(fs.existsSync(location));
});
test('a same-byte replacement inode and a linked kind directory are retained as conflicts',t=>{
  const f=fixture(t),location=f.paths[0],bytes=fs.readFileSync(location),replacement=path.join(f.root,'replacement');fs.writeFileSync(replacement,bytes);fs.unlinkSync(location);fs.renameSync(replacement,location);
  assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});assert.deepEqual(fs.readFileSync(location),bytes);
  const linked=fixture(t),parent=path.dirname(linked.paths[0]),moved=path.join(linked.root,'moved-kind');fs.renameSync(parent,moved);fs.symlinkSync(moved,parent,'junction');
  assert.throws(()=>linked.port.reclaim(linked.plan,linked.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});assert.ok(fs.existsSync(path.join(moved,path.basename(linked.paths[0]))));
});
test('partial unlink requires explicit original-effect continue_forward and then converges to the same reality digest',t=>{
  const f=fixture(t),unlink=fs.unlinkSync;let count=0;
  fs.unlinkSync=function(location,...args){unlink.call(fs,location,...args);if(f.paths.includes(location)&&++count===2)throw Object.assign(new Error('process loss'),{code:'PROCESS_LOSS'});};
  try{assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'PROCESS_LOSS'});}finally{fs.unlinkSync=unlink;}
  assert.equal(f.paths.filter(location=>fs.existsSync(location)).length,2);
  assert.throws(()=>f.port.reclaim(f.plan,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});
  const result=f.port.reclaim(f.plan,{...f.options,recoveryDecision:'continue_forward'});assert.deepEqual(f.port.verifyReclaimed(f.plan,f.options),result);assert.ok(fs.existsSync(f.formal));
});
test('guard loss or a newly introduced file during execution stops the next mutation and preserves remaining bytes',t=>{
  for(const kind of ['guard','foreign']){const f=fixture(t),unlink=fs.unlinkSync;let changed=false;
    fs.unlinkSync=function(location,...args){unlink.call(fs,location,...args);if(f.paths.includes(location)&&!changed){changed=true;if(kind==='foreign')fs.writeFileSync(path.join(path.dirname(f.paths.at(-1)),'late.txt'),'foreign');}};
    try{assert.throws(()=>f.port.reclaim(f.plan,{shouldContinue:()=>true,readCurrentGuardDigest:()=>changed&&kind==='guard'?canonicalDigest('stale'):f.plan.guardDigest}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});}finally{fs.unlinkSync=unlink;}
    assert.equal(f.paths.filter(location=>fs.existsSync(location)).length,3);assert.ok(fs.existsSync(f.formal));}
});
test('completed or active core correction, changed Asset set and foreign formal retirement provenance cannot produce a reclaim Plan',t=>{
  const f=fixture(t);
  for(const mutate of [value=>value.record.cleanupState='completed',value=>value.record.state='active',value=>value.registry.members.pop(),
    value=>value.formalRetirementResult.committedContextDigest=canonicalDigest('foreign'),value=>value.prepared.metadataHandle.digestHex=canonicalDigest('foreign')]){
    const input=structuredClone(f.input);mutate(input);assert.throws(()=>buildJavCorrectionWorkspaceReclaimPlan(input));}
  for(const location of f.paths)assert.ok(fs.existsSync(location));
});
test('a re-signed Plan with a broader root cannot borrow the current owner guard',t=>{
  const f=fixture(t),plan=structuredClone(f.plan);plan.root.resolvedRoot=path.dirname(f.root);const {planDigest,guardDigest,...body}=plan;
  const changed={...body,guardDigest:canonicalDigest(body)},expanded={...changed,planDigest:canonicalDigest(changed)};
  assert.throws(()=>f.port.reclaim(expanded,f.options),{code:'ARCA_JAV_CORRECTION_WORKSPACE_RECLAIM_CONFLICT'});for(const location of f.paths)assert.ok(fs.existsSync(location));
});
