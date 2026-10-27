import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
export async function askLocal(question,{secret=false,input=process.stdin,output=process.stderr}={}) {
 if(!input.isTTY || !output.isTTY)throw Error('Device pairing requires an interactive terminal');
 if(!secret) {
  const rl=createInterface({input,output});
  try{return (await rl.question(question)).trim();}finally{rl.close();}
 }
 output.write(question);
 const silent=new Writable({write(_chunk,_encoding,callback){callback();}});
 const rl=createInterface({input,output:silent,terminal:true});
 try {return (await rl.question('')).trim();}
 finally {rl.close();output.write('\n');silent.end();}
}
