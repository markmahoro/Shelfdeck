'use strict';

const {canonicalDigest,canonicalJson}=require('./canonical-json');
const OBSERVATION='shelfdeck.series-presentation-source@1';
const BASIS='shelfdeck.series-presentation-basis@1';
const KINDS=Object.freeze(['nfo','poster','fanart']);
function seriesPresentationFileName(kind){const value={nfo:'tvshow.nfo',poster:'poster.jpg',fanart:'fanart.jpg'}[kind];
  if(!value)throw new TypeError('Unknown Series presentation role.');return value;}
const text=maxLength=>({type:'string',maxLength});
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));
const fail=message=>{throw Object.assign(new TypeError(message),{code:'SERIES_PRESENTATION_BASIS_INVALID'});};

function sourceSchema(){return object({schema:{const:OBSERVATION},provider:{const:'tmdb'},namespace:{const:'tmdb_series'},
  providerKey:{type:'string',pattern:'^[0-9]+$'},seasonIdentityAnchorDigest:digest,integrationId:{...text(256),minLength:1},
  configRevision:{type:'integer',minimum:1},language:{...text(32),minLength:1},sourceRef:{...text(256),minLength:1},
  title:{...text(1024),minLength:1},originalTitle:text(1024),originalLanguage:text(16),firstAirDate:text(32),plot:text(16384),
  genres:{type:'array',items:text(256),maxItems:64},sourceDigest:digest});}

function seriesPresentationBasisSchema(){return object({schema:{const:BASIS},sourceObservation:sourceSchema(),
  metadataEvidenceId:{...text(256),minLength:1},metadataObservationDigest:digest,
  requiredArtifactKinds:{type:'array',prefixItems:KINDS.map(kind=>({const:kind})),items:false,minItems:3,maxItems:3},
  imageSelectionRevision:{const:1},renderRevision:{const:1},basisDigest:digest});}

function assertSource(value){
  const keys=Object.keys(sourceSchema().properties);
  if(!value||canonicalJson(Object.keys(value).sort())!==canonicalJson([...keys].sort())||value.schema!==OBSERVATION||
      value.provider!=='tmdb'||value.namespace!=='tmdb_series'||!/^\d+$/.test(value.providerKey)||
      !Number.isSafeInteger(value.configRevision)||value.configRevision<1||!value.integrationId||!value.language||
      !value.title||value.title.length>1024||typeof value.originalTitle!=='string'||value.originalTitle.length>1024||
      typeof value.originalLanguage!=='string'||value.originalLanguage.length>16||
      typeof value.plot!=='string'||value.plot.length>16384||typeof value.firstAirDate!=='string'||value.firstAirDate.length>32||
      !Array.isArray(value.genres)||value.genres.length>64||value.genres.some(item=>typeof item!=='string'||item.length>256)||
      !/^[a-f0-9]{64}$/.test(value.seasonIdentityAnchorDigest)||value.sourceRef!=='tmdb:tv:'+value.providerKey||
      value.sourceDigest!==canonicalDigest(without(value,'sourceDigest'))||Buffer.byteLength(canonicalJson(value))>32768)
    fail('Series presentation source must preserve exact show facts and qualified Season provenance.');
  return value;
}

function buildSeriesPresentationSource(value){const source={originalLanguage:'',...value,schema:OBSERVATION};
  return Object.freeze(assertSource({...source,sourceDigest:canonicalDigest(source)}));}

function buildSeriesPresentationBasis(observation){
  const source=assertSource(observation.seriesPresentationSource);
  if(observation.contentProfile!=='series'||observation.sourceKind!=='provider'||observation.episodeScope||
      !observation.providerIdentitySet.entries.some(identity=>identity.provider==='tmdb'&&identity.namespace==='tmdb_series'&&
        identity.providerKey===source.providerKey&&identity.identityAnchorDigest===source.seasonIdentityAnchorDigest)||
      !observation.evidenceId||!/^[a-f0-9]{64}$/.test(observation.payloadDigest))
    fail('Series presentation basis requires its exact formal non-Episode metadata Observation.');
  const basis={schema:BASIS,sourceObservation:source,metadataEvidenceId:observation.evidenceId,
    metadataObservationDigest:observation.payloadDigest,requiredArtifactKinds:KINDS,imageSelectionRevision:1,renderRevision:1};
  return Object.freeze({...basis,basisDigest:canonicalDigest(basis)});
}

function assertSeriesPresentationBasis(value,identity){
  if(!value||canonicalJson(Object.keys(value).sort())!==canonicalJson(Object.keys(seriesPresentationBasisSchema().properties).sort())||
      value.schema!==BASIS||canonicalJson(value.requiredArtifactKinds)!==canonicalJson(KINDS)||
      value.imageSelectionRevision!==1||value.renderRevision!==1||value.basisDigest!==canonicalDigest(without(value,'basisDigest'))||
      !value.metadataEvidenceId||!/^[a-f0-9]{64}$/.test(value.metadataObservationDigest))fail('Series presentation basis is invalid.');
  const source=assertSource(value.sourceObservation);
  if(identity&&(identity.provider!=='tmdb'||identity.namespace!=='tmdb_series'||identity.providerKey!==source.providerKey||
      identity.identityAnchorDigest!==source.seasonIdentityAnchorDigest))fail('Series presentation source belongs to a foreign Season identity.');
  return value;
}

function renderSeriesNfo(basis){
  const source=assertSeriesPresentationBasis(basis).sourceObservation;
  const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const elements=[['title',source.title],['originaltitle',source.originalTitle],['premiered',source.firstAirDate],
    ['year',source.firstAirDate.slice(0,4)],['plot',source.plot],...source.genres.map(value=>['genre',value])];
  return Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<tvshow>\n'+
    elements.filter(([,value])=>value).map(([key,value])=>'  <'+key+'>'+xml(value)+'</'+key+'>').join('\n')+
    '\n  <uniqueid type="tmdb" default="true">'+xml(source.providerKey)+'</uniqueid>\n</tvshow>\n');
}

module.exports=Object.freeze({KINDS,sourceSchema,seriesPresentationBasisSchema,assertSource,
  buildSeriesPresentationSource,buildSeriesPresentationBasis,assertSeriesPresentationBasis,renderSeriesNfo,seriesPresentationFileName});
