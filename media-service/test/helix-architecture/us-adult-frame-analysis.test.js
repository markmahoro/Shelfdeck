'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process'),sharp=require('sharp');
const {createCleanUsAdultFrameExtractor}=require('../../src/clean-us-adult-frame-extractor');
const {createCleanMediaProbe}=require('../../src/clean-media-probe');
const {createLocalFaceModel}=require('../../src/helix/integrations/local-face-model');
const {computeBoundedMaterialFingerprint}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {uniformFrameTimes,createUsAdultFrameAnalysis}=require('../../src/helix/integrations/us-adult-frame-analysis');
const {faceModelReference}=require('../../src/helix/contracts/us-adult-face-model');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
test('sampling uses twenty evenly spaced interior times and rejects unknown duration',()=>{
  assert.deepEqual(uniformFrameTimes(2000),Array.from({length:20},(_,index)=>50+index*100));
  assert.throws(()=>uniformFrameTimes(0),{code:'US_ADULT_SAMPLING_INVALID'});
});
test('real Service FFmpeg extracts twenty points and CPU matching selects one actor across every detected face',{
  timeout:60000,skip:!process.env.SHELFDECK_FACE_MODEL_ROOT||!process.env.SHELFDECK_FACE_TEST_IMAGE?'Explicit pinned models and a benign test image are required.':false,
},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'us-frame-analysis-')),video=path.join(root,'Original source.mp4'),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static'),
    model=createLocalFaceModel({modelRoot:process.env.SHELFDECK_FACE_MODEL_ROOT}),extractor=createCleanUsAdultFrameExtractor({ffmpegPath:ffmpeg,mediaProbe:createCleanMediaProbe()});
  t.after(async()=>{await extractor.close();await model.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const encoded=spawnSync(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-loop','1','-i',process.env.SHELFDECK_FACE_TEST_IMAGE,
    '-t','2','-r','24','-c:v','libx264','-preset','ultrafast','-threads','1','-pix_fmt','yuv420p',video],{windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(encoded.status,0,encoded.stderr);
  const observed=await computeBoundedMaterialFingerprint(video),identity={inode:String(observed.stat.ino),sizeBytes:Number(observed.stat.size),
    fingerprintAlgorithm:observed.fingerprintAlgorithm,fingerprintVersion:observed.fingerprintVersion,contentFingerprint:observed.contentFingerprint},
    handle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',identity,location:video,ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'test-run'},
      expectedMtimeNs:Number(observed.stat.mtimeNs/1000000n),expectedCtimeNs:Number(observed.stat.ctimeNs/1000000n)},
    context={ownerScope:{domain:'libra',processType:'libra_run',processId:'test-run'},assertExecutionActive:()=>{}},frames=await extractor.extract({sourceHandle:handle,context});
  assert.equal(frames.length,20);assert.deepEqual(frames.map(frame=>frame.timestampMs),uniformFrameTimes(2000));
  const inventoryFrames=await extractor.extract({sourceHandle:{...handle,ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:'entry-1'}},
    context:{ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry-1'},assertExecutionActive:()=>{}}});
  assert.deepEqual(inventoryFrames,frames,'Arca reads its own entry through the same pure frame I/O without a borrowed Libra Run.');
  await assert.rejects(extractor.extract({sourceHandle:handle,context,durationMs:1000}),{code:'US_ADULT_SOURCE_PROBE_CHANGED'});
  const engine=createUsAdultFrameAnalysis({faceModel:model}),analysis=await engine.analyze(frames),
    reference=await model.analyzeImage(fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE),{requireSingleFace:true});
  assert.equal(analysis.frameMembers.length,20);assert.ok(analysis.detectedFaceCount>=20);
  assert.deepEqual(analysis.posterFrameOrdinals,[4,8,12,16]);
  const ref={libraryKind:'us_adult',vector:reference.faces[0].vector,personRevision:2,referenceRevision:3,referenceAssetId:'photo-1',
    referenceProjectionDigest:canonicalDigest('reference-projection'),artifactDigest:canonicalDigest('image'),modelRefDigest:faceModelReference('single_reference_face').digest},
    winner=engine.match(analysis,[{...ref,personId:'z-actor'},{...ref,personId:'a-actor'}]);
  assert.equal(winner.personId,'a-actor');assert.equal(winner.personRevision,2);assert.equal(winner.referenceAssetId,'photo-1');assert.equal(winner.referenceRevision,3);assert.ok(winner.score>0.9,winner.score);
  assert.equal(winner.analysisDigest,analysis.analysisDigest);assert.equal(winner.threshold,0.363);
  assert.equal(engine.match(analysis,[]),null);
  const black=await sharp({create:{width:256,height:256,channels:3,background:'#000'}}).jpeg().toBuffer(),
    noFaces=await engine.analyze([{timestampMs:0,bytes:black}]);
  assert.equal(noFaces.detectedFaceCount,0);assert.equal(engine.match(noFaces,[{...ref,personId:'a-actor'}]),null);
  assert.throws(()=>engine.match(analysis,[{...ref,personId:'a-actor',modelRefDigest:canonicalDigest('other-model')}]),{code:'US_ADULT_REFERENCE_MODEL_CHANGED'});
  fs.appendFileSync(video,'changed-source');
  await assert.rejects(extractor.extract({sourceHandle:handle,context}),{code:'US_ADULT_SOURCE_CHANGED'});
});
test('frame I/O rejects cross-owner, cross-entry and wrong process authority before reading a source',async()=>{
  let reads=0;const extractor=createCleanUsAdultFrameExtractor({ffmpegPath:process.execPath,mediaProbe:{probe(){reads++;throw new Error('Unexpected read');}}}),
    source={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',ownerDomain:'arca',ownerScope:{scopeType:'shelf_entry',scopeId:'entry-1'}},
    context={ownerScope:{domain:'arca',processType:'arca_shelf_entry',processId:'entry-1'},assertExecutionActive:()=>{}};
  try{
    for(const ownerScope of [{domain:'libra',processType:'libra_run',processId:'entry-1'},
      {domain:'arca',processType:'arca_shelf_entry',processId:'entry-2'},{domain:'arca',processType:'arca_ondeck_run',processId:'entry-1'}])
      await assert.rejects(extractor.extract({sourceHandle:source,context:{...context,ownerScope}}),{code:'US_ADULT_FRAME_AUTHORITY_INVALID'});
    await assert.rejects(extractor.extract({sourceHandle:{...source,ownerScope:{scopeType:'libra_run',scopeId:'entry-1'}},context}),{code:'US_ADULT_FRAME_AUTHORITY_INVALID'});
    assert.equal(reads,0);
  }finally{await extractor.close();}
});
