'use strict';
const Database=require('better-sqlite3');
const operator=require('./helix-architecture/us-adult-schema-copy');
function main(args){
  const values={};
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(!['--source','--target','--inspect','--rollback-check'].includes(flag)||Object.hasOwn(values,flag))
      throw Object.assign(new Error('Unsupported or repeated argument.'),{code:'US_SCHEMA_ARGUMENT_INVALID'});
    if(flag==='--inspect')values[flag]=true;
    else {const value=args[++index];if(!value||value.startsWith('--'))throw Object.assign(new Error('A path argument is required.'),{code:'US_SCHEMA_ARGUMENT_INVALID'});values[flag]=value;}
  }
  if(!values['--source']||[values['--target'],values['--inspect'],values['--rollback-check']].filter(Boolean).length!==1)
    throw Object.assign(new Error('Supply --source and exactly one of --target, --inspect or --rollback-check.'),{code:'US_SCHEMA_ARGUMENT_INVALID'});
  const input={Database,sourcePath:values['--source']};
  return values['--inspect']?operator.inspectUsAdultSchemaSource(input):values['--rollback-check']?
    operator.verifyUsAdultSchemaRollback({...input,upgradedPath:values['--rollback-check']}):operator.prepareUsAdultSchemaCopy({...input,targetPath:values['--target']});
}
if(require.main===module){try{process.stdout.write(JSON.stringify(main(process.argv.slice(2)),null,2)+'\n');}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code||'US_SCHEMA_COPY_FAILED',message:'US Adult schema preparation failed.',details:error.details||{}}})+'\n');process.exitCode=1;}}
module.exports=Object.freeze({main});
