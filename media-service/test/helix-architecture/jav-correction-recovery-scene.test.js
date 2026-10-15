'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {createJavCorrectionRecoveryScene}=require('../../src/helix/integrations/jav-correction-recovery-scene');
const {computeBoundedMaterialFingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const correctionId='arca-jav-correction-'+canonicalDigest('scene').slice(0,40);
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'jav-recovery-scene-'));t.after(()=>{
  assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('jav-recovery-scene-'));fs.rmSync(root,{recursive:true,force:true});});return root;}
test('recovery observes exact video identity and complete small artifact bytes without changing either file',async t=>{
  const root=temporary(t),video=path.join(root,'film.mkv'),cover=path.join(root,'poster.jpg'),bytes=Buffer.from('frozen cover');
  fs.writeFileSync(video,Buffer.alloc(1024,7));fs.truncateSync(video,64*1024*1024);fs.writeFileSync(cover,bytes);
  const fingerprint=await computeBoundedMaterialFingerprint(video,{requireStableSnapshot:true}),identity={inode:String(fingerprint.stat.ino),sizeBytes:Number(fingerprint.stat.size),contentFingerprint:fingerprint.contentFingerprint},
    before=[video,cover].map(location=>fs.statSync(location,{bigint:true})),request={correctionId,phase:'jav_correction_publish',roots:[root],
      files:[{role:'primary_payload',location:video,identities:[{identity}]},{role:'poster',location:cover,byteDigest:createHash('sha256').update(bytes).digest('hex'),sizeBytes:bytes.length}],
      directories:[],requiredGroups:[[0]]},port=createJavCorrectionRecoveryScene({now:()=>100}),observed=await port.observe(request);
  assert.equal(observed.classification,'matching');assert.equal(observed.files[0].expectedDigest,null);assert.equal(observed.files[0].physical.sizeBytes,64*1024*1024);
  assert.equal(observed.files[1].expectedDigest,request.files[1].byteDigest);assert.deepEqual(fs.readFileSync(cover),bytes);
  for(const [index,location] of [video,cover].entries()){const after=fs.statSync(location,{bigint:true});for(const field of ['ino','size','mtimeNs','ctimeNs'])assert.equal(after[field],before[index][field]);}
  fs.writeFileSync(cover,Buffer.from('altered byte'));assert.equal((await port.observe(request)).classification,'conflict');
  fs.unlinkSync(video);await assert.rejects(port.observe(request),{code:'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID'});
});
test('recovery rejects unknown directory members and escaped paths, retaining the complete allowed directory observation',async t=>{
  const root=temporary(t),directory=path.join(root,'workspace');fs.mkdirSync(directory);const expected=path.join(directory,'movie.nfo');
  const request={correctionId,phase:'jav_correction_assets',roots:[root],files:[],directories:[{location:directory,allowedMembers:[expected]}]},
    port=createJavCorrectionRecoveryScene({now:()=>100}),empty=await port.observe(request);
  assert.deepEqual(empty.directories,[{location:directory,exists:true,memberNames:[],memberSetDigest:canonicalDigest([])}]);
  fs.writeFileSync(expected,'nfo');assert.deepEqual((await port.observe(request)).directories[0].memberNames,['movie.nfo']);
  const unknown=path.join(directory,'foreign.jpg');fs.writeFileSync(unknown,'keep');await assert.rejects(port.observe(request),{code:'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID'});
  assert.equal(fs.readFileSync(unknown,'utf8'),'keep');
  await assert.rejects(port.observe({...request,directories:[],files:[{role:'escaped',location:path.join(root,'..','outside'),missingAllowed:true}]}),{code:'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID'});
});
test('only an exact recipe-named short producer in a registered Workspace can be observed for new-Intent recovery',async t=>{
  const root=temporary(t),bytes=Buffer.from('complete frozen producer bytes'),digest=createHash('sha256').update(bytes).digest('hex'),
    location=path.join(root,'.shelfdeck-writing-'+digest+'.part'),port=createJavCorrectionRecoveryScene({now:()=>100}),
    request={correctionId,phase:'jav_correction_assets',roots:[root],directories:[],files:[{role:'producer_temporary_nfo',location,missingAllowed:true,
      producerRecipe:{byteDigest:digest,sizeBytes:bytes.length,registeredWorkspace:true}}]};
  fs.writeFileSync(location,bytes.subarray(0,8));const before=fs.statSync(location,{bigint:true}),observed=await port.observe(request);
  assert.equal(observed.classification,'matching');assert.equal(observed.files[0].expectedDigest,digest);assert.equal(observed.files[0].physical.sizeBytes,8);
  assert.deepEqual(fs.readFileSync(location),bytes.subarray(0,8));assert.equal(fs.statSync(location,{bigint:true}).ino,before.ino);
  fs.writeFileSync(location,Buffer.alloc(bytes.length,0));assert.equal((await port.observe(request)).classification,'conflict');
  fs.writeFileSync(location,bytes);assert.equal((await port.observe(request)).classification,'matching');
  await assert.rejects(port.observe({...request,files:[{...request.files[0],producerRecipe:{...request.files[0].producerRecipe,registeredWorkspace:false}}]}),{code:'ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID'});
});
