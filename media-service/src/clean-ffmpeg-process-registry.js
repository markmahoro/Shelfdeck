'use strict';

function createFfmpegProcessRegistry({ stopTimeoutMs = 5000 } = {}) {
  if (!Number.isSafeInteger(stopTimeoutMs) || stopTimeoutMs < 1)
    throw new TypeError('Process stop timeout must be a positive integer.');
  const children=new Set();
  const interrupted=new WeakSet();
  let closing=false;
  let stopped=false;
  let stopping=null;
  function register(child){
    if(!child||typeof child.kill!=='function')throw new TypeError('FFmpeg process registry requires a child process.');
    children.add(child);
    child.once?.('close',()=>children.delete(child));
    if(closing||stopped){interrupted.add(child);child.kill('SIGKILL');return false;}
    return true;
  }
  function unregister(child){children.delete(child);}
  function quiesce(){
    stopped=true;
    if(stopping)return stopping;
    const deadline=Date.now()+stopTimeoutMs;
    stopping=(async()=>{
      while(children.size){
        const active=[...children];
        await Promise.all(active.map(child=>new Promise((resolve,reject)=>{
          let settled=false;
          const finish=()=>{if(settled)return;settled=true;clearTimeout(timer);child.removeListener?.('close',finish);children.delete(child);resolve();};
          const timer=setTimeout(()=>{settled=true;child.removeListener?.('close',finish);reject(Object.assign(
            new Error('An owned media process did not confirm exit.'),{code:'CLEAN_MEDIA_PROCESS_STOP_TIMEOUT'}));},
          Math.max(1,deadline-Date.now()));
          child.once?.('close',finish);
          interrupted.add(child);
          try { child.kill('SIGKILL'); }
          catch(error){settled=true;clearTimeout(timer);child.removeListener?.('close',finish);reject(error);}
        })));
      }
    })().finally(()=>{stopping=null;});
    return stopping;
  }
  async function close(){closing=true;await quiesce();}
  function resume(){
    if(closing||stopping||children.size)throw Object.assign(new Error('Media processes are not ready to resume.'),
      {code:'CLEAN_MEDIA_PROCESS_RESUME_REFUSED'});
    stopped=false;
  }
  return Object.freeze({register,unregister,quiesce,resume,close,wasInterrupted:child=>interrupted.has(child),size:()=>children.size});
}

module.exports=Object.freeze({createFfmpegProcessRegistry});
