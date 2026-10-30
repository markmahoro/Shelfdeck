'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {catalogueSearchPolicy}=require('../../../contracts/face-catalogue-search-policy');
const {representativeImagePolicy}=require('../../../contracts/buffalo-representative-policy');
const {assertGeneration}=require('../../../contracts/face-catalogue-generation');
const {policy}=require('../model/us-adult-catalogue-assessment');

const UNAVAILABLE='US_ADULT_CATALOGUE_UNAVAILABLE';
const DEFAULT_BUFFALO_MODEL_ROOT=path.resolve(__dirname,'../../../../../resources/buffalo-models');
function fail(code,message,details){throw Object.assign(new Error(message),{code,details});}
function readJson(filePath,label){
  let raw;try{raw=fs.readFileSync(filePath,'utf8');}catch{fail(UNAVAILABLE,'The catalogue '+label+' file is not readable.',{filePath});}
  try{return JSON.parse(raw);}catch{fail(UNAVAILABLE,'The catalogue '+label+' file is not valid JSON.',{filePath});}
}
function defaultBuffaloModelRoot(options={}){
  const root=options.defaultBuffaloModelRoot||DEFAULT_BUFFALO_MODEL_ROOT;
  return typeof root==='string'&&root.trim()?path.resolve(root):DEFAULT_BUFFALO_MODEL_ROOT;
}
function resolveCatalogueHostConfiguration(options={}){
  const catalogueRoot=options.catalogueRoot||process.env.SHELFDECK_US_ADULT_CATALOGUE_ROOT||null,
    explicitBuffalo=options.buffaloModelRoot||process.env.SHELFDECK_BUFFALO_MODEL_ROOT||null,
    generationPath=options.catalogueGenerationPath||process.env.SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH||null,
    generationValue=options.catalogueGeneration||null;
  // Offline catalogue data is the enablement gate. Image-baked buffalo alone does not turn the path on.
  if(!catalogueRoot&&!generationPath&&!generationValue&&!explicitBuffalo)return null;
  if(!catalogueRoot||typeof catalogueRoot!=='string'||!catalogueRoot.trim())
    fail(UNAVAILABLE,'Catalogue recognition requires an explicit catalogueRoot (offline face-vector data volume).');
  const buffaloModelRoot=explicitBuffalo&&typeof explicitBuffalo==='string'&&explicitBuffalo.trim()
    ?explicitBuffalo:defaultBuffaloModelRoot(options);
  if(!buffaloModelRoot||typeof buffaloModelRoot!=='string'||!buffaloModelRoot.trim())
    fail(UNAVAILABLE,'Catalogue recognition requires the image-baked buffalo_l model root.');
  const resolvedRoot=path.resolve(catalogueRoot),resolvedModel=path.resolve(buffaloModelRoot);
  if(!fs.existsSync(resolvedRoot)||!fs.statSync(resolvedRoot).isDirectory())
    fail(UNAVAILABLE,'The configured catalogue root is missing or not a directory.',{catalogueRoot:resolvedRoot});
  if(!fs.existsSync(resolvedModel)||!fs.statSync(resolvedModel).isDirectory())
    fail(UNAVAILABLE,'The buffalo_l model root is missing or not a directory.',{buffaloModelRoot:resolvedModel});
  if(!generationValue&&!(generationPath&&typeof generationPath==='string'&&generationPath.trim()))
    fail(UNAVAILABLE,'Catalogue recognition requires catalogueGeneration or an explicit generation path.');
  const catalogueGeneration=assertGeneration(generationValue||readJson(path.resolve(generationPath),'generation'));
  const selectionPolicy=options.selectionPolicy||policy({maximumDistance:0.5,minimumDistanceMargin:0.05,
    minimumRepresentativeStrata:2,minimumCoverageStrata:3});
  const resourceBudget=options.resourceBudget||{cpuSlots:1,memoryBytes:2147483648,maximumFrames:40,maximumFacesPerFrame:32,
    maximumFrameBytes:10485760,maximumWorkspaceBytes:268435456,frameDeadlineMs:30000,imageDeadlineMs:60000,analysisDeadlineMs:900000};
  return Object.freeze({
    catalogueRoot:resolvedRoot,
    buffaloModelRoot:resolvedModel,
    catalogueConfiguration:Object.freeze({
      catalogueGeneration,
      catalogueSearchPolicy:catalogueSearchPolicy(),
      representativeImagePolicy:representativeImagePolicy(),
      clusterThreshold:options.clusterThreshold??0.6,
      clusterAmbiguityMargin:options.clusterAmbiguityMargin??0.05,
      selectionPolicy,
      resourceBudget,
    }),
  });
}
function assertCatalogueConfigured(options){
  if(options?.catalogueConfiguration&&typeof options.createCatalogueFramePort==='function'&&
    typeof options.createCatalogueObservationPort==='function'&&options.usAdultCatalogueStore)
    return options.catalogueConfiguration;
  fail(UNAVAILABLE,'US Adult western_adult Runs require a configured offline face-vector catalogue; Host did not wire catalogueRoot.');
}
module.exports=Object.freeze({UNAVAILABLE,DEFAULT_BUFFALO_MODEL_ROOT,defaultBuffaloModelRoot,
  resolveCatalogueHostConfiguration,assertCatalogueConfigured});
