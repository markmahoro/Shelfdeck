'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const policy=require('../contracts/buffalo-model-reference').pack;
const math=require('./buffalo-math');
function fail(code,message){throw Object.assign(new Error(message),{code});}
function createBuffaloImageEngine({modelRoot,ort=require('onnxruntime-node'),sharp=require('sharp')}={}){
  let detector=null,recognizer=null,loading=null,closed=false;
  async function load(){
    if(closed)fail('BUFFALO_CLOSED','The buffalo image engine is closed.');
    if(ort.env?.versions?.node!==policy.runtimeVersion)fail('BUFFALO_RUNTIME_INVALID','The ONNX runtime differs from the qualified model contract.');
    if(!loading)loading=(async()=>{
      const paths={};
      for(const item of policy.models){
        const file=path.join(modelRoot,item.file),stat=fs.lstatSync(file);
        if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==item.bytes||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==item.sha256)
          fail('BUFFALO_MODEL_INVALID','A pinned model failed verification.');
        paths[item.role]=file;
      }
      const settings={executionProviders:['cpu'],intraOpNumThreads:2,interOpNumThreads:1,logSeverityLevel:3};
      detector=await ort.InferenceSession.create(paths.detector,settings);
      try{recognizer=await ort.InferenceSession.create(paths.recognizer,settings);}
      catch(error){await detector.release();detector=null;throw error;}
    })();
    return loading;
  }
  async function decode(bytes){
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>policy.maximumImageBytes)fail('BUFFALO_IMAGE_INVALID','A bounded image is required.');
    try{
      const source=sharp(bytes,{limitInputPixels:policy.maximumImagePixels});
      const metadata=await source.metadata();
      if(!['jpeg','png','webp'].includes(metadata.format)||(metadata.pages||1)!==1)fail('BUFFALO_IMAGE_INVALID','A single image is required.');
      // PIL load_image does not auto-rotate EXIF and discards alpha without compositing.
      const {data,info}=await source.toColourspace('srgb').removeAlpha().raw().toBuffer({resolveWithObject:true});
      const image={data,width:info.width,height:info.height};math.validateImage(image);return image;
    }catch(error){if(error.code==='BUFFALO_IMAGE_INVALID')throw error;fail('BUFFALO_IMAGE_INVALID','The image cannot be decoded.');}
  }
  async function detectRaw(image,assertActive){
    assertActive();
    const input=math.detectorInput(image,policy.detectorSize);
    const outputs=await detector.run({[detector.inputNames[0]]:new ort.Tensor('float32',input.tensor,[1,3,640,640])});
    assertActive();
    const faces=math.decodeDetections(outputs,detector.outputNames,input.scale,640,0.5).filter(face=>{
      const [left,top,right,bottom]=face.rectangle.map(Math.trunc);
      return Math.min(image.width,right)-Math.max(0,left)>=10&&Math.min(image.height,bottom)-Math.max(0,top)>=10;
    });
    for(const face of faces){
      assertActive();
      const aligned=math.recognitionInput(image,face.landmarks);
      const result=await recognizer.run({[recognizer.inputNames[0]]:new ort.Tensor('float32',aligned,[1,3,112,112])});
      face.vector=Array.from(math.normalize(result[recognizer.outputNames[0]].data));
      face.rotationApplied=0;
    }
    return faces;
  }
  async function analyzeRaw(image,{assertActive=()=>{}}={}){
    math.validateImage(image);assertActive();await load();assertActive();
    const original=await detectRaw(image,assertActive);
    const area=face=>{const [x0,y0,x1,y1]=face.rectangle.map(Math.trunc);return (x1-x0)*(y1-y0);};
    const largest=faces=>faces.reduce((a,b)=>area(a)>=area(b)?a:b);
    if(!original.length)return [];
    let roll=math.rollDegrees(largest(original).landmarks);
    if(roll===null||Math.abs(roll)<25)return original;
    let rotation=0;
    for(let attempt=0;attempt<3;attempt++){
      rotation-=roll;assertActive();
      const rotated=await detectRaw(math.rotateNearest(image,rotation),assertActive);
      if(!rotated.length)break;
      roll=math.rollDegrees(largest(rotated).landmarks);
      if(roll===null)break;
      if(Math.abs(roll)<15){for(const face of rotated)face.rotationApplied=rotation;return rotated;}
    }
    return original;
  }
  async function analyzeEvidence(bytes,options){
    const source=await decode(bytes),faces=await analyzeRaw(source,options),rotationDegrees=faces[0]?.rotationApplied||0;
    if(faces.some(face=>face.rotationApplied!==rotationDegrees))fail('BUFFALO_GEOMETRY_INVALID','Face coordinates do not share one correction canvas.');
    const canvas=rotationDegrees?math.rotateNearest(source,rotationDegrees):source;
    return {faces,coordinateSpace:{kind:'corrected_canvas',sourceWidth:source.width,sourceHeight:source.height,
      width:canvas.width,height:canvas.height,rotationDegrees,pixelDigest:crypto.createHash('sha256').update(canvas.data).digest('hex')}};
  }
  return Object.freeze({load,decode,analyzeRaw,analyzeEvidence,async analyze(bytes,options){return analyzeRaw(await decode(bytes),options);},
    async close(){closed=true;if(loading)await loading.catch(()=>{});if(recognizer)await recognizer.release();if(detector)await detector.release();recognizer=null;detector=null;}});
}
module.exports=Object.freeze({createBuffaloImageEngine});
