'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createImageSession}=require('./image-session');
const policy=require('./parity-policy.json');
async function main(){
  const report={checks:[]};
  const session=createImageSession({modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:'/catalogue'});
  try{
    await session.load();
    const result=await session.query(Array(512).fill(1/Math.sqrt(512)));
    assert.equal(result.matches.length,0);assert.equal(result.raw.length,100);
    report.checks.push('nonzero_query_without_threshold_match');
    await assert.rejects(session.query(Array(128).fill(0.1)),{code:'BUFFALO_INPUT_INVALID'});
    report.checks.push('foreign_model_dimension_rejected');
    await assert.rejects(session.query(Array(512).fill(NaN)),{code:'BUFFALO_INPUT_INVALID'});
    report.checks.push('nonfinite_vector_rejected');
    await assert.rejects(session.query(Array(512).fill(0)),{code:'BUFFALO_CATALOGUE_INVALID'});
    report.checks.push('zero_vector_rejected');
    await assert.rejects(session.load({timeoutMs:0}),{code:'BUFFALO_INPUT_INVALID'});
    report.checks.push('invalid_deadline_rejected');
    await assert.rejects(session.analyze(Buffer.alloc(policy.maximumImageBytes+1)),{code:'BUFFALO_IMAGE_INVALID'});
    report.checks.push('oversized_encoded_image_rejected');
  }finally{await session.stop();}
  const temporary=fs.mkdtempSync('/tmp/buffalo-negative-');
  assert.ok(path.resolve(temporary).startsWith('/tmp/buffalo-negative-'));
  fs.writeFileSync(path.join(temporary,'det_10g.onnx'),Buffer.alloc(policy.models[0].bytes));
  const wrongChecksum=createImageSession({modelRoot:temporary,catalogueRoot:'/catalogue'});
  try{await assert.rejects(wrongChecksum.load(),{code:'BUFFALO_MODEL_INVALID'});report.checks.push('same_size_wrong_model_sha_rejected');}
  finally{await wrongChecksum.stop();}
  fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify({version:'unqualified-generation',models:{embedding_dim:512}}));
  const wrongGeneration=createImageSession({modelRoot:'/catalogue/models/models/buffalo_l',catalogueRoot:temporary});
  try{await assert.rejects(wrongGeneration.load(),{code:'BUFFALO_CATALOGUE_INVALID'});report.checks.push('wrong_catalogue_generation_rejected');}
  finally{await wrongGeneration.stop();}
  fs.writeFileSync('/output/node-negatives.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
