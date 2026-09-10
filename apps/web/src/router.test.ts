import { describe, expect, it } from 'vitest';
import { Router } from './router.js';
describe('router', () => {
  it('matches params and cleans up popstate listener', () => {
    const router = new Router();
    router.add('/customers/:id', () => {});
    expect(router.match('/customers/a%20b')?.params.id).toBe('a b');
    const cleanup = router.listen(() => {});
    cleanup();
  });
});
