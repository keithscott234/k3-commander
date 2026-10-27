import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, lstat } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function configDirectory() {
  const directory = process.env.K3_COMMANDER_CONFIG_DIR || path.join(homedir(), '.k3-commander');
  if (!path.isAbsolute(directory)) throw new Error('K3_COMMANDER_CONFIG_DIR must be absolute');
  return directory;
}
export async function privateDirectory(directory) {
  await mkdir(directory, {recursive: true, mode: 0o700});
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Control directory must be a real directory');
  if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) {
    throw new Error('Control directory must belong to this user and have mode 0700');
  }
}
export class SessionState {
  constructor(device) {
    this.device = device;
    this.mode = 'active';
    this.startedAt = new Date().toISOString();
    this.history = [];
    this.inFlight = 0;
  }
  snapshot() { return {device: this.device, mode: this.mode, startedAt: this.startedAt,
    inFlight: this.inFlight, history: this.history.map(entry => ({...entry})), quota: null}; }
  record(tool, status) {
    const row = {id: randomUUID(), tool, status, at: new Date().toISOString()};
    this.history.unshift(row);
    this.history.length = Math.min(this.history.length, 100);
    return row;
  }
  async call(name, operation) {
    if (this.mode !== 'active') {
      this.record(name, 'blocked');
      return {isError: true, content: [{type: 'text', text: `K3 Commander is ${this.mode}. Use the local control panel.`}]};
    }
    const row = this.record(name, 'running'), started = performance.now();
    this.inFlight++;
    try {
      const result = await operation();
      row.status = this.mode === 'stopping' || this.mode === 'stopped' ? 'interrupted' : result.isError ? 'failed' : 'completed';
      return result;
    } catch {
      row.status = this.mode === 'stopping' || this.mode === 'stopped' ? 'interrupted' : 'failed';
      return {isError: true, content: [{type: 'text', text: 'K3 Commander could not complete this operation. Check local session status.'}]};
    } finally { row.durationMs = Math.round(performance.now() - started); this.inFlight--; }
  }
  pause() { if (this.mode === 'active') this.mode = 'paused'; }
  resume() { if (this.mode !== 'paused') throw new Error('Only a paused session can resume. Restart a stopped session.'); this.mode = 'active'; }
  stop(stopEngine) {
    if (!this.stopping) {
      this.mode = 'stopping';
      this.stopping = Promise.resolve().then(stopEngine).then(() => { this.mode = 'stopped'; }, () => {
        this.mode = 'stop_failed'; throw new Error('Engine stop could not be confirmed');
      });
    }
    return this.stopping;
  }
}

export async function startControl({state, directory, stopEngine}) {
  await privateDirectory(directory);
  const sessions = path.join(directory, 'sessions');
  await privateDirectory(sessions);
  const id = randomUUID(), token = randomBytes(32).toString('hex');
  const file = path.join(sessions, `${id}.json`);
  const ui = fileURLToPath(new URL('../ui/', import.meta.url));
  const assets = new Map(await Promise.all([['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]
    .map(async ([url, name, type]) => [url, {body: await readFile(path.join(ui, name)), type}])));
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const reply = (code, value) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(value)); };
    // Exact Host and Origin checks prevent DNS rebinding and cross-origin browser requests.
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return reply(403, {error: 'Forbidden origin'});
    const asset = assets.get(req.url);
    if (req.method === 'GET' && asset) { res.writeHead(200, {'Content-Type': asset.type}); return res.end(asset.body); }
    const supplied = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, {error: 'Local authorization required'});
    if (req.method === 'GET' && req.url === '/api/status') return reply(200, state.snapshot());
    if (req.method !== 'POST' || !['/api/pause', '/api/resume', '/api/stop'].includes(req.url)) return reply(404, {error: 'Not found'});
    if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return reply(400, {error: 'This endpoint accepts no request body'});
    try {
      if (req.url === '/api/pause') state.pause();
      if (req.url === '/api/resume') state.resume();
      if (req.url === '/api/stop') await state.stop(stopEngine);
      reply(200, state.snapshot());
    } catch { reply(409, {error: 'Action unavailable. Check session state; stopped sessions must be restarted.'}); }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await writeFile(file, JSON.stringify({id, pid: process.pid, origin, token, device: state.device}), {mode: 0o600, flag: 'wx'});
  } catch (error) { server.close(); throw error; }
  return {id, origin, file, async close() {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }};
}
export function localDevice() { return {name: hostname(), platform: process.platform, pid: process.pid}; }
