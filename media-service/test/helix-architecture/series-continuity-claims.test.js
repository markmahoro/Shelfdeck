'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {explicitSeriesContinuityClaims:claims,mergeExplicitSeriesContinuityClaims:merge}=require('../../src/helix/domains/procurement/model/series-continuity-claims');
const input=(location,seasonNumber=1)=>({materialKey:'material',context:{fieldRelativeLocation:location},seasonNumber});
test('Explicit Series marker produces the canonical Provider Season tuple without deriving identity from title',()=>{
 const a=claims(input('Show {tmdb-series-1399}/Season 01/E01.mkv'))[0],b=claims(input('Renamed {tmdb-series-01399}/S01E03.mkv'))[0];
 assert.equal(a.claimKey,'series:1399:season:1');assert.equal(a.claimDigest,b.claimDigest);assert.notEqual(a.evidenceDigest,b.evidenceDigest);
 assert.notEqual(a.claimDigest,claims(input('Show {tmdb-series-1399}/S02E01.mkv',2))[0].claimDigest);
});
test('No marker, ambiguous namespaces, conflicting markers and invalid seasons cannot assert continuity',()=>{
 for(const path of ['Show/S01E01.mkv','Show {tmdb-1399}/S01E01.mkv','Show {tmdb-movie-1399}/S01E01.mkv',
  '{tmdb-series-1399}/{tmdb-series-invalid}/S01E01.mkv','{tmdb-series-1399}/{tmdb-series-1400/S01E01.mkv','Show {tmdb-series-0}/S01E01.mkv','{tmdb-series-1399}/{tmdb-series-1400}/S01E01.mkv'])assert.deepEqual(claims(input(path)),[]);
 for(const season of [0,null,-1,1.5])assert.deepEqual(claims(input('{tmdb-series-1399}/episode.mkv',season)),[]);
});
test('A Candidate marker must be explicitly consistent across every grouped member',()=>{
 const a={seasonContinuityClaims:claims(input('{tmdb-series-1399}/E01.mkv'))};
 const b={seasonContinuityClaims:claims(input('{tmdb-series-1399}/E02.mkv'))};
 assert.equal(merge([a,b]).length,1);
 assert.deepEqual(merge([a,{seasonContinuityClaims:[]}]),[]);
 assert.deepEqual(merge([a,{seasonContinuityClaims:claims(input('{tmdb-series-1400}/E02.mkv'))}]),[]);
});
