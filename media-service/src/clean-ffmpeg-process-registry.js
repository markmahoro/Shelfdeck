'use strict';

function createFfmpegProcessRegistry() {
  const children=new Set();
  const interrupted=new WeakSet();
  let closing=false;
  function register(child){
    if(!child||typeof child.kill!=='function')throw new TypeError('FFmpeg process registry requires a child process.');
    if(closing){interrupted.add(child);child.kill('SIGKILL');return false;}
    children.add(child);return true;
  }
  function unregister(child){children.delete(child);}
  async function close(){
    closing=true;
    const active=[...children];
    for(const child of active){interrupted.add(child);child.kill('SIGKILL');}
    await Promise.all(active.map((child)=>new Promise((resolve)=>{
      if(child.exitCode!==null||child.signalCode!==null)return resolve();
      const timer=setTimeout(resolve,5000);child.once('close',()=>{clearTimeout(timer);resolve();});
    })));
  }
  return Object.freeze({register,unregister,close,wasInterrupted:child=>interrupted.has(child),size:()=>children.size});
}

module.exports=Object.freeze({createFfmpegProcessRegistry});
