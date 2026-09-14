import { describe, expect, it } from 'vitest';
import { hashToken } from '../security.js';
import {
  call,
  forceExpire,
  journey,
  tokenFromLink,
} from '../testing/journey-fixture.js';

describe('journey: customer account lifecycle', () => {
  it('registers a new customer, signs out, and signs back in', async () => {
    const { app, customer, customerLogin, password } = await journey();
    const ana = await customer({ email: 'ana@journey.test' });
    expect((await call(app, 'GET', '/customer/me', ana.token)).status).toBe(
      200,
    );
    expect(
      (await call(app, 'POST', '/customer-auth/logout', ana.token)).status,
    ).toBe(200);
    expect((await call(app, 'GET', '/customer/me', ana.token)).status).toBe(
      401,
    );
    expect(
      (await customerLogin('ana@journey.test', 'wrong-password')).status,
    ).toBe(401);
    const again = await customerLogin('ana@journey.test', password);
    expect(again.status).toBe(200);
    expect(again.body.data.customerId).toBe(ana.customerId);
  });

  it('activates portal access for a staff-created customer exactly once', async () => {
    const { app, repo, venue, staffLogin, customerLogin } = await journey();
    const staff = await staffLogin();
    const created = await call(app, 'POST', '/customers', staff, {
      name: 'Walk-in Bruno',
      phone: '41988887777',
      email: 'bruno@journey.test',
    });
    expect(created.status).toBe(201);
    const customerId = created.body.data.customerId as string;

    expect((await customerLogin('bruno@journey.test', 'anything')).status).toBe(
      401,
    );
    const access = await call(
      app,
      'POST',
      `/customers/${customerId}/portal-access`,
      staff,
    );
    expect(access.status).toBe(200);
    const token = tokenFromLink(access.body.data.link);

    const activate = (value: string, pw: string) =>
      call(
        app,
        'POST',
        `/public/venues/${venue.slug}/portal/activate`,
        undefined,
        { token: value, password: pw },
      );
    expect((await activate(token, 'first-password')).status).toBe(200);
    const login = await customerLogin('bruno@journey.test', 'first-password');
    expect(login.status).toBe(200);
    expect(login.body.data.customerId).toBe(customerId);

    // A used link cannot set a new password.
    expect((await activate(token, 'hijack')).status).toBe(401);
    expect((await customerLogin('bruno@journey.test', 'hijack')).status).toBe(
      401,
    );

    // An expired link is rejected as well.
    const second = await call(
      app,
      'POST',
      `/customers/${customerId}/portal-access`,
      staff,
    );
    const expiring = tokenFromLink(second.body.data.link);
    const [tokenRecord] = await repo.scan(
      (item) =>
        item.entity === 'customerAccountToken' &&
        item.tokenHash === hashToken(expiring),
    );
    await forceExpire(repo, { PK: tokenRecord!.PK, SK: tokenRecord!.SK });
    expect((await activate(expiring, 'late-password')).status).toBe(401);
  });

  it('resets a forgotten password through a staff-issued reset link', async () => {
    const { app, venue, customer, customerLogin, staffLogin, password } =
      await journey();
    const ana = await customer({ email: 'reset@journey.test' });
    const staff = await staffLogin();
    const reset = await call(
      app,
      'POST',
      `/customers/${ana.customerId}/portal-reset`,
      staff,
    );
    expect(reset.status).toBe(200);
    const token = tokenFromLink(reset.body.data.link);
    // An activation endpoint must not accept a reset token.
    expect(
      (
        await call(
          app,
          'POST',
          `/public/venues/${venue.slug}/portal/activate`,
          undefined,
          { token, password: 'wrong-flow' },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await call(app, 'POST', '/customer-auth/reset-password', undefined, {
          slug: venue.slug,
          token,
          password: 'new-password',
        })
      ).status,
    ).toBe(200);
    expect((await customerLogin('reset@journey.test', password)).status).toBe(
      401,
    );
    expect(
      (await customerLogin('reset@journey.test', 'new-password')).status,
    ).toBe(200);
  });

  it('disables portal access, ending existing sessions, and re-enables through activation', async () => {
    const { app, venue, customer, customerLogin, staffLogin, password } =
      await journey();
    const ana = await customer({ email: 'disabled@journey.test' });
    const staff = await staffLogin();

    expect(
      (await call(app, 'POST', `/customers/${ana.customerId}/portal-disable`))
        .status,
    ).toBe(401);
    expect(
      (
        await call(
          app,
          'POST',
          `/customers/${ana.customerId}/portal-disable`,
          ana.token,
        )
      ).status,
    ).toBe(401);
    const disabled = await call(
      app,
      'POST',
      `/customers/${ana.customerId}/portal-disable`,
      staff,
    );
    expect(disabled.status).toBe(200);
    expect(disabled.body.data).toMatchObject({ status: 'DISABLED' });

    expect((await call(app, 'GET', '/customer/me', ana.token)).status).toBe(
      401,
    );
    expect(
      (await customerLogin('disabled@journey.test', password)).status,
    ).toBe(401);

    const access = await call(
      app,
      'POST',
      `/customers/${ana.customerId}/portal-access`,
      staff,
    );
    expect(access.status).toBe(200);
    expect(
      (
        await call(
          app,
          'POST',
          `/public/venues/${venue.slug}/portal/activate`,
          undefined,
          { token: tokenFromLink(access.body.data.link), password: 'back' },
        )
      ).status,
    ).toBe(200);
    expect((await customerLogin('disabled@journey.test', 'back')).status).toBe(
      200,
    );
  });

  it('returns not found when disabling a customer without portal access', async () => {
    const { app, staffLogin } = await journey();
    const staff = await staffLogin();
    const created = await call(app, 'POST', '/customers', staff, {
      name: 'No portal',
      phone: '41977776666',
    });
    expect(
      (
        await call(
          app,
          'POST',
          `/customers/${created.body.data.customerId}/portal-disable`,
          staff,
        )
      ).status,
    ).toBe(404);
  });

  it('keeps the same email in two venues as separate customers', async () => {
    const { app, venue, otherVenue, customer, staffLogin } = await journey();
    const inAlpha = await customer({ email: 'shared@journey.test' }, venue);
    const inBeta = await customer(
      { email: 'shared@journey.test', name: 'Beta Ana' },
      otherVenue,
    );
    expect(inAlpha.customerId).not.toBe(inBeta.customerId);

    const alphaMe = await call(app, 'GET', '/customer/me', inAlpha.token);
    const betaMe = await call(app, 'GET', '/customer/me', inBeta.token);
    expect(alphaMe.body.data.customer).toMatchObject({
      customerId: inAlpha.customerId,
      organizationId: venue.organizationId,
    });
    expect(betaMe.body.data.customer).toMatchObject({
      customerId: inBeta.customerId,
      organizationId: otherVenue.organizationId,
      name: 'Beta Ana',
    });

    // Disabling in one venue does not affect the other.
    await call(
      app,
      'POST',
      `/customers/${inAlpha.customerId}/portal-disable`,
      await staffLogin(venue),
    );
    expect((await call(app, 'GET', '/customer/me', inAlpha.token)).status).toBe(
      401,
    );
    expect((await call(app, 'GET', '/customer/me', inBeta.token)).status).toBe(
      200,
    );
    // Staff of venue B cannot manage venue A's customer.
    expect(
      (
        await call(
          app,
          'POST',
          `/customers/${inAlpha.customerId}/portal-access`,
          await staffLogin(otherVenue),
        )
      ).status,
    ).toBe(404);
  });
});
