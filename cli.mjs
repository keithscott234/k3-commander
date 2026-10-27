#!/usr/bin/env node
import {run} from './lib/remote-cli.mjs';

run(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(() => {
  console.error('K3 Commander startup failed. Run remote --check to inspect prerequisites.');
  process.exitCode = 1;
});
