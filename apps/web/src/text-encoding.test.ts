import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const screensDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  'screens',
);

describe('frontend source encoding', () => {
  it('does not contain common UTF-8 mojibake markers', () => {
    const source = readdirSync(screensDirectory)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => readFileSync(join(screensDirectory, file), 'utf8'))
      .join('\n');

    expect(source).not.toMatch(/[ÃÂâ][^\n]{0,12}(?:[ÃÂâ]|€|‚|™|œ|ž)/);
  });
});
