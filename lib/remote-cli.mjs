import {acquireConnectionLock} from './connection-lock.mjs';
import {locateInstallation, installationHome} from './installation.mjs';
import {inspectWindowsTask, startWindowsTask} from './windows-task.mjs';
import {access, readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const unit = 'k3-commander-tunnel.service';
const help = `Usage: k3-commander remote [--check] [--profile NAME]
Reconnect an already enrolled private tunnel on this computer.
Use k3-commander locate to find a registered portable installation.
Install a trusted local bundle: k3-commander install --source DIRECTORY --sha256 MANIFEST_SHA256
--check inspects local prerequisites without starting a connection.
First-time device pairing requires its own OpenAI tunnel and runtime key. Public npm distribution is not available yet.
Environment overrides: K3_TUNNEL_BINARY, K3_TUNNEL_PROFILE_DIR, K3_TUNNEL_PROFILE.
No credentials are accepted in command-line arguments.`;

export function parse(args) {
  if (!args.length || (args.length === 1 && ['--help', '-h'].includes(args[0]))) return {help:true};
  if (args.length===1 && args[0]==='locate') return {locate:true};
  if (args[0] !== 'remote') throw new Error('Unknown command. Use k3-commander remote --help.');
  const options = {};
  for (let i=1; i<args.length; i++) {
    if (args[i] === '--help' && args.length === 2) return {help:true};
    if (args[i] === '--check' && !options.check) options.check = true;
    else if (args[i] === '--profile' && !options.profile && /^[A-Za-z0-9_-]+$/.test(args[i+1] || '')) options.profile = args[++i];
    else throw new Error('Invalid arguments. Use k3-commander remote --help.');
  }
  return options;
}

export async function inspect(options, {env=process.env, home=homedir(), platform=process.platform, exists=async p=>{try{await access(p, constants.F_OK);return true;}catch{return false;}}, executable=async p=>{try{await access(p, constants.X_OK);return true;}catch{return false;}}, list=readdir, windowsTask=inspectWindowsTask, portableLocate=locateInstallation}={}) {
  // Use the existing service when available: its credential handling and process
  // supervision remain authoritative. Never race a second foreground tunnel.
  const service = platform === 'linux' && await exists(path.join(home,'.config/systemd/user',unit));
  if (service) {
    if (options.profile) return {ready:false, reason:'A managed K3 tunnel service exists. Remove --profile to reconnect it; configure another device separately.'};
    return {ready:true, mode:'service', unit};
  }
  if (platform === 'win32') {
    let task;
    try { task = await windowsTask(); }
    catch { return {ready:false,reason:'Unable to inspect the Windows reconnect task. No foreground tunnel was started.'}; }
    if (task !== 'absent') {
      if (options.profile) return {ready:false,reason:'A managed Windows reconnect task exists. Remove --profile to use it.'};
      if (task === 'disabled') return {ready:false,reason:'The Windows reconnect task is disabled. Enable it locally before reconnecting.'};
      return {ready:true,mode:'windows-task'};
    }
  }
  let portable;
  const portableHome=installationHome({env,home,platform});
  try {portable=await portableLocate(portableHome);}catch{return {ready:false,reason:'Portable installation registration is invalid; no connection started.'};}
  if(portable) {
    const paths=platform==='win32'?path.win32:path.posix;
    if(options.profile && options.profile!=='k3-commander')return {ready:false,reason:'This portable installation has one connection. Use its own profile.'};
    const dir=paths.join(portableHome,'connection');
    const binary=paths.join(portableHome,'dependencies','tunnel-0.0.16',platform==='win32'?'tunnel-client.exe':'tunnel-client');
    if(!await exists(paths.join(dir,'k3-commander.yaml')))return {ready:false,needsSetup:true,reason:'Engine installed. Run pair --tunnel-id with a separate tunnel ID for this device.'};
    if(!await executable(binary))return {ready:false,reason:'Installed tunnel dependency is missing; run installation setup again.'};
    if(!env.CONTROL_PLANE_API_KEY && !env.OPENAI_API_KEY)return {ready:false,needsCredential:true,reason:'Set CONTROL_PLANE_API_KEY locally for this device; never paste it into chat.'};
    return {ready:true,mode:'foreground',binary,profile:'k3-commander',dir};
  }
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const dir = env.K3_TUNNEL_PROFILE_DIR || paths.join(home,'.config','tunnel-client');
  if (!paths.isAbsolute(dir)) return {ready:false, reason:'K3_TUNNEL_PROFILE_DIR must be an absolute path.'};
  let profile = options.profile || env.K3_TUNNEL_PROFILE;
  if (profile && !/^[A-Za-z0-9_-]+$/.test(profile)) return {ready:false,reason:'Invalid tunnel profile name.'};
  if (!profile) {
    let entries=[];
    try { entries = await list(dir); } catch { /* no enrollment */ }
    const profiles = entries.filter(n=>/^k3-commander[A-Za-z0-9_-]*\.yaml$/.test(n));
    if (profiles.length > 1) return {ready:false,reason:'Multiple K3 profiles exist. Select the intended device with --profile NAME.'};
    profile = profiles[0]?.slice(0,-5);
  }
  if (!profile || !await exists(paths.join(dir, profile+'.yaml'))) return {ready:false,needsSetup:!profile && !options.profile && !env.K3_TUNNEL_PROFILE,reason:'No enrolled device profile found. First-time setup requires a separately provisioned device tunnel.'};
  let binary = env.K3_TUNNEL_BINARY;
  if (binary && !paths.isAbsolute(binary)) return {ready:false,reason:'K3_TUNNEL_BINARY must be an absolute path.'};
  if (!binary) {
    const name = platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
    const searchPath = platform === 'win32' ? Object.entries(env).find(([key])=>key.toLowerCase()==='path')?.[1] : env.PATH;
    const dirs = (searchPath || '').split(platform === 'win32' ? ';' : ':').filter(p=>paths.isAbsolute(p));
    const candidates = dirs.map(p=>paths.join(p,name));
    if (platform !== 'win32') candidates.push(paths.join(home,'.local/share/k3-commander/tunnel-client-v0.0.16',name));
    for (const candidate of candidates) if (await executable(candidate)) { binary=candidate; break; }
  }
  if (!binary || !await executable(binary)) return {ready:false,reason:'Tunnel client not found. Install the official client for this OS or set K3_TUNNEL_BINARY to its absolute path.'};
  if (!env.CONTROL_PLANE_API_KEY && !env.OPENAI_API_KEY) return {ready:false,reason:'Tunnel credentials are unavailable. Use the existing protected service or configure credentials locally; do not paste secrets into chat or command arguments.'};
  return {ready:true,mode:'foreground',binary,profile,dir};
}

export async function run(args, deps={}) {
  const log=deps.log || console.log;
  if(args[0]==='pair') {
    if(args.length!==3 || args[1]!=='--tunnel-id') {log('Usage: k3-commander pair --tunnel-id TUNNEL_ID');return 2;}
    try {const {preparePairing}=await import('./pairing.mjs');log(JSON.stringify(await preparePairing({id:args[2],home:installationHome(deps)}),null,2));return 0;}
    catch(error){log(error.message);return 1;}
  }
  if(args[0]==='install') {
    try { const {parseInstall,bootstrapInstall}=await import('./bootstrap.mjs');
      log(JSON.stringify(await bootstrapInstall(parseInstall(args.slice(1)),deps),null,2));return 0;
    }catch(error){log(error.message);return 1;}
  }
  let options;
  try { options=parse(args); } catch(error) { log(error.message); return 2; }
  if (options.help) { log(help); return 0; }
  if(options.locate) {
    try { const found=await locateInstallation(installationHome(deps)); log(found ? JSON.stringify(found) : 'No portable installation registered on this device.'); return found ? 0 : 1; }
    catch { log('Cannot verify the local installation registration.'); return 1; }
  }
  let state=await inspect(options,deps);
  if(!state.ready && !options.check && (state.needsSetup || state.needsCredential)) {
    try {
      const {onboard}=await import('./onboarding.mjs');
      const env=await (deps.onboard || onboard)({home:installationHome(deps),env:deps.env || process.env,log});
      deps={...deps,env};state=await inspect(options,deps);
    }catch(error){log(error.message);return 1;}
  }
  if (!state.ready) { log(state.reason); return 1; }
  if (options.check) {
    log(`Local launch prerequisites found (${state.mode}). No connection was started; GPT connectivity is unverified.`);
    return 0;
  }
  if (state.mode === 'windows-task') {
    try {
      await (deps.startWindowsTask || startWindowsTask)();
      log('Windows reconnect task requested. Verify a GPT tool call before running tasks.');
      return 0;
    } catch { log('Unable to start the Windows reconnect task. Inspect Task Scheduler locally.'); return 1; }
  }
  if (state.mode === 'service') {
    const exec=deps.execute || execute;
    try {
      await exec('systemctl',['--user','start',unit],{timeout:15000});
      await exec('systemctl',['--user','is-active','--quiet',unit],{timeout:5000});
      log('K3 tunnel service is active. Confirm a read-only GPT tool call before running tasks.');
      return 0;
    } catch { log('K3 tunnel service did not become active. Inspect its status locally; credentials and service configuration were not changed.'); return 1; }
  }
  let release;
  try {release=await (deps.acquireLock || acquireConnectionLock)(state.dir);}
  catch(error){log(error.message);return 1;}
  const env={...(deps.env || process.env)};
  env.CONTROL_PLANE_API_KEY ||= env.OPENAI_API_KEY;
  for (const key of Object.keys(env)) if (/^OPENAI_/i.test(key)) delete env[key];
  log('Starting the selected private tunnel. Keep this terminal open. GPT connectivity is not yet verified.');
  // No shell, background persistence, automatic replay, or credential output.
  let child;
  try {child=(deps.spawn || spawn)(state.binary,['run','--profile',state.profile,'--profile-dir',state.dir],{shell:false,stdio:'inherit',env});}
  catch {await release();log('Unable to start tunnel client.');return 1;}
  return await new Promise(resolve=>{
    const stop=()=>child.kill('SIGTERM');
    process.once('SIGINT',stop);
    process.once('SIGTERM',stop);
    let finished=false;
    const finish=async code=>{if(finished)return;finished=true;process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);try{await release();}catch{log('Connection exited; inspect its stale local lock before reconnecting.');code=1;}resolve(code);};
    child.once('error',()=>{log('Unable to start tunnel client. Run remote --check.');finish(1);});
    child.once('exit',(code)=>finish(code ?? 1));
  });
}
