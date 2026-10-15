'use strict';
const {JAV_CODE_PATTERNS,JAV_ALIAS_RULES,buildJavQueryAnchor}=require('../../../contracts/jav-source-contracts');
function identifyJavFilename(name) {
  if(typeof name!=='string'||name.length>4096)return Object.freeze({javCode:null,multipartPart:null});
  const parts=new Set();
  const normalized=name.normalize('NFKC').replace(/[a-z]/g,char=>char.toUpperCase())
    .replace(/(?:(?<![A-Z0-9])CID[\s:=_-]+|\[CID\]\s*)([A-Z0-9]{2,64})(?![A-Z0-9])/g,' ')
    .replace(/\bFC2\s+(?:PPV\s+)?(?=[0-9])/g,'FC2-')
    .replace(/(?<=[0-9])(?:CH|C)(?=$|[.\s])/g,'')
    .replace(/(?<=[0-9])[-_ ]?([AB])(?=$|[.\s])/g,(_match,part)=>{parts.add(part);return '';});
  const matches=new Set();
  for(const pattern of [...Object.values(JAV_CODE_PATTERNS),...JAV_ALIAS_RULES.map(rule=>rule[0])]) {
    const expression=new RegExp('(?<![A-Z0-9_-])('+pattern.slice(1,-1)+')(?![A-Z0-9]|[-_][0-9])','g');
    for(const match of normalized.matchAll(expression)) {
      try{matches.add(buildJavQueryAnchor('jav_code',match[1]).javCode);}catch{}
    }
  }
  return Object.freeze({javCode:matches.size===1&&parts.size<=1?[...matches][0]:null,
    multipartPart:matches.size===1&&parts.size===1?[...parts][0]:null});
}
module.exports=Object.freeze({identifyJavFilename});
