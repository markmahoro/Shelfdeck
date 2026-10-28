'use strict';

// Qualification implementation of the pinned InsightFace/Sense numerical contract.
// No production imports, domain writes, external service, or legacy implementation.
const TARGET = [[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]]
  .map(point => point.map(Math.fround));
function invalid(message) { throw Object.assign(new Error(message), {code:'BUFFALO_INPUT_INVALID'}); }
function validateImage(image) {
  if (!Number.isSafeInteger(image?.width) || !Number.isSafeInteger(image?.height) || image.width < 1 || image.height < 1 ||
      image.width * image.height > 16777216 || image.data?.length !== image.width * image.height * 3) invalid('A bounded RGB image is required.');
}
function roundEven(value) {
  const base = Math.floor(value), fraction = value - base;
  return fraction === 0.5 ? base + (base % 2 !== 0 ? 1 : 0) : Math.round(value);
}
function resizeLinear(image, width, height) {
  validateImage(image);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 16777216) invalid('Resize dimensions are invalid.');
  const out = Buffer.alloc(width * height * 3);
  const axis = (length, sourceLength) => Array.from({length}, (_, index) => {
    const point = Math.fround((index + 0.5) * sourceLength / length - 0.5);
    let left = Math.floor(point), fraction = Math.fround(point - left);
    if (left < 0) { left = 0; fraction = 0; }
    if (left >= sourceLength - 1) { left = sourceLength - 1; fraction = 0; }
    return [left, Math.min(sourceLength - 1, left + 1), roundEven(Math.fround(1 - fraction) * 2048), roundEven(fraction * 2048)];
  });
  const xs = axis(width, image.width), ys = axis(height, image.height);
  for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const [x0,x1,a,b]=xs[x], [y0,y1,c,d]=ys[y];
    for (let channel=0; channel<3; channel++) {
      const top=image.data[(y0*image.width+x0)*3+channel]*a+image.data[(y0*image.width+x1)*3+channel]*b;
      const bottom=image.data[(y1*image.width+x0)*3+channel]*a+image.data[(y1*image.width+x1)*3+channel]*b;
      // OpenCV's uint8 linear path rounds two fixed-point vertical products
      // separately after reducing the horizontal accumulator precision.
      const upper=Math.floor(c*Math.floor(top/16)/65536);
      const lower=Math.floor(d*Math.floor(bottom/16)/65536);
      out[(y*width+x)*3+channel]=Math.max(0,Math.min(255,Math.floor((upper+lower+2)/4)));
    }
  }
  return {data:out,width,height};
}
function detectorInput(image, size=640) {
  validateImage(image);
  const ratio=image.height/image.width;
  const width=ratio>1 ? Math.max(1,Math.trunc(size/ratio)) : size;
  const height=ratio>1 ? size : Math.max(1,Math.trunc(size*ratio));
  const resized=resizeLinear(image,width,height), plane=size*size, tensor=new Float32Array(plane*3);
  tensor.fill(-127.5/128);
  // Sense passes RGB arrays to FaceAnalysis; blobFromImage(swapRB=True) reverses them.
  // Preserve that actual query/database method rather than silently correcting it.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let channel=0;channel<3;channel++)
    tensor[channel*plane+y*size+x]=(resized.data[(y*width+x)*3+2-channel]-127.5)/128;
  return {tensor,scale:height/image.height};
}
function decodeDetections(outputs, names, scale, size=640, threshold=0.5) {
  if(names.length!==9 || !Number.isFinite(scale) || scale<=0)invalid('Unexpected SCRFD output contract.');
  const found=[];
  for(const [level,stride]of [8,16,32].entries()){
    const scores=outputs[names[level]]?.data, boxes=outputs[names[level+3]]?.data, points=outputs[names[level+6]]?.data;
    const grid=size/stride, count=grid*grid*2;
    if(scores?.length!==count || boxes?.length!==count*4 || points?.length!==count*10)invalid('Unexpected SCRFD output dimensions.');
    for(let i=0;i<count;i++){
      if(!Number.isFinite(scores[i])||scores[i]<threshold)continue;
      const cell=Math.floor(i/2), cx=(cell%grid)*stride, cy=Math.floor(cell/grid)*stride;
      const rectangle=[cx-Math.fround(boxes[i*4]*stride),cy-Math.fround(boxes[i*4+1]*stride),
        cx+Math.fround(boxes[i*4+2]*stride),cy+Math.fround(boxes[i*4+3]*stride)]
        .map(value=>Math.fround(Math.fround(value)/scale));
      const landmarks=Array.from({length:5},(_,point)=>[
        Math.fround(Math.fround(cx+Math.fround(points[i*10+point*2]*stride))/scale),
        Math.fround(Math.fround(cy+Math.fround(points[i*10+point*2+1]*stride))/scale)]);
      if([...rectangle,...landmarks.flat()].some(value=>!Number.isFinite(value)))invalid('SCRFD produced non-finite geometry.');
      found.push({rectangle,landmarks,confidence:scores[i],ordinal:found.length});
    }
  }
  found.sort((a,b)=>b.confidence-a.confidence || a.ordinal-b.ordinal);
  const selected=[];
  const iou=(a,b)=>{
    const intersection=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])+1)*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])+1);
    return intersection/((a[2]-a[0]+1)*(a[3]-a[1]+1)+(b[2]-b[0]+1)*(b[3]-b[1]+1)-intersection);
  };
  for(const face of found)if(!selected.some(other=>iou(face.rectangle,other.rectangle)>0.4))selected.push(face);
  if(selected.length>32)invalid('Face count exceeds the qualification limit.');
  return selected;
}
function similarityTransform(landmarks) {
  if(landmarks?.length!==5 || landmarks.flat().length!==10 || landmarks.flat().some(value=>!Number.isFinite(value)))invalid('Five finite landmarks are required.');
  const mean=points=>[0,1].map(axis=>points.reduce((sum,p)=>sum+p[axis],0)/5);
  const source=mean(landmarks), target=mean(TARGET);let a=0,b=0,denominator=0;
  for(let i=0;i<5;i++){
    const x=landmarks[i][0]-source[0],y=landmarks[i][1]-source[1],u=TARGET[i][0]-target[0],v=TARGET[i][1]-target[1];
    a+=x*u+y*v;b+=x*v-y*u;denominator+=x*x+y*y;
  }
  if(denominator<1e-10)invalid('Landmarks are degenerate.');
  a/=denominator;b/=denominator;
  if(a*a+b*b<1e-12)invalid('Face transform is singular.');
  return [a,-b,target[0]-a*source[0]+b*source[1],b,a,target[1]-b*source[0]-a*source[1]];
}
function alignedPixels(image, landmarks) {
  validateImage(image);
  const [a,b,tx,c,d,ty]=similarityTransform(landmarks), determinant=a*d-b*c;
  const inv=[d/determinant,-b/determinant,(b*ty-d*tx)/determinant,-c/determinant,a/determinant,(c*tx-a*ty)/determinant];
  const out=Buffer.alloc(112*112*3);
  const pixel=(x,y,channel)=>x<0||y<0||x>=image.width||y>=image.height?0:image.data[(y*image.width+x)*3+channel];
  for(let y=0;y<112;y++)for(let x=0;x<112;x++){
    // OpenCV INTER_LINEAR affine maps use 10-bit affine and 5-bit interpolation tables.
    const qx=Math.floor((roundEven((inv[1]*y+inv[2])*1024)+16+roundEven(inv[0]*x*1024))/32);
    const qy=Math.floor((roundEven((inv[4]*y+inv[5])*1024)+16+roundEven(inv[3]*x*1024))/32);
    const sx=Math.floor(qx/32),sy=Math.floor(qy/32),fx=qx-sx*32,fy=qy-sy*32;
    for(let channel=0;channel<3;channel++)out[(y*112+x)*3+channel]=Math.floor((
      pixel(sx,sy,channel)*(32-fx)*(32-fy)+pixel(sx+1,sy,channel)*fx*(32-fy)+
      pixel(sx,sy+1,channel)*(32-fx)*fy+pixel(sx+1,sy+1,channel)*fx*fy+512)/1024);
  }
  return out;
}
function recognitionInput(image, landmarks) {
  const pixels=alignedPixels(image,landmarks), plane=112*112, tensor=new Float32Array(3*plane);
  for(let i=0;i<plane;i++)for(let channel=0;channel<3;channel++)tensor[channel*plane+i]=(pixels[i*3+2-channel]-127.5)/127.5;
  return tensor;
}
function normalize(values) {
  if(values?.length!==512 || Array.from(values).some(value=>!Number.isFinite(value)))invalid('A finite 512-dimensional vector is required.');
  const norm=Math.sqrt(values.reduce((sum,value)=>sum+value*value,0));
  if(norm<1e-12)invalid('The feature vector is zero.');
  return Float32Array.from(values,value=>value/norm);
}
function rollDegrees(landmarks) {
  if(!landmarks || landmarks.length<5)return null;
  const center=(a,b)=>a.map((value,i)=>Math.fround(value+b[i])/2);
  const eyes=center(landmarks[0],landmarks[1]),mouth=center(landmarks[3],landmarks[4]);
  return Math.atan2(mouth[0]-eyes[0],mouth[1]-eyes[1])*180/Math.PI;
}
function rotateNearest(image, degrees) {
  validateImage(image);
  const angle=((degrees%360)+360)%360;
  if(angle===0)return image;
  const radians=-angle*Math.PI/180;
  const a=Number(Math.cos(radians).toFixed(15)),b=Number(Math.sin(radians).toFixed(15)),c=-b,d=a;
  let tx=image.width/2-a*image.width/2-b*image.height/2;
  let ty=image.height/2-c*image.width/2-d*image.height/2;
  const corners=[[0,0],[image.width,0],[image.width,image.height],[0,image.height]]
    .map(([x,y])=>[a*x+b*y+tx,c*x+d*y+ty]);
  const width=Math.ceil(Math.max(...corners.map(p=>p[0])))-Math.floor(Math.min(...corners.map(p=>p[0])));
  const height=Math.ceil(Math.max(...corners.map(p=>p[1])))-Math.floor(Math.min(...corners.map(p=>p[1])));
  if(width*height>16777216)invalid('Rotated image exceeds the pixel limit.');
  tx+=a*(-(width-image.width)/2)+b*(-(height-image.height)/2);
  ty+=c*(-(width-image.width)/2)+d*(-(height-image.height)/2);
  const data=Buffer.alloc(width*height*3);
  const fixed=[[0,0],[width,height],[0,height],[width,0]].every(([x,y])=>
    Math.abs(a*x+b*y+tx)<32768&&Math.abs(c*x+d*y+ty)<32768);
  const coefficient=value=>Math.floor(value*65536+0.5);
  const qa=coefficient(a),qb=coefficient(b),qc=coefficient(c),qd=coefficient(d);
  const qtx=coefficient(tx+a*0.5+b*0.5),qty=coefficient(ty+c*0.5+d*0.5);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    // PIL's default nearest-neighbor affine uses a 16.16 map when it fits.
    const sx=fixed?Math.floor((qtx+qa*x+qb*y)/65536):Math.floor(a*(x+0.5)+b*(y+0.5)+tx);
    const sy=fixed?Math.floor((qty+qc*x+qd*y)/65536):Math.floor(c*(x+0.5)+d*(y+0.5)+ty);
    if(sx>=0&&sy>=0&&sx<image.width&&sy<image.height)
      for(let channel=0;channel<3;channel++)data[(y*width+x)*3+channel]=image.data[(sy*image.width+sx)*3+channel];
  }
  return {data,width,height};
}
module.exports=Object.freeze({TARGET,validateImage,resizeLinear,detectorInput,decodeDetections,similarityTransform,
  alignedPixels,recognitionInput,normalize,rollDegrees,rotateNearest});
