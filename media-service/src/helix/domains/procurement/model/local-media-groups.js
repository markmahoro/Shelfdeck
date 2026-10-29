'use strict';

const path = require('node:path');
const { canonicalDigest } = require('../../../contracts/canonical-json');

function episodeToken(name) {
  const patterns = [/(?:^|[ ._-])S(\d{1,2})E(\d{1,3})(?:E|-)?(\d{1,3})?(?=$|[ ._-])/i,
    /(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:-(\d{1,3}))?(?=$|[ ._-])/i,
    /(?:^|[ ._-])第(\d{1,3})集(?=$|[ ._-])/i];
  for (let index=0; index<patterns.length; index++) {
    const match = name.match(patterns[index]); if (!match) continue;
    const season = index === 2 ? null : Number(match[1]);
    const start = Number(index === 2 ? match[1] : match[2]);
    const end = Number(index === 2 ? match[1] : match[3] || match[2]);
    if (end < start || end - start + 1 > 32) return null;
    return { season, episodes:Array.from({length:end-start+1}, (_,offset) => start+offset) };
  }
  return null;
}

function seriesTitleFrom(context, temporaryLabel) {
  const stem = context.baseName.replace(/\.[^.]+$/, '');
  const match = stem.match(/(?:^|[ ._-])(?:S\d{1,2}E\d{1,3}(?:E|-)?\d{0,3}|\d{1,2}x\d{1,3}(?:-\d{1,3})?|第\d{1,3}集)(?=$|[ ._-])/i);
  const title = (match ? stem.slice(0,match.index) : stem).replace(/[ ._-]+$/g,'').trim();
  const ancestors = (context.parentSegments || []).filter(segment => segment !== '.' &&
    !/^(?:season[ ._-]*\d+|s\d{1,2}|第\d+季)$/i.test(segment));
  return title || ancestors.at(-1) || temporaryLabel;
}

function localSeriesGroup(context) {
  const token = episodeToken(context.baseName);
  if (!token) return null;
  const claim = { schema:'procurement.local-series-group@1',
    claimedTitle:seriesTitleFrom(context, context.baseName), seasonNumber:token.season,
    provisionalParent:token.season === null ? context.parentSegments : null };
  return Object.freeze({ ...claim, groupDigest:canonicalDigest(claim) });
}

function localContext(relativeLocation) {
  return { baseName:path.posix.basename(relativeLocation),
    parentSegments:path.posix.dirname(relativeLocation).split('/').filter(Boolean) };
}

module.exports = Object.freeze({ episodeToken, seriesTitleFrom, localSeriesGroup, localContext });
