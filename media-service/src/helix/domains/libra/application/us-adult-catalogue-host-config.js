'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {catalogueSearchPolicy}=require('../../../contracts/face-catalogue-search-policy');
const {representativeImagePolicy}=require('../../../contracts/buffalo-representative-policy');
const {assertGeneration}=require('../../../contracts/face-catalogue-generation');
const {policy}=require('../model/us-adult-catalogue-assessment');
const {INSTALLED_DIRNAME,GENERATION_FILE,catalogueLooksInstalled,installedCatalogueRoot}=
  require('../../../integrations/us-adult-catalogue-install');

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
function resolveBuiltinCatalogueRoot(options={}){
  const dataDir=options.dataDir||process.env.MEDIA_SERVICE_DATA_DIR||null;
  if(typeof dataDir!=='string'||!dataDir.trim())return null;
  const root=installedCatalogueRoot(dataDir);
  return catalogueLooksInstalled(root)?root:null;
}
function resolveCatalogueHostConfiguration(options={}){
  const explicitRoot=options.catalogueRoot||process.env.SHELFDECK_US_ADULT_CATALOGUE_ROOT||null,
    builtinRoot=resolveBuiltinCatalogueRoot(options),
    catalogueRoot=explicitRoot||builtinRoot||null,
    explicitBuffalo=options.buffaloModelRoot||process.env.SHELFDECK_BUFFALO_MODEL_ROOT||null,
    generationPath=options.catalogueGenerationPath||process.env.SHELFDECK_US_ADULT_CATALOGUE_GENERATION_PATH||null,
    generationValue=options.catalogueGeneration||null;
  // Offline catalogue data is the enablement gate. Image-baked buffalo alone does not turn the path on.
  if(!catalogueRoot&&!generationPath&&!generationValue&&!explicitBuffalo)return null;
  if(!catalogueRoot||typeof catalogueRoot!=='string'||!catalogueRoot.trim())
    fail(UNAVAILABLE,'Catalogue recognition requires the installed product catalogue under ShelfDeck data (or an explicit catalogueRoot).');
  const buffaloModelRoot=explicitBuffalo&&typeof explicitBuffalo==='string'&&explicitBuffalo.trim()
    ?explicitBuffalo:defaultBuffaloModelRoot(options);
  if(!buffaloModelRoot||typeof buffaloModelRoot!=='string'||!buffaloModelRoot.trim())
    fail(UNAVAILABLE,'Catalogue recognition requires the image-baked buffalo_l model root.');
  const resolvedRoot=path.resolve(catalogueRoot),resolvedModel=path.resolve(buffaloModelRoot);
  if(!fs.existsSync(resolvedRoot)||!fs.statSync(resolvedRoot).isDirectory())
    fail(UNAVAILABLE,'The configured catalogue root is missing or not a directory.',{catalogueRoot:resolvedRoot});
  if(!fs.existsSync(resolvedModel)||!fs.statSync(resolvedModel).isDirectory())
    fail(UNAVAILABLE,'The buffalo_l model root is missing or not a directory.',{buffaloModelRoot:resolvedModel});
  const defaultGenerationPath=path.join(resolvedRoot,GENERATION_FILE);
  if(!generationValue&&!(generationPath&&typeof generationPath==='string'&&generationPath.trim())&&!fs.existsSync(defaultGenerationPath))
    fail(UNAVAILABLE,'Catalogue recognition requires catalogueGeneration or generation.json under the installed catalogue.');
  const catalogueGeneration=assertGeneration(generationValue||readJson(
    path.resolve(generationPath&&String(generationPath).trim()?generationPath:defaultGenerationPath),'generation'));
  const selectionPolicy=options.selectionPolicy||policy({maximumDistance:0.5,minimumDistanceMargin:0.05,
    minimumRepresentativeStrata:2,minimumCoverageStrata:3});
  const resourceBudget=options.resourceBudget||{cpuSlots:1,memoryBytes:2147483648,maximumFrames:40,maximumFacesPerFrame:32,
    maximumFrameBytes:10485760,maximumWorkspaceBytes:268435456,frameDeadlineMs:30000,imageDeadlineMs:60000,analysisDeadlineMs:900000};
  return Object.freeze({
    catalogueRoot:resolvedRoot,
    buffaloModelRoot:resolvedModel,
    installedUnderData:Boolean(builtinRoot&&path.resolve(builtinRoot)===resolvedRoot&&!explicitRoot),
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
module.exports=Object.freeze({UNAVAILABLE,DEFAULT_BUFFALO_MODEL_ROOT,INSTALLED_DIRNAME,defaultBuffaloModelRoot,
  resolveCatalogueHostConfiguration,assertCatalogueConfigured,resolveBuiltinCatalogueRoot});
