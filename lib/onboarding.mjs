import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {installationHome,locateInstallation} from './installation.mjs';
import {autoInstall} from './auto-install.mjs';
import {preparePairing,tunnelId} from './pairing.mjs';
import {verifyEnrollment} from './enrollment.mjs';
import {askLocal} from './terminal-input.mjs';
export async function onboard({home=installationHome(),env=process.env,log=console.log}={},deps={}) {
 let installed=await (deps.locate || locateInstallation)(home);
 if(!installed) {
  log('Installing the verified K3 Commander release for this device.');
  await (deps.install || autoInstall)({home});
 }
 let paired=false,id;
 try {await readFile(path.join(home,'connection','device.json'));paired=true;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(!paired) {
  log('Create a separate tunnel for this device at https://platform.openai.com/settings/organization/tunnels');
  log('Use a dedicated runtime key with Tunnels Read + Use from https://platform.openai.com/settings/organization/api-keys');
  id=tunnelId(await (deps.ask || askLocal)('New device tunnel ID: '));

 }
 const nextEnv={...env};
 if(!nextEnv.CONTROL_PLANE_API_KEY && !nextEnv.OPENAI_API_KEY) {
  const key=await (deps.ask || askLocal)('Runtime API key (hidden; held only for this session): ',{secret:true});
  if(!key || /[\s\x00-\x1f]/.test(key))throw Error('Runtime key is empty or malformed');
  nextEnv.CONTROL_PLANE_API_KEY=key;
 }
 if(!paired) {
  log('Checking tunnel access before saving the local profile...');
  await (deps.verify || verifyEnrollment)({id,home,env:nextEnv});
  await (deps.pair || preparePairing)({id,home});
 }
 return nextEnv;
}
