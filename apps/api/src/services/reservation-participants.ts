import { randomUUID } from 'node:crypto';
import {
  CustomerReservationParticipantSchema,
  ReservationParticipantInputSchema,
  type CustomerAuthContext,
  type ReservationParticipantInput,
  type ReservationParticipantsPage,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { normalizeEmail, normalizePhone } from '../domain.js';
import { AppError } from '../errors.js';

const participantKey = (
  ctx: CustomerAuthContext,
  reservationId: string,
  participantId = '',
) => ({
  PK: `RESERVATION_PARTICIPANTS#${ctx.organizationId}#${reservationId}`,
  SK: `PARTICIPANT#${participantId}`,
});

export class ReservationParticipantService {
  constructor(private readonly repo: Repository) {}

  private async reservation(ctx: CustomerAuthContext, reservationId: string) {
    const record = await this.repo.get({
      PK: `RESERVATION#${reservationId}`,
      SK: 'META',
    });
    if (
      !record ||
      record.organizationId !== ctx.organizationId ||
      record.customerId !== ctx.customerId
    )
      throw new AppError('NOT_FOUND', 'Reservation was not found.');
    return record;
  }

  private mutable(reservation: RecordItem) {
    return (
      reservation.status === 'BOOKED' &&
      Date.parse(String(reservation.startAt)) > Date.now()
    );
  }

  async list(
    ctx: CustomerAuthContext,
    reservationId: string,
    cursor?: string,
  ): Promise<ReservationParticipantsPage> {
    const reservation = await this.reservation(ctx, reservationId);
    if (cursor && !/^[0-9a-f-]{36}$/.test(cursor))
      throw new AppError('VALIDATION_ERROR', 'Invalid participant cursor.');
    const key = participantKey(ctx, reservationId);
    const rows = await this.repo.query(key.PK, {
      between: [cursor ? `${key.SK}${cursor}\u0000` : key.SK, `${key.SK}~`],
      limit: 51,
    });
    const page = rows.slice(0, 50);
    return {
      participants: page
        .filter(
          (row) =>
            row.organizationId === ctx.organizationId &&
            row.reservationId === reservationId,
        )
        .map((row) => CustomerReservationParticipantSchema.parse(row)),
      mutable: this.mutable(reservation),
      nextCursor: rows.length > 50 ? String(page.at(-1)!.participantId) : null,
    };
  }

  // Only existing exact-contact lookup records are used. Missing or stale
  // lookups leave participants unresolved; never scan the customer directory.
  private async linkedCustomer(
    ctx: CustomerAuthContext,
    input: ReservationParticipantInput,
  ) {
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone ?? '');
    const keys = [
      ...(email
        ? [
            {
              PK: `CUSTOMER_ACCOUNT_EMAIL#${ctx.organizationId}#${email}`,
              SK: 'META',
            },
          ]
        : []),
      ...(phone
        ? [
            {
              PK: `CUSTOMER_IDENTITY_PHONE#${ctx.organizationId}#${phone}`,
              SK: 'META',
            },
          ]
        : []),
    ];
    if (!keys.length) return undefined;
    const lookups = await this.repo.batchGet(keys);
    const ids = [
      ...new Set(
        lookups
          .filter(
            (row) =>
              row.organizationId === ctx.organizationId &&
              typeof row.customerId === 'string',
          )
          .map((row) => String(row.customerId)),
      ),
    ];
    if (!ids.length) return undefined;
    const customers = await this.repo.batchGet(
      ids.map((id) => ({
        PK: `ORG#${ctx.organizationId}`,
        SK: `CUSTOMER#${id}`,
      })),
    );
    const matches = customers.filter(
      (row) =>
        row.organizationId === ctx.organizationId &&
        !row.archived &&
        ((email && normalizeEmail(String(row.email ?? '')) === email) ||
          (phone && normalizePhone(String(row.phone ?? '')) === phone)),
    );
    return matches.length === 1 && matches[0]!.customerId !== ctx.customerId
      ? String(matches[0]!.customerId)
      : undefined;
  }

  async save(
    ctx: CustomerAuthContext,
    reservationId: string,
    participantId: string,
    input: ReservationParticipantInput,
  ) {
    const values = ReservationParticipantInputSchema.parse(input);
    return this.write(ctx, reservationId, participantId, values);
  }

  async remove(
    ctx: CustomerAuthContext,
    reservationId: string,
    participantId: string,
  ) {
    return this.write(ctx, reservationId, participantId);
  }

  private async write(
    ctx: CustomerAuthContext,
    reservationId: string,
    participantId: string,
    input?: ReservationParticipantInput,
  ) {
    if (!/^[0-9a-f-]{36}$/.test(participantId))
      throw new AppError('VALIDATION_ERROR', 'Invalid participant ID.');
    const reservation = await this.reservation(ctx, reservationId);
    const key = participantKey(ctx, reservationId, participantId);
    const previous = await this.repo.get(key);
    if (
      previous &&
      (previous.organizationId !== ctx.organizationId ||
        previous.reservationId !== reservationId)
    )
      throw new AppError('NOT_FOUND', 'Participant was not found.');
    if (!input && !previous)
      throw new AppError('NOT_FOUND', 'Participant was not found.');
    // Idempotent removal retains the original historical record.
    if (!input && previous?.status === 'REMOVED')
      return CustomerReservationParticipantSchema.parse(previous);
    if (!this.mutable(reservation))
      throw new AppError(
        'INVALID_STATE',
        'Participants can only change before a booked reservation starts.',
      );
    if (input && previous?.status === 'REMOVED')
      throw new AppError(
        'INVALID_STATE',
        'Removed participants cannot be restored.',
      );
    const timestamp = new Date().toISOString();
    const customerId = input
      ? await this.linkedCustomer(ctx, input)
      : previous?.customerId;
    const item: RecordItem = input
      ? {
          ...key,
          entity: 'reservationParticipant',
          organizationId: ctx.organizationId,
          reservationId,
          participantId,
          ...input,
          ...(customerId ? { customerId } : {}),
          status: 'ACTIVE',
          createdByActorType: 'CUSTOMER',
          createdAt: previous?.createdAt ?? timestamp,
          updatedAt: timestamp,
          revision: randomUUID(),
        }
      : {
          ...previous!,
          status: 'REMOVED',
          removedAt: timestamp,
          updatedAt: timestamp,
          revision: randomUUID(),
        };
    await this.repo.transactWrite([
      {
        type: 'check',
        key: { PK: reservation.PK, SK: reservation.SK },
        expected: {
          organizationId: ctx.organizationId,
          customerId: ctx.customerId,
          status: 'BOOKED',
          startAt: reservation.startAt,
        },
      },
      {
        type: 'put',
        item,
        ...(previous
          ? { expected: { revision: previous.revision } }
          : { condition: 'attribute_not_exists(PK)' }),
      },
    ]);
    return CustomerReservationParticipantSchema.parse(item);
  }
}
