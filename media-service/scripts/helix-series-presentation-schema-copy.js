'use strict';
const Database=require('better-sqlite3');
const {prepareSeriesPresentationSchemaCopy}=require('./helix-architecture/series-presentation-schema-copy');
function main(args){const values={};for(let i=0;i<args.length;i++){const flag=args[i];if(!['--source','--target','--rollback'].includes(flag)||Object.hasOwn(values,flag))throw new Error('Unsupported or repeated argument.');if(flag==='--rollback')values[flag]=true;else{const value=args[++i];if(!value||value.startsWith('--'))throw new Error('A path argument is required.');values[flag]=value;}}if(!values['--source']||!values['--target'])throw new Error('Supply exact --source and new --target snapshot paths.');return prepareSeriesPresentationSchemaCopy({Database,sourcePath:values['--source'],targetPath:values['--target'],rollback:Boolean(values['--rollback'])});}
if(require.main===module){try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n');}catch(error){process.stderr.write(JSON.stringify({error:{code:error.code||'SERIES_SCHEMA_COPY_FAILED',message:'Series presentation schema copy failed.',details:error.details||{}}})+'\n');process.exitCode=1;}}
module.exports=Object.freeze({main});
