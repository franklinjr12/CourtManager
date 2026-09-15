import { expect, test } from '@playwright/test';
import { login, loginCustomer } from './support/auth.js';
import { apiAs, createIsolatedVenue, useEnglish } from './support/venue.js';

test('staff can grant a makeup credit from a roster and the customer can view it', async ({
  page,
}) => {
  test.setTimeout(60000);
  const venue = await createIsolatedVenue({ prefix: 'makeup' });
  const coachId = `coach-${Date.now()}`;
  await venue.repo.put({
    PK: `ORG#${venue.organizationId}`,
    SK: `USER#${coachId}`,
    entity: 'user',
    organizationId: venue.organizationId,
    userId: coachId,
    name: 'Makeup Coach',
    email: `${coachId}@makeup.test`,
    role: 'COACH',
    active: true,
    passwordHash: 'unused',
  });
  const registered = await venue.services.customerAccounts.register(
    venue.slug,
    {
      name: 'Makeup Customer',
      email: `makeup-${Date.now()}@customer.test`,
      phone: `8${Date.now().toString().slice(-9)}`,
      password: 'makeup-password',
    },
  );
  const customerId = String(registered.customer.customerId);
  await venue.services.classes.create(venue.owner, {
    name: 'Makeup Class',
    sport: 'Tennis',
    coachId,
    courtId: venue.court.courtId,
    capacity: 5,
    pricePerParticipant: 40,
    scheduleType: 'SINGLE',
    startDate: '2099-01-05',
    startTime: '10:00',
    durationMinutes: 60,
  });
  const classes = await venue.services.classes.list(venue.owner);
  const classRecord = classes.find((item) => item.name === 'Makeup Class')!;
  await venue.services.classes.enroll(
    venue.owner,
    classRecord.classId,
    customerId,
  );
  const loginResponse = await page.request.post(
    'http://localhost:8787/auth/login',
    {
      data: { email: venue.ownerEmail, password: venue.ownerPassword },
    },
  );
  const token = ((await loginResponse.json()) as { data: { token: string } })
    .data.token;
  const classDetail = await apiAs(token, `/classes/${classRecord.classId}`);
  const sessionId = classDetail.body.data.sessions[0].sessionId as string;

  await useEnglish(page);
  await login(page, {
    email: venue.ownerEmail,
    password: venue.ownerPassword,
  });
  await page.goto(`/class-sessions/${sessionId}`);
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Grant makeup credit' }).click();
  const form = page.locator('#makeup-credit-form');
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Grant makeup credit' }).click();
  await expect(page.getByRole('heading', { name: 'Roster' })).toBeVisible();

  const staffLogin = await page.request.post(
    'http://localhost:8787/auth/login',
    {
      data: { email: venue.ownerEmail, password: venue.ownerPassword },
    },
  );
  const staffToken = ((await staffLogin.json()) as { data: { token: string } })
    .data.token;
  const history = await apiAs(
    staffToken,
    `/customers/${customerId}/makeup-credits`,
  );
  expect(history.body.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        originClassId: classRecord.classId,
        originSessionId: sessionId,
        reason: 'STAFF_GRANTED',
      }),
    ]),
  );

  await loginCustomer(
    page,
    venue.slug,
    registered.account.email,
    'makeup-password',
  );
  await page.goto(`/portal/${venue.slug}/profile`);
  await expect(
    page.getByRole('heading', { name: 'Makeup credits' }),
  ).toBeVisible();
  await expect(page.locator('#portal-makeup-credits')).toContainText(
    'From class',
  );
});
