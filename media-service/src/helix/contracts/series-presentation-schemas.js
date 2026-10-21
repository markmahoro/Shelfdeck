'use strict';

const {seriesPresentationBasisSchema}=require('./series-presentation-basis');
const text=maxLength=>({type:'string',minLength:1,maxLength});
const digest=()=>({type:'string',pattern:'^[a-f0-9]{64}$'});
const integer=minimum=>({type:'integer',minimum});
const nullable=value=>({anyOf:[value,{type:'null'}]});
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const array=(items,minimum=0)=>({type:'array',minItems:minimum,maxItems:3,items});
const kind=()=>({enum:['nfo','poster','fanart']});
const type=(name,version=1)=>({$ref:'helix://contracts/types/'+name+'/v'+version});

function memberSchema(){return object({artifactKind:kind(),endpointId:text(256),location:text(4096),
  physicalIdentity:type('PhysicalMaterialIdentity',2),byteDigest:digest(),sizeBytes:integer(1),
  width:nullable(integer(1)),height:nullable(integer(1)),nfoProviderKey:nullable(text(128)),sourceDigest:digest()});}

function scopeSchema(){return object({schemaRef:{const:'helix://contracts/domain-types/SeriesPresentationScope/v1'},schemaVersion:{const:1},
  objectId:text(256),revision:integer(1),scopeId:text(256),shelfId:text(256),endpointId:text(256),mountScopeId:text(256),
  shelfRoot:text(4096),rootLocation:text(4096),expectedVersion:integer(0),basis:seriesPresentationBasisSchema(),
  existingMembers:array(memberSchema()),missingKinds:array(kind()),digest:digest()});}

function manifestSchema(){return object({schemaRef:{const:'helix://contracts/domain-types/SeriesPresentationManifest/v1'},schemaVersion:{const:1},
  objectId:text(256),revision:integer(1),scopeId:text(256),buildId:text(256),providerKey:text(128),rootLocation:text(4096),
  basisDigest:digest(),members:array(memberSchema(),3),digest:digest()});}

function recipeSchema(){return object({artifactKind:kind(),sourcePath:nullable(text(2048)),sourceByteDigest:nullable(digest()),
  byteDigest:digest(),sizeBytes:integer(1),width:nullable(integer(1)),height:nullable(integer(1)),nfoProviderKey:nullable(text(128))});}

function resultProperties(name){
  const common={scopeId:text(256),buildId:text(256),scopeDigest:digest()};
  if(name==='SeriesPresentationSourceObserved')return {...common,recipe:array(recipeSchema()),recipeDigest:digest()};
  if(name==='SeriesPresentationAssetsPrepared')return {...common,recipeDigest:digest(),artifacts:array(object({artifactKind:kind(),
    workspaceMaterialHandle:type('WorkspaceMaterialHandle'),artifactHandle:type('ArtifactHandle')}))};
  if(name==='SeriesPresentationFilesPublished')return {...common,manifest:manifestSchema()};
  if(name==='SeriesPresentationReady')return {...common,sharedVersion:integer(1),manifestDigest:digest(),verificationDigest:digest()};
  throw new TypeError('Unknown Series presentation Result.');
}

module.exports=Object.freeze({memberSchema,scopeSchema,manifestSchema,recipeSchema,resultProperties});
