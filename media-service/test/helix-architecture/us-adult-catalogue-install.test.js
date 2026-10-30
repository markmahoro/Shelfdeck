'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {createGeneration,MEMBER_NAMES}=require('../../src/helix/contracts/face-catalogue-generation');
const {installUsAdultCatalogue,installedCatalogueRoot,catalogueLooksInstalled,INSTALL_FAILED}=
  require('../../src/helix/integrations/us-adult-catalogue-install');
const {createBuffaloFaceCatalogue}=require('../../src/helix/integrations/buffalo-face-catalogue');
const {catalogueSearchPolicy}=require('../../src/helix/contracts/face-catalogue-search-policy');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const linux={skip:process.platform!=='linux'?'Linux catalogue install requires Linux.':false};

function packageFixture({wal=true}={}){
  const Database=require('better-sqlite3'),root=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-catalogue-pkg-'));
  const database=new Database(path.join(root,'performers.db'));
  if(wal)database.pragma('journal_mode=WAL');
  database.exec('CREATE TABLE performers(id INTEGER PRIMARY KEY,canonical_name TEXT); CREATE TABLE faces(embedding_index INTEGER PRIMARY KEY,performer_id INTEGER,source_endpoint TEXT); CREATE TABLE stashbox_ids(performer_id INTEGER,endpoint TEXT,stashbox_performer_id TEXT,PRIMARY KEY(endpoint,stashbox_performer_id)); CREATE TABLE performer_urls(performer_id INTEGER,source_endpoint TEXT,url_type TEXT);');
  database.prepare('INSERT INTO performers VALUES(1,?)').run('Actor A');
  database.prepare('INSERT INTO faces VALUES(0,1,?)').run('stashdb');
  database.prepare('INSERT INTO stashbox_ids VALUES(1,?,?)').run('stashdb','actor-a');
  if(wal)database.pragma('wal_checkpoint(TRUNCATE)');
  database.close();
  const uid='stashdb.org:actor-a';
  const values={'aliases.json':{[uid]:['Alias A']},'faces.json':[uid,null],'face_yaw.json':[60,null],
    'performer_links.json':[[uid]],'performers.json':{[uid]:{name:'Actor A'}}};
  for(const [name,value]of Object.entries(values))fs.writeFileSync(path.join(root,name),JSON.stringify(value));
  fs.writeFileSync(path.join(root,'face_embeddings.usearch'),'controlled-index-test');
  const members=MEMBER_NAMES.map(name=>{const bytes=fs.readFileSync(path.join(root,name));return {name,bytes:bytes.length,sha256:sha(bytes)};});
  const manifest=JSON.stringify({version:'fixture-v1',models:{embedding_dim:512},checksums:Object.fromEntries(members.map(x=>[x.name,'sha256:'+x.sha256]))});
  fs.writeFileSync(path.join(root,'manifest.json'),manifest);
  const generation=createGeneration({datasetVersion:'fixture-v1',manifestDigest:sha(manifest),members});
  fs.writeFileSync(path.join(root,'generation.json'),JSON.stringify(generation,null,2));
  return {root,generation};
}

test('installedCatalogueRoot is under ShelfDeck data',()=>{
  assert.equal(installedCatalogueRoot('/app/data'),path.resolve('/app/data/us-adult-catalogue'));
  assert.throws(()=>installedCatalogueRoot(''),{code:INSTALL_FAILED});
});

test('install converts WAL package to DELETE journal product data',linux,()=>{
  const Database=require('better-sqlite3'),pkg=packageFixture({wal:true});
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-data-'));
  const target=installedCatalogueRoot(dataDir);
  try{
    const result=installUsAdultCatalogue({sourceRoot:pkg.root,targetRoot:target,Database});
    assert.equal(result.journalMode,'delete');
    assert.equal(catalogueLooksInstalled(target),true);
    assert.ok(fs.existsSync(path.join(target,'generation.json')));
    const mode=new Database(path.join(target,'performers.db'),{readonly:true}).pragma('journal_mode',{simple:true});
    assert.equal(String(mode).toLowerCase(),'delete');
    assert.equal(fs.existsSync(path.join(target,'performers.db-wal')),false);
    assert.equal(fs.existsSync(path.join(target,'performers.db-shm')),false);
  }finally{
    fs.rmSync(pkg.root,{recursive:true,force:true});
    fs.rmSync(dataDir,{recursive:true,force:true});
  }
});

test('installed DELETE catalogue loads through RO bind without temp-copy',linux,async t=>{
  const unshare=spawnSync('unshare',['-rm','true'],{encoding:'utf8'});
  if(unshare.status!==0){t.skip('user-namespace RO bind requires unshare -rm');return;}
  const Database=require('better-sqlite3'),pkg=packageFixture({wal:true});
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-data-'));
  const target=installedCatalogueRoot(dataDir);
  t.after(()=>{fs.rmSync(pkg.root,{recursive:true,force:true});fs.rmSync(dataDir,{recursive:true,force:true});});
  installUsAdultCatalogue({sourceRoot:pkg.root,targetRoot:target,Database});
  const generation=JSON.parse(fs.readFileSync(path.join(target,'generation.json'),'utf8'));
  class Index{view(){}size(){return 2;}dimensions(){return 512;}
    search(){return {keys:BigUint64Array.from([0n,1n]),distances:Float32Array.from([0.1,0.2])};}}
  const mount=fs.mkdtempSync(path.join(os.tmpdir(),'us-adult-installed-ro-'));
  t.after(()=>fs.rmSync(mount,{recursive:true,force:true}));
  const probe=path.join(dataDir,'probe.js');
  fs.writeFileSync(probe,`'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execSync}=require('node:child_process');
const {createBuffaloFaceCatalogue}=require(${JSON.stringify(require.resolve('../../src/helix/integrations/buffalo-face-catalogue'))});
const {catalogueSearchPolicy}=require(${JSON.stringify(require.resolve('../../src/helix/contracts/face-catalogue-search-policy'))});
const source=process.argv[2],mount=process.argv[3],generation=JSON.parse(process.argv[4]);
execSync('mount --bind '+JSON.stringify(source)+' '+JSON.stringify(mount),{stdio:'inherit'});
execSync('mount -o remount,ro,bind '+JSON.stringify(mount),{stdio:'inherit'});
let copied=false; const real=fs.copyFileSync; fs.copyFileSync=(...a)=>{copied=true;return real(...a);};
const Database=require('better-sqlite3');
class Index{view(){}size(){return 2;}dimensions(){return 512;}
  search(){return {keys:BigUint64Array.from([0n,1n]),distances:Float32Array.from([0.1,0.2])};}}
const catalogue=createBuffaloFaceCatalogue({root:mount,generation,searchPolicy:catalogueSearchPolicy(),Database,usearch:{Index}});
catalogue.load({deadlineAtMs:Date.now()+5000}).then(()=>{
  const vector=Array(512).fill(0);vector[0]=1;
  assert.equal(catalogue.search(vector).matches[0].name,'Actor A');
  assert.equal(copied,false);
  catalogue.close();process.exit(0);
}).catch(error=>{console.error(error);process.exit(1);});
`);
  const result=spawnSync('unshare',['-rm',process.execPath,probe,target,mount,JSON.stringify(generation)],{
    encoding:'utf8',timeout:30000,cwd:path.resolve(__dirname,'../..'),
    env:{...process.env,NODE_PATH:path.resolve(__dirname,'../../node_modules')},
  });
  assert.equal(result.status,0,(result.stderr||'')+(result.stdout||''));
});
