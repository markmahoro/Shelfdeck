'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {artifactRequirement}=require('../../../contracts/product-artifact-requirement');
const {readInventoryArtifactScope}=require('./inventory-artifact-scope');
const {aftercareProviderIdentity}=require('./aftercare-provider-identity');
const {MAX_NFO_BYTES,AftercareNfoError}=require('./aftercare-nfo');

function fail(message) {
  throw new AftercareNfoError('ARCA_AFTERCARE_SERIES_NFO_INPUT_INVALID',message);
}
function entriesOf(value) {
  const rows=value?.descriptiveFacts?.entries;
  if(!Array.isArray(rows))fail('Series NFO accepted metadata is absent.');
  const entries=new Map();
  for(const row of rows) {
    if(!row||typeof row.key!=='string'||entries.has(row.key))fail('Series NFO metadata keys are invalid or duplicated.');
    entries.set(row.key,row.value);
  }
  return entries;
}
function requiredText(entries,key) {
  const value=entries.get(key);
  if(typeof value!=='string'||!value.trim())fail('Series NFO required metadata is absent: '+key+'.');
  return value;
}
function xmlText(value) {
  const text=String(value);
  // XML 1.0 rejects control characters and unpaired surrogates, even inside CDATA.
  for(const character of text) {
    const code=character.codePointAt(0);
    if(![9,10,13].includes(code)&&!(code>=32&&code<=0xd7ff)&&!(code>=0xe000&&code<=0xfffd)&&
        !(code>=0x10000&&code<=0x10ffff))fail('Series NFO metadata contains an invalid XML character.');
  }
  return text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&apos;');
}
function acceptedFact(raw,packageId,kind) {
  const matches=raw.facts.filter(row=>row.source_package_id===packageId&&row.fact_kind===kind);
  if(matches.length!==1)fail('Series NFO requires one accepted '+kind+' Fact from its original package.');
  return matches[0].value;
}
function assertNumber(entries,key,expected) {
  if(!entries.has(key))return;
  const actual=entries.get(key);
  if(!(typeof actual==='number'||typeof actual==='string'&&/^[0-9]+$/.test(actual))||
      Number(actual)!==expected)fail('Series NFO metadata conflicts with the frozen '+key+'.');
}

/** Resolve accepted facts without reading a Provider or inferring scope from a path. */
function seriesAftercareNfoTarget(context,materialKey) {
  const raw=context.raw;
  if(raw.entry.structure_kind!=='season')fail('Series NFO requires a Season Inventory.');
  const matches=raw.materials.filter(row=>row.material_key===materialKey);
  if(matches.length!==1)fail('Series NFO requires one current Inventory material.');
  const material=matches[0],scope=readInventoryArtifactScope(material);
  if(!scope)fail('Series NFO Inventory Artifact scope is absent.');
  const anchor=aftercareProviderIdentity(context,{providerId:raw.identity.provider,
    providerObjectId:raw.identity.provider_key,identityDigest:raw.identity.identity_digest});
  if(scope.seasonNumber!==anchor.seasonNumber)fail('Series NFO target belongs to a different Season.');
  acceptedFact(raw,scope.sourcePackageId,'resolved_identity');
  const metadata=acceptedFact(raw,scope.sourcePackageId,'product_metadata'),seriesEntries=entriesOf(metadata);
  const cast=acceptedFact(raw,scope.sourcePackageId,'media_cast');
  if(!Array.isArray(cast?.relations))fail('Series NFO accepted cast is absent.');
  assertNumber(seriesEntries,'season_number',scope.seasonNumber);
  if(seriesEntries.has('tmdb_series_id')&&String(seriesEntries.get('tmdb_series_id'))!==anchor.providerKey)
    fail('Series NFO metadata conflicts with the accepted Series identity.');
  const seriesTitle=requiredText(seriesEntries,'series_title');
  let episodeEntries=null;
  if(scope.episodeScope) {
    const records=metadata.episodeMetadata;
    if(!Array.isArray(records)||!records.length||records.length>1024)fail('Series NFO Episode metadata is absent or exceeds its bound.');
    const scopes=new Set();
    for(const record of records) {
      const episode=record.episodeScope;
      artifactRequirement('nfo',episode);
      if(!episode||episode.seasonNumber!==scope.seasonNumber||scopes.has(episode.episodeKey))
        fail('Series NFO accepted Episode scopes are duplicated or inconsistent.');
      scopes.add(episode.episodeKey);
    }
    const selected=records.filter(record=>canonicalDigest(record.episodeScope)===canonicalDigest(scope.episodeScope));
    if(selected.length!==1)fail('Series NFO exact Episode metadata is absent.');
    const current=raw.materials.filter(row=>row.role==='primary_payload').flatMap(row=>JSON.parse(row.episode_claims_json).items);
    if(!current.some(claim=>claim.episodeKey===scope.episodeScope.episodeKey))
      fail('Series NFO Episode is outside the current Inventory.');
    episodeEntries=entriesOf(selected[0]);
    assertNumber(episodeEntries,'season_number',scope.seasonNumber);
    assertNumber(episodeEntries,'episode_number',scope.episodeScope.episodeNumber);
    if(episodeEntries.has('series_title')&&episodeEntries.get('series_title')!==seriesTitle)
      fail('Series NFO Episode metadata conflicts with the accepted Series title.');
    requiredText(episodeEntries,'episode_title');requiredText(episodeEntries,'episode_plot');
  }
  return Object.freeze({material,scope,anchor,seriesEntries,episodeEntries,seriesTitle,cast});
}

