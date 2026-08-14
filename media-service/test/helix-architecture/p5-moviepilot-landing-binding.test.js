'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  buildMoviePilotLandingBinding,
} = require('../../src/helix/platform/application/moviepilot-landing-binding');
const landingAccess = require(
  '../../src/helix/integrations/moviepilot-landing-access-adapter'
);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-moviepilot-landing-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const landing = path.join(root, 'external-landing');
  const workspace = path.join(root, 'libra-workspace');
  const field = path.join(root, 'material-field');
  for (const item of [landing, workspace, field]) fs.mkdirSync(item);
  return { root, landing, workspace, field };
}

function build(roots, overrides = {}) {
  return buildMoviePilotLandingBinding({
    integrationId:'platform-integration-moviepilot',
    configRevision:1,
    probe:landingAccess.probe({
      settings:{
        providerRequestSaveRoot:'/downloads/shelfdeck',
        providerOrganizedRoot:'/organized/shelfdeck',
        shelfDeckVisibleRoot:roots.landing,
        ...overrides,
      },
      reservedRoots:[roots.workspace, roots.field],
      now:() => 1,
    }),
  });
}

test('same-volume separate Landing and Workspace roots are legal and map exact endpoint-relative locations', (t) => {
  const roots = fixture(t);
  const movie = path.join(roots.landing, 'Movie (2024)', 'Movie (2024).mkv');
  fs.mkdirSync(path.dirname(movie));
  fs.writeFileSync(movie, 'movie');
  const binding = build(roots);
  const location = 'Movie (2024)/Movie (2024).mkv';
  assert.equal(location, 'Movie (2024)/Movie (2024).mkv');
  assert.equal(landingAccess.resolve(binding, location), fs.realpathSync.native(movie));
  assert.equal(binding.accessMode, 'provider_rw_shelfdeck_ro');
  assert.equal(fs.statSync(roots.landing).dev, fs.statSync(roots.workspace).dev);
});

test('same, nested, and later registered roots cannot overlap External Landing', (t) => {
  const roots = fixture(t);
  assert.throws(() => landingAccess.probe({
    settings:{ providerRequestSaveRoot:'/downloads', providerOrganizedRoot:'/organized',
      shelfDeckVisibleRoot:roots.landing },
    reservedRoots:[roots.landing], now:() => 1,
  }), { code:'PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP' });
  assert.throws(() => landingAccess.probe({
    settings:{ providerRequestSaveRoot:'/downloads', providerOrganizedRoot:'/organized',
      shelfDeckVisibleRoot:roots.landing },
    reservedRoots:[path.join(roots.landing, 'nested')], now:() => 1,
  }), { code:'PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP' });
  const binding = build(roots);
  assert.throws(() => landingAccess.assertRootDoesNotOverlap(binding,
    path.join(roots.landing, 'future-shelf')), {
    code:'PLATFORM_MOVIEPILOT_LANDING_ROOT_OVERLAP',
  });
});

test('provider and ShelfDeck locations fail closed on traversal or containment drift', (t) => {
  const roots = fixture(t);
  const binding = build(roots);
  assert.throws(() => landingAccess.resolve(binding, '../movie.mkv'), {
    code:'PLATFORM_MOVIEPILOT_LANDING_LOCATION_INVALID',
  });
});
