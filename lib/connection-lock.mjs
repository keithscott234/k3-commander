import {mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
function dead(pid){
 if(!Number.isSafeInteger(pid)||pid<=0)return false;
 try{process.kill(pid,0);return false;}catch(e){return e.code==='ESRCH';}
}
export async function acquireConnectionLock(directory,{recoverBackground=false}={}) {
 const lock=path.join(directory,'.k3-connection-lock'),guard=lock+'.guard',owner=randomUUID();
 // All cooperating launchers serialize creation/reclamation. Unknown or live owners fail closed.
 try{await mkdir(guard);}catch{throw Error('Connection lock is being inspected; retry or inspect its guard locally');}
 try{
  if(recoverBackground){
   let previous;
   try{previous=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(previous?.kind==='background'&&dead(previous.pid)&&(!previous.childPid||dead(previous.childPid)))
    await rm(lock,{recursive:true});
  }
  try {await mkdir(lock);}catch(error){if(error.code==='EEXIST')throw Error('A connection is already running or left a stale lock; inspect it before retrying');throw error;}
  try {await writeFile(path.join(lock,'owner.json'),JSON.stringify({owner,pid:process.pid,...(recoverBackground?{kind:'background'}:{})}),{flag:'wx',mode:0o600});}
  catch(error){await rm(lock,{recursive:true,force:true});throw error;}
 }finally{await rm(guard,{recursive:true,force:true});}
 const release=async()=>{
  try {const record=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
   if(record.owner===owner)await rm(lock,{recursive:true,force:true});
  }catch(error){if(error.code!=='ENOENT')throw error;}
 };
 release.setChild=async childPid=>{
  const record=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8'));
  if(record.owner!==owner)throw Error('Connection lock ownership changed');
  await writeFile(path.join(lock,'owner.json'),JSON.stringify({...record,childPid}),{mode:0o600});
 };
 return release;
}
