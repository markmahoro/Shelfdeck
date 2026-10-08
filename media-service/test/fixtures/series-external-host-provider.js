'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function fixture(root,{rejectSearch=false,real=false}={}){
  const landing=path.join(root,'landing'),directory=path.join(landing,'Demo Show','Season 01');
  fs.mkdirSync(directory,{recursive:true});
  const files=[1,2].map(n=>{const name='Demo.Show.S01E0'+n+'.2160p.HEVC.mkv',location=path.join(directory,name);fs.writeFileSync(location,'external-episode-'+n);return {name,location};});
  if(real) {
    const {spawnSync}=require('node:child_process'),ffmpeg=process.env.FFMPEG_PATH||require('ffmpeg-static');
    const result=spawnSync(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=3840x2160:r=24:d=3',
      '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=3','-c:v','libx265','-preset','ultrafast',
      '-x265-params','pools=1:frame-threads=1','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k',files[0].location],
      {encoding:'utf8',windowsHide:true,timeout:120000});
    assert.equal(result.status,0,result.stderr);
    fs.copyFileSync(files[0].location,files[1].location);
  }
  const fingerprints=files.map(item=>require('node:crypto').createHash('sha256').update(fs.readFileSync(item.location)).digest('hex'));
  let requested=false;const calls=[];
  function response(body){return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});}
  async function fetch(input,init={}){
    const url=new URL(input);assert.equal(url.host,'series-moviepilot.test');
    calls.push({path:url.pathname,method:init.method||'GET'});
    if(url.pathname==='/api/v1/search/title')return response({success:true,data:rejectSearch?[]:[{
      meta_info:{name:'Demo Show',year:'2020',type:'电视剧',begin_season:1,begin_episode:1,end_episode:2,total_episode:2},
      media_info:{title:'Demo Show',year:'2020',type:'电视剧',tmdb_id:1399},
      torrent_info:{title:'Demo.Show.2020.S01E01-E02.2160p.HEVC.AAC',enclosure:'https://tracker.test/series.torrent',
        size:files.reduce((sum,item)=>sum+fs.statSync(item.location).size,0),seeders:10}}]});
    if(url.pathname==='/api/v1/download/add'){const body=JSON.parse(init.body);assert.equal(body.tmdbid,1399);requested=true;return response({success:true,data:{download_id:'series-job'}});}
    if(url.pathname==='/api/v1/download/')return response(requested?[{hash:'series-job',progress:100,state:'completed',content_path:'/provider/downloads/series',
      title:'Demo.Show.S01E01-E02.2160p.HEVC',media:{title:'Demo Show',tmdbid:1399,type:'电视剧',seasons:'S01'}}]:[]);
    if(url.pathname==='/api/v1/history/download')return response([]);
    if(url.pathname==='/api/v1/history/transfer')return response({success:true,data:{list:requested?files.map((item,index)=>({download_hash:'series-job',status:true,
      dest:'/provider/organized/Demo Show/Season 01/'+item.name,type:'电视剧',tmdbid:1399,seasons:'S01',episodes:'E0'+(index+1),title:'Demo Show',year:'2020'})):[],total:requested?2:0}});
    throw new Error('Unexpected fixture Provider route: '+url.pathname);
  }
  async function configure(request){
    const proof=(await request('POST','/v1/admin/settings/integrations/moviepilot/actions/test',{kind:'moviepilot',idempotencyKey:'series-provider-test',
      endpoint:'https://series-moviepilot.test',credential:{kind:'api_key',value:'disposable-series-key'},settings:{providerRequestSaveRoot:'/provider/downloads',
        providerOrganizedRoot:'/provider/organized',shelfDeckVisibleRoot:landing},timeoutMs:5000})).json();
    await request('PATCH','/v1/admin/settings/integrations/moviepilot',{kind:'moviepilot',idempotencyKey:'series-provider-save',expectedConfigRevision:0,connectionProofId:proof.connectionProofId});
  }
  return {landing,files,fingerprints,calls,fetch,configure};
}
function exhaustedComputeRuntime(){
  const {canonicalDigest:d}=require('../../src/helix/contracts/canonical-json');
  const pipeline={pipelineProfileId:'ordinary_to_hevc@1',inputDynamicRangeKinds:['sdr'],
    inputPixelFormats:['yuv420p10le'],outputCodec:'hevc',outputDynamicRangeKind:'sdr',outputPixelFormat:'yuv420p',
    outputColorProfile:{range:'limited',primaries:'bt709',transfer:'bt709',matrix:'bt709'},selfTestDigest:d('fixture-pipeline')};
  const capabilityPayload={supportedVideoCodecs:['hevc'],supportedRateControlModes:['quality_bound'],
    validatedConcurrentSlots:1,validatedVideoPipelines:[pipeline]},capabilityDigest=d(capabilityPayload);
  const body={deviceId:'series-fixture-cpu',deviceClass:'software_cpu',probeRevision:1,
    capabilitySchemaRef:'platform.compute-device-capability@1',capabilityPayload,capabilityDigest,enabled:true,state:'ready',workerRef:null};
  const snapshot={...body,snapshotDigest:d(body)},ref={deviceId:body.deviceId,deviceClass:body.deviceClass,probeRevision:1,capabilityDigest};
  return {listReadyDeviceRefs(query){const result={queryDigest:query.queryDigest,resultKind:'available',items:[{...ref,refDigest:d(ref)}]};
    return {...result,resultDigest:d(result)};},readDeviceSnapshot(query){
    assert.equal(query.deviceId,body.deviceId);assert.equal(query.expectedProbeRevision,1);assert.equal(query.expectedCapabilityDigest,capabilityDigest);
    const result={queryDigest:query.queryDigest,resultKind:'found',snapshot};return {...result,resultDigest:d(result)};
  }};
}
module.exports=Object.freeze({fixture,exhaustedComputeRuntime});
