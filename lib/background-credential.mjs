import {spawn} from 'node:child_process';
import {writeFile,readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {psQuote} from './background-platform.mjs';
export function cleanEnvironment(env=process.env){return Object.fromEntries(Object.entries(env).filter(([k])=>! /^(OPENAI_|CONTROL_PLANE_|K3_TUNNEL_)/i.test(k)));}
export function validKey(key){if(typeof key!=='string'||!key||/[\s\x00-\x1f]/.test(key))throw Error('Runtime key is empty or malformed');return key;}
function powershell(script,input=''){
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+script],{env:cleanEnvironment(),windowsHide:true,stdio:['pipe','pipe','ignore'],shell:false});
  let result='',done=false;
  const finish=(err)=>{if(done)return;done=true;clearTimeout(timer);err?reject(Error('Protected credential operation failed')):resolve(result.trim());};
  const timer=setTimeout(()=>{child.kill();finish(true);},15000);
  child.stdout.on('data',b=>{result+=b;if(result.length>65536){child.kill();finish(true);}});
  child.stdin.on('error',()=>finish(true));child.on('error',()=>finish(true));child.on('exit',c=>finish(c!==0));child.stdin.end(input);
 });
}
export async function saveCredential(folder,key,platform=process.platform){
 validKey(key);
 const file=path.join(folder,'credential');
 if(platform==='win32'){
  const encrypted=await powershell("$s=[Console]::In.ReadToEnd() | ConvertTo-SecureString -AsPlainText -Force; ConvertFrom-SecureString $s",key);
  await writeFile(file,encrypted,{flag:'wx',mode:0o600});
 }else if(platform==='linux')await writeFile(file,key,{flag:'wx',mode:0o600});
 else throw Error('Background mode supports Windows and Linux only');
}
export async function loadCredential(folder,platform=process.platform){
 const directory=await lstat(folder);
 if(!directory.isDirectory()||directory.isSymbolicLink())throw Error('Invalid credential directory');
 if(platform==='linux'&&((directory.mode&0o077)!==0||directory.uid!==process.getuid()))throw Error('Credential directory must be private and owned by this user');
 const file=path.join(folder,'credential'),st=await lstat(file);
 if(!st.isFile()||st.isSymbolicLink())throw Error('Invalid credential file');
 if(platform==='linux'){
  if((st.mode&0o077)!==0||st.uid!==process.getuid())throw Error('Credential file must be owned by this user with mode 0600');
  return validKey(await readFile(file,'utf8'));
 }
 const result=await powershell("$s=Get-Content -Raw -LiteralPath "+psQuote(file)+" | ConvertTo-SecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try{[Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p))}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}");
 return validKey(result);
}
