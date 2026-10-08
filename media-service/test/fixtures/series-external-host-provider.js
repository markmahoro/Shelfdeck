'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
function fixture(root,{rejectSearch=false}={}){
  const landing=path.join(root,'landing'),directory=path.join(landing,'Demo Show','Season 01');
  fs.mkdirSync(directory,{recursive:true});
  const files=[1,2].map(n=>{const name='Demo.Show.S01E0'+n+'.2160p.HEVC.mkv',location=path.join(directory,name);fs.writeFileSync(location,'external-episode-'+n);return {name,location};});
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
      title:'Demo.Show.S01E01-E02.2160p.HEVC',media:{title:'Demo Show',tmdbid:1399,type:'电视剧',season:1}}]:[]);
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
  return {landing,files,calls,fetch,configure};
}
module.exports=Object.freeze({fixture});
