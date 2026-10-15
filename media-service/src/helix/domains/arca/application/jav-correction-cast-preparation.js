'use strict';
const {buildJavCorrectionMetadata}=require('../model/jav-correction-metadata');
const {castQueries,buildJavCorrectionCast}=require('../model/jav-correction-cast');
function createJavCorrectionCastPreparation({resolveMediaCastReference,contractValidator}) {
  if(typeof resolveMediaCastReference!=='function'||!contractValidator)throw new TypeError('Correction cast preparation requires the public People reference query.');
  return Object.freeze({prepare(input) {
    const metadata=buildJavCorrectionMetadata(input);contractValidator.validate(metadata.schemaRef,metadata);
    const resolutions=castQueries(metadata).map(query=>({relationId:query.relationId,inputDigest:query.inputDigest,
      result:resolveMediaCastReference(query.input)})),value=buildJavCorrectionCast({...input,resolutions});
    contractValidator.validate(value.schemaRef,value);return value;
  }});
}
module.exports=Object.freeze({createJavCorrectionCastPreparation});
