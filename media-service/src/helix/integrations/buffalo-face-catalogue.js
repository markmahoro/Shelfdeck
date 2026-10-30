'use strict';
const crypto=require('node:crypto'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {canonicalJson,canonicalDigest}=require('../contracts/canonical-json');
const {assertGeneration}=require('../contracts/face-catalogue-generation');
const {assertCatalogueSearchPolicy}=require('../contracts/face-catalogue-search-policy');
const {verifyCatalogueGenerationFiles}=require('./face-catalogue-verification');
function fail(message,code='BUFFALO_CATALOGUE_INVALID'){throw Object.assign(new Error(message),{code});}
const OPEN_FAILED='BUFFALO_CATALOGUE_OPEN_FAILED';
const statDigest=stat=>canonicalDigest(Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs'].map(key=>[key,String(stat[key])])));
function isSqliteReadonlyOpenFailure(error){
  const code=typeof error?.code==='string'?error.code:'';
  return code==='SQLITE_CANTOPEN'||code.startsWith('SQLITE_CANTOPEN')||
    code==='SQLITE_READONLY'||code==='SQLITE_READONLY_DIRECTORY'||code.startsWith('SQLITE_READONLY');
}
function openReadonlyDatabase(Database,file){
  const db=new Database(file,{readonly:true,fileMustExist:true,timeout:1000});
  try{db.pragma('query_only=ON');}catch(error){try{db.close();}catch{}throw error;}
  return db;
}
function openPerformersDatabase(Database,root){
  const source=path.join(root,'performers.db');
  try{return {db:openReadonlyDatabase(Database,source),temporaryPath:null};}
  catch(error){if(!isSqliteReadonlyOpenFailure(error))throw error;}
  // WAL (and some other modes) cannot open in place on a read-only filesystem.
  // better-sqlite3 URI immutable=1 is unavailable here; copy once to a writable
  // temp and fail closed if that copy or open cannot complete.
  const temporaryRoot=fs.realpathSync(os.tmpdir());
  const temporaryPath=path.join(temporaryRoot,`shelfdeck-catalogue-performers-${process.pid}-${crypto.randomUUID()}.db`);
  try{
    fs.copyFileSync(source,temporaryPath);
    if(fs.statSync(source).size!==fs.statSync(temporaryPath).size)
      fail('The temporary performers.db copy lost bytes.',OPEN_FAILED);
    return {db:openReadonlyDatabase(Database,temporaryPath),temporaryPath};
  }catch(error){
    try{fs.unlinkSync(temporaryPath);}catch{}
    if(error?.code===OPEN_FAILED||error?.code==='BUFFALO_CATALOGUE_INVALID')throw error;
    fail('The catalogue performers database could not be opened on its read-only volume.',OPEN_FAILED);
  }
}
function createBuffaloFaceCatalogue({root,generation,searchPolicy,usearch=require('usearch'),Database=require('better-sqlite3')}={}){
  const reference=JSON.parse(canonicalJson(assertGeneration(generation))),policy=assertCatalogueSearchPolicy(searchPolicy);
  if(typeof root!=='string'||root!==path.resolve(root))fail('The exact catalogue resource root is required.');
  let db=null,temporaryDbPath=null,index=null,faces=null,yaws=null,aliases=null,groups=null,verification=null,loading=null,closed=false;
  const links=new Map();
  function close(){
    closed=true;if(db)try{db.close();}catch{}db=null;
    if(temporaryDbPath){try{fs.unlinkSync(temporaryDbPath);}catch{}temporaryDbPath=null;}
    index=null;faces=null;yaws=null;aliases=null;groups=null;verification=null;links.clear();
  }
  function fence(){
    if(closed||!verification)fail('The exact qualified catalogue generation is not loaded.');
    try{
      const rootStat=fs.lstatSync(root,{bigint:true});
      if(rootStat.isSymbolicLink()||!rootStat.isDirectory()||fs.realpathSync(root)!==root||statDigest(rootStat)!==verification.rootSnapshotDigest)throw Error('Root changed');
      for(const member of verification.verifiedMembers){
        const stat=fs.lstatSync(path.join(root,member.name),{bigint:true});
        if(!stat.isFile()||stat.isSymbolicLink()||statDigest(stat)!==member.statDigest)throw Error('Member changed');
      }
    }catch{fail('The resource generation changed after qualification.','FACE_CATALOGUE_FILES_CHANGED');}
  }
  function read(name,maximumBytes){
    const stat=fs.lstatSync(path.join(root,name));
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maximumBytes)fail('A catalogue mapping exceeds its qualified file budget.');
    return JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
  }
  function linkRoot(uid){
    let current=uid;const visited=[];
    while(links.has(current)&&links.get(current)!==current){visited.push(current);current=links.get(current);}
    for(const value of visited)links.set(value,current);
    return current;
  }
  async function load({deadlineAtMs,signal}={}){
    if(closed)fail('The catalogue resource is closed.');
    if(!loading)loading=(async()=>{
      try{
        verification=await verifyCatalogueGenerationFiles({root,generation:reference,deadlineAtMs,signal});fence();
        index=new usearch.Index({dimensions:512,metric:'cos'});index.view(path.join(root,'face_embeddings.usearch'));
        faces=read('faces.json',64*1024*1024);yaws=read('face_yaw.json',32*1024*1024);aliases=read('aliases.json',16*1024*1024);groups=read('performer_links.json',8*1024*1024);
        // USearch keys are sparse stable labels, not dense ordinals. Mapping arrays
        // cover the key space; their length is not the live vector count.
        if(index.dimensions()!==512||!Array.isArray(faces)||!faces.length||index.size()<1||index.size()>faces.length||!Array.isArray(yaws)||yaws.length!==faces.length||
          !aliases||typeof aliases!=='object'||Array.isArray(aliases)||!Array.isArray(groups))fail('The catalogue vector and mapping bounds differ.','BUFFALO_CATALOGUE_CARDINALITY_INVALID');
        for(const group of groups){
          if(!Array.isArray(group)||group.length>1024||group.some(uid=>typeof uid!=='string'||!uid||uid.length>256))fail('A catalogue identity link is invalid.');
          for(const uid of group){const a=linkRoot(group[0]),b=linkRoot(uid),first=Buffer.compare(Buffer.from(a),Buffer.from(b))<=0?a:b;links.set(a,first);links.set(b,first);}
        }
        for(const uid of links.keys())links.set(uid,linkRoot(uid));
        const opened=openPerformersDatabase(Database,root);db=opened.db;temporaryDbPath=opened.temporaryPath;fence();
        return Object.freeze({generationDigest:reference.generationDigest,policyDigest:policy.policyDigest,dimension:512,size:index.size(),verificationDigest:verification.verificationDigest});
      }catch(error){close();throw error;}
    })();
    const result=await loading;fence();return result;
  }
  function search(vector){
    fence();
    if(!index||!Array.isArray(vector)||vector.length!==512||vector.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...vector)-1)>1e-5)
      fail('A unit buffalo feature from this generation is required.');
    const result=index.search(Float32Array.from(vector),policy.queryCount,1),byUid=new Map(),raw=[],retiredSlots=[],
      lookup=db.prepare('SELECT p.id,p.canonical_name,f.source_endpoint FROM performers p JOIN faces f ON p.id=f.performer_id WHERE f.embedding_index=?'),
      stashbox=db.prepare('SELECT performer_id,endpoint FROM stashbox_ids WHERE endpoint=? AND stashbox_performer_id=?'),
      catalogueSource=db.prepare("SELECT 1 FROM performer_urls WHERE performer_id=? AND source_endpoint=? AND url_type='catalogue' LIMIT 1");
    if(!result||result.keys?.length!==result.distances?.length||result.keys.length>policy.queryCount)fail('The index returned an unbounded candidate set.');
    for(let i=0;i<result.keys.length;i++){
      const key=Number(result.keys[i]),distance=result.distances[i];
      if(!Number.isSafeInteger(key)||key<0||key>=faces.length||!Number.isFinite(distance)||distance< -1e-5||distance>2+1e-5)fail('An index key or distance is invalid.');
      const uid=faces[key],person=lookup.get(key),yaw=yaws[key];raw.push({key,distance});
      if(uid===null&&!person&&yaw===null){retiredSlots.push({key,reason:'explicit_null_catalogue_slot'});continue;}
      if(typeof uid!=='string'||!uid||uid.length>256||!person||typeof person.canonical_name!=='string'||!person.canonical_name.trim()||person.canonical_name.length>256)
        fail('An index face disagrees with its complete performer identity.');
      const colon=uid.indexOf(':'),prefix=uid.slice(0,colon),identifier=uid.slice(colon+1),
        domains={stashdb:'stashdb.org',theporndb:'theporndb.net',fansdb:'fansdb.cc',pmvstash:'pmvstash.org',javstash:'javstash.org'};
      let agrees=false;
      if(colon>0&&identifier&&prefix.includes('.')){
        const linked=stashbox.get(prefix.split('.')[0],identifier);
        agrees=Boolean(linked&&linked.performer_id===person.id&&(domains[linked.endpoint]||linked.endpoint+'.org')===prefix);
      }else if(colon>0&&prefix!=='local'&&/^[1-9][0-9]*$/.test(identifier)&&String(person.id)===identifier){
        agrees=person.source_endpoint===prefix||Boolean(catalogueSource.get(person.id,prefix));
      }
      if(!agrees)fail('The external catalogue UID does not belong to the face row performer.','BUFFALO_CATALOGUE_IDENTITY_INVALID');
      let confidence=Math.max(0,Math.min(1,1-distance));
      if(yaw!==null&&yaw!==undefined){if(!Number.isFinite(yaw))fail('A catalogue pose value is invalid.');const absolute=Math.min(Math.abs(yaw),90);if(absolute>45)confidence*=1-(absolute-45)/45*0.5;}
      const names=aliases[uid]||[];
      if(!Array.isArray(names)||names.length>256||names.some(x=>typeof x!=='string'||!x||x.length>256))fail('A catalogue performer has invalid bounded aliases.');
      const candidate={key,uid,identityKey:linkRoot(uid),name:person.canonical_name,distance,combinedDistance:1-confidence,aliases:[...names]};
      if(!byUid.has(uid)||candidate.combinedDistance<byUid.get(uid).combinedDistance)byUid.set(uid,candidate);
    }
    let matches=[...byUid.values()].sort((a,b)=>a.combinedDistance-b.combinedDistance).filter(x=>x.combinedDistance<=policy.maximumDistance).slice(0,policy.maximumResults);
    const present=new Map(matches.map(item=>[item.uid,item])),seen=new Set(),collapsed=[];
    for(const candidate of matches){
      if(seen.has(candidate.uid))continue;
      const group=groups.find(values=>values.includes(candidate.uid))||[candidate.uid],members=group.filter(uid=>present.has(uid));
      for(const uid of members)seen.add(uid);
      collapsed.push(members.map(uid=>present.get(uid)).reduce((a,b)=>a.combinedDistance<=b.combinedDistance?a:b));
    }
    matches=collapsed.sort((a,b)=>a.combinedDistance-b.combinedDistance).slice(0,policy.maximumResults);fence();
    return Object.freeze({generationDigest:reference.generationDigest,searchPolicyDigest:policy.policyDigest,raw,matches,retiredSlots});
  }
  return Object.freeze({load,search,close});
}
module.exports=Object.freeze({createBuffaloFaceCatalogue,OPEN_FAILED,isSqliteReadonlyOpenFailure});
