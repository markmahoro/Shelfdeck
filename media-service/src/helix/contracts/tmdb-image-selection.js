'use strict';

function normalizedLanguage(value){return typeof value==='string'?value.trim().toLowerCase().split(/[-_]/)[0]:null;}
function selectTmdbImage(items,{artifactKind,language,originalLanguage=null}){
  if(!['poster','fanart','still'].includes(artifactKind)||!Array.isArray(items)||items.length>512)
    throw new TypeError('TMDB image selection requires a bounded exact image role.');
  const languages=[...new Set([normalizedLanguage(language),normalizedLanguage(originalLanguage),null])];
  const rank=image=>artifactKind==='fanart'?(image.iso_639_1==null?0:1):
    (languages.indexOf(normalizedLanguage(image.iso_639_1))<0?languages.length:languages.indexOf(normalizedLanguage(image.iso_639_1)));
  return [...items].filter(item=>typeof item.file_path==='string'&&/^\/[A-Za-z0-9._-]+$/.test(item.file_path)&&
    (!Number.isFinite(item.width)||item.width>0)&&(!Number.isFinite(item.height)||item.height>0)&&
    (artifactKind==='still'||!item.width||!item.height||(artifactKind==='poster'?item.height>item.width:item.width>item.height)))
    .sort((a,b)=>rank(a)-rank(b)||(b.vote_average||0)-(a.vote_average||0)||
      (b.width||0)*(b.height||0)-(a.width||0)*(a.height||0)||Buffer.from(a.file_path).compare(Buffer.from(b.file_path)))[0]||null;
}
module.exports=Object.freeze({normalizedLanguage,selectTmdbImage});
