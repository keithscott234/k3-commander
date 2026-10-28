import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import path from 'node:path';
const execute=promisify(execFile);
export const psQuote=s=>"'"+s.replaceAll("'","''")+"'";
export function identity(home){return 'k3-commander-portable-'+createHash('sha256').update(path.resolve(home)).digest('hex').slice(0,20);}
export function unitText(home,node,runner){
 const q=s=>'"'+s.replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%').split('$').join('$$')+'"';
 for(const s of [home,node,runner])if(/[\r\n\0]/.test(s))throw Error('Unsupported path');
 return '[Unit]\nDescription=K3 Commander portable connection\n[Service]\nType=simple\nExecStart='+[node,runner,home].map(q).join(' ')+'\nRestart=on-failure\nRestartSec=10\nTimeoutStopSec=15\nKillMode=control-group\nUMask=0077\nStandardOutput=null\nStandardError=null\n[Install]\nWantedBy=default.target\n';
}
export async function windows(action,{home,node=process.execPath,runner},exec=execute){
 for(const value of [home,node,runner].filter(Boolean))if(/[\x00-\x1f"\x7f]/.test(value))throw Error('Unsupported Windows command path');
 const name=psQuote(identity(home)), q=psQuote;
 let body;
 if(action==='register')body=`if(Get-ScheduledTask -TaskName ${name} -ErrorAction SilentlyContinue){throw 'Task already exists'}; $a=New-ScheduledTaskAction -Execute ${q(node)} -Argument ${q('"'+runner+'" "'+home+'"')}; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; $p=New-ScheduledTaskPrincipal -UserId $u -LogonType Interactive -RunLevel Limited; $t=New-ScheduledTaskTrigger -AtLogOn -User $u; $s=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; Register-ScheduledTask -TaskName ${name} -Action $a -Principal $p -Trigger $t -Settings $s | Out-Null`;
 else if(action==='start')body=`Enable-ScheduledTask -TaskName ${name} | Out-Null; Start-ScheduledTask -TaskName ${name}`;
 else if(action==='pause')body=`Disable-ScheduledTask -TaskName ${name} | Out-Null`;
 else if(action==='remove')body=`Unregister-ScheduledTask -TaskName ${name} -Confirm:$false`;
 else if(action==='status')body=`$t=Get-ScheduledTask -TaskName ${name} -ErrorAction SilentlyContinue; if($null -eq $t){'absent'}else{[string]$t.State}`;
 else throw Error('Unsupported task action');
 return exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; "+body],{timeout:20000,windowsHide:true,maxBuffer:65536});
}
export async function linux(action,home,exec=execute){
 const unit=identity(home)+'.service';
 const args=action==='register'?['daemon-reload']:action==='start'?['enable','--now',unit]:action==='pause'?['disable','--now',unit]:action==='remove'?['daemon-reload']:action==='status'?['show',unit,'--property=ActiveState,SubState,UnitFileState']:null;
 if(!args)throw Error('Unsupported service action');
 return exec('systemctl',['--user',...args],{timeout:20000,maxBuffer:65536});
}
