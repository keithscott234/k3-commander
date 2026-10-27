import {cp,mkdir,mkdtemp,readFile,writeFile,lstat,readdir,rm,copyFile,realpath} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {runtimeFilter} from './runtime-filter.mjs';
import {doctor} from './doctor.mjs';
const execute=promisify(execFile);
const source=fileURLToPath(new URL('../',import.meta.url));
const sources=['cli.mjs','commander.mjs','engine-entry.mjs','lib','ui','scripts','package.json','upstream.json','release-catalog.json','UPSTREAM-LICENSE.txt','README.md','REMOTE-CLI.md'];
const runtimeFiles=['dist','node_modules','vendor','package.json','package-lock.json','LICENSE','engine-entry.mjs','k3-build.json'];
async function digest(file) {
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
export async function inventory(root,relative='',files={}) {
  for(const name of (await readdir(path.join(root,relative))).sort()) {
    const rel=relative ? relative+'/'+name : name;
    const file=path.join(root,rel),stat=await lstat(file);
    if(stat.isDirectory()) await inventory(root,rel,files);
    else if(stat.isFile()) files[rel]={bytes:stat.size,sha256:await digest(file)};
    else throw new Error('Portable bundle cannot contain links or special files: '+rel);
  }
  return files;
}
export async function bundlePortable(output) {
  if(!path.isAbsolute(output) || !/^[a-zA-Z0-9._-]+\.tar\.gz$/.test(path.basename(output)))throw new Error('Use an absolute output path ending in .tar.gz');
  for(const target of [output,output+'.sha256']) {
    try {await lstat(target);throw new Error('Output already exists');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const work=await mkdtemp(path.join(tmpdir(),'k3-portable-'));
  let created=false;
  try {
    const root=path.join(work,'k3-commander');await mkdir(root);
    for(const item of sources)await cp(path.join(source,item),path.join(root,item),{recursive:true,verbatimSymlinks:true});
    const guide=await readFile(path.join(source,'PUBLIC-README.md'),'utf8');
    await writeFile(path.join(root,'README.md'),guide);
    await writeFile(path.join(root,'REMOTE-CLI.md'),guide);
    const runtime=path.join(source,'.runtime'),filter=await runtimeFilter(runtime);
    await mkdir(path.join(root,'.runtime'));
    // npm executable shims are unnecessary to run the built engine. Excluding
    // them also avoids platform-specific symlink privileges on extraction.
    for(const item of runtimeFiles)await cp(path.join(runtime,item),path.join(root,'.runtime',item),{
      recursive:true,dereference:true,
      filter:async file=>{
        if(path.relative(runtime,file).split(path.sep).includes('.bin') || !await filter(file))return false;
        const resolved=path.relative(await realpath(runtime),await realpath(file));
        if(resolved==='..' || resolved.startsWith('..'+path.sep) || path.isAbsolute(resolved))throw new Error('Runtime link escapes bundle source');
        return true;
      }
    });
    const verification=await doctor(root);
    const files=await inventory(root);
    await writeFile(path.join(root,'portable-manifest.json'),JSON.stringify({
      version:1,platform:process.platform,arch:process.arch,nodeMajor:Number(process.versions.node.split('.')[0]),
      upstream:verification.upstream,files
    },null,2)+'\n');
    const archive=path.join(work,'portable.tar.gz');
    await execute('tar',['-czf',archive,'-C',work,'k3-commander'],{timeout:180000,maxBuffer:1048576});
    const sha256=await digest(archive);
    await copyFile(archive,output,constants.COPYFILE_EXCL);created=true;
    await writeFile(output+'.sha256',sha256+'  '+path.basename(output)+'\n',{flag:'wx'});
    return {archive:output,sha256,files:Object.keys(files).length,verification,platform:process.platform,arch:process.arch};
  }catch(error){if(created)await rm(output,{force:true});throw error;}
  finally{if(process.env.K3_KEEP_FAILED_BUNDLE==='1')console.log('Diagnostic staging: '+work);else await rm(work,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  bundlePortable(process.argv[2] || '').then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

export async function verifyPortable(root) {
  const manifest=JSON.parse(await readFile(path.join(root,'portable-manifest.json'),'utf8'));
  if(manifest.version!==1 || manifest.platform!==process.platform || manifest.arch!==process.arch || manifest.nodeMajor!==Number(process.versions.node.split('.')[0]))throw new Error('Portable bundle platform or Node version mismatch');
  const actual=await inventory(root);delete actual['portable-manifest.json'];
  if(JSON.stringify(Object.keys(actual).sort())!==JSON.stringify(Object.keys(manifest.files).sort()))throw new Error('Portable bundle file inventory mismatch');
  for(const [file,entry] of Object.entries(actual))if(entry.sha256!==manifest.files[file].sha256 || entry.bytes!==manifest.files[file].bytes)throw new Error('Portable bundle integrity mismatch: '+file);
  return {verified:true,files:Object.keys(actual).length};
}
