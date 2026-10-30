#!/usr/bin/env node
'use strict';
/**
 * Install a US Adult face-catalogue package into ShelfDeck product data.
 *
 * The package (stash-sense2 export with generation.json + seven members) is an
 * install input only. Runtime observe uses the installed DELETE-journal copy
 * under MEDIA_SERVICE_DATA_DIR/us-adult-catalogue — never a Docker :ro mount
 * and never a hot-path temp copy.
 *
 *   node scripts/install-us-adult-catalogue.js \
 *     --source /path/to/package \
 *     --target /app/data/us-adult-catalogue \
 *     --apply
 */
const path=require('node:path');
const {installUsAdultCatalogue,installedCatalogueRoot,INSTALL_FAILED}=
  require('../src/helix/integrations/us-adult-catalogue-install');

function parseArgs(argv){
  const out={source:'',target:'',dataDir:'',apply:false};
  for(let i=0;i<argv.length;i+=1){
    const arg=argv[i];
    if(arg==='--apply')out.apply=true;
    else if(arg==='--source')out.source=argv[++i]||'';
    else if(arg==='--target')out.target=argv[++i]||'';
    else if(arg==='--data-dir')out.dataDir=argv[++i]||'';
    else if(arg.startsWith('--source='))out.source=arg.slice('--source='.length);
    else if(arg.startsWith('--target='))out.target=arg.slice('--target='.length);
    else if(arg.startsWith('--data-dir='))out.dataDir=arg.slice('--data-dir='.length);
    else throw new Error('Unknown argument: '+arg);
  }
  if(!out.source)throw new Error('--source <catalogue-package-root> is required.');
  if(!out.target&&out.dataDir)out.target=installedCatalogueRoot(out.dataDir);
  if(!out.target)throw new Error('--target <installed-root> or --data-dir <ShelfDeck data> is required.');
  return out;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));
  const plan={sourceRoot:path.resolve(args.source),targetRoot:path.resolve(args.target),apply:args.apply};
  console.log(JSON.stringify({schema:'shelfdeck.us-adult-catalogue-install-plan@1',...plan},null,2));
  if(!args.apply){
    console.log('Dry run only. Re-run with --apply to install into ShelfDeck data.');
    return;
  }
  const result=installUsAdultCatalogue({sourceRoot:plan.sourceRoot,targetRoot:plan.targetRoot});
  console.log(JSON.stringify({schema:'shelfdeck.us-adult-catalogue-install-result@1',...result},null,2));
}

main().catch(error=>{
  console.error(JSON.stringify({error:{code:error.code||INSTALL_FAILED,message:error.message,details:error.details||null}},null,2));
  process.exitCode=1;
});
