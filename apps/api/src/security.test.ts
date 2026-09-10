import { describe, expect, it } from 'vitest';
import {
  createToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from './security.js';
describe('security', () => {
  it('hashes passwords and never returns the source', async () => {
    const hash = await hashPassword('secret');
    expect(hash).not.toContain('secret');
    expect(await verifyPassword('secret', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });
  it('creates opaque tokens and hashes them', () => {
    const token = createToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashToken(token)).not.toBe(token);
  });
});
