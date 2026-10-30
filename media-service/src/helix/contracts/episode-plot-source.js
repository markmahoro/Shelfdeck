'use strict';
const crypto=require('node:crypto');
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {buildEpisodeMetadataScope,episodeMetadataScopeSchema}=require('./episode-metadata-scope');
const {buildProviderEpisodeReference,providerEpisodeReferenceSchema}=require('./provider-episode-reference');
const POLICY='tmdb.episode-plot-language@1',SCHEMA='shelfdeck.episode-plot-source@1',DIGEST=/^[a-f0-9]{64}$/;
const hash=value=>crypto.createHash('sha256').update(value,'utf8').digest('hex');
const fields=['schema','policyRef','providerEpisode','localScope','requestedLanguage','result','selectedLanguage','plotDigest','translationSetDigest','proofDigest'];
function fail(code='EPISODE_PLOT_SOURCE_INVALID'){throw Object.assign(new Error('Episode plot requires exact same-Episode language provenance.'),{code});}
function language(value){return typeof value==='string'&&/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(value);}
function assertEpisodePlotSource(value){
  if(!value||canonicalJson(Object.keys(value).sort())!==canonicalJson([...fields].sort())||value.schema!==SCHEMA||value.policyRef!==POLICY||
      !language(value.requestedLanguage)||!['selected','not_available'].includes(value.result)||!DIGEST.test(value.translationSetDigest||''))fail();
  buildProviderEpisodeReference(value.providerEpisode);buildEpisodeMetadataScope(value.localScope);
  if(value.result==='selected'?(!language(value.selectedLanguage)||!DIGEST.test(value.plotDigest||'')):
    (value.selectedLanguage!==null||value.plotDigest!==null))fail();
  const {proofDigest,...body}=value;if(!DIGEST.test(proofDigest||'')||proofDigest!==canonicalDigest(body))fail();return value;
}
function selectEpisodePlot({response,providerEpisode,localScope,requestedLanguage,originalLanguage}){
  const exact=buildProviderEpisodeReference(providerEpisode);buildEpisodeMetadataScope(localScope);
  if(!language(requestedLanguage)||!response||response.id!==exact.episodeId||!Array.isArray(response.translations)||response.translations.length>128)
    fail('PLATFORM_TMDB_EPISODE_TRANSLATIONS_INVALID');
  const locales=new Map();
  for(const row of response.translations){
    const country=row?.iso_3166_1??'',overview=row?.data?.overview??'';
    if(!row||typeof row.iso_639_1!=='string'||!/^[a-z]{2,3}$/.test(row.iso_639_1)||
        typeof country!=='string'||!/^([A-Z]{2})?$/.test(country)||
        !row.data||Array.isArray(row.data)||typeof row.data!=='object'||typeof overview!=='string'||Buffer.byteLength(overview)>16*1024||overview.includes('\0'))
      fail('PLATFORM_TMDB_EPISODE_TRANSLATIONS_INVALID');
    const locale=row.iso_639_1+(country?'-'+country:''),plot=overview.trim();
    if(locales.has(locale)&&locales.get(locale)!==plot)fail('PLATFORM_TMDB_EPISODE_TRANSLATIONS_INVALID');
    locales.set(locale,plot);
  }
  const primary=requestedLanguage.split('-')[0],original=typeof originalLanguage==='string'?originalLanguage.split('-')[0]:null,
    priority=locale=>locale===requestedLanguage?0:locale.split('-')[0]===primary?1:
      locale.split('-')[0]===original?2:locale.split('-')[0]==='en'?3:4,
    entries=[...locales].sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b))),
    selected=entries.filter(([,plot])=>plot).sort(([a],[b])=>priority(a)-priority(b)||Buffer.compare(Buffer.from(a),Buffer.from(b)))[0]||null,
    body={schema:SCHEMA,policyRef:POLICY,providerEpisode:exact,localScope,requestedLanguage,result:selected?'selected':'not_available',
      selectedLanguage:selected?.[0]||null,plotDigest:selected?hash(selected[1]):null,
      translationSetDigest:canonicalDigest({schema:'tmdb.episode-plot-translations@1',episodeId:exact.episodeId,entries})};
  return Object.freeze({plot:selected?.[1]||null,proof:Object.freeze(assertEpisodePlotSource({...body,proofDigest:canonicalDigest(body)}))});
}
function assertEpisodePlotBinding(proof,intent,entries){
  assertEpisodePlotSource(proof);
  const identity=intent.resolvedProviderIdentity,mapped=intent.episodeMapping?.providerEpisode,scope=intent.episodeScope,
    episode=proof.providerEpisode,plot=entries.filter(item=>item.key==='episode_plot');
  if(intent.contentProfile!=='series'||intent.sourceKind!=='provider'||intent.episodePlotPolicyRef!==POLICY||!scope||canonicalJson(proof.localScope)!==canonicalJson(scope)||
      episode.providerKey!==identity?.providerKey||episode.seasonNumber!==(mapped?.seasonNumber??scope.seasonNumber)||
      episode.episodeNumber!==(mapped?.episodeNumber??scope.episodeNumber)||(mapped&&canonicalJson(mapped)!==canonicalJson(episode))||
      (proof.result==='selected'?(plot.length!==1||typeof plot[0].value!=='string'||hash(plot[0].value)!==proof.plotDigest):plot.length!==0))fail();
  return proof;
}
function episodePlotSourceSchema(){const digest={type:'string',pattern:'^[a-f0-9]{64}$'},locale={type:'string',pattern:'^[a-z]{2,3}(?:-[A-Z]{2})?$'};
  return {type:'object',additionalProperties:false,required:fields,properties:{schema:{const:SCHEMA},policyRef:{const:POLICY},
    providerEpisode:providerEpisodeReferenceSchema(),localScope:episodeMetadataScopeSchema(),requestedLanguage:locale,
    result:{enum:['selected','not_available']},selectedLanguage:{anyOf:[locale,{type:'null'}]},plotDigest:{anyOf:[digest,{type:'null'}]},
    translationSetDigest:digest,proofDigest:digest},allOf:[{if:{properties:{result:{const:'selected'}}},
      then:{properties:{selectedLanguage:locale,plotDigest:digest}},else:{properties:{selectedLanguage:{type:'null'},plotDigest:{type:'null'}}}}]};
}
module.exports=Object.freeze({POLICY,selectEpisodePlot,assertEpisodePlotSource,assertEpisodePlotBinding,episodePlotSourceSchema});
