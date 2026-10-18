'use strict';

const {createHash}=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('./helix/contracts/canonical-json');
const {restoreFrameAnalysis}=require('./helix/contracts/us-adult-frame-geometry');
const {normalizeVector}=require('./helix/integrations/local-face-math');

function fail(message){throw Object.assign(new Error(message),{code:'US_ADULT_RECOMMENDATION_IMAGE_INVALID'});}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')===[...keys].sort().join(',');}
const digestBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const ordered=(left,right)=>Buffer.compare(Buffer.from(left),Buffer.from(right));

// Root owns byte access. Consumers receive evidence and an image, never a path,
// Workspace mutation authority or a repository belonging to Libra.
function createCleanUsAdultRecommendationImagePort(options){
  if(typeof options?.sourceQuery?.readSource!=='function'||typeof options.workspaceProductPort?.readArtifactBytes!=='function')
    throw new TypeError('Recommendation images require exact Libra Source and controlled Artifact read ports.');
  const sharp=options.sharp||require('sharp');
  function artifact(handle,kind,runId,maxBytes){
    if(handle?.ownerDomain!=='libra'||handle.ownerScope?.scopeType!=='libra_run'||handle.ownerScope?.scopeId!==runId||
      handle.artifactKind!==kind||!Number.isSafeInteger(handle.sizeBytes)||handle.sizeBytes<1||handle.sizeBytes>maxBytes)
      fail('Recommendation Artifact is outside its exact Run, kind or byte bound.');
    const bytes=options.workspaceProductPort.readArtifactBytes(handle)?.bytes;
    if(!Buffer.isBuffer(bytes)||bytes.length!==handle.sizeBytes||digestBytes(bytes)!==handle.digestHex)
      fail('Recommendation Artifact bytes differ from their immutable Handle.');
    let payload;try{payload=JSON.parse(bytes.toString('utf8'));}catch{fail('Recommendation Artifact is not JSON.');}
    if(canonicalJson(payload)!==bytes.toString('utf8'))fail('Recommendation Artifact is not canonical JSON.');
    return payload;
  }
  function read(source){
    options.sourceQuery.readSource(source);
    const analysis=restoreFrameAnalysis(artifact(source.faceEmbeddingSetHandle?.artifactHandle,'face_embedding_set',source.libraRunId,8*1024*1024)),
      frames=artifact(source.frameArtifactSet?.frameSetArtifactHandle,'western_frame_set',source.libraRunId,300*1024*1024),
      grouped=artifact(source.faceClusterSetHandle?.artifactHandle,'face_cluster_set',source.libraRunId,8*1024*1024);
    if(!exact(frames,['schema','members','memberPayloads','frameMemberSetDigest'])||frames.schema!=='libra.western-frame-composite@1'||
      !Array.isArray(frames.members)||!Array.isArray(frames.memberPayloads)||frames.members.length!==analysis.frameMembers.length||
      frames.memberPayloads.length!==frames.members.length||source.frameArtifactSet.frameCount!==frames.members.length||
      frames.frameMemberSetDigest!==source.frameArtifactSet.frameMemberSetDigest||
      frames.frameMemberSetDigest!==canonicalDigest({schema:'libra.western-frame-member-set@1',items:frames.members})||
      source.faceEmbeddingSetHandle.faceModelRefDigest!==analysis.modelRef.digest||
      source.faceEmbeddingSetHandle.detectedFaceCount!==analysis.detectedFaceCount||analysis.detectedFaceCount===0||
      !exact(grouped,['schema','clusters'])||grouped.schema!=='shared.face-cluster-set@1'||!Array.isArray(grouped.clusters)||
      grouped.clusters.length!==source.faceClusterSetHandle.clusterCount||grouped.clusters.length<1||grouped.clusters.length>1280)
      fail('Recommendation frames, geometry and cluster index disagree.');
    const images=frames.members.map((member,ordinal)=>{
      const image=frames.memberPayloads[ordinal],geometry=analysis.frameMembers[ordinal];
      if(!exact(member,['ordinal','timestampMs','contentDigest','locator'])||!exact(image,['ordinal','contentDigest','encoding','bytesBase64'])||
        member.ordinal!==ordinal||image.ordinal!==ordinal||member.locator!=='composite-member:'+ordinal||image.encoding!=='base64'||
        member.timestampMs!==geometry.timestampMs||member.contentDigest!==geometry.imageDigest||image.contentDigest!==geometry.imageDigest)
        fail('Recommendation frame is outside its frozen geometry.');
      const bytes=Buffer.from(image.bytesBase64,'base64');
      if(!bytes.length||bytes.length>10*1024*1024||bytes.toString('base64')!==image.bytesBase64||digestBytes(bytes)!==geometry.imageDigest)
        fail('Recommendation screenshot bytes changed.');
      return bytes;
    });
    const seen=new Set(),clusterIds=new Set(),groups=grouped.clusters.map(cluster=>{
      if(!exact(cluster,['clusterId','memberOrdinals','vectors'])||typeof cluster.clusterId!=='string'||!cluster.clusterId||cluster.clusterId.length>256||
        clusterIds.has(cluster.clusterId)||!Array.isArray(cluster.memberOrdinals)||cluster.memberOrdinals.length<1||
        cluster.memberOrdinals.length>1280||!Array.isArray(cluster.vectors)||cluster.vectors.length!==cluster.memberOrdinals.length)
        fail('Recommendation clusters must be a bounded partition of source faces.');
      clusterIds.add(cluster.clusterId);
      const faces=cluster.memberOrdinals.map((ordinal,index)=>{
        const face=analysis.faces[ordinal];
        if(!Number.isSafeInteger(ordinal)||!face||seen.has(ordinal)||canonicalJson(normalizeVector(face.vector))!==canonicalJson(cluster.vectors[index]))
          fail('Recommendation cluster lost or substituted a source face.');
        seen.add(ordinal);return face;
      }).sort((a,b)=>b.qualityScore-a.qualityScore||a.ordinal-b.ordinal);
      return {clusterId:cluster.clusterId,count:faces.length,face:faces[0]};
    }).sort((a,b)=>b.count-a.count||b.face.qualityScore-a.face.qualityScore||ordered(a.clusterId,b.clusterId));
    if(seen.size!==analysis.detectedFaceCount)fail('Recommendation cluster partition omitted source faces.');
    const selected=groups[0],face=selected.face,frame=analysis.frameMembers[face.frameOrdinal],
      basis={schema:'people.us-adult-recommendation-image-evidence@1',sourceDigest:source.sourceDigest,modelRefDigest:analysis.modelRef.digest,
        analysisDigest:analysis.analysisDigest,clusterId:selected.clusterId,clusterFaceCount:selected.count,faceDigest:face.faceDigest,
        frameOrdinal:face.frameOrdinal,imageDigest:face.imageDigest,width:frame.width,height:frame.height,box:face.box,
        qualityScore:face.qualityScore,vector:face.vector},evidence=Object.freeze({...basis,evidenceDigest:canonicalDigest(basis)});
    options.sourceQuery.readSource(source);
    return {evidence,bytes:images[face.frameOrdinal]};
  }
  return Object.freeze({
    readCandidate(source){return read(source).evidence;},
    async readImage({source,expectedEvidenceDigest}){
      const {evidence,bytes}=read(source);
      if(expectedEvidenceDigest!==evidence.evidenceDigest)fail('Recommendation image selection changed.');
      const image=sharp(bytes,{limitInputPixels:16384*16384}),metadata=await image.metadata();
      if(metadata.width!==evidence.width||metadata.height!==evidence.height)fail('Screenshot dimensions differ from frozen face geometry.');
      const box=evidence.box,left=Math.max(0,Math.min(metadata.width-1,Math.floor(box.x-box.width*0.35))),
        top=Math.max(0,Math.min(metadata.height-1,Math.floor(box.y-box.height*0.45))),
        right=Math.max(left+1,Math.min(metadata.width,Math.ceil(box.x+box.width*1.35))),
        bottom=Math.max(top+1,Math.min(metadata.height,Math.ceil(box.y+box.height*1.35))),
        cropped=await image.extract({left,top,width:right-left,height:bottom-top}).resize({width:640,height:640,fit:'inside',withoutEnlargement:true})
          .jpeg({quality:90}).toBuffer();
      options.sourceQuery.readSource(source);
      if(!cropped.length||cropped.length>2*1024*1024)fail('Recommendation image exceeds its byte bound.');
      return Object.freeze({bytes:cropped,mediaType:'image/jpeg',imageDigest:digestBytes(cropped),evidenceDigest:evidence.evidenceDigest});
    },
  });
}
module.exports=Object.freeze({createCleanUsAdultRecommendationImagePort});
