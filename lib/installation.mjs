import path from 'node:path';
import {homedir} from 'node:os';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export function installationHome({env=process.env,home=homedir(),platform=process.platform}={}) {
 const paths=platform==='win32'?path.win32:path.posix;
 const root=env.K3_COMMANDER_HOME || (platform==='win32'
  ? paths.join(env.LOCALAPPDATA || paths.join(home,'AppData','Local'),'K3Commander')
  : paths.join(home,'.local','share','k3-commander-portable'));
 if(!paths.isAbsolute(root))throw Error('K3_COMMANDER_HOME must be absolute');
 return root;
}
export async function locateInstallation(home=installationHome()) {
 const pointer=path.join(home,'current.json');
 let record;
 try {record=JSON.parse(await readFile(pointer,'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw Error('Invalid local installation registration');}
 if(record.version!==1 || !/^[a-f0-9]{64}$/.test(record.manifestSha256 || '') ||
  record.platform!==process.platform || record.arch!==process.arch ||
  record.nodeMajor!==Number(process.versions.node.split('.')[0]))
  throw Error('Installation registration does not match this platform or Node version');
 const expected=path.join(home,'releases',record.manifestSha256);
 if(record.root!==expected)throw Error('Installation registration points outside its release');
 const stat=await lstat(expected);
 if(!stat.isDirectory() || stat.isSymbolicLink())throw Error('Installed release must be a real directory');
 const canonical=await realpath(expected),releases=await realpath(path.join(home,'releases'));
 if(path.dirname(canonical)!==releases)throw Error('Installed release escapes its home');
 const bytes=await readFile(path.join(expected,'portable-manifest.json'));
 if(createHash('sha256').update(bytes).digest('hex')!==record.manifestSha256)
  throw Error('Installed manifest was modified');
 return {root:expected,manifestSha256:record.manifestSha256,registration:pointer};
}
