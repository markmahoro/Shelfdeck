'use strict';
const {JAV_SOURCE_TRANSPORTS}=require('../../../src/helix/contracts/jav-source-profiles');
const html=body=>new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});
function createJavClassTransport(picture,requests,sourceCase,shouldFailPrimary=()=>true){
  const supported=new Set(sourceCase.sites),credit=sourceCase.credit?.name||'',role=sourceCase.credit?.role;
  const javDbCodes=new Map();
  return async url=>{const value=new URL(url);requests.push(value.toString());const origin=value.origin;
    const asset=[...supported].some(site=>JAV_SOURCE_TRANSPORTS[site].assets.includes(value.hostname));
    if(sourceCase.primaryDenied&&shouldFailPrimary()&&value.hostname==='adult.contents.fc2.com'&&value.pathname.startsWith('/article/'))
      return new Response('Unavailable fixture source',{status:sourceCase.primaryHttpStatus||403,headers:{'content-type':'text/html'}});
    if(asset&&/\.(jpg|png)$/.test(value.pathname))return new Response(sourceCase.failPrimary&&value.hostname==='c0.jdbstatic.com'&&value.pathname==='/rejected.jpg'?Buffer.from('not an image'):picture,{headers:{'content-type':'image/jpeg'}});
    if(value.hostname==='javdb.com'&&supported.has('javdb')){
      const code=value.searchParams.get('q')||javDbCodes.get(value.pathname.split('/').pop());
      if(value.pathname==='/search'){const key='Class'+code.replace(/-/g,'');javDbCodes.set(key,code);return html('<div class="movie-list"><div class="item"><a href="/v/'+key+'"><strong>'+code+'</strong></a></div></div>');}
      if(value.pathname.startsWith('/v/')){const rejected=sourceCase.failPrimary&&code===sourceCase.javCode;
        return html('<link rel="canonical" href="'+origin+value.pathname+'"><div class="video-detail"><h2 class="title">'+code+' '+(rejected?'Rejected site title':sourceCase.title)+'</h2><div class="movie-panel-info"><div class="panel-block"><strong>番號：</strong><span class="value">'+code+'</span></div>'+(rejected?'<div class="panel-block"><strong>片商：</strong><span class="value">Rejected studio</span></div>':'')+'</div><img class="video-cover" src="https://c0.jdbstatic.com/'+(rejected?'rejected':'fixture')+'.jpg"></div>');}
    }
    if(value.hostname==='javmenu.com'&&supported.has('javmenu')){const code=value.pathname.slice(1);
      if(sourceCase.primaryNotFound&&code===sourceCase.javCode)return html('<h1>Fixture unavailable</h1>');
      const match=code.match(/^(.+?)([0-9]+[A-Z]?)$/),prefix=match?.[1]||code,suffix=match?.[2]||'';
      return html('<link rel="canonical" href="'+origin+value.pathname+'"><div class="col-md-9"><h1 class="display-5"><strong>'+sourceCase.title+'</strong></h1><div class="left-wrapper"><div class="card"><div class="card-body"><div class="code"><a>'+prefix+'</a><span>'+suffix+'</span></div></div></div></div><div class="single-video"><video poster="https://666.9989641.xyz/fixture.jpg"></video></div></div>');}
    if(value.hostname==='adult.contents.fc2.com'&&supported.has('fc2_official')){const digits=value.pathname.split('/')[2];return html('<link rel="canonical" href="'+origin+'/article/'+digits+'/"><div class="items_article_left"><div class="items_article_headerInfo"><h3>'+sourceCase.title+'</h3></div><div class="items_article_MainitemThumb"><img src="https://contents-thumbnail2.fc2.com/fixture.jpg"></div><iframe src="/widget/article/'+digits+'/description"></iframe>'+(role==='seller'?'<ul><li>by <a>'+credit+'</a></li></ul>':'')+'</div>');}
    if(value.hostname==='www.heydouga.com'&&supported.has('heydouga_official')){const [, ,publisher,item]=value.pathname.split('/');return html('<link rel="canonical" href="'+origin+value.pathname+'"><meta property="og:image" content="https://image01-www.heydouga.com/contents/'+publisher+'/'+item+'/player_thumb.jpg"><div id="title-bg"><h1>'+sourceCase.title+'</h1></div><div id="movie-player">/sample/'+publisher+'/'+item+'/file_type.php</div>');}
    if(value.hostname==='www.caribbeancom.com'&&supported.has('caribbeancom_official')){const code=value.pathname.split('/')[2];return html('<h1>'+sourceCase.title+'</h1><script>var Movie = '+JSON.stringify({movie_id:code,is_mp4:true})+';</script>');}
    if(value.hostname==='av-wiki.net'&&supported.has('avwiki')){const code=value.pathname.split('/')[1].toUpperCase();return html('<link rel="canonical" href="'+origin+'/'+code.toLowerCase()+'/"><header><a class="image-link-border"><img src="https://image.mgstage.com/fixture.jpg"></a></header><section class="article-body"><div><p>'+sourceCase.title+'</p></div><dl class="dltable"><dt>メーカー品番</dt><dd>'+code+'</dd><dt>MGS品番</dt><dd>'+code+'</dd>'+(role==='maker'?'<dt>メーカー</dt><dd>'+credit+'</dd>':'')+'</dl><a href="https://www.mgstage.com/product/product_detail/'+code+'/">Product</a></section>');}
    if(value.hostname==='dl.getchu.com'&&supported.has('dl_getchu')){const digits=value.pathname.replace('/i/item','');return html('<link rel="canonical" href="'+origin+'/i/item'+digits+'"><meta property="og:title" content="'+sourceCase.title+'"><form action="https://dl.getchu.com/cart/"><table><tr><td class="bluetext">作品形式</td><td>MP4</td></tr>'+(role==='circle'?'<tr><td class="bluetext">サークル</td><td>'+credit+'</td></tr>':'')+'</table></form><img src="'+origin+'/covers/'+digits+'top.jpg">');}
    if(value.hostname==='gyutto.com'&&supported.has('gyutto')){const digits=value.pathname.replace('/i/item','');return html('<link rel="canonical" href="'+origin+'/i/item'+digits+'"><h1>'+sourceCase.title+'</h1><dl class="BasicInfo"><dt>作品形式</dt><dd>MP4</dd>'+(role==='circle'?'<dt>サークル</dt><dd>'+credit+'</dd>':'')+'</dl><a class="highslide"><img src="https://image.gyutto.com/fixture.jpg"></a>');}
    throw new Error('Unconfigured class source was queried: '+value.hostname+value.pathname);
  };
}
module.exports={createJavClassTransport};
