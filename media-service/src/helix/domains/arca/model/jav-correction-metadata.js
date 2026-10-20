'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {buildJavCorrectionProposal}=require('./jav-identity-correction');
const {analyzeMovieNfo,attribute,childText,directText}=require('../../../contracts/movie-nfo-document');
const {javActorHints}=require('../../../contracts/jav-actor-policy');
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_METADATA_INVALID'});};
const escape=value=>String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function validateProposal(basis,proposal) {
  const expected=buildJavCorrectionProposal({basis,...proposal?.sourceQualification});
  if(canonicalJson(expected)!==canonicalJson(proposal))fail('Correction metadata requires its exact same-site immutable proposal.');
  return expected;
}
function buildJavCorrectionMetadata({correctionId,admissionDigest,basis,proposal}) {
  validateProposal(basis,proposal);
  if(typeof correctionId!=='string'||!/^arca-jav-correction-[a-f0-9]{40}$/.test(correctionId)||!/^[a-f0-9]{64}$/.test(admissionDigest||''))
    fail('Correction metadata must retain its own durable admission.');
  const observation=proposal.sourceQualification.observation,
    body={schemaRef:'helix://contracts/application-types/ArcaJavCorrectionMetadataFact/v1',schemaVersion:1,
      correctionId,shelfEntryId:basis.shelfEntryId,admissionDigest,canonicalIdentityDigest:proposal.newIdentity.identityDigest,
      contentProfile:'jav',identityKind:'jav_code',javCode:proposal.newJavCode,
      descriptiveFacts:{entries:observation.descriptiveEntries.map(entry=>({...entry}))},peopleHints:observation.peopleHints.map(item=>structuredClone(item)),
      sourceQualification:structuredClone(proposal.sourceQualification)};
  if(Buffer.byteLength(canonicalJson(body))>128*1024)fail('Correction metadata exceeds its bounded source scope.');
  return Object.freeze({...body,factDigest:canonicalDigest(body)});
}
function renderJavCorrectionNfo({basis,proposal}) {
  validateProposal(basis,proposal);
  const observation=proposal.sourceQualification.observation,entries=new Map(observation.descriptiveEntries.map(item=>[item.key,item.value]));
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<movie>',
    '  <title>'+escape(entries.get('title'))+'</title>',
    '  <uniqueid type="jav" default="true">'+escape(proposal.newJavCode)+'</uniqueid>'];
  for(const [field,tag] of [['plot','plot'],['release_date','premiered'],['studio','studio']]) {
    const value=entries.get(field);if(typeof value==='string'&&value.trim())lines.push('  <'+tag+'>'+escape(value)+'</'+tag+'>');
  }
  const genres=entries.get('genre');
  if(typeof genres==='string')for(const genre of [...new Set(genres.split(/[|;；]/).map(value=>value.trim()).filter(Boolean))])lines.push('  <genre>'+escape(genre)+'</genre>');
  for(const name of [...new Set(javActorHints(observation.peopleHints).map(item=>item.displayName))]) {
    if(typeof name!=='string'||!name.trim())continue;
    lines.push('  <actor>','    <name>'+escape(name)+'</name>','  </actor>');
  }
  lines.push('</movie>');const bytes=Buffer.from(lines.join('\n')+'\n','utf8');
  if(bytes.byteLength>128*1024)fail('Correction NFO exceeds its artifact byte budget.');
  return Object.freeze({bytes,renderDigest:canonicalDigest({schema:'arca.jav-correction-nfo-content@1',xml:bytes.toString('utf8')}),
    sourceObservationDigest:observation.observationDigest,proposalDigest:proposal.proposalDigest,rendererVersion:'arca.jav-correction-nfo@2'});
}
function verifyJavCorrectionNfo(bytes,{javCode,title}) {
  const document=analyzeMovieNfo(bytes),ids=document.usable?document.directChildren.filter(item=>item.name==='uniqueid'):[],
    titles=document.usable?document.directChildren.filter(item=>item.name==='title'):[];
  if(!document.usable||ids.length!==1||String(attribute(ids[0],'type')).toLowerCase()!=='jav'||childText(document,ids[0])!==javCode||
      titles.length!==1||directText(document,'title')!==title||document.directChildren.some(item=>item.name==='tmdbid'))
    throw Object.assign(new TypeError('Final NFO does not independently prove the exact selected JAV identity and title.'),{code:'ARCA_JAV_CORRECTION_NFO_INVALID'});
  return Object.freeze({javCode,title});
}
module.exports=Object.freeze({buildJavCorrectionMetadata,renderJavCorrectionNfo,verifyJavCorrectionNfo});
