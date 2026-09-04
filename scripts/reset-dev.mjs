import { spawnSync } from 'node:child_process';
const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8120';
if (!endpoint.includes('localhost') && !endpoint.includes('127.0.0.1')) throw new Error('reset:dev only accepts a local DynamoDB endpoint');
spawnSync('docker', ['compose', 'down', '-v'], { stdio: 'inherit', shell: process.platform === 'win32' });
spawnSync('docker', ['compose', 'up', '-d', 'dynamodb'], { stdio: 'inherit', shell: process.platform === 'win32' });
