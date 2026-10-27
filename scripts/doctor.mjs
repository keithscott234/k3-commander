import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export async function doctor(root,{env=process.env}={}) {
  try {await promisify(execFile)('rg',['--version'],{timeout:5000,env});}
  catch {throw new Error('File search requires ripgrep (rg) on PATH. Install ripgrep, then retry K3 Commander installation.');}
  const sdk=p=>import(pathToFileURL(path.join(root,'.runtime/node_modules/@modelcontextprotocol/sdk/dist/esm',p)).href);
  const {Client}=await sdk('client/index.js');
  const {StdioClientTransport}=await sdk('client/stdio.js');
  const directory=await mkdtemp(path.join(tmpdir(),'k3-install-check-'));
  const client=new Client({name:'k3-install-check',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'commander.mjs')],
    env:{...env,K3_COMMANDER_CONFIG_DIR:directory},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});
  try {
    await client.connect(transport);
    if(client.getServerVersion()?.name!=='k3-commander')throw new Error('Unexpected engine identity');
    const tools=(await client.listTools()).tools;
    if(tools.length!==19 || !tools.some(t=>t.name==='start_process'))throw new Error('Engine catalog unavailable');
    const pin=JSON.parse(await readFile(path.join(root,'upstream.json'),'utf8'));
    const build=JSON.parse(await readFile(path.join(root,'.runtime/k3-build.json'),'utf8'));
    if(pin.commit!==build.upstream)throw new Error('Engine source pin differs');
    return {engine:'k3-commander',tools:tools.length,upstream:pin.commit};
  } finally {await client.close();await rm(directory,{recursive:true,force:true});}
}
