import {locateInstallation} from './installation.mjs';
import {spawn} from 'node:child_process';
import path from 'node:path';
const home=process.argv[2];
if(!home || !path.isAbsolute(home))throw Error('Installation home is required');
const installed=await locateInstallation(home);
if(!installed)throw Error('No registered engine');
const env={...process.env};
for(const name of Object.keys(env))if(/^(OPENAI_|CONTROL_PLANE_|K3_TUNNEL_)/i.test(name))delete env[name];
const key=Object.keys(env).find(k=>k.toLowerCase()==='path') || 'PATH';
env[key]=path.join(home,'dependencies','search-15.2.0')+path.delimiter+(env[key] || '');
const child=spawn(process.execPath,[path.join(installed.root,'commander.mjs')],{
 cwd:installed.root,env,stdio:'inherit',shell:false,windowsHide:true
});
child.once('error',()=>{console.error('Installed engine could not start');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code ?? 1;});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));
