import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export async function acquireConnectionLock(directory) {
 const lock=path.join(directory,'.k3-connection-lock'),owner=randomUUID();
 try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('A connection is already running or left a stale lock; inspect it before retrying');throw error;}
 try {await writeFile(path.join(lock,'owner.json'),JSON.stringify({owner,pid:process.pid}),{flag:'wx',mode:0o600});}
 catch(error){await rm(lock,{recursive:true,force:true});throw error;}
 return async()=>{
  try {const record=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
   if(record.owner===owner)await rm(lock,{recursive:true,force:true});
  }catch(error){if(error.code!=='ENOENT')throw error;}
 };
}
