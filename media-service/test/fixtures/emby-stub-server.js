'use strict';

const http = require('node:http');

const item = {
  Id: 'docker-auto-1',
  Name: 'Docker Automatic Movie',
  Type: 'Movie',
  Path: '/readonly/Docker Automatic Movie.mkv',
  PremiereDate: '2026-01-01T00:00:00.000Z',
  Genres: ['Drama'],
  ProviderIds: { Tmdb: '5252' },
  UserData: { Played: false, PlayCount: 0 },
  MediaSources: [{
    Path: '/readonly/Docker Automatic Movie.mkv', Size: 50000000, RunTimeTicks: 50000000, Bitrate: 4000000,
    MediaStreams: [
      { Type: 'Video', Codec: 'h264', Width: 640, Height: 360 },
      { Type: 'Audio', Codec: 'aac', DisplayTitle: 'AAC' },
    ],
  }],
};
let detailReads = 0;

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://stub');
  response.setHeader('content-type', 'application/json');
  if (url.pathname === '/System/Info') return response.end(JSON.stringify({ ServerName: 'Helix Stub', Version: '1.0.0' }));
  if (url.pathname === '/Users/user/Items') return response.end(JSON.stringify({ Items: [item], TotalRecordCount: 1 }));
  if (url.pathname === '/Users/user/Items/docker-auto-1') {
    detailReads += 1;
    const detail = JSON.parse(JSON.stringify(item));
    if (detailReads >= 3) detail.MediaSources[0].MediaStreams[0].Codec = 'hevc';
    return response.end(JSON.stringify(detail));
  }
  response.statusCode = 404;
  return response.end(JSON.stringify({ error: 'not found' }));
}).listen(8096, '0.0.0.0');
