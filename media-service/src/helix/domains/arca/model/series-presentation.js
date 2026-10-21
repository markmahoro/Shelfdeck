'use strict';

const path=require('node:path');
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {KINDS,assertSeriesPresentationBasis,seriesPresentationFileName:fileName}=require('../../../contracts/series-presentation-basis');
const {buildImageSource,assertImageSource}=require('../../../contracts/series-image-source');
const CAPS=Object.freeze({source:'arca.series_presentation.source.observe@1',assets:'arca.series_presentation.assets.prepare@1',
  publish:'arca.series_presentation.files.publish@1',commit:'arca.series_presentation.inventory.commit@1',reclaim:'arca.series_presentation.workspace.reclaim@1'});
const SCHEMA='helix://contracts/domain-types/SeriesPresentationScope/v1';
const MANIFEST_SCHEMA='helix://contracts/domain-types/SeriesPresentationManifest/v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const omit=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));

function packageSeriesBasis(packageValue){
  if(packageValue.productStructureSnapshot?.structureKind!=='season')return null;
  const identity=packageValue.resolvedIdentitySnapshot?.factValue;
  const providers=(identity?.resolvedProductIdentity||identity)?.providerIdentities?.filter(value=>value.namespace==='tmdb_series')||[];
  const facts=(packageValue.productFactManifest?.items||[]).filter(value=>value.factKind==='product_metadata'&&value.factValue?.seriesPresentationBasis);
  if(providers.length!==1||facts.length!==1)fail('ARCA_SERIES_PRESENTATION_BASIS_MISSING','Series delivery requires one exact show presentation basis.');
  return assertSeriesPresentationBasis(facts[0].factValue.seriesPresentationBasis,providers[0]);
}

function seriesScopeId(shelfId,providerKey){return 'arca-series-'+canonicalDigest({schema:'arca.series-presentation-identity@1',shelfId,provider:'tmdb',providerKey}).slice(0,40);}

function assertRootBinding({shelfRoot,rootLocation}){
  if(!path.isAbsolute(shelfRoot)||!path.isAbsolute(rootLocation))fail('ARCA_SERIES_ROOT_INVALID','Shared Series placement must use absolute scoped roots.');
  const relative=path.relative(path.resolve(shelfRoot),path.resolve(rootLocation));
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))
    fail('ARCA_SERIES_ROOT_INVALID','Shared Series root escapes its accepted Shelf.');
  return path.resolve(rootLocation);
}

function buildSeriesScope(value){
  const basis=assertSeriesPresentationBasis(value.basis),rootLocation=assertRootBinding(value),imageSourceQualification=assertImageSource(value.imageSourceQualification||basis.imageSourceQualification||buildImageSource(basis.sourceObservation)),supplementalSources=value.supplementalSources||[];
  if(imageSourceQualification.providerKey!==basis.sourceObservation.providerKey||supplementalSources.length>2||new Set(supplementalSources.map(item=>item.artifactKind)).size!==supplementalSources.length||supplementalSources.some(item=>item.scopeId!==value.scopeId))
    fail('ARCA_SERIES_SCOPE_INVALID','Shared image qualification changed its exact show or role.');
  if(value.scopeId!==seriesScopeId(value.shelfId,basis.sourceObservation.providerKey)||!value.buildId||
      !Number.isSafeInteger(value.revision)||value.revision<1||!Number.isSafeInteger(value.expectedVersion)||value.expectedVersion<0||
      !value.endpointId||!value.mountScopeId||!Array.isArray(value.existingMembers)||value.existingMembers.length>3)
    fail('ARCA_SERIES_SCOPE_INVALID','Shared Series scope requires a bounded immutable build and exact identity.');
  const existingMembers=[...value.existingMembers].sort((a,b)=>KINDS.indexOf(a.artifactKind)-KINDS.indexOf(b.artifactKind));
  if(new Set(existingMembers.map(member=>member.artifactKind)).size!==existingMembers.length||
      existingMembers.some(member=>!KINDS.includes(member.artifactKind)||member.location!==path.join(rootLocation,fileName(member.artifactKind))))
    fail('ARCA_SERIES_SCOPE_INVALID','Shared existing members do not cover unique exact root roles.');
  const files=value.sourceWorkspaceFiles||[];
  if(files.length>3||new Set(files.map(row=>row.artifactKind)).size!==files.length||files.some(row=>row.originBuildId===value.buildId||row.recipe.artifactKind!==row.artifactKind)||
      (files.length&&!value.supersedesBuildId)||value.supersedesBuildId===value.buildId)
    fail('ARCA_SERIES_SCOPE_INVALID','Recovery sources require bounded immutable predecessor files.');
  const body={schemaRef:SCHEMA,schemaVersion:1,objectId:value.buildId,revision:value.revision,scopeId:value.scopeId,
    shelfId:value.shelfId,endpointId:value.endpointId,mountScopeId:value.mountScopeId,shelfRoot:path.resolve(value.shelfRoot),
    rootLocation,expectedVersion:value.expectedVersion,basis,imageSourceQualification,supplementalSources,reassessmentProofDigest:value.reassessmentProofDigest??null,
    supersedesBuildId:value.supersedesBuildId??null,sourceWorkspaceFiles:value.sourceWorkspaceFiles||[],existingMembers,
    missingKinds:KINDS.filter(kind=>!existingMembers.some(member=>member.artifactKind===kind))};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}

