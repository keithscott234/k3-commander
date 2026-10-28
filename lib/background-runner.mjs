import {spawn} from 'node:child_process';
import {readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireConnectionLock} from './connection-lock.mjs';
import {loadCredential,cleanEnvironment} from './background-credential.mjs';
export async function supervise({home,binary,args,key,retryMs=1000},deps={}){
 const folder=path.join(home,'background'),dir=path.join(home,'connection');
 const release=await acquireConnectionLock(dir,{recoverBackground:true});
 let stopping=false,child,timer,watch,attempt=0,resolveDone;
 const done=new Promise(r=>resolveDone=r);
 const state=async data=>{await writeFile(path.join(folder,'state.json'),JSON.stringify({pid:process.pid,updatedAt:new Date().toISOString(),...data}),{mode:0o600});};
 const stop=()=>{if(stopping)return;stopping=true;clearTimeout(timer);if(child){child.kill('SIGTERM');timer=setTimeout(()=>child?.kill('SIGKILL'),5000);}else resolveDone();};
 const start=async()=>{
  if(stopping)return resolveDone();
  attempt++;
  await state({state:'starting',attempt});
  await release.setChild('starting');
  if(stopping)return resolveDone();
  try{child=(deps.spawn||spawn)(binary,args,{shell:false,windowsHide:true,stdio:'ignore',env:{...cleanEnvironment(),CONTROL_PLANE_API_KEY:key}});}
  catch{await state({state:'retrying',attempt});timer=setTimeout(()=>start().catch(stop),retryMs);return;}
  let ended=false;
  const finish=async code=>{
   if(ended)return;ended=true;child=null;clearTimeout(timer);
   if(stopping)return resolveDone();
   await state({state:'retrying',attempt,lastExitCode:code});
   timer=setTimeout(()=>start().catch(stop),Math.min(retryMs*attempt,30000));
  };
  child.once('error',()=>{finish(null).catch(stop);});
  child.once('exit',code=>{finish(code).catch(stop);});
  if(child.pid)await release.setChild(child.pid);
  await state({state:'running',attempt,childPid:child.pid});
 };
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
 let polling=false;
 watch=setInterval(async()=>{if(polling)return;polling=true;try{await readFile(path.join(folder,'stop.request'));stop();}catch(e){if(e.code!=='ENOENT')stop();}finally{polling=false;}},250);
 try{await start();await done;}
 catch(error){stop();await done;throw error;}
 finally{clearInterval(watch);clearTimeout(timer);process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);try{await state({state:'stopped',attempt});}finally{await release();}}
}
async function main(){
 const home=process.argv[2];
 if(!home||!path.isAbsolute(home))throw Error('Invalid home');
 const folder=path.join(home,'background');
 const record=JSON.parse(await readFile(path.join(folder,'registration.json'),'utf8'));
 if(record.version!==1||record.home!==home)throw Error('Invalid background registration');
 try{await readFile(path.join(folder,'stop.request'));return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const key=await loadCredential(folder);
 const binary=path.join(home,'dependencies','tunnel-0.0.16',process.platform==='win32'?'tunnel-client.exe':'tunnel-client');
 await supervise({home,binary,args:['run','--profile','k3-commander','--profile-dir',path.join(home,'connection')],key});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Background connection stopped. Inspect status locally.');process.exitCode=1;});
