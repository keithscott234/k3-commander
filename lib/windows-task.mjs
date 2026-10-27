import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const taskName = 'K3 Commander Windows Reconnect';
const prefix = "$ErrorActionPreference='Stop'; ";
const query = "$t=Get-ScheduledTask -TaskPath '\\' -TaskName '"+taskName+"' -ErrorAction SilentlyContinue; ";
export async function inspectWindowsTask(exec=execute) {
  // Query only the fixed task identity. Never execute task action text ourselves.
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    prefix+query+"if ($null -eq $t) { 'absent' } elseif ($t.State -eq 'Disabled') { 'disabled' } else { 'present' }"],
    {timeout:15000,windowsHide:true});
  const state=stdout.trim();
  if (!['absent','disabled','present'].includes(state)) throw new Error('Unexpected task status');
  return state;
}
export async function startWindowsTask(exec=execute) {
  await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    prefix+query+"if ($null -eq $t -or $t.State -eq 'Disabled') { throw 'Reconnect task unavailable' }; if ($t.State -ne 'Running') { Start-ScheduledTask -InputObject $t }"],
    {timeout:15000,windowsHide:true});
}
