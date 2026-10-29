'use strict';
const fs=require('node:fs'),path=require('node:path');
const math=require('./buffalo-math');
const reference=JSON.parse(fs.readFileSync('/reference/reference.json','utf8'));
const components=JSON.parse(fs.readFileSync('/components/components.json','utf8'));
function difference(actual,expected){
  if(actual.length!==expected.length)return {actualLength:actual.length,expectedLength:expected.length};
  let count=0,total=0,maximum=0;
  for(let i=0;i<actual.length;i++){const delta=Math.abs(actual[i]-expected[i]);if(delta)count++;total+=delta;maximum=Math.max(maximum,delta);}
  return {differentBytes:count,maximum,mean:total/actual.length,length:actual.length};
}
const results=[];
for(const item of components){
  const prior=reference.cases.find(value=>value.name===item.name);
  const image={data:fs.readFileSync(path.join('/reference',prior.rawFile)),width:prior.width,height:prior.height};
  const result={name:item.name,resize:difference(math.resizeLinear(image,item.width,item.height).data,fs.readFileSync('/components/'+item.name+'-resized.rgb'))};
  if(item.transform){
    result.alignment=difference(math.alignedPixels(image,prior.faces[0].landmarks),fs.readFileSync('/components/'+item.name+'-aligned.rgb'));
    result.transform=math.similarityTransform(prior.faces[0].landmarks).map((value,index)=>value-item.transform.flat()[index]);
  }else{
    const rotated=math.rotateNearest(image,item.rotation);
    result.rotation={width:rotated.width,height:rotated.height,...difference(rotated.data,fs.readFileSync('/components/'+item.name+'-rotated.rgb'))};
  }
  results.push(result);
}
fs.writeFileSync('/output/components-node.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
