'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createCleanMediaProbe, parseProbeResult } = require('../src/clean-media-probe');
const { createCleanMediaProductionEffectPort } = require('../src/clean-media-production-effect-port');

const ffmpeg = process.env.FFMPEG_PATH || require('ffmpeg-static');
const ffprobe = process.env.FFPROBE_PATH || require('@ffprobe-installer/ffprobe').path;
const delayedHeaderFixture = process.env.HELIX_DELAYED_HEADER_FIXTURE;

function delayedCodecFixture(root) {
  const location = path.join(root, 'late-headers.m2ts');
  const bytes = fs.readFileSync(delayedHeaderFixture);
  fs.writeFileSync(location, bytes);
  return location;
}

test('late transport-stream codec headers are observed and remuxed without altering source bytes',
  { skip:!delayedHeaderFixture && 'HELIX_DELAYED_HEADER_FIXTURE is required' }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-late-headers-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const source = delayedCodecFixture(root);
  const before = fs.readFileSync(source);
  const defaultProbe = spawnSync(ffprobe, ['-v', 'fatal', '-show_streams', '-of', 'json', source],
    { encoding:'utf8', windowsHide:true, timeout:20000 });
  const defaultVideo = JSON.parse(defaultProbe.stdout || '{}').streams?.find((stream) => stream.codec_type === 'video');
  t.diagnostic('Default FFprobe observed width: ' + (defaultVideo?.width || 'unavailable'));
  const probe = createCleanMediaProbe({ binary:ffprobe, discTopologyReader:{ async inspect() { return null; } } });
  const observed = await probe.probe({ location:source, identity:{ materialKey:'fixture-source' } });
  assert.equal(observed.resultKind, 'probed');
  assert.equal(observed.videoStreams[0].width, 1920);
  assert.equal(observed.videoStreams[0].height, 1080);
  assert.ok(observed.durationMs > 0);
  const output = path.join(root, 'output.mkv');
  const port = createCleanMediaProductionEffectPort({ ffmpegPath:ffmpeg, workspaceProductPort:{
    async materializeMedia(request) { await request.produce(output); return { output }; },
  } });
  t.after(() => port.close());
  await port.executeRemux({
    source:{ primaryMembers:[{ readHandle:{ location:source } }] }, productionIntent:{ intentDigest:'fixture-intent' },
    outputTarget:{ libraRunId:'fixture-run', workspaceId:'fixture-workspace', targetRelativePath:'output.mkv',
      effectScopeDigest:'fixture-effect', targetId:'fixture-target', targetDigest:'fixture-target-digest' },
    idempotencyKey:'fixture-remux',
  });
  const product = await probe.probe({ location:output, identity:{ materialKey:'fixture-product' } });
  assert.equal(product.container, 'matroska');
  assert.equal(product.videoStreams[0].width, 1920);
  assert.equal(product.videoStreams[0].height, 1080);
  assert.ok(product.durationMs > 0);
  assert.deepEqual(fs.readFileSync(source), before);
});

test('unobserved video dimensions fail technically instead of publishing invented dimensions', () => {
  assert.throws(() => parseProbeResult({ identity:{ materialKey:'fixture-source' } }, {
    code:0, stdout:JSON.stringify({ format:{ format_name:'mpegts' },
      streams:[{ index:0, codec_type:'video', codec_name:'h264', width:0, height:0 }] }),
  }, null),
    { code:'CLEAN_MEDIA_PROBE_INCOMPLETE' });
});
