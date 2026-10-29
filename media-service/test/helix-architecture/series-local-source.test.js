'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildReferenceSet}=require('../../src/helix/contracts/series-local-source');
const {qualifyReferences,readQualified,readReference}=require('../../src/helix/integrations/series-local-source-io');
const {readBoundedFileSnapshotSync}=require('../../src/helix/integrations/bounded-material-fingerprint');
const {physicalIdentity,createSeriesPresentationIo}=require('../../src/helix/integrations/series-presentation-io');
test('local shared source is exact, read-only and bound by a real whole-show NFO',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-local-')),source=path.join(root,'Show'),workspace=path.join(root,'workspace');fs.mkdirSync(source);fs.mkdirSync(workspace);
  try{
    const bytes={nfo:Buffer.from('<tvshow><title>Show</title><uniqueid type="tmdb">1399</uniqueid></tvshow>'),poster:await sharp({create:{width:60,height:90,channels:3,background:'#123456'}}).png().toBuffer()};
    const references=Object.entries(bytes).map(([kind,value])=>{const location=path.join(source,kind==='nfo'?'tvshow.nfo':'poster.png');fs.writeFileSync(location,value);
      const snapshot=readBoundedFileSnapshotSync(location,1024*1024,{requireStableSnapshot:true});return {artifactKind:kind,endpointId:'field-endpoint',location:location.split(path.sep).join('/'),physicalIdentity:physicalIdentity(snapshot,'field-mount'),entryDigest:canonicalDigest({kind})};});
    const set=buildReferenceSet({fieldId:'field',accessRevision:1,fieldRoot:root,sourceRoot:source,observationDigest:canonicalDigest({observation:1}),references}),qualified=(readReference(set,references[0]),qualifyReferences(set,'1399'));
    assert.ok(qualified);assert.equal(qualifyReferences(set,'999'),null);assert.deepEqual(readQualified(qualified,'nfo').bytes,bytes.nfo);
    const io=createSeriesPresentationIo({rootSnapshot:{resolvedRoot:workspace,rootHandleRef:'root',endpointId:'workspace',mountScopeId:'workspace-mount'}}),image=await io.readLocalSource({basis:{localSource:qualified}},'poster');
    assert.equal(image.normalized,true);assert.equal((await sharp(image.bytes).metadata()).format,'jpeg');assert.deepEqual(image.sourceBytes,bytes.poster);
    assert.equal(await io.readLocalSource({basis:{localSource:qualified}},'fanart'),null);
    fs.writeFileSync(references[0].location,'<tvshow><title>Other</title><uniqueid type="tmdb">999</uniqueid></tvshow>');
    assert.throws(()=>readQualified(qualified,'poster'),{code:'SERIES_LOCAL_SOURCE_CHANGED'});assert.equal(await io.readLocalSource({basis:{localSource:qualified}},'poster'),null);
    const {sourceSetDigest,...body}=set;assert.throws(()=>qualifyReferences(buildReferenceSet({...body,fieldRoot:path.join(root,'different')}),'1399'),{code:'SERIES_LOCAL_SOURCE_SCOPE_INVALID'});
    assert.deepEqual(fs.readFileSync(references[1].location),bytes.poster);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
