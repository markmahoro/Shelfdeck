'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalJson,canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultInventoryWorkspace}=require('../../src/helix/integrations/us-adult-inventory-workspace');
function setup(t){
  const f=fixture(t),s=f.services(),started=s.command.request('entry',f.request,'admin'),intent=s.store.get(started.intentId).intent,
    aftercareCaseId=started.aftercareCaseId,context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry'},assertExecutionActive(){}},
    make=services=>createUsAdultInventoryWorkspace({rootSnapshot:{...services.care.aftercareWorkspaceRootSnapshot,resolvedRoot:services.dependencies.aftercareWorkspaceRoot},
      ensureWorkspace:id=>services.care.ensureAftercareWorkspace(id),registerMaterial:handle=>services.care.registerAftercareWorkspaceMaterial(handle),
      assertRegistered:handle=>services.care.listAftercareWorkspaceHandles(aftercareCaseId).some(value=>canonicalJson(value)===canonicalJson(handle))});
  s.care.admitCase(aftercareCaseId);return {f,s,intent,aftercareCaseId,context,make,workspace:make(s)};
}
test('actor Workspace uses the durable Case registry and preserves immutable handles through database reopen',t=>{
  const x=setup(t),request={intent:x.intent,aftercareCaseId:x.aftercareCaseId,context:x.context},bytes=Buffer.from('registered image'),
    handle=x.workspace.write({...request,kind:'frame-00',bytes});
  assert.deepEqual(x.workspace.read({...request,handle}),bytes);
  assert.deepEqual(x.workspace.write({...request,kind:'frame-00',bytes}),handle);
  const restarted=x.make(x.f.reopen());assert.deepEqual(restarted.read({...request,handle}),bytes);
  assert.equal(x.f.db.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n,1);
  assert.throws(()=>restarted.read({...request,aftercareCaseId:'other-case',handle}),{code:'ARCA_US_ADULT_WORKSPACE_HANDLE_INVALID'});
  const changed={...handle,rootHandleRef:canonicalDigest('other-root')};
  assert.throws(()=>restarted.read({...request,handle:changed}),{code:'ARCA_US_ADULT_WORKSPACE_HANDLE_INVALID'});
  const location=x.s.care.aftercareWorkspaceLocation(x.aftercareCaseId,handle.relativePath);fs.writeFileSync(location,'changed');
  assert.throws(()=>restarted.read({...request,handle}),{code:'ARCA_US_ADULT_WORKSPACE_CHANGED'});
});
test('partial Workspace writes require exact recipe recovery and never replace a foreign prefix',t=>{
  const x=setup(t),request={intent:x.intent,aftercareCaseId:x.aftercareCaseId,context:x.context},bytes=Buffer.from('complete screenshot'),
    handle=x.workspace.write({...request,kind:'frame-00',bytes}),location=x.s.care.aftercareWorkspaceLocation(x.aftercareCaseId,handle.relativePath);
  fs.writeFileSync(location+'.part',bytes.subarray(0,4));
  assert.throws(()=>x.workspace.write({...request,kind:'frame-00',bytes}),{code:'ARCA_US_ADULT_WORKSPACE_PARTIAL_WRITE'});
  assert.equal(fs.readFileSync(location+'.part').length,4);
  assert.deepEqual(x.workspace.write({...request,kind:'frame-00',bytes,recoveryDecision:'safe_retry'}),handle);
  fs.writeFileSync(location+'.part','FOREIGN');
  assert.throws(()=>x.workspace.write({...request,kind:'frame-00',bytes,recoveryDecision:'safe_retry'}),{code:'ARCA_US_ADULT_WORKSPACE_PARTIAL_WRITE'});
  assert.equal(fs.readFileSync(location+'.part','utf8'),'FOREIGN');assert.deepEqual(fs.readFileSync(location),bytes);
});
test('Workspace publication rejects linked parents and execution cancellation before writes',t=>{
  const x=setup(t),request={intent:x.intent,aftercareCaseId:x.aftercareCaseId,context:x.context},bytes=Buffer.from('screenshot');
  assert.throws(()=>x.workspace.write({...request,kind:'../frame-00',bytes}),{code:'ARCA_US_ADULT_WORKSPACE_BYTES_INVALID'});
  assert.throws(()=>x.workspace.write({...request,kind:'frame-00',bytes,context:{...x.context,assertExecutionActive(){throw Object.assign(new Error('Stopped'),{code:'STOPPED'});}}}),{code:'STOPPED'});
  assert.equal(x.f.db.prepare('SELECT count(*) n FROM fx_workspace_materials').get().n,0);
  x.s.care.ensureAftercareWorkspace(x.aftercareCaseId);
  const caseRoot=path.join(x.s.dependencies.aftercareWorkspaceRoot,x.aftercareCaseId),foreign=path.join(x.f.root,'foreign');
  fs.mkdirSync(caseRoot,{recursive:true});fs.mkdirSync(foreign);fs.symlinkSync(foreign,path.join(caseRoot,'us-adult'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>x.workspace.write({...request,kind:'frame-00',bytes}),{code:'ARCA_US_ADULT_WORKSPACE_PATH_INVALID'});
  assert.deepEqual(fs.readdirSync(foreign),[]);
});
