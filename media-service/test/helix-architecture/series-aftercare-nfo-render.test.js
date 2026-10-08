'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderSeriesAftercareNfo}=require('../../src/helix/domains/arca/model/aftercare-series-nfo');
const {fixture}=require('./fixtures/series-aftercare-context');

test('Series NFO rebuild uses the exact accepted batch and Episode, independent of row order or filename',()=>{
  const c=fixture(),result=renderSeriesAftercareNfo(c,'three'),xml=result.bytes.toString('utf8');
  assert.match(xml,/^<episodedetails>\n/);assert.match(xml,/<title>Episode 3<\/title>/);
  assert.match(xml,/<plot>Plot 3<\/plot>/);assert.match(xml,/<season>2<\/season>/);assert.match(xml,/<episode>3<\/episode>/);
  assert.match(xml,/<showtitle>Updated &amp; &lt;Series&gt;<\/showtitle>/);
  assert.match(xml,/<name>Actor from second<\/name>/);
  assert.doesNotMatch(xml,/Original Series|Episode [12]|Plot [12]|Season plot|Actor from first|uniqueid/);
  c.raw.facts.reverse();c.raw.materials.reverse();
  c.raw.materials.find(row=>row.material_key==='three').location='/arbitrary/movie-S99E01.nfo';
  assert.deepEqual(renderSeriesAftercareNfo(c,'three').bytes,result.bytes);
  assert.match(renderSeriesAftercareNfo(c,'one').bytes.toString(),/<showtitle>Original Series<\/showtitle>/);
});
test('Season NFO rebuild retains original batch facts and omits all Episode details',()=>{
  const xml=renderSeriesAftercareNfo(fixture(),'season').bytes.toString();
  assert.match(xml,/^<tvshow>\n/);assert.match(xml,/<title>Original Series<\/title>/);
  assert.match(xml,/<tmdbid>1399<\/tmdbid>/);assert.match(xml,/<uniqueid type="tmdb">1399<\/uniqueid>/);
  assert.match(xml,/<genre>Drama<\/genre>/);assert.match(xml,/<genre>Fantasy<\/genre>/);
  assert.match(xml,/<plot>Season plot<\/plot>/);assert.match(xml,/<name>Actor from first<\/name>/);
  assert.doesNotMatch(xml,/episodedetails|<episode>|episodetitle|episodeplot|Updated|Actor from second/);
});
const mutations={
  missing_scope:c=>{delete c.raw.materials[3].artifact_scope_json;},
  absent_material:c=>{c.raw.materials=c.raw.materials.filter(row=>row.material_key!=='three');},
  duplicate_material:c=>{c.raw.materials.push(structuredClone(c.raw.materials[3]));},
  movie_inventory:c=>{c.raw.entry.structure_kind='single';},
  missing_batch_metadata:c=>{c.raw.facts=c.raw.facts.filter(row=>row.fact_kind!=='product_metadata'||row.source_package_id!=='second');},
  duplicate_batch_metadata:c=>{c.raw.facts.push(structuredClone(c.raw.facts[4]));},
  missing_batch_identity:c=>{c.raw.facts.splice(3,1);},
  missing_batch_cast:c=>{c.raw.facts.splice(5,1);},
  foreign_identity:c=>{c.raw.facts[3].value.providerIdentities[0].seasonNumber=3;},
  absent_episode:c=>{c.raw.facts[4].value.episodeMetadata=[];},
  wrong_episode:c=>{c.raw.facts[4].value.episodeMetadata[0].episodeScope={seasonNumber:2,episodeNumber:4,episodeKey:'E004'};},
  duplicate_episode:c=>{c.raw.facts[4].value.episodeMetadata.push(structuredClone(c.raw.facts[4].value.episodeMetadata[0]));},
  extra_scope_key:c=>{c.raw.facts[4].value.episodeMetadata[0].episodeScope.guessed=true;},
  unrepresented_episode:c=>{c.raw.materials=c.raw.materials.filter(row=>!row.material_key.startsWith('part-'));},
  wrong_series_id:c=>{c.raw.facts[4].value.descriptiveFacts.entries.find(row=>row.key==='tmdb_series_id').value='550';},
  wrong_season_number:c=>{c.raw.facts[4].value.descriptiveFacts.entries.find(row=>row.key==='season_number').value=3;},
  wrong_episode_number:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries.find(row=>row.key==='episode_number').value=1;},
  duplicate_field:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries.push({key:'episode_title',value:'Duplicate'});},
  empty_title:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries.find(row=>row.key==='episode_title').value=' ';},
  absent_plot:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries=c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries.filter(row=>row.key!=='episode_plot');},
  xml_control:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries[0].value='bad\u0000text';},
  xml_surrogate:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries[0].value='bad\ud800text';},
  oversized:c=>{c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries[0].value='界'.repeat(100000);},
  duplicate_actor_identity:c=>{c.raw.facts[5].value.relations[0].providerIdentities.push({...c.raw.facts[5].value.relations[0].providerIdentities[0]});},
};
for(const [name,mutate] of Object.entries(mutations))test('Series NFO refuses '+name+' instead of borrowing other facts',()=>{
  const c=fixture();mutate(c);assert.throws(()=>renderSeriesAftercareNfo(c,'three'));
});
test('Series NFO escapes actor and Episode text while accepting valid Unicode',()=>{
  const c=fixture();c.raw.facts[5].value.relations[0].displayName='演员 🎬 & <Guest> "One"';
  c.raw.facts[4].value.episodeMetadata[0].descriptiveFacts.entries[0].value="剧集 '三'";
  const xml=renderSeriesAftercareNfo(c,'three').bytes.toString();
  assert.match(xml,/<title>剧集 &apos;三&apos;<\/title>/);
  assert.match(xml,/<name>演员 🎬 &amp; &lt;Guest&gt; &quot;One&quot;<\/name>/);
});
