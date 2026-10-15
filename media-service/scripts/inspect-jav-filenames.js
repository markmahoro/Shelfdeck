'use strict';
const fs=require('node:fs'),path=require('node:path');
const {identifyJavFilename}=require('../src/helix/domains/procurement/model/jav-filename-identity');
function inspectJavFilenames(root) {
  const absolute=path.resolve(root),rows=[],ignored={torrent:0,incomplete_download:0,other:0,symlink:0};
  function visit(directory) {
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
      const location=path.join(directory,entry.name);
      if(entry.isSymbolicLink()){ignored.symlink++;continue;}
      if(entry.isDirectory()){visit(location);continue;}
      if(!entry.isFile())continue;
      if(/\.torrent$/i.test(entry.name)){ignored.torrent++;continue;}
      if(/\.(?:xltd|part|download|crdownload)$/i.test(entry.name)){ignored.incomplete_download++;continue;}
      if(!/\.(?:mp4|mkv|wmv|avi|mov|m4v|ts|m2ts)$/i.test(entry.name)){ignored.other++;continue;}
      const stat=fs.statSync(location);rows.push({relativePath:path.relative(absolute,location).split(path.sep).join('/'),
        sizeBytes:stat.size,mtimeMs:stat.mtimeMs,...identifyJavFilename(entry.name)});
    }
  }
  visit(absolute);rows.sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
  return {schema:'procurement.jav-filename-inspection@1',scope:'filename_evidence_only',root:absolute,videoCount:rows.length,
    recognizedCount:rows.filter(row=>row.javCode).length,uniqueCodeCount:new Set(rows.map(row=>row.javCode).filter(Boolean)).size,
    multipartFileCount:rows.filter(row=>row.multipartPart).length,ignored,rows};
}
if(require.main===module) {
  const args=process.argv.slice(2),rootIndex=args.indexOf('--root'),outputIndex=args.indexOf('--output');
  if(rootIndex<0||!args[rootIndex+1]||args.some((arg,index)=>index!==rootIndex+1&&index!==outputIndex+1&&!['--root','--output'].includes(arg)))
    throw new Error('Usage: node scripts/inspect-jav-filenames.js --root <directory> [--output <new report.json>]');
  const root=path.resolve(args[rootIndex+1]),result=inspectJavFilenames(root);
  if(outputIndex>=0) {
    if(!args[outputIndex+1])throw new Error('Report output path is required.');
    const output=path.resolve(args[outputIndex+1]);
    if(output===root||output.startsWith(root+path.sep))throw new Error('Inspection reports must stay outside the inspected source directory.');
    fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}
module.exports=Object.freeze({inspectJavFilenames});
