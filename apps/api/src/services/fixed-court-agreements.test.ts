import type {
  AuthContext,
  FixedCourtOccurrence,
} from '@court-manager/contracts';
import { describe, expect, it } from 'vitest';
import { MemoryRepository } from '../db.js';
import { buildServices } from './index.js';

const owner: AuthContext = {
  organizationId: 'org-fixed-court',
  userId: 'owner-fixed-court',
  role: 'OWNER',
};

const openingHours = Object.fromEntries(
  [
    'MONDAY',
    'TUESDAY',
    'WEDNESDAY',
    'THURSDAY',
    'FRIDAY',
    'SATURDAY',
    'SUNDAY',
  ].map((day) => [day, { open: '07:00', close: '23:00' }]),
);

async function setup() {
  const repo = new MemoryRepository();
  await repo.put({
    PK: `ORG#${owner.organizationId}`,
    SK: 'META',
    entity: 'organization',
    organizationId: owner.organizationId,
    timezone: 'UTC',
    currency: 'BRL',
  });
  const services = buildServices(repo);
  const court = await services.courts.create(owner, {
    name: 'Court 1',
    sport: 'Tennis',
    slotMinutes: 30,
    defaultHourlyPrice: 80,
    publiclyRequestable: true,
    active: true,
    openingHours,
  });
  const customer = await services.customers.create(owner, {
    name: 'João',
    phone: '41999990000',
  });
  return { repo, services, court, customer };
}

const agreementInput = (courtId: string, customerId: string) => ({
  courtId,
  customerId,
  weekday: 'WEDNESDAY' as const,
  startTime: '19:00',
  durationMinutes: 120,
  intervalWeeks: 1,
  startDate: '2027-01-06',
  endDate: '2027-02-20',
  monthlyPrice: 600,
  currency: 'BRL',
  timezone: 'UTC',
});

describe('fixed recurring court agreements', () => {
  it('creates linked occupancy, bills at the agreement level, and avoids reservation debt', async () => {
    const { services, court, customer } = await setup();
    const agreement = (await services.fixedCourtAgreements.create(
      owner,
      agreementInput(String(court.courtId), String(customer.customerId)),
    )) as { agreementId: string; occurrences: FixedCourtOccurrence[] };

    expect(agreement.occurrences).toHaveLength(7);
    expect(agreement.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2027-01-06',
          status: 'BOOKED',
          reservationId: expect.any(String),
        }),
      ]),
    );
    expect(
      await services.charges.list(owner, { sourceType: 'RESERVATION' }),
    ).toEqual([]);
    expect(
      await services.charges.list(owner, {
        sourceType: 'FIXED_COURT_AGREEMENT',
      }),
    ).toEqual([
      expect.objectContaining({
        sourceId: agreement.agreementId,
        fixedCourtAgreementId: agreement.agreementId,
        amount: 600,
      }),
    ]);

    await services.fixedCourtAgreements.bill(owner, agreement.agreementId);
    await services.fixedCourtAgreements.bill(owner, agreement.agreementId, {
      periodStartDate: '2027-02-06',
    });
    expect(
      (
        (await services.charges.list(owner, {
          sourceType: 'FIXED_COURT_AGREEMENT',
        })) as unknown as Array<{ sourceId: string }>
      ).filter((charge) => charge.sourceId === agreement.agreementId),
    ).toHaveLength(2);
  });

  it('previews conflicts and preserves historical occurrences when paused or moved', async () => {
    const { repo, services, court, customer } = await setup();
    const first = await services.reservations.create(owner, {
      courtId: String(court.courtId),
      customerId: String(customer.customerId),
      startAt: '2027-01-13T19:00:00.000Z',
      endAt: '2027-01-13T21:00:00.000Z',
      expectedAmount: 160,
      source: 'STAFF',
    });
    const preview = await services.fixedCourtAgreements.create(owner, {
      ...agreementInput(String(court.courtId), String(customer.customerId)),
      preview: true,
    });
    expect(preview.conflicts).toEqual(['2027-01-13']);
    expect(first).toEqual(expect.objectContaining({ status: 'BOOKED' }));

    const agreement = (await services.fixedCourtAgreements.create(owner, {
      ...agreementInput(String(court.courtId), String(customer.customerId)),
      skipConflicts: true,
    })) as { agreementId: string; occurrences: FixedCourtOccurrence[] };
    const historical = agreement.occurrences.find(
      (occurrence) => occurrence.date === '2027-01-06',
    );
    await services.fixedCourtAgreements.pause(owner, agreement.agreementId, {
      effectiveDate: '2027-01-20',
    });
    expect(
      await services.fixedCourtAgreements.occurrences(
        owner,
        agreement.agreementId,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2027-01-06', status: 'BOOKED' }),
        expect.objectContaining({ date: '2027-01-20', status: 'CANCELLED' }),
      ]),
    );

    await services.fixedCourtAgreements.resume(owner, agreement.agreementId, {
      effectiveDate: '2027-01-20',
      skipConflicts: true,
    });
    const resumed = await services.fixedCourtAgreements.get(
      owner,
      agreement.agreementId,
    );
    expect(resumed.occurrences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: '2027-01-06', status: 'BOOKED' }),
      ]),
    );
    expect(historical?.reservationId).toBeDefined();
    const historicalReservation = await repo.get({
      PK: `RESERVATION#${historical?.reservationId}`,
      SK: 'META',
    });
    expect(historicalReservation?.status).toBe('BOOKED');
  });
});
