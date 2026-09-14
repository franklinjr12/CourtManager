import { describe, expect, it } from 'vitest';
import { Router } from './router.js';
describe('router', () => {
  it('matches params and cleans up popstate listener', () => {
    const router = new Router();
    router.add('/customers/:id', () => {});
    router.add('/portal/:slug/reservations/:id', () => {});
    expect(router.match('/customers/a%20b')?.params.id).toBe('a b');
    expect(router.match('/portal/my-club/reservations/res-1')?.params).toEqual({
      slug: 'my-club',
      id: 'res-1',
    });
    const cleanup = router.listen(() => {});
    cleanup();
  });
});
