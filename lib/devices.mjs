import {mkdir, lstat, readFile, writeFile, rename, readdir} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {configDirectory, privateDirectory} from './control.mjs';

const allowedFields = new Set(['name','host','port','user','identityFile','hostPublicKey','nodePath','commanderPath','remoteConfigDirectory']);
export function validateName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)) throw new Error('Device name must use 1–48 lowercase letters, digits or hyphens');
  return name;
}
function absolute(value, label, posix = false) {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value) || !(posix ? path.posix.isAbsolute(value) : path.isAbsolute(value))) throw new Error(`${label} must be an absolute path without control characters`);
  return value;
}
export function validateDevice(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Device profile must be an object');
  for (const key of Object.keys(input)) if (!allowedFields.has(key)) throw new Error('Unknown device profile field: '+key);
  const name = validateName(input.name);
  if (typeof input.host !== 'string' || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|[0-9a-fA-F:]*:[0-9a-fA-F:]+)$/.test(input.host) || input.host.includes('..')) throw new Error('Host must be a plain DNS name or IP address');
  if (typeof input.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/i.test(input.user)) throw new Error('Invalid remote account name');
  const port = input.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH port');
  const identityFile = absolute(input.identityFile,'identityFile');
  const nodePath = absolute(input.nodePath,'nodePath',true);
  const commanderPath = absolute(input.commanderPath,'commanderPath',true);
  const remoteConfigDirectory = input.remoteConfigDirectory === undefined ? undefined : absolute(input.remoteConfigDirectory,'remoteConfigDirectory',true);
  if (typeof input.hostPublicKey !== 'string' || /[\r\n]/.test(input.hostPublicKey)) throw new Error('One verified SSH host public key is required');
  const parts = input.hostPublicKey.trim().split(/\s+/);
  if (!['ssh-ed25519','ecdsa-sha2-nistp256','ssh-rsa'].includes(parts[0]) || !/^[A-Za-z0-9+/]+={0,2}$/.test(parts[1] || '')) throw new Error('Unsupported SSH host public key');
  const key = Buffer.from(parts[1],'base64');
  if (key.length < 32 || key.length > 8192 || key.toString('base64') !== parts[1]) throw new Error('Malformed SSH host public key');
  const typeLength = key.readUInt32BE(0);
  if (typeLength > key.length-4 || key.subarray(4,4+typeLength).toString() !== parts[0]) throw new Error('SSH host key type mismatch');
  const hostPublicKey = parts.slice(0,2).join(' ');
  return {name,host:input.host,port,user:input.user,identityFile,hostPublicKey,nodePath,commanderPath,
    ...(remoteConfigDirectory ? {remoteConfigDirectory} : {})};
}
export function fingerprint(publicKey) {
  return 'SHA256:'+createHash('sha256').update(Buffer.from(publicKey.split(' ')[1],'base64')).digest('base64').replace(/=+$/,'');
}
export function shellQuote(value) { return "'"+value.replaceAll("'", "'\\''")+"'"; }
export async function profileRoot(directory=configDirectory()) {
  await privateDirectory(directory);
  const root=path.join(directory,'devices'); await privateDirectory(root); return root;
}
async function protectedFile(file) {
  const stat=await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (process.platform!=='win32' && (stat.uid!==process.getuid() || stat.mode & 0o077))) throw new Error('Device file must be a private regular file owned by this account');
}
export async function enroll(input, verifiedFingerprint, directory) {
  const profile=validateDevice(input);
  if (verifiedFingerprint !== fingerprint(profile.hostPublicKey)) throw new Error('Verified fingerprint does not match the supplied host key');
  // Never read, upload or copy the private key. OpenSSH reads it at connection time.
  await protectedFile(profile.identityFile);
  const root=await profileRoot(directory), folder=path.join(root,profile.name);
  await mkdir(folder,{mode:0o700}); // Existing devices must be explicitly revoked/managed; never overwrite.
  const record={version:1,generation:randomUUID(),enabled:true,profile};
  await writeFile(path.join(folder,'profile.json'),JSON.stringify(record,null,2),{flag:'wx',mode:0o600});
  await writeFile(path.join(folder,'known_hosts'),`k3-device-${profile.name} ${profile.hostPublicKey}\n`,{flag:'wx',mode:0o600});
  await writeFile(path.join(folder,'ssh_config'),'# K3 Commander: ignore personal SSH config.\n',{flag:'wx',mode:0o600});
  return {name:profile.name,fingerprint:fingerprint(profile.hostPublicKey)};
}
export async function loadDevice(name,directory,{allowDisabled=false,connectionChecks=true}={}) {
  validateName(name);
  const folder=path.join(await profileRoot(directory),name);
  await lstat(folder); // Loading a missing device must not create an enrollment directory.
  await privateDirectory(folder);
  const filename=path.join(folder,'profile.json'); await protectedFile(filename);
  const record=JSON.parse(await readFile(filename,'utf8'));
  if (record.version!==1 || typeof record.generation!=='string' || typeof record.enabled!=='boolean') throw new Error('Invalid device record');
  const profile=validateDevice(record.profile);
  if (profile.name!==name || (!allowDisabled && !record.enabled)) throw new Error('Device is revoked');
  if (!connectionChecks) return {folder,record,profile};
  await protectedFile(profile.identityFile);
  for (const file of ['known_hosts','ssh_config']) await protectedFile(path.join(folder,file));
  if ((await readFile(path.join(folder,'known_hosts'),'utf8')) !== `k3-device-${name} ${profile.hostPublicKey}\n`) throw new Error('Pinned host key changed');
  if ((await readFile(path.join(folder,'ssh_config'),'utf8')) !== '# K3 Commander: ignore personal SSH config.\n') throw new Error('Device SSH configuration changed');
  return {folder,record,profile};
}
export async function revoke(name,directory) {
  const {folder,record}=await loadDevice(name,directory,{allowDisabled:true,connectionChecks:false});
  record.enabled=false; record.generation=randomUUID();
  const temporary=path.join(folder,`profile-${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify(record,null,2),{mode:0o600,flag:'wx'});
  await rename(temporary,path.join(folder,'profile.json'));
}
export async function listDevices(directory) {
  const root=await profileRoot(directory), result=[];
  for (const name of await readdir(root)) {
    try {const {record,profile}=await loadDevice(name,directory,{allowDisabled:true,connectionChecks:false}); result.push({name,host:profile.host,user:profile.user,enabled:record.enabled,fingerprint:fingerprint(profile.hostPublicKey)});}
    catch {result.push({name,status:'unavailable'});}
  }
  return result;
}
export function sshArguments({folder,profile}, control) {
  const options={BatchMode:'yes',StrictHostKeyChecking:'yes',UserKnownHostsFile:'"'+path.join(folder,'known_hosts').replaceAll('\\','/').replaceAll('"','\\"')+'"',GlobalKnownHostsFile:process.platform==='win32'?'NUL':'/dev/null',HostKeyAlias:`k3-device-${profile.name}`,
    PasswordAuthentication:'no',KbdInteractiveAuthentication:'no',PreferredAuthentications:'publickey',IdentitiesOnly:'yes',ForwardAgent:'no',ForwardX11:'no',ClearAllForwardings:'yes',PermitLocalCommand:'no',ProxyCommand:'none',ProxyJump:'none',ControlMaster:'no',ControlPath:'none',ServerAliveInterval:'15',ServerAliveCountMax:'2',ConnectTimeout:'10',EscapeChar:'none',LogLevel:'ERROR'};
  let entry=profile.commanderPath, tail='';
  if (control) {
    if (!['list','status','pause','resume','stop'].includes(control.action)) throw new Error('Invalid remote control action');
    if (control.sessionId !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(control.sessionId)) throw new Error('Invalid remote session ID');
    entry=path.posix.join(path.posix.dirname(entry),'control.mjs');
    tail=' '+shellQuote(control.action)+(control.sessionId?' '+shellQuote(control.sessionId):'');
  }
  const command='exec '+(profile.remoteConfigDirectory ? `/usr/bin/env ${shellQuote('K3_COMMANDER_CONFIG_DIR='+profile.remoteConfigDirectory)} ` : '')+shellQuote(profile.nodePath)+' '+shellQuote(entry)+tail;
  return ['-F',path.join(folder,'ssh_config'),'-T',...Object.entries(options).flatMap(([key,value])=>['-o',`${key}=${value}`]),'-p',String(profile.port),'-l',profile.user,'-i',profile.identityFile,profile.host,command];
}
