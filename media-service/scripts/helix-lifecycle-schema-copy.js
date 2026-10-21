'use strict';
const Database=require('better-sqlite3');
const operator=require('./helix-architecture/lifecycle-schema-copy');
function main(args){
 const values={};for(let i=0;i<args.length;i++){
   const flag=args[i];if(!['--source','--target','--inspect','--rollback'].includes(flag)||Object.hasOwn(values,flag))throw new Error('Unsupported or repeated argument.');
   if(['--inspect','--rollback'].includes(flag))values[flag]=true;
   else{const value=args[++i];if(!value||value.startsWith('--'))throw new Error('A path argument is required.');values[flag]=value;}
 }
 if(!values['--source']||Boolean(values['--inspect'])===Boolean(values['--target'])||values['--inspect']&&values['--rollback'])
   throw new Error('Supply --source and exactly one of --inspect or --target; --rollback requires --target.');
 const input={Database,sourcePath:values['--source']};
 return values['--inspect']?operator.inspectLifecycleSchemaSource(input):operator.prepareLifecycleSchemaCopy({...input,targetPath:values['--target'],rollback:Boolean(values['--rollback'])});
}
if(require.main===module){try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n');}
 catch(error){process.stderr.write(JSON.stringify({error:{code:error.code||'LIFECYCLE_SCHEMA_COPY_FAILED',message:'Lifecycle schema copy failed.',details:error.details||{}}})+'\n');process.exitCode=1;}}
module.exports=Object.freeze({main});
