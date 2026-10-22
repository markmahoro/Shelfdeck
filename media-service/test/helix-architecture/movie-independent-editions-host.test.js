'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process'),Database=require('better-sqlite3'),sharp=require('sharp');
const {initializeCleanData}=require('../../scripts/helix-operational-safety');
const {createCleanServiceHost}=require('../../src/clean-service-host');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');

test('a fresh same-movie FLAC package creates a second collection without replacing its existing edition',{timeout:150000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'shelfdeck-movie-editions-')),dataDir=path.join(root,'data'),source=path.join(root,'source'),target=path.join(root,'shelf'),adminDistDir=path.join(root,'admin');
 for(const dir of [source,target,adminDistDir])fs.mkdirSync(dir);fs.writeFileSync(path.join(adminDistDir,'index.html'),'<div></div>');
 const secretRoot='independent-movie-editions-fixture-0123456789abcdef';
 const initialized=initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'});
 const image=await sharp({create:{width:360,height:540,channels:3,background:'#416380'}}).jpeg().toBuffer();
 const movie={id:550,title:'Collection Movie',original_title:'Collection Movie',release_date:'2024-01-01',overview:'Collection fixture plot',
  genres:[{id:18,name:'Drama'}],poster_path:'/poster.jpg',backdrop_path:'/fanart.jpg',
  credits:{cast:[{id:101,name:'Fixture Actor',character:'Lead',order:0}],crew:[{id:102,name:'Fixture Director',job:'Director',department:'Directing'}]}};
 const calls=[],errors=[];let host,db;
 function encode(filename,audioCodec){const output=path.join(source,filename),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static');
  const result=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=1920x1080:r=24:d=3',
   '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx265','-preset','ultrafast',
   '-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-color_range','tv','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-c:a',audioCodec,output],
   {encoding:'utf8',windowsHide:true,timeout:60000});assert.equal(result.status,0,result.stderr);return output;}
 try {
  host=await createCleanServiceHost({dataDir,secretRoot,adminDistDir,onExecutionRuntimeError:error=>errors.push(error.code||error.message),integrationFetch:async input=>{
   const url=new URL(input);calls.push(url.pathname);
   if(url.hostname==='image.tmdb.org')return new Response(image,{headers:{'content-type':'image/jpeg'}});
   let body;if(url.pathname.endsWith('/configuration'))body={images:{secure_base_url:'https://image.tmdb.org/t/p/'}};
   else if(url.pathname.endsWith('/search/movie'))body={page:1,results:[{id:550,title:movie.title,original_title:movie.original_title,release_date:movie.release_date}],total_pages:1,total_results:1};
   else if(url.pathname.endsWith('/movie/550'))body=movie;
   else if(url.pathname.endsWith('/movie/550/images'))body={id:550,posters:[{file_path:'/poster.jpg'}],backdrops:[{file_path:'/fanart.jpg'}]};
   else throw new Error('Unexpected TMDB fixture route '+url.pathname);
   return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  }});
  db=new Database(path.join(dataDir,'shelfdeck.db'));
  const auth=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(auth.statusCode,204);const cookie=auth.headers['set-cookie'];
  async function request(method,url,payload){const response=await host.inject({method,url,headers:{cookie},payload});assert.ok(response.statusCode>=200&&response.statusCode<300,response.body);return response.json();}
  const proof=await request('POST','/v1/admin/settings/integrations/tmdb/actions/test',{kind:'tmdb',idempotencyKey:'test-provider',endpoint:'https://api.themoviedb.org/3',credential:{kind:'api_key',value:'disposable-edition-key'},settings:{language:'zh-CN',proxyServer:''},timeoutMs:5000});
  await request('PATCH','/v1/admin/settings/integrations/tmdb',{kind:'tmdb',idempotencyKey:'save-provider',expectedConfigRevision:0,connectionProofId:proof.connectionProofId});
  await request('POST','/v1/admin/shelves',{idempotencyKey:'shelf',shelfId:'shelf',name:'Editions',targetRootLocation:target,ruleTemplateId:'system-beta-recommended',expectedTemplateRevision:1,
   placementPolicy:{folderTemplate:'{title} ({year})',primaryTemplate:'{stem}{ext}',nfoTemplate:'{stem}.nfo',subtitleTemplate:'{stem}{language}{forced}{sdh}{ext}',posterTemplate:'poster{ext}',fanartTemplate:'fanart{ext}',collisionPolicy:'reject'}});
  await request('POST','/v1/admin/settings/automatic-operation/actions/enable-full',{idempotencyKey:'settlement',expectedRevision:0,coverExclusiveRelatedInput:true});
  const fieldId='field',policy={includedDirectories:[],excludedDirectories:[],allowedExtensions:['.mkv'],minimumSizeBytes:0,excludedMaterialKeys:[]},access={fieldId,revision:1,endpointId:'source',rootLocation:source,mountScopeId:'source-mount',mountScopeRevision:1,accessSchemaRef:'helix://fixtures/edition-access/v1'};
  await request('POST','/v1/admin/material-fields',{idempotencyKey:'field',fieldId,name:'Editions',contentProfileHint:'movie',policy:{extractionPolicyId:'policy',revision:1,policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1',policy,policyDigest:canonicalDigest({extractionPolicyId:'policy',revision:1,...policy})},access:{...access,accessDigest:canonicalDigest(access)}});
  await request('PATCH','/v1/admin/routing/material-fields/'+fieldId,{idempotencyKey:'routing',fieldId,expectedPolicyId:null,expectedRevision:0,policy:{routingPolicyId:'routing',mode:'direct',targets:[{shelfId:'shelf',rank:1,matchExpression:{nodeKind:'always'}}]}});
  async function scan(key){const field=(await request('GET','/v1/admin/material-fields')).items[0];await request('POST','/v1/admin/material-fields/field/actions/observe',{idempotencyKey:key,fieldId,expectedAccessRevision:1,expectedObservationRevision:field.currentObservationRevision||0,pageBudget:8});}
  async function commitCount(count){const deadline=Date.now()+50000;while(Date.now()<deadline){
   if(db.prepare('SELECT count(*) n FROM arca_ondeck_commit_receipts').get().n===count)return;
   await new Promise(resolve=>setTimeout(resolve,100));}
   assert.fail(JSON.stringify({errors,calls,runs:db.prepare('SELECT state FROM libra_runs').all(),attempts:db.prepare("SELECT failure_code FROM fx_work_attempts WHERE state='failed'").all(),formation:await request('GET','/v1/admin/formation?limit=25')}));}
  encode('Collection Movie (2024).mkv','aac');await scan('first');await commitCount(1);
  const first=db.prepare("SELECT m.* FROM arca_inventory_materials m JOIN arca_shelf_entries e USING(shelf_entry_id) WHERE m.inventory_revision=e.current_inventory_revision AND m.role='primary_payload'").get();
  const firstBytes=fs.readFileSync(first.location),firstReceipt=db.prepare('SELECT * FROM arca_ondeck_commit_receipts').get();
  encode('Collection Movie (2024) - 1080p FLAC.mkv','flac');
  fs.writeFileSync(path.join(source,'Collection Movie (2024) - 1080p FLAC.nfo'),'<movie><title>Collection Movie</title><year>2024</year><uniqueid type="tmdb" default="true">550</uniqueid></movie>');
  await scan('second');await commitCount(2);
  const collection=await request('GET','/v1/admin/collection?limit=24');assert.equal(collection.items.length,2);
  assert.equal(db.prepare('SELECT count(DISTINCT subject_id) n FROM libra_runs').get().n,2);
  assert.deepEqual(db.prepare('SELECT * FROM arca_ondeck_commit_receipts WHERE receipt_id=?').get(firstReceipt.receipt_id),firstReceipt);
  assert.deepEqual(fs.readFileSync(first.location),firstBytes);
  const primaries=db.prepare("SELECT m.location FROM arca_inventory_materials m JOIN arca_shelf_entries e USING(shelf_entry_id) WHERE m.inventory_revision=e.current_inventory_revision AND m.role='primary_payload'").all();
  assert.equal(new Set(primaries.map(row=>path.dirname(row.location))).size,2);assert.ok(primaries.some(row=>path.dirname(row.location).includes('1080p FLAC')));
  assert.ok(calls.some(route=>route.endsWith('/search/movie')));assert.ok(calls.some(route=>route.endsWith('/poster.jpg')));
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
 }finally{await host?.close();db?.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
