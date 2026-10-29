'use strict';
const fs=require('node:fs'),path=require('node:path');
const policy=require('./parity-policy.json');
function fail(message){throw Object.assign(new Error(message),{code:'BUFFALO_CATALOGUE_INVALID'});}
function createCatalogue({root,usearch=require('usearch'),Database=require('better-sqlite3')}){
  let db=null,index=null,faces=null,yaws=null,aliases=null,groups=null,links=new Map();
  function read(name,maxBytes){
    const file=path.join(root,name),stat=fs.lstatSync(file);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxBytes)fail('An invalid catalogue member was supplied.');
    return JSON.parse(fs.readFileSync(file,'utf8'));
  }
  function load(){
    if(index)return;
    const manifest=read('manifest.json',65536);
    if(manifest.version!==policy.databaseVersion||manifest.models.embedding_dim!==512)fail('The pinned catalogue generation differs.');
    index=new usearch.Index({dimensions:512,metric:'cos'});
    index.view(path.join(root,'face_embeddings.usearch'));
    if(index.dimensions()!==512||index.size()<1)fail('The catalogue index has an invalid dimension or size.');
    faces=read('faces.json',64*1024*1024);
    yaws=read('face_yaw.json',32*1024*1024);
    aliases=read('aliases.json',16*1024*1024);
    groups=read('performer_links.json',8*1024*1024);
    if(!Array.isArray(faces)||!Array.isArray(yaws)||!Array.isArray(groups))fail('The catalogue mappings are invalid.');
    const linkRoot=uid=>{let current=uid;while(links.has(current)&&links.get(current)!==current)current=links.get(current);return current;};
    for(const group of groups){
      if(!Array.isArray(group)||group.some(uid=>typeof uid!=='string'||!uid))fail('A catalogue identity link is invalid.');
      for(const uid of group){
        const a=linkRoot(group[0]),b=linkRoot(uid),first=Buffer.compare(Buffer.from(a),Buffer.from(b))<=0?a:b;
        links.set(a,first);links.set(b,first);
      }
    }
    for(const uid of links.keys())links.set(uid,linkRoot(uid));
    db=new Database(path.join(root,'performers.db'),{readonly:true,fileMustExist:true,timeout:1000});
    db.pragma('query_only=ON');
  }
  function search(vector){
    if(!index)fail('The catalogue must be loaded before searching.');
    if(vector?.length!==512||Array.from(vector).some(value=>!Number.isFinite(value)))fail('A finite query vector is required.');
    if(vector.reduce((sum,value)=>sum+value*value,0)<1e-12)fail('A zero query vector is invalid.');
    const result=index.search(Float32Array.from(vector),100,1), byUid=new Map(), raw=[],retiredSlots=[];
    const lookup=db.prepare('SELECT p.id,p.canonical_name,p.gender FROM performers p JOIN faces f ON p.id=f.performer_id WHERE f.embedding_index=?');
    for(let i=0;i<result.keys.length;i++){
      const key=Number(result.keys[i]),distance=result.distances[i];
      if(!Number.isSafeInteger(key)||key<0||key>=faces.length||!Number.isFinite(distance))fail('An index key or distance is invalid.');
      const uid=faces[key];
      const person=lookup.get(key);
      raw.push({key,distance});
      if(uid===null&&!person&&yaws[key]===null){
        // The pinned dataset retains five graph slots whose identity
        // and yaw are null and whose SQLite face rows are absent. Preserve explicit
        // exclusion evidence, rather than inventing a person or hiding a broken mapping.
        retiredSlots.push({key,reason:'explicit_null_catalogue_slot'});continue;
      }
      if(!person||typeof uid!=='string'||!uid)fail('An index vector has no matching performer metadata.');
      const yaw=yaws[key];let confidence=Math.max(0,Math.min(1,1-distance));
      if(yaw!==null&&yaw!==undefined){
        if(!Number.isFinite(yaw))fail('A catalogue pose value is invalid.');
        const absolute=Math.min(Math.abs(yaw),90);
        if(absolute>45)confidence*=1-(absolute-45)/45*0.5;
      }
      const candidate={key,uid,name:person.canonical_name,gender:person.gender,distance,combinedDistance:1-confidence,aliases:aliases[uid]||[]};
      if(!byUid.has(uid)||candidate.combinedDistance<byUid.get(uid).combinedDistance)byUid.set(uid,candidate);
    }
    let matches=[...byUid.values()].sort((a,b)=>a.combinedDistance-b.combinedDistance)
      .filter(item=>item.combinedDistance<=policy.maximumDistance).slice(0,policy.maximumResults);
    // Match Sense's no-configured-endpoint case: collapse only explicit dataset links,
    // keep the smallest adjusted distance, and never infer links from equal names.
    const present=new Map(matches.map(item=>[item.uid,item])), seen=new Set(), collapsed=[];
    for(const candidate of matches){
      if(seen.has(candidate.uid))continue;
      const group=groups.find(values=>values.includes(candidate.uid))||[candidate.uid];
      const members=group.filter(uid=>present.has(uid));
      for(const uid of members)seen.add(uid);
      collapsed.push(members.map(uid=>present.get(uid)).reduce((a,b)=>a.combinedDistance<=b.combinedDistance?a:b));
    }
    matches=collapsed.sort((a,b)=>a.combinedDistance-b.combinedDistance).slice(0,policy.maximumResults);
    return {raw,matches,retiredSlots};
  }
  return Object.freeze({load,search,identityKey(uid){if(!index||typeof uid!=='string'||!uid)fail('A loaded catalogue identity is required.');return links.get(uid)||uid;},
    stats:()=>({size:index?.size(),dimension:index?.dimensions()}),close(){if(db)db.close();db=null;index=null;faces=null;yaws=null;aliases=null;groups=null;links=new Map();}});
}
module.exports=Object.freeze({createCatalogue});
