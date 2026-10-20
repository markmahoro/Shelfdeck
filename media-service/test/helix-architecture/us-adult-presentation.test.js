'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const sharp = require('sharp');
const { US_ADULT_PRESENTATION_VERSION, originalNameProvenance, buildUsAdultTitle, buildUsAdultName } = require('../../src/helix/contracts/us-adult-presentation');
const { renderUsAdultPoster, fitPosterText } = require('../../src/helix/integrations/us-adult-poster-renderer');

test('preserves the complete original stem and replaces only the actor prefix across refreshes', () => {
  const originalName = originalNameProvenance('Studio.2024-05-21.Scene.Title.1080p.HEVC.mp4');
  const first = buildUsAdultName({ actorName: 'Actor One', originalName, outputExtension: '.mkv' });
  const refreshed = buildUsAdultName({ actorName: 'Actor Two', originalName, outputExtension: '.mkv' });
  assert.equal(first.fileName, 'Actor One Studio.2024-05-21.Scene.Title.1080p.HEVC.mkv');
  assert.equal(refreshed.fileName, 'Actor Two Studio.2024-05-21.Scene.Title.1080p.HEVC.mkv');
  assert.equal(refreshed.originalName.provenanceDigest, first.originalName.provenanceDigest);
  assert.equal(refreshed.title.includes('Actor One'), false);
});

test('rejects missing provenance, path traversal and unrepresentable names without silent truncation', () => {
  assert.throws(() => originalNameProvenance('../video.mp4'), { code: 'US_ADULT_ORIGINAL_NAME_INVALID' });
  assert.throws(() => originalNameProvenance('C:\\video.mp4'), { code: 'US_ADULT_ORIGINAL_NAME_INVALID' });
  const originalName = originalNameProvenance('video.mp4');
  assert.throws(() => buildUsAdultName({ actorName: 'Actor', originalName: { ...originalName, originalFileName: 'changed.mp4' }, outputExtension: '.mkv' }),
    { code: 'US_ADULT_ORIGINAL_NAME_PROOF_INVALID' });
  assert.throws(() => buildUsAdultName({ actorName: 'A'.repeat(250), originalName, outputExtension: '.mkv' }), { code: 'US_ADULT_NAME_TOO_LONG' });
  assert.throws(() => buildUsAdultName({ actorName: '../Actor', originalName, outputExtension: '.mkv' }), { code: 'US_ADULT_ACTOR_NAME_INVALID' });
});

test('title projection does not invent an output extension when the actual container decides the filename budget', () => {
  const originalName=originalNameProvenance('x'.repeat(250)+'.mp4'),input={actorName:'A',originalName};
  assert.equal(Buffer.byteLength(buildUsAdultTitle(input).title),252);
  assert.equal(Buffer.byteLength(buildUsAdultName({...input,outputExtension:'.ts'}).fileName),255);
  assert.throws(()=>buildUsAdultName({...input,outputExtension:'.mkv'}),{code:'US_ADULT_NAME_TOO_LONG'});
});

test('renders all four large screenshots in a two-by-two grid without portrait or text overlap', async () => {
  const solid = background => sharp({ create: { width: 160, height: 90, channels: 3, background } }).png().toBuffer();
  const frames = await Promise.all(['#ff0000', '#00ff00', '#0000ff', '#ffff00'].map(solid));
  const result = await renderUsAdultPoster({ actorName: 'Actor & Name', originalTitle: 'Studio <Original> Title', portrait: await solid('#ffffff'), frames });
  const { data, info } = await sharp(result.bytes).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1000); assert.equal(info.height, 1500);
  assert.equal(result.version, US_ADULT_PRESENTATION_VERSION);
  assert.equal(result.version, 'us-adult-presentation@3');
  const pixel = (x, y) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]];
  for (const [index, [x, y]] of [[265, 465], [735, 465], [265, 1005], [735, 1005]].entries()) {
    assert.ok(pixel(x, y).every((value, channel) => Math.abs(value - expected[index][channel]) < 8));
  }
  // Landscape sources fill the tall tiles by cropping, without letterboxing.
  for (const [index, [left, top]] of [[40, 210], [510, 210], [40, 750], [510, 750]].entries()) {
    for (const [x, y] of [[left + 10, top + 10], [left + 440, top + 500]]) {
      assert.ok(pixel(x, y).every((value, channel) => Math.abs(value - expected[index][channel]) < 8));
    }
  }
  for (const [x,y] of [[20,20],[50,180],[500,500],[500,1480]]) {
    assert.ok(pixel(x,y).every((value,channel)=>Math.abs(value-[243,240,233][channel])<4));
  }
  assert.ok(pixel(920,1390).every(value=>value>245),'The small portrait belongs in the footer.');
});

test('fits actual wide glyphs, combining marks and XML characters within declared text bounds with visible truncation', async () => {
  const cases = ['亚历山德拉蒙哥马利阿尔伯特森示例姓名', 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
    'A & <B> "C" e\u0301 ' .repeat(80), '这是一部用于审核海报布局的本地合成影片原始名称应完整可辨识且不被画布边缘直接截断'.repeat(8)];
  for (const text of cases) {
    for(const bounds of [
      {width:920,height:124,font:'sans bold 64',color:'#292b29'},
      {width:800,height:108,font:'sans 27',color:'#706d65'},
    ]){
      const result = await fitPosterText(text,bounds);
      const metadata = await sharp(result.bytes).metadata();
      assert.ok(metadata.width<=bounds.width); assert.ok(metadata.height<=bounds.height);
      if(result.truncated)assert.ok(result.text.endsWith('…'));
    }
  }
  const short = await fitPosterText('Alice Example', { width: 656, height: 128, font: 'sans bold 52', color: '#ffffff' });
  assert.equal(short.text, 'Alice Example'); assert.equal(short.truncated, false);
});
