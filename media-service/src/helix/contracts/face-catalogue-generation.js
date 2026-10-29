'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {featureSpaceDigest}=require('./buffalo-model-reference');
const SCHEMA='helix://contracts/domain-types/FaceCatalogueGeneration/v1';
const MEMBER_NAMES=Object.freeze(['aliases.json','face_embeddings.usearch','face_yaw.json','faces.json','performer_links.json','performers.db','performers.json']);
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'}),text=()=>({type:'string',minLength:1,maxLength:256});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function fail(message){throw Object.assign(new TypeError(message),{code:'FACE_CATALOGUE_GENERATION_INVALID'});}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function schema(){return {$schema:'https://json-schema.org/draft/2020-12/schema',$id:SCHEMA,title:'FaceCatalogueGeneration@1',
  'x-helix-ssotRefs':['8.6.18'],'x-helix-role':'bounded-contract','x-helix-maxCanonicalBytes':8192,
  ...object({schemaRef:{const:SCHEMA},schemaVersion:{const:1},generationId:digest(),datasetId:{const:'stash-sense2-data'},
    datasetVersion:text(),manifestDigest:digest(),featureSpaceDigest:{const:featureSpaceDigest},dimension:{const:512},
    members:{type:'array',minItems:7,maxItems:7,items:object({name:{enum:MEMBER_NAMES},bytes:{type:'integer',minimum:1,maximum:4294967296},sha256:digest()})},generationDigest:digest()})};}
function assertGeneration(value){
  const {generationId,generationDigest,...body}=value||{},keys=Object.keys(schema().properties).sort().join(',');
  if(!value||Object.keys(value).sort().join(',')!==keys||value.schemaRef!==SCHEMA||value.schemaVersion!==1||value.datasetId!=='stash-sense2-data'||
    typeof value.datasetVersion!=='string'||!value.datasetVersion.trim()||value.datasetVersion.length>256||!/^[a-f0-9]{64}$/.test(value.manifestDigest||'')||
    value.featureSpaceDigest!==featureSpaceDigest||value.dimension!==512||!Array.isArray(value.members)||value.members.length!==7||
    value.members.some((item,i)=>!item||Object.keys(item).sort().join(',')!=='bytes,name,sha256'||item.name!==MEMBER_NAMES[i]||
      !Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>4294967296||!/^[a-f0-9]{64}$/.test(item.sha256||''))||
    value.members.reduce((sum,item)=>sum+item.bytes,0)>8589934592||Buffer.byteLength(canonicalJson(value))>8192||
    generationDigest!==canonicalDigest(body)||generationId!==canonicalDigest({schema:'shared.face-catalogue-generation-id@1',generationDigest}))
    fail('The catalogue generation, complete member set or buffalo feature space is invalid.');
  return value;
}
function createGeneration({datasetVersion,manifestDigest,members}){
  if(!Array.isArray(members)||members.some(item=>typeof item?.name!=='string'))fail('An explicit complete catalogue member set is required.');
  const body={schemaRef:SCHEMA,schemaVersion:1,datasetId:'stash-sense2-data',datasetVersion,manifestDigest,featureSpaceDigest,dimension:512,
    members:members.map(item=>({...item})).sort((a,b)=>Buffer.compare(Buffer.from(a.name||''),Buffer.from(b.name||'')))},generationDigest=canonicalDigest(body);
  return freeze(assertGeneration({...body,generationDigest,generationId:canonicalDigest({schema:'shared.face-catalogue-generation-id@1',generationDigest})}));
}
module.exports=Object.freeze({SCHEMA,MEMBER_NAMES,schema,createGeneration,assertGeneration});
