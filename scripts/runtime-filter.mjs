import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';

// Keep production and shared dependencies exactly as built. Only lockfile entries
// explicitly marked development-only are omitted; no install scripts or network.
export async function runtimeFilter(runtime) {
 const lock=JSON.parse(await readFile(path.join(runtime,'package-lock.json'),'utf8'));
 if(lock.lockfileVersion!==3 || !lock.packages)throw new Error('Expected pinned npm v3 lockfile');
 const roots=[path.resolve(runtime),await realpath(runtime)];
 const excluded=new Set(Object.entries(lock.packages).filter(([,p])=>p.dev===true).flatMap(([p])=>roots.map(root=>path.resolve(root,p))));
 const omitted=file=>{for(let p=file;p!==runtime && p!==path.dirname(p);p=path.dirname(p))if(excluded.has(p))return true;return false;};
 return async file=>{
  if(file===path.join(runtime,'node_modules','.package-lock.json') || omitted(file))return false;
  if((await lstat(file)).isSymbolicLink()){
   try {return !omitted(await realpath(file));}
   catch(error){if(error.code==='ENOENT')throw new Error('Broken runtime link: '+path.relative(runtime,file));throw error;}
  }
  return true;
 };
}