function renderSeriesAftercareNfo(context,materialKey) {
  const target=seriesAftercareNfoTarget(context,materialKey),{scope,anchor,seriesEntries,episodeEntries,seriesTitle,cast}=target;
  const root=episodeEntries?'episodedetails':'tvshow',lines=['<'+root+'>'];
  const append=(tag,value)=>lines.push('  <'+tag+'>'+xmlText(value)+'</'+tag+'>');
  if(episodeEntries) {
    append('title',requiredText(episodeEntries,'episode_title'));append('showtitle',seriesTitle);
    append('season',scope.seasonNumber);append('episode',scope.episodeScope.episodeNumber);
    append('plot',requiredText(episodeEntries,'episode_plot'));
  } else {
    append('title',seriesTitle);append('tmdbid',anchor.providerKey);append('season',scope.seasonNumber);
    append('plot',requiredText(seriesEntries,'plot'));
    for(const genre of requiredText(seriesEntries,'genre').split(/\s*(?:\/|,|;|\|)\s*/).filter(Boolean))append('genre',genre);
    for(const [key,tag] of [['year_or_release_date','year'],['release_date','releasedate'],['studio','studio'],['director','director']]) {
      if(!seriesEntries.has(key))continue;
      const value=seriesEntries.get(key);
      if(!['string','number'].includes(typeof value))fail('Series NFO optional metadata must be scalar.');
      if(String(value).trim())append(tag,value);
    }
    lines.push('  <uniqueid type="tmdb">'+xmlText(anchor.providerKey)+'</uniqueid>');
  }
  for(const relation of cast.relations) {
    if(relation?.role!=='actor')continue;
    if(typeof relation.displayName!=='string'||!relation.displayName.trim())fail('Series NFO actor name is absent.');
    lines.push('  <actor>','    <name>'+xmlText(relation.displayName)+'</name>');
    const claims=(relation.providerIdentities||[]).filter(item=>item.provider==='tmdb'&&['tmdb_person','person'].includes(item.namespace));
    if(new Set(claims.map(item=>item.namespace)).size!==claims.length)fail('Series NFO actor identity is duplicated.');
    const ids=[...new Set(claims.map(item=>item.providerKey))];
    if(ids.length>1)fail('Series NFO actor identity is ambiguous.');
    if(ids.length) {
      if(!/^[1-9][0-9]{0,15}$/.test(String(ids[0])))fail('Series NFO actor identity is invalid.');
      lines.push('    <tmdbid>'+xmlText(ids[0])+'</tmdbid>');
    }
    lines.push('  </actor>');
  }
  lines.push('</'+root+'>');
  const bytes=Buffer.from(lines.join('\n')+'\n','utf8');
  if(bytes.length>MAX_NFO_BYTES)throw new AftercareNfoError('ARCA_AFTERCARE_NFO_OUTPUT_TOO_LARGE',
    'Rendered Series Aftercare NFO exceeds its byte bound.',{maxBytes:MAX_NFO_BYTES});
  return Object.freeze({material:target.material,scope,bytes});
}

module.exports=Object.freeze({seriesAftercareNfoTarget,renderSeriesAftercareNfo});
