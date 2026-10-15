export const JAV_SOURCE_LABELS:Record<string,string>={javdb:'JavDB',javmenu:'JavMenu',fc2_official:'FC2 官方',heydouga_official:'Heydouga 官方',
  caribbeancom_official:'Caribbeancom 官方',avwiki:'AvWiki',dl_getchu:'DL Getchu',gyutto:'Gyutto'};
export const javSourceLabel=(site:string)=>JAV_SOURCE_LABELS[site]||'未知资料站';
