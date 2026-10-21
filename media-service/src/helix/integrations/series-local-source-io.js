'use strict';
const path=require('node:path'),{createHash}=require('node:crypto');
const {canonicalDigest}=require('../contracts/canonical-json');
const {assertReferenceSet,assertQualified,qualify}=require('../contracts/series-local-source');
const {readBoundedFileSnapshotSync}=require('./bounded-material-fingerprint');
const {assertParents,nfoIdentity,physicalIdentity}=require('./series-presentation-io');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function readReference(set,reference){
  assertReferenceSet(set);const root=path.resolve(set.fieldRoot),source=path.resolve(set.sourceRoot),relative=path.relative(root,source);
  if(!path.isAbsolute(set.fieldRoot)||!path.isAbsolute(set.sourceRoot)||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||
    !path.isAbsolute(reference.location)||path.resolve(path.dirname(reference.location))!==source)throw Object.assign(new Error('Local show material escapes its frozen Field ancestor.'),{code:'SERIES_LOCAL_SOURCE_SCOPE_INVALID'});
  const names=reference.artifactKind==='nfo'?['tvshow.nfo']:['jpg','jpeg','png','webp'].map(ext=>reference.artifactKind+'.'+ext);
  if(!names.includes(path.basename(reference.location).toLowerCase()))throw new TypeError('Local show source role is invalid.');
  assertParents(root,reference.location);
  const snapshot=readBoundedFileSnapshotSync(reference.location,reference.artifactKind==='nfo'?256*1024:16*1024*1024,{requireStableSnapshot:true});
  if(physicalIdentity(snapshot,reference.physicalIdentity.mountScopeId).materialKey!==reference.physicalIdentity.materialKey)
    throw Object.assign(new Error('Local show source changed after observation.'),{code:'SERIES_LOCAL_SOURCE_CHANGED'});
  return snapshot.bytes;
}
function qualifyReferences(referenceSet,providerKey){
  if(!referenceSet)return null;const nfo=assertReferenceSet(referenceSet).references.find(row=>row.artifactKind==='nfo');if(!nfo)return null;
  try{const bytes=readReference(referenceSet,nfo);return nfoIdentity(bytes)===providerKey?qualify(referenceSet,providerKey,hash(bytes)):null;}
  catch(error){if(/^(ENOENT|SERIES_LOCAL_SOURCE_CHANGED|ARCA_SERIES_)/.test(error.code||''))return null;throw error;}
}
function readQualified(value,kind){
  assertQualified(value);const set=value.referenceSet,nfo=set.references.find(row=>row.artifactKind==='nfo'),bytes=readReference(set,nfo);
  if(hash(bytes)!==value.nfoByteDigest||nfoIdentity(bytes)!==value.providerKey)throw Object.assign(new Error('Local show association changed after qualification.'),{code:'SERIES_LOCAL_SOURCE_CHANGED'});
  const reference=set.references.find(row=>row.artifactKind===kind);if(!reference)return null;
  return {bytes:kind==='nfo'?bytes:readReference(set,reference),imagePath:'local:'+kind,sourceDigest:canonicalDigest(reference)};
}
module.exports=Object.freeze({qualifyReferences,readQualified,readReference});
