'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createJavCorrectionWorkspaceIo}=require('../../src/helix/integrations/jav-correction-workspace-io');
const {createHash}=require('node:crypto');
test('correction Workspace writes replay exact bytes and reject foreign bytes, oversized members and lost execution scope',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-io-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-correction-io-'));fs.rmSync(root,{recursive:true,force:true});});
  const io=createJavCorrectionWorkspaceIo({rootSnapshot:{resolvedRoot:root,rootHandleRef:canonicalDigest('root'),mountScopeId:'test-mount',endpointId:'test-endpoint'}}),
    request={correctionId:'arca-jav-correction-'+canonicalDigest('correction').slice(0,40),admissionDigest:canonicalDigest('admission'),kind:'nfo',
      bytes:Buffer.from('<movie>IPX-178</movie>'),shouldContinue:()=>true},first=io.write(request),second=io.write(request);
  assert.deepEqual(second,first);
  assert.throws(()=>io.write({...request,bytes:Buffer.from('<movie>IPX-177</movie>')}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT'});
  assert.throws(()=>io.write({...request,bytes:Buffer.alloc(128*1024+1)}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_BYTES_INVALID'});
  assert.throws(()=>io.write({...request,kind:'poster',shouldContinue:()=>false}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_FENCED'});
  assert.equal(fs.existsSync(io.location(request.correctionId,'poster').location),false);
  assert.throws(()=>io.write({...request,correctionId:'../outside'}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_PATH_INVALID'});
});
test('declared short producer files require classified cleanup; complete conflicting and unknown files are retained',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-io-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-correction-io-'));fs.rmSync(root,{recursive:true,force:true});});
  const io=createJavCorrectionWorkspaceIo({rootSnapshot:{resolvedRoot:root,rootHandleRef:canonicalDigest('root'),mountScopeId:'mount',endpointId:'endpoint'}}),
    correctionId='arca-jav-correction-'+canonicalDigest('case').slice(0,40),bytes=Buffer.from('<movie><title>Expected film</title></movie>'),
    request={correctionId,admissionDigest:canonicalDigest('admission'),kind:'nfo',bytes,shouldContinue:()=>true},member=io.location(correctionId,'nfo'),
    temporary=path.join(path.dirname(member.location),'.shelfdeck-writing-'+createHash('sha256').update(bytes).digest('hex')+'.part'),
    recipe=io.describe(['metadata','nfo','poster','fanart'].map(kind=>({kind,bytes:kind==='nfo'?bytes:Buffer.from(kind)}))),registry={registryExists:true,members:[]};
  fs.mkdirSync(path.dirname(temporary),{recursive:true});fs.writeFileSync(temporary,bytes.subarray(0,7));
  let observed=io.observe({correctionId,byteExpectations:recipe,registry});assert.equal(observed.status,'conflict');assert.equal(observed.cleanupDeclared,true);
  assert.throws(()=>io.write(request),{code:'ARCA_JAV_CORRECTION_TEMP_RECOVERY_REQUIRED'});assert.equal(fs.existsSync(member.location),false);
  const result=io.write({...request,recoveryDecision:'safe_retry'});assert.equal(fs.existsSync(temporary),false);assert.deepEqual(fs.readFileSync(member.location),bytes);
  assert.equal(result.workspaceMaterialHandle.sizeBytes,bytes.length);
  const conflicting=Buffer.alloc(bytes.length,65);fs.writeFileSync(temporary,conflicting);
  observed=io.observe({correctionId,byteExpectations:recipe,registry});assert.equal(observed.status,'conflict');assert.equal(observed.cleanupDeclared,false);
  assert.throws(()=>io.write({...request,recoveryDecision:'safe_retry'}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT'});
  assert.deepEqual(fs.readFileSync(temporary),conflicting);assert.deepEqual(fs.readFileSync(member.location),bytes);
  const unknown=path.join(path.dirname(member.location),'other.part');fs.writeFileSync(unknown,'foreign');
  assert.equal(io.observe({correctionId,byteExpectations:recipe,registry}).cleanupDeclared,false);assert.equal(fs.readFileSync(unknown,'utf8'),'foreign');
});
test('exclusive publication preserves a foreign final target created during the publication race',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-correction-io-'));
  t.after(()=>{assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('jav-correction-io-'));fs.rmSync(root,{recursive:true,force:true});});
  const io=createJavCorrectionWorkspaceIo({rootSnapshot:{resolvedRoot:root,rootHandleRef:canonicalDigest('root'),mountScopeId:'mount',endpointId:'endpoint'}}),
    correctionId='arca-jav-correction-'+canonicalDigest('race').slice(0,40),target=io.location(correctionId,'nfo').location,
    bytes=Buffer.from('<movie>new</movie>'),foreign=Buffer.from('<movie>old</movie>'),link=fs.linkSync;
  fs.linkSync=function(source,destination,...args){if(destination===target)fs.writeFileSync(target,foreign,{flag:'wx'});return link.call(fs,source,destination,...args);};
  try {
    assert.throws(()=>io.write({correctionId,admissionDigest:canonicalDigest('admission'),kind:'nfo',bytes,shouldContinue:()=>true}),{code:'ARCA_JAV_CORRECTION_WORKSPACE_REPLAY_CONFLICT'});
    assert.deepEqual(fs.readFileSync(target),foreign);
    const temporary=path.join(path.dirname(target),'.shelfdeck-writing-'+createHash('sha256').update(bytes).digest('hex')+'.part');
    assert.deepEqual(fs.readFileSync(temporary),bytes);
  } finally {fs.linkSync=link;}
});
