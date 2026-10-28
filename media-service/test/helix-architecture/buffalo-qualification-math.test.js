'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const math=require('../../scripts/qualification/buffalo/buffalo-math');
test('buffalo qualification keeps the pinned RGB-array channel reversal and zero padding',()=>{
  const result=math.detectorInput({width:1,height:2,data:Buffer.from([10,20,30,10,20,30])},640);
  assert.equal(result.tensor[0],(30-127.5)/128);
  assert.equal(result.tensor[640*640],(20-127.5)/128);
  assert.equal(result.tensor[640*640*2],(10-127.5)/128);
  assert.equal(result.tensor[639],-127.5/128);
  assert.equal(result.scale,320);
});
test('buffalo qualification rejects malformed geometry and zero or foreign-dimensional vectors',()=>{
  assert.throws(()=>math.similarityTransform(Array.from({length:5},()=>[1,1])),{code:'BUFFALO_INPUT_INVALID'});
  assert.throws(()=>math.normalize(new Float32Array(128)),{code:'BUFFALO_INPUT_INVALID'});
  assert.throws(()=>math.normalize(new Float32Array(512)),{code:'BUFFALO_INPUT_INVALID'});
  assert.throws(()=>math.detectorInput({width:1,height:1,data:Buffer.alloc(2)}),{code:'BUFFALO_INPUT_INVALID'});
  assert.throws(()=>math.decodeDetections({},['unexpected'],1),{code:'BUFFALO_INPUT_INVALID'});
});
test('buffalo alignment preserves identity landmarks and constant interior colors',()=>{
  const transform=math.similarityTransform(math.TARGET);
  transform.forEach((value,index)=>assert.ok(Math.abs(value-[1,0,0,0,1,0][index])<1e-10));
  const image={width:112,height:112,data:Buffer.alloc(112*112*3,71)};
  assert.deepEqual(math.alignedPixels(image,math.TARGET),image.data);
});
test('buffalo rotation uses an expanded nearest-neighbor canvas and original pixels',()=>{
  const image={width:2,height:2,data:Buffer.from([1,2,3,4,5,6,7,8,9,10,11,12])};
  assert.equal(math.rotateNearest(image,0),image);
  const rotated=math.rotateNearest(image,90);
  assert.equal(rotated.width,2);assert.equal(rotated.height,2);
  assert.deepEqual([...rotated.data],[4,5,6,10,11,12,1,2,3,7,8,9]);
});
test('buffalo reference vectors normalize without accepting SFace payloads',()=>{
  const vector=new Float32Array(512);vector[0]=3;vector[1]=4;
  const normalized=math.normalize(vector);
  assert.ok(Math.abs(normalized[0]-0.6)<1e-6);assert.ok(Math.abs(normalized[1]-0.8)<1e-6);
});
