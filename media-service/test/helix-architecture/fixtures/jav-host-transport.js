'use strict';
function createJavHostTransport(picture,requests=[],sameTitle=false,actors=false) {
  return async url=>{
    const value=new URL(url);requests.push(value.toString());
    const code=value.pathname==='/v/Correct02'||value.searchParams.get('q')==='IPX-178'?'IPX-178':'IPX-177',resource=code==='IPX-178'?'Correct02':'Fixture01';
    const actorBlock=actors?'<div class="panel-block"><strong>演員：</strong><span class="value"><a href="/actors/'+(code==='IPX-178'?'newFixture':'oldFixture')+'">'+(code==='IPX-178'?'New Actor':'Old Actor')+'</a>'+(code==='IPX-178'?'<a href="https://foreign.invalid/actors/weak">Unresolved Actor</a>':'')+'</span></div>':'';
    if(value.hostname==='javdb.com'&&value.pathname==='/search')return new Response('<div class="movie-list"><div class="item"><a href="/v/'+resource+'"><strong>'+code+'</strong></a></div></div>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if(value.hostname==='javdb.com'&&['/v/Fixture01','/v/Correct02'].includes(value.pathname))return new Response('<link rel="canonical" href="https://javdb.com/v/'+resource+'"><div class="video-detail"><h2 class="title">'+code+' '+(code==='IPX-178'&&!sameTitle?'Corrected JAV film':'Fixture JAV film')+'</h2><div class="movie-panel-info"><div class="panel-block"><strong>番號：</strong><span class="value">'+code+'</span></div>'+actorBlock+'</div><img class="video-cover" src="https://c0.jdbstatic.com/'+(code==='IPX-178'?'corrected':'fixture')+'.jpg"></div>',{headers:{'content-type':'text/html; charset=utf-8'}});
    if(value.hostname==='c0.jdbstatic.com')return new Response(picture,{headers:{'content-type':'image/jpeg'}});
    throw new Error('Unconfigured source was queried.');
  };
}
module.exports={createJavHostTransport};
