#!/usr/bin/env node
import {run} from './lib/remote-cli.mjs';
import {createTerminalUI} from './lib/terminal-ui.mjs';
const ui=createTerminalUI();
ui.intro(process.argv.slice(2));

run(process.argv.slice(2),{log:ui.log,present:ui.present,started:ui.started}).then(code => { process.exitCode = code; }).catch(() => {
  console.error('K3 Commander startup failed. Run remote --check to inspect prerequisites.');
  process.exitCode = 1;
});
