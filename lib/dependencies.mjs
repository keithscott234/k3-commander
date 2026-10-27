import {lstat,mkdir,mkdtemp,readFile,writeFile,copyFile,rename,rm,readdir,chmod} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {installationHome} from './installation.mjs';
const execute=promisify(execFile);
const pins={
 'win32-x64':{
  tunnel:{version:'0.0.16',name:'tunnel-client.exe',url:'https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-windows-amd64.zip',sha256:'edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6'},
  search:{version:'15.2.0',name:'rg.exe',url:'https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',sha256:'71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5'}
 },
 'linux-x64':{
  tunnel:{version:'0.0.16',name:'tunnel-client',url:'https://github.com/openai/tunnel-client/releases/download/v0.0.16/tunnel-client-v0.0.16-linux-amd64.zip',sha256:'d60cdba019bce451bcc3a15478cc5b9cb11270b049f5b56ea39a80b517f8b117'},
  search:{version:'15.2.0',name:'rg',url:'https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz',sha256:'33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c'}
 }
};
export function dependencyPin(kind,platform=process.platform,arch=process.arch) {
 const pin=pins[platform+'-'+arch]?.[kind];
 if(!pin)throw Error('Dependency downloads currently support Windows x64 and Linux x64 only');
 return {...pin};
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function downloadVerified(pin,{fetcher=fetch}={}) {
 const response=await fetcher(pin.url,{signal:AbortSignal.timeout(120000)});
 if(!response.ok)throw Error('Dependency download failed');
 const chunks=[];let size=0;
 for await(const chunk of response.body) {
  size+=chunk.length;if(size>134217728)throw Error('Dependency download exceeds size limit');chunks.push(chunk);
 }
 const bytes=Buffer.concat(chunks);
 if(hash(bytes)!==pin.sha256)throw Error('Dependency checksum mismatch');
 return bytes;
}
async function findBinary(root,name) {
 const matches=[];
 async function walk(dir) {
  for(const entry of await readdir(dir,{withFileTypes:true})) {
   const file=path.join(dir,entry.name);
   if(entry.isSymbolicLink())throw Error('Dependency archive contains a symbolic link');
   if(entry.isDirectory())await walk(file);
   else if(entry.isFile() && entry.name===name)matches.push(file);
  }
 }
 await walk(root);
 if(matches.length!==1)throw Error('Dependency archive has no unique expected binary');
 return matches[0];
}
export async function ensureDependency(kind,{home=installationHome(),fetcher=fetch}={}) {
 if(!path.isAbsolute(home))throw Error('Dependency home must be absolute');
 const pin=dependencyPin(kind),parent=path.join(home,'dependencies');
 const target=path.join(parent,kind+'-'+pin.version),binary=path.join(target,pin.name);
 await mkdir(parent,{recursive:true});
 try {
  const receipt=JSON.parse(await readFile(path.join(target,'receipt.json'),'utf8'));
  if(receipt.archiveSha256!==pin.sha256 || hash(await readFile(binary))!==receipt.binarySha256)
   throw Error('Installed dependency integrity mismatch');
  return binary;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 try {await lstat(target);throw Error('Incomplete dependency installation; inspect it before retrying');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const lock=target+'.lock';
 try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('Dependency installation is already in progress');throw error;}
 let stage;
 try {
  stage=await mkdtemp(path.join(parent,'.download-'));
  const bytes=await downloadVerified(pin,{fetcher});
  const archive=path.join(stage,pin.url.endsWith('.zip')?'archive.zip':'archive.tar.gz');
  await writeFile(archive,bytes,{flag:'wx'});
  const extracted=path.join(stage,'extracted');await mkdir(extracted);
  if(process.platform!=='win32' && archive.endsWith('.zip'))
   await execute('unzip',['-q',archive,'-d',extracted],{timeout:120000});
  else await execute('tar',['-xf',archive,'-C',extracted],{timeout:120000});
  const source=await findBinary(extracted,pin.name);
  const payload=path.join(stage,'payload');await mkdir(payload);
  await copyFile(source,path.join(payload,pin.name));
  await chmod(path.join(payload,pin.name),0o700);
  const binarySha256=hash(await readFile(source));
  await writeFile(path.join(payload,'receipt.json'),JSON.stringify({archiveSha256:pin.sha256,binarySha256}));
  // Keep the verified source archive with notices for local inspection.
  await copyFile(archive,path.join(payload,path.basename(archive)));
  await rename(payload,target);
  return binary;
 }finally{if(stage)await rm(stage,{recursive:true,force:true,maxRetries:5});await rm(lock,{recursive:true,force:true});}
}
