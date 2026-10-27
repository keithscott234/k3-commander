import {installationHome} from '../lib/installation.mjs';
import {lstat,realpath,cp,mkdir,mkdtemp,readFile,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {verifyPortable} from './bundle-portable.mjs';
import {doctor} from './doctor.mjs';

async function absent(file) {
  try {await lstat(file);} catch(error) {if(error.code==='ENOENT')return;throw error;}
  throw new Error('Installation already exists: '+file);
}
async function trustedManifest(root,expected) {
  const bytes=await readFile(path.join(root,'portable-manifest.json'));
  if(createHash('sha256').update(bytes).digest('hex')!==expected)
    throw new Error('Manifest does not match the trusted digest');
}
// Accepts an already extracted directory, never an untrusted archive.
// The expected manifest digest must come from a separately trusted source.
export async function installPortable({source,home=installationHome(),manifestSha256},deps={}) {
  if(!path.isAbsolute(source || '') || !path.isAbsolute(home || ''))
    throw new Error('Source and installation home must be absolute paths');
  if(!/^[a-f0-9]{64}$/.test(manifestSha256 || ''))throw new Error('A trusted manifest SHA-256 is required');
  const relative=path.relative(source,home);
  if(!relative || (!relative.startsWith('..'+path.sep) && relative!=='..' && !path.isAbsolute(relative)))
    throw new Error('Installation home must be outside the source directory');
  await trustedManifest(source,manifestSha256);
  await verifyPortable(source);
  await mkdir(home,{recursive:true});
  const resolvedSource=await realpath(source),resolvedHome=await realpath(home);
  const canonicalRelative=path.relative(resolvedSource,resolvedHome);
  if(!canonicalRelative || (!canonicalRelative.startsWith('..'+path.sep) && canonicalRelative!=='..' && !path.isAbsolute(canonicalRelative)))
    throw new Error('Installation home must be outside the source directory');
  const lock=path.join(home,'.install-lock');
  try {await mkdir(lock);} catch(error) {
    if(error.code==='EEXIST')throw new Error('Another installation owns the lock; inspect it before retrying');
    throw error;
  }
  let stage,created=false,published=false;
  const target=path.join(home,'releases',manifestSha256);
  const pointer=path.join(home,'current.json');
  try {
    await absent(pointer);await absent(target);
    await mkdir(path.join(home,'releases'),{recursive:true});
    stage=await mkdtemp(path.join(home,'.stage-'));
    const payload=path.join(stage,'engine');
    await cp(source,payload,{recursive:true,verbatimSymlinks:true});
    // Recheck the copy before executing it, including source changes during copy.
    await trustedManifest(payload,manifestSha256);
    const integrity=await verifyPortable(payload);
    const engine=await (deps.doctor || doctor)(payload);
    await rename(payload,target);created=true;
    const record={version:1,root:target,manifestSha256,platform:process.platform,
      arch:process.arch,nodeMajor:Number(process.versions.node.split('.')[0])};
    await writeFile(pointer,JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});
    published=true;
    return {installed:target,registration:pointer,integrity,engine};
  } finally {
    if(created && !published)await rm(target,{recursive:true,force:true,maxRetries:5});
    if(stage)await rm(stage,{recursive:true,force:true,maxRetries:5});
    await rm(lock,{recursive:true,force:true});
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  const [source,home,manifestSha256,...extra]=process.argv.slice(2);
  if(extra.length){console.error('Usage: node install-portable.mjs SOURCE HOME TRUSTED_MANIFEST_SHA256');process.exitCode=2;}
  else installPortable({source,home,manifestSha256}).then(x=>console.log(JSON.stringify(x,null,2)))
    .catch(error=>{console.error(error.message);process.exitCode=1;});
}
