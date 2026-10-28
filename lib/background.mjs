import {mkdir,readFile,writeFile,cp,rm,lstat} from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {installationHome,locateInstallation} from './installation.mjs';
import {acquireConnectionLock} from './connection-lock.mjs';
import {saveCredential,validKey} from './background-credential.mjs';
import {identity,unitText,windows,linux} from './background-platform.mjs';
import {askLocal} from './terminal-input.mjs';
const files=['background-runner.mjs','background-credential.mjs','background-platform.mjs','connection-lock.mjs'];
const actions=['enable','status','stop','reconnect','disable'];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function performBackground(args,deps={}){
 const log=deps.log||console.log,platform=deps.platform||process.platform,home=installationHome(deps);
 if(args.length!==1||!actions.includes(args[0])){log('Usage: k3-commander background enable|status|stop|reconnect|disable');return 2;}
 const action=args[0],folder=path.join(home,'background'),registration=path.join(folder,'registration.json');
 if(!['win32','linux'].includes(platform)){log('Background mode supports Windows and Linux only.');return 1;}
 const unitDir=path.join(deps.home||homedir(),'.config/systemd/user'),unitFile=path.join(unitDir,identity(home)+'.service');
 const runner=path.join(folder,'launcher','background-runner.mjs');
 const control=deps.control||(a=>platform==='win32'?windows(a,{home,runner}):linux(a,home));
 let record;
 try{record=JSON.parse(await readFile(registration,'utf8'));if(record.version!==1||record.home!==home)throw Error('Invalid registration');}
 catch(e){if(e.code!=='ENOENT'){log('Cannot validate background registration.');return 1;}}
 try{
  if(action==='enable'){
   if(record){log('Background startup is already configured. Use reconnect to start it.');return 0;}
   if(!await (deps.locate||locateInstallation)(home))throw Error('Install and pair this portable device first.');
   const device=JSON.parse(await readFile(path.join(home,'connection','device.json'),'utf8'));
   if(device.profile!=='k3-commander')throw Error('Portable pairing is invalid.');
   await lstat(path.join(home,'connection','k3-commander.yaml'));
   const release=await acquireConnectionLock(path.join(home,'connection'));
   let owned=false,unitOwned=false,registered=false;
   try{
    log(platform==='win32'?'Enable stores this device runtime key encrypted for your Windows user.':'Enable stores this device runtime key in a user-owned file (0600), not encrypted, inside a private directory (0700).');
    const env=deps.env||process.env;
    const key=validKey(env.CONTROL_PLANE_API_KEY||env.OPENAI_API_KEY||await (deps.ask||askLocal)('Runtime key for this device (hidden; saved locally): ',{secret:true}));
    await mkdir(folder,{mode:0o700});owned=true;
    await (deps.save||saveCredential)(folder,key,platform);
    await mkdir(path.join(folder,'launcher'),{mode:0o700});
    for(const f of files)await cp(fileURLToPath(new URL(f,import.meta.url)),path.join(folder,'launcher',f));
    await writeFile(registration,JSON.stringify({version:1,home,identity:identity(home),platform}),{flag:'wx',mode:0o600});
    if(platform==='linux'){
     await mkdir(unitDir,{recursive:true});
     await writeFile(unitFile,unitText(home,process.execPath,runner),{flag:'wx',mode:0o600});unitOwned=true;
    }
    await control('register');registered=true;
   }catch(e){
    if(registered)try{await control('remove');}catch{}
    if(unitOwned)await rm(unitFile,{force:true});
    if(owned)await rm(folder,{recursive:true,force:true});
    throw e;
   }finally{await release();}
   await control('start');
   log('Background startup registered and start requested. GPT connectivity remains unverified.');return 0;
  }
  if(!record){log('No portable background startup is configured in this installation.');return action==='status'?0:1;}
  if(record.platform!==platform)throw Error('Background registration belongs to another platform.');
  if(action==='status'){
   const result=await control('status');
   let state={state:'not observed'};
   try{state=JSON.parse(await readFile(path.join(folder,'state.json'),'utf8'));}catch{}
   log(JSON.stringify({identity:identity(home),osStatus:result.stdout.trim(),lastRunnerState:state.state,updatedAt:state.updatedAt,attempt:state.attempt,gptConnectivity:'unverified'}));return 0;
  }
  if(action==='reconnect'){
   await rm(path.join(folder,'stop.request'),{force:true});
   await control('start');log('Background connection start requested. Verify a GPT tool call.');return 0;
  }
  // Pause future startup first; then let the runner stop its child and release its lock.
  await control('pause');
  await writeFile(path.join(folder,'stop.request'),'stop',{mode:0o600});
  const lock=path.join(home,'connection','.k3-connection-lock');
  let released=false;
  for(let i=0;i<60;i++){
   try{await lstat(lock);}catch(e){if(e.code==='ENOENT'){released=true;break;}throw e;}
   await pause(250);
  }
  if(!released)throw Error('The connection has not released its lock. Background startup is paused; inspect locally before retrying.');
  if(action==='disable'){
   if(platform==='win32')await control('remove');
   else{await rm(unitFile);await control('remove');}
   await rm(folder,{recursive:true});
   log('Background startup and its saved credential removed. Pairing and installed engine preserved.');
  }else log('Background connection stopped and startup paused. Use background reconnect to resume.');
  return 0;
 }catch(e){
  // Native exceptions may contain credentials or process output.
  log('Background operation did not complete. Existing device identities were preserved. Inspect local task/service status before retrying.');
  return 1;
 }
}

export async function background(args,deps={}){
 if(args.length!==1||!actions.includes(args[0])||args[0]==='status')return performBackground(args,deps);
 let release;
 try{release=await acquireConnectionLock(installationHome(deps));}
 catch{(deps.log||console.log)('Cannot acquire the background operation lock. Check installation and concurrent commands.');return 1;}
 try{return await performBackground(args,deps);}finally{await release();}
}
