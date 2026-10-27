import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {downloadVerified} from './dependencies.mjs';
import {bootstrapInstall} from './bootstrap.mjs';
export function selectRelease(catalog,{platform=process.platform,arch=process.arch,nodeMajor=Number(process.versions.node.split('.')[0])}={}) {
 if(catalog.version!==1 || !Array.isArray(catalog.releases))throw Error('Invalid release catalog');
 const matches=catalog.releases.filter(r=>r.platform===platform && r.arch===arch && r.nodeMajor===nodeMajor);
 if(matches.length!==1)throw Error('No published engine is configured for this OS, architecture and Node version');
 const item=matches[0],url=new URL(item.url);
 if(url.protocol!=='https:' || url.hostname!=='github.com' || !url.pathname.startsWith('/keithscott234/k3-commander/releases/download/') ||
  !/^[a-f0-9]{64}$/.test(item.sha256) || !/^[a-f0-9]{64}$/.test(item.manifestSha256))
  throw Error('Release metadata is invalid');
 return item;
}
export async function autoInstall({home,catalog,fetcher=fetch}={}) {
 catalog ||= JSON.parse(await readFile(new URL('../release-catalog.json',import.meta.url),'utf8'));
 const release=selectRelease(catalog);
 const work=await mkdtemp(path.join(tmpdir(),'k3 download '));
 try {
  const bytes=await downloadVerified(release,{fetcher});
  const archive=path.join(work,'engine.tar.gz');await writeFile(archive,bytes,{flag:'wx'});
  await promisify(execFile)('tar',['-xzf',archive,'-C',work],{timeout:180000});
  return await bootstrapInstall({source:path.join(work,'k3-commander'),manifestSha256:release.manifestSha256},{home});
 }finally{await rm(work,{recursive:true,force:true,maxRetries:5});}
}
