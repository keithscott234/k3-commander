import {mkdir,cp,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {installationHome,locateInstallation} from './installation.mjs';
import {ensureDependency} from './dependencies.mjs';
const execute=promisify(execFile);
export function tunnelId(value) {
 if(!/^tunnel_[A-Za-z0-9]{16,64}$/.test(value || ''))throw Error('Supply the new device tunnel ID from OpenAI Platform');
 return value;
}
export function commandWord(value) {
 if(/[\x00-\x1f"\x7f]/.test(value))throw Error('Unsupported character in local command path');
 return '"'+value.replaceAll('\\','/')+'"';
}
export async function preparePairing({id,home=installationHome()},deps={}) {
 tunnelId(id);
 const installed=await (deps.locate || locateInstallation)(home);
 if(!installed)throw Error('Install the engine before pairing this device');
 const binary=await (deps.ensure || ensureDependency)('tunnel',{home});
 const folder=path.join(home,'connection');
 try {await mkdir(folder);}catch(error){if(error.code==='EEXIST')throw Error('This device already has connection setup; existing identity was preserved');throw error;}
 try {
  const launcher=path.join(folder,'launcher');await mkdir(launcher);
  for(const file of ['installation.mjs','portable-engine.mjs'])
   await cp(fileURLToPath(new URL(file,import.meta.url)),path.join(launcher,file));
  const command=[process.execPath,path.join(launcher,'portable-engine.mjs'),home].map(commandWord).join(' ');
  await (deps.execute || execute)(binary,['init','--profile','k3-commander','--profile-dir',folder,
   '--tunnel-id',id,'--mcp-command',command,'--health-listen-addr','127.0.0.1:0'],
   {timeout:15000,windowsHide:true,maxBuffer:1048576});
  await writeFile(path.join(folder,'device.json'),JSON.stringify({version:1,tunnelId:id,profile:'k3-commander'}),{flag:'wx',mode:0o600});
  return {profile:'k3-commander',profileDirectory:folder,tunnelId:id,
   next:'Set CONTROL_PLANE_API_KEY locally for this device, then run remote. The key is never stored by this setup.'};
 }catch {await rm(folder,{recursive:true,force:true});throw Error('Device setup failed; existing tunnels were not changed');}
}
