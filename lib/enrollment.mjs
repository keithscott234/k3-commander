import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ensureDependency} from './dependencies.mjs';
import {tunnelId} from './pairing.mjs';
export async function verifyEnrollment({id,home,env=process.env},{ensure=ensureDependency,execute=promisify(execFile)}={}) {
 tunnelId(id);
 const key=env.CONTROL_PLANE_API_KEY || env.OPENAI_API_KEY;
 if(!key || /[\s\x00-\x1f]/.test(key))throw Error('Runtime key is empty or malformed');
 const binary=await ensure('tunnel',{home});
 const childEnv={...env};
 for(const name of Object.keys(childEnv))if(/^(OPENAI_|CONTROL_PLANE_|K3_TUNNEL_)/i.test(name))delete childEnv[name];
 childEnv.CONTROL_PLANE_API_KEY=key;
 try {
  await execute(binary,['admin','--control-plane.base-url','https://api.openai.com','--json','tunnels','get',id],
   {env:childEnv,timeout:30000,maxBuffer:1048576,windowsHide:true,shell:false});
 }catch {
  throw Error('Could not verify this tunnel with the runtime key. Check the tunnel ID, key permissions, and network, then rerun setup. No new local profile was saved.');
 }
 return {metadataAccessible:true};
}
