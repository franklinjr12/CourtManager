import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const envPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../.env',
);

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match?.[1] && process.env[match[1]] === undefined)
      process.env[match[1]] = match[2] ?? '';
  }
}
