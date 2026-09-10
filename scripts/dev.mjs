import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';

const children = [];
if (existsSync('.env'))
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2] ?? '';
  }
const run = (command, args, options = {}) => {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  children.push(child);
  return child;
};
run('docker', ['compose', 'up', '-d', 'dynamodb']);
const waitForDb = () =>
  new Promise((resolve) => {
    const timer = setInterval(() => {
      const request = http.get('http://localhost:8120', () => {
        clearInterval(timer);
        request.destroy();
        resolve();
      });
      request.on('error', () => request.destroy());
    }, 500);
  });
await waitForDb();
run('corepack', ['pnpm', '--filter', '@court-manager/api', 'dev']);
run('corepack', ['pnpm', '--filter', '@court-manager/web', 'dev']);
const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', shutdown);
