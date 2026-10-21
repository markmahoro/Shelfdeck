'use strict';
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const text=maxLength=>({type:'string',minLength:1,maxLength}),digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
function referenceSetSchema(){return object({schema:{const:'shelfdeck.series-source-references@1'},fieldId:text(256),accessRevision:{type:'integer',minimum:1},fieldRoot:text(4096),sourceRoot:text(4096),observationDigest:digest,
  references:{type:'array',maxItems:3,minItems:1,items:object({artifactKind:{enum:['nfo','poster','fanart']},endpointId:text(256),location:text(4096),physicalIdentity:{$ref:'helix://contracts/types/PhysicalMaterialIdentity/v2'},entryDigest:digest})},sourceSetDigest:digest});}
function qualifiedSchema(){return object({schema:{const:'shelfdeck.series-qualified-local-source@1'},providerKey:{type:'string',pattern:'^[0-9]+$'},referenceSet:referenceSetSchema(),nfoByteDigest:digest,qualificationDigest:digest});}
function buildReferenceSet(body){const value={schema:'shelfdeck.series-source-references@1',...body};return assertReferenceSet({...value,sourceSetDigest:canonicalDigest(value)});}
function assertReferenceSet(value){const {sourceSetDigest,...body}=value||{};
  if(!value||value.schema!=='shelfdeck.series-source-references@1'||sourceSetDigest!==canonicalDigest(body)||!Array.isArray(value.references)||value.references.length<1||value.references.length>3||new Set(value.references.map(row=>row.artifactKind)).size!==value.references.length||
    canonicalJson(Object.keys(value).sort())!==canonicalJson(Object.keys(referenceSetSchema().properties).sort()))throw new TypeError('Invalid bounded show source references.');return value;}
function qualify(referenceSet,providerKey,nfoByteDigest){assertReferenceSet(referenceSet);const body={schema:'shelfdeck.series-qualified-local-source@1',providerKey,referenceSet,nfoByteDigest};return assertQualified({...body,qualificationDigest:canonicalDigest(body)});}
function assertQualified(value){const {qualificationDigest,...body}=value||{};if(!value||value.schema!=='shelfdeck.series-qualified-local-source@1'||!/^[0-9]+$/.test(value.providerKey)||!/^[a-f0-9]{64}$/.test(value.nfoByteDigest)||qualificationDigest!==canonicalDigest(body))throw new TypeError('Local show qualification changed.');assertReferenceSet(value.referenceSet);return value;}
module.exports=Object.freeze({referenceSetSchema,qualifiedSchema,buildReferenceSet,assertReferenceSet,qualify,assertQualified});