function assertSeriesScope(value){
  const expected=buildSeriesScope({...value,buildId:value.objectId});
  if(canonicalJson(expected)!==canonicalJson(value))fail('ARCA_SERIES_SCOPE_INVALID','Shared Series execution scope changed.');
  return value;
}

function buildSharedManifest(scope,members){
  assertSeriesScope(scope);
  if(!Array.isArray(members)||members.length!==3||new Set(members.map(member=>member.artifactKind)).size!==3)
    fail('ARCA_SERIES_PRESENTATION_INCOMPLETE','Series root requires NFO, poster and fanart.');
  const ordered=[...members].sort((a,b)=>KINDS.indexOf(a.artifactKind)-KINDS.indexOf(b.artifactKind));
  for(const member of ordered){
    if(!KINDS.includes(member.artifactKind)||member.location!==path.join(scope.rootLocation,fileName(member.artifactKind))||
        !/^[a-f0-9]{64}$/.test(member.byteDigest)||!Number.isSafeInteger(member.sizeBytes)||member.sizeBytes<1||
        !member.physicalIdentity?.materialKey||member.endpointId!==scope.endpointId)
      fail('ARCA_SERIES_PRESENTATION_INCOMPLETE','Shared presentation lacks exact verified physical members.');
    if(member.artifactKind==='nfo'?member.nfoProviderKey!==scope.basis.sourceObservation.providerKey:
      !Number.isSafeInteger(member.width)||!Number.isSafeInteger(member.height)||member.width<1||member.height<1||
      (member.artifactKind==='poster'?member.height<=member.width:member.width<=member.height))
      fail('ARCA_SERIES_PRESENTATION_ROLE_INVALID','Shared presentation content does not match its exact Series role.');
  }
  const body={schemaRef:MANIFEST_SCHEMA,schemaVersion:1,objectId:scope.scopeId,revision:scope.expectedVersion+1,
    scopeId:scope.scopeId,buildId:scope.objectId,providerKey:scope.basis.sourceObservation.providerKey,
    rootLocation:scope.rootLocation,basisDigest:scope.basis.basisDigest,members:ordered};
  return Object.freeze({...body,digest:canonicalDigest(body)});
}

function assertSharedManifest(value){
  if(!value||value.schemaRef!==MANIFEST_SCHEMA||value.schemaVersion!==1||value.digest!==canonicalDigest(omit(value,'digest'))||
      !Number.isSafeInteger(value.revision)||value.revision<1||value.members?.length!==3||
      value.members.map(member=>member.artifactKind).join(',')!==KINDS.join(','))
    fail('ARCA_SERIES_MANIFEST_INVALID','Shared Series manifest is incomplete or changed.');
  return value;
}

module.exports=Object.freeze({CAPS,SCHEMA,MANIFEST_SCHEMA,packageSeriesBasis,seriesScopeId,assertRootBinding,
  buildSeriesScope,assertSeriesScope,fileName,buildSharedManifest,assertSharedManifest});
