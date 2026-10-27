import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Dedicated process group on Unix: ordinary shell children inherit this group.
// This is lifecycle control, not a sandbox for deliberately detached processes.
export class ManagedTransport {
  constructor({command, args, env, ReadBuffer, serializeMessage}) {
    Object.assign(this, {command, args, env, serializeMessage});
    this.buffer = new ReadBuffer();
  }
  async start() {
    if (this.child) throw new Error('Engine already started');
    this.child = spawn(this.command, this.args, {env: this.env, shell: false,
      detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'inherit']});
    this.pid = this.child.pid;
    this.child.stdout.on('data', chunk => {
      try {
        this.buffer.append(chunk);
        let message;
        while ((message = this.buffer.readMessage()) !== null) this.onmessage?.(message);
      } catch (error) { this.onerror?.(error); void this.close().catch(() => {}); }
    });
    this.child.stdin.on('error', error => this.onerror?.(error));
    this.child.stdout.on('error', error => this.onerror?.(error));
    this.child.once('exit', () => {
      this.exited = true;
      void this.close().catch(error => this.onerror?.(error));
    });
    this.child.once('close', () => { this.onclose?.(); });
    await new Promise((resolve, reject) => {
      this.child.once('spawn', resolve);
      this.child.once('error', error => { this.onerror?.(error); reject(error); });
    });
  }
  async send(message) {
    if (this.closing || this.exited) throw new Error('Engine is stopped');
    await new Promise((resolve, reject) => this.child.stdin.write(this.serializeMessage(message), error => error ? reject(error) : resolve()));
  }
  close() {
    if (!this.closing) this.closing = this.stopTree();
    return this.closing;
  }
  async stopTree() {
    if (!this.pid) return;
    if (process.platform === 'win32') {
      // No shell interpolation; taskkill receives only a PID created by this instance.
      await new Promise((resolve, reject) => {
        const killer = spawn('taskkill.exe', ['/PID', String(this.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL'});
        killer.once('error', reject);
        killer.once('exit', code => code === 0 ? resolve() : reject(new Error('Windows process-tree termination failed')));
      });
    } else {
      const signal = name => {
        try { process.kill(-this.pid, name); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      };
      signal('SIGTERM');
      await delay(300);
      signal('SIGKILL'); // Also reaches children that ignored SIGTERM or outlived the parent.
    }
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.buffer.clear();
  }
}
