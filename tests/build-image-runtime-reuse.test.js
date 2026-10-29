'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {consolidateRuntimeCopies,consolidateCanonicalRecipe,assertExportableLayerCount}=require('../scripts/build-image');
const root=path.resolve(__dirname,'..');

function destinations(lines) {
  return lines.flatMap(line=>{
    const parts=line.trim().split(/\s+/),target=parts.at(-1);
    return parts.slice(1,-1).map(source=>{
      const isDirectory=fs.statSync(path.join(root,source)).isDirectory();
      return {source,target:target.endsWith('/')&&!isDirectory?
        path.posix.join(target,path.posix.basename(source)):path.posix.normalize(target)};
    });
  }).sort((a,b)=>a.source.localeCompare(b.source));
}

test('runtime reuse retains all canonical copy destinations with bounded added layers',()=>{
  const recipe=fs.readFileSync(path.join(root,'media-service/Dockerfile'),'utf8')
    .split('FROM service-base AS service-runtime')[1];
  const copies=recipe.split(/\r?\n/).filter(line=>line.startsWith('COPY ')&&!line.startsWith('COPY --from='));
  const consolidated=consolidateRuntimeCopies(root,copies);
  assert.deepEqual(destinations(consolidated),destinations(copies));
  // Package files, Root sources, the Helix tree, two script destinations and
  // the separately preserved offline history evidence directory.
  assert.equal(consolidated.length,6);
  assert.ok(consolidated.includes('COPY media-service/src/helix ./src/helix'));
});

test('renamed destination remains an individual canonical COPY',()=>{
  const copies=['COPY media-service/src/server.js ./src/renamed.js',
    'COPY media-service/src/clean-service-host.js ./src/clean-service-host.js'];
  assert.deepEqual(destinations(consolidateRuntimeCopies(root,copies)),destinations(copies));
  assert.ok(consolidateRuntimeCopies(root,copies).includes(copies[0]));
});

test('standard builds consolidate canonical runtime sources without changing destinations or crossing build effects',()=>{
  const recipe=fs.readFileSync(path.join(root,'media-service/Dockerfile'),'utf8');
  const rendered=consolidateCanonicalRecipe(root,recipe);
  const copies=text=>text.split('FROM service-base AS service-runtime')[1].split(/\r?\n/)
    .filter(line=>line.startsWith('COPY ')&&!line.startsWith('COPY --from='));
  assert.deepEqual(destinations(copies(rendered)),destinations(copies(recipe)));
  assert.ok(copies(rendered).length<=10);
  const effects=text=>text.split(/\r?\n/).filter(line=>!line.startsWith('COPY media-service/'));
  assert.deepEqual(effects(rendered),effects(recipe));
  const ordered=['FROM service-base AS service-runtime','COPY media-service/src/server.js ./src/server.js',
    'RUN node ./src/server.js','COPY media-service/src/clean-service-host.js ./src/clean-service-host.js'].join('\n');
  const output=consolidateCanonicalRecipe(root,ordered);
  assert.ok(output.indexOf('src/server.js ./src/')<output.indexOf('RUN node'));
  assert.ok(output.indexOf('src/clean-service-host.js ./src/')>output.indexOf('RUN node'));
});

test('image export rejects a layer chain that cannot safely start on production overlay2',()=>{
  assert.doesNotThrow(()=>assertExportableLayerCount(96));
  for(const count of [0,97,127,NaN])assert.throws(()=>assertExportableLayerCount(count),/export budget/);
});
