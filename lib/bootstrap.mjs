import path from 'node:path';
import {installationHome,locateInstallation} from './installation.mjs';
import {ensureDependency} from './dependencies.mjs';
import {installPortable} from '../scripts/install-portable.mjs';
import {doctor} from '../scripts/doctor.mjs';

export function parseInstall(args) {
 const out={};
 for(let i=0;i<args.length;i+=2) {
  const name={'--source':'source','--sha256':'manifestSha256'}[args[i]];
  if(!name || out[name] || !args[i+1])throw Error('Usage: k3-commander install --source ABSOLUTE_DIRECTORY --sha256 TRUSTED_MANIFEST_SHA256');
  out[name]=args[i+1];
 }
 if(!path.isAbsolute(out.source || '') || !/^[a-f0-9]{64}$/.test(out.manifestSha256 || ''))
  throw Error('An absolute source directory and trusted manifest SHA-256 are required');
 return out;
}
export async function bootstrapInstall(options,{home=installationHome(),ensure=ensureDependency,install=installPortable,check=doctor}={}) {
 const existing=await locateInstallation(home);
 if(existing) {
  if(existing.manifestSha256!==options.manifestSha256)throw Error('A different release is installed; upgrades require a separate reviewed operation');
  return {alreadyInstalled:true,...existing};
 }
 const search=await ensure('search',{home});
 const tunnel=await ensure('tunnel',{home});
 const env={...process.env};
 const pathKey=Object.keys(env).find(k=>k.toLowerCase()==='path') || 'PATH';
 env[pathKey]=path.dirname(search)+path.delimiter+(env[pathKey] || '');
 const result=await install({...options,home},{doctor:root=>check(root,{env})});
 return {...result,dependencies:{search,tunnel}};
}
