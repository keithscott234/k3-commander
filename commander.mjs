#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { ManagedTransport } from './lib/managed-transport.mjs';
import { SessionState, startControl, configDirectory, privateDirectory, localDevice } from './lib/control.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const runtime = path.join(root, '.runtime');
const pin = JSON.parse(readFileSync(path.join(root, 'upstream.json')));
const build = JSON.parse(readFileSync(path.join(runtime, 'k3-build.json')));
if (build.upstream !== pin.commit) throw new Error('K3 Commander engine revision mismatch; rebuild required.');
if (process.argv.length > 2) throw new Error('This build supports local MCP over stdio only; remote access is not available.');
const sdk = async p => import(pathToFileURL(path.join(runtime, 'node_modules/@modelcontextprotocol/sdk/dist/esm', p)).href);
const { Client } = await sdk('client/index.js');
const { ReadBuffer, serializeMessage } = await sdk('shared/stdio.js');
const { Server } = await sdk('server/index.js');
const { StdioServerTransport } = await sdk('server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = await sdk('types.js');
const allowed = new Set([
  'read_file', 'read_multiple_files', 'write_file', 'create_directory', 'list_directory',
  'move_file', 'start_search', 'get_more_search_results', 'stop_search', 'list_searches',
  'get_file_info', 'edit_block', 'start_process', 'read_process_output', 'interact_with_process',
  'force_terminate', 'list_sessions', 'list_processes', 'kill_process'
]);
const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'));
env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
const directory = configDirectory();
await privateDirectory(directory);
env.K3_COMMANDER_CONFIG_DIR = directory;
const state = new SessionState(localDevice());
const engine = new Client({name: 'k3-commander-engine-client', version: '0.1.0'});
const engineTransport = new ManagedTransport({ReadBuffer, serializeMessage, command: process.execPath,
  args: [path.join(runtime, 'engine-entry.mjs')], env});
try { await engine.connect(engineTransport); }
catch (error) { await engineTransport.close(); throw error; }
const catalog = (await engine.listTools()).tools.filter(t => allowed.has(t.name)).map(t => ({
  name: t.name, description: t.description?.replaceAll('Desktop Commander', 'K3 Commander'),
  inputSchema: t.inputSchema, ...(t.annotations ? {annotations: t.annotations} : {})
}));
if (catalog.length !== allowed.size) { await engine.close(); throw new Error('Required engine tools missing'); }
const server = new Server({name: 'k3-commander', version: '0.1.0'}, {capabilities: {tools: {}}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({tools: catalog}));
server.setRequestHandler(CallToolRequestSchema, async ({params}) => {
  if (!allowed.has(params.name)) return {isError: true, content: [{type: 'text', text: 'Tool is not enabled in K3 Commander.'}]};
  // No request counter, credit balance, trial expiry, or monthly quota.
  return await state.call(params.name, () => engine.callTool({name: params.name, arguments: params.arguments}));
});
let control;
let closing;
async function stopEngine() { await engineTransport.close(); await engine.close(); }
function close() {
  if (!closing) closing = (async () => {
    try { await state.stop(stopEngine); }
    finally { await control?.close(); await server.close(); }
  })();
  return closing;
}
server.onclose = () => { void close().catch(() => { process.exitCode = 1; }); };
engine.onclose = () => { void state.stop(stopEngine).catch(() => {}); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  void close().catch(() => { process.exitCode = 1; });
});
try {
  control = await startControl({state, directory, stopEngine});
  await server.connect(new StdioServerTransport());
} catch (error) { await close(); throw error; }
