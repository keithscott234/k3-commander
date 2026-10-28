import {hostname} from 'node:os';
import {readFileSync} from 'node:fs';
const glyphs={
 K:['█   █','█  █ ','███  ','█  █ ','█   █'],
 3:['████ ','    █',' ███ ','    █','████ '],
 C:[' ████','█    ','█    ','█    ',' ████'],
 O:[' ███ ','█   █','█   █','█   █',' ███ '],
 M:['█   █','██ ██','█ █ █','█   █','█   █'],
 A:[' ███ ','█   █','█████','█   █','█   █'],
 N:['█   █','██  █','█ █ █','█  ██','█   █'],
 D:['████ ','█   █','█   █','█   █','████ '],
 E:['█████','█    ','████ ','█    ','█████'],
 R:['████ ','█   █','████ ','█  █ ','█   █'],
 ' ':['  ','  ','  ','  ','  ']
};
function version(){try{return JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;}catch{return 'development';}}
export function createTerminalUI({stream=process.stdout,env=process.env,now=()=>new Date(),device=hostname(),release=version()}={}){
 const interactive=!!stream.isTTY;
 let decorated=false;
 const clean=s=>String(s).replace(/[\x00-\x1f\x7f-\x9f]/g,'');
 const color=interactive&&!Object.hasOwn(env,'NO_COLOR')&&env.TERM!=='dumb';
 const line=s=>stream.write((decorated?'['+now().toLocaleTimeString('en-GB',{hour12:false})+'] ':'')+s+'\n');
 const log=value=>{for(const s of String(value).split(/\r?\n/))line(s);};
 const title=s=>line(color?'\x1b[36;1m'+s+'\x1b[0m':s);
 function intro(args){
  if(!interactive||args[0]!=='remote'||args.includes('--help'))return;
  decorated=true;
  const text=(stream.columns||80)>=80?'K3 COMMANDER':'K3';
  if(env.TERM==='dumb')title('K3 COMMANDER');
  else{for(let row=0;row<5;row++)title([...text].map(c=>glyphs[c][row]).join(' '));if(text==='K3')title('COMMANDER');}
  line('');title('Private device connection');
  line('Device: '+clean(device));line('Launcher: '+clean(release));
 }
 function present(state){
  if(!interactive)return;
  const modes={'windows-task':'Windows managed task',service:'Linux managed service','portable-background':'Portable background connection',foreground:'Foreground terminal'};
  line('Mode: '+(modes[state.mode]||'Local setup'));
 }
 function started(mode){
  if(!interactive)return;
  line('');
  line('Next: return to ChatGPT and verify this device with a read-only tool call.');
  if(mode==='foreground'){line('Keep this terminal open; you can minimize it.');line('Press Ctrl+C to disconnect.');}
  else line('Background launch requested. This terminal can be closed.');
  line('Help: k3-commander remote --help');
  if(mode==='portable-background')line('Controls: k3-commander background status | stop | reconnect | disable');
 }
 return {intro,log,present,started};
}
