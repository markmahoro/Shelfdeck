'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const serviceRoot=path.resolve(__dirname,'../..');
test('Windows distribution boots independently with its own native dependencies and refuses to overwrite an existing output',
  {skip:process.platform!=='win32',timeout:120000},async t=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-win-package-')),output=path.join(root,'service'),dataDir=path.join(root,'runtime');
    t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-win-package-'));
      assert.equal(fs.lstatSync(root).isSymbolicLink(),false);fs.rmSync(root,{recursive:true,force:true});});
    const packaged=spawnSync(process.execPath,['scripts/package-win.js','--output',output],{cwd:serviceRoot,encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:8*1024*1024});
    assert.equal(packaged.status,0,packaged.stdout+packaged.stderr);assert.equal(fs.existsSync(path.join(output,'data')),false);
    const code=String.raw`
      const assert=require('node:assert/strict'),path=require('node:path');
      (async()=>{const output=process.cwd(),secretRoot=process.env.SHELFDECK_SECRET_ROOT,dataDir=process.env.PACKAGE_TEST_DATA,
        initialized=require('./scripts/helix-operational-safety').initializeCleanData({dataDir,secretRoot,confirmation:'INITIALIZE_HELIX_CLEAN_V1'}),
        host=await require('./src/clean-service-host').createCleanServiceHost({dataDir,secretRoot,adminDistDir:path.join(output,'dist','admin')});
        try{await host.listen({host:'127.0.0.1',port:0});assert.equal((await host.inject({method:'GET',url:'/v1/health'})).statusCode,200);
          const login=await host.inject({method:'POST',url:'/v1/admin/session',headers:{'x-api-key':initialized.adminApiKey}});assert.equal(login.statusCode,204);
          for(const url of ['/v1/admin/collection','/v1/admin/formation','/v1/admin/settings/integrations/jav-javdb'])
            assert.equal((await host.inject({method:'GET',url,headers:{cookie:login.headers['set-cookie']}})).statusCode,200);
          assert.ok((await require('sharp')({create:{width:4,height:4,channels:3,background:'#376892'}}).jpeg().toBuffer()).length);
          for(const binary of [require('ffmpeg-static'),require('@ffprobe-installer/ffprobe').path])
            assert.equal(require('node:child_process').spawnSync(binary,['-version'],{windowsHide:true,timeout:10000}).status,0);
          assert.equal(Object.keys(require.cache).filter(file=>{const rel=path.relative(output,file);return rel.startsWith('..'+path.sep)||path.isAbsolute(rel);}).length,0);
          console.log(JSON.stringify({ok:true,tableCount:initialized.tableCount,routeCount:host.routeCount}));
        }finally{await host.close();}
      })().catch(error=>{console.error(error);process.exitCode=1;});`;
    const result=spawnSync(path.join(output,'node.exe'),['-e',code],{cwd:output,encoding:'utf8',windowsHide:true,timeout:45000,
      env:{...process.env,NODE_PATH:'',NODE_OPTIONS:'',SHELFDECK_SECRET_ROOT:crypto.randomBytes(48).toString('base64url'),PACKAGE_TEST_DATA:dataDir}});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{ok:true,tableCount:203,routeCount:147});
    const entryHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'src','server.js'))).digest('hex'),
      again=spawnSync(process.execPath,['scripts/package-win.js','--output',output],{cwd:serviceRoot,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.notEqual(again.status,0);assert.match(again.stderr,/output already exists/);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(output,'src','server.js'))).digest('hex'),entryHash);
    const forbidden=path.join(serviceRoot,'src','package-test-'+crypto.randomUUID()),nested=spawnSync(process.execPath,['scripts/package-win.js','--output',forbidden],
      {cwd:serviceRoot,encoding:'utf8',windowsHide:true,timeout:10000});
    assert.notEqual(nested.status,0);assert.match(nested.stderr,/cannot be nested/);assert.equal(fs.existsSync(forbidden),false);
    const alias=path.join(root,'alias');fs.symlinkSync(output,alias,'junction');
    try{const linked=spawnSync(process.execPath,['scripts/package-win.js','--output',path.join(alias,'new')],{cwd:serviceRoot,encoding:'utf8',windowsHide:true,timeout:10000});
      assert.notEqual(linked.status,0);assert.match(linked.stderr,/symbolic links or junctions/);assert.equal(fs.existsSync(path.join(output,'new')),false);
    }finally{fs.unlinkSync(alias);}
  });
