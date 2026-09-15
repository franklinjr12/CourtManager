import { createHash } from 'node:crypto';
import {
  CustomerCommercialActivityEventSchema,
  type CustomerCommercialActivityEvent,
} from '@court-manager/contracts';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';

const now = () => new Date().toISOString();

export type CommercialActivityEventInput = Omit<
  CustomerCommercialActivityEvent,
  'eventId' | 'createdAt'
> & {
  /** Distinguishes repeated lifecycle events for the same source. */
  dedupeKey?: string;
  createdAt?: string;
};

const eventIdFor = (input: CommercialActivityEventInput) => {
  const identity = [
    input.organizationId,
    input.customerId,
    input.eventType,
    input.sourceType,
    input.sourceId,
    input.dedupeKey ?? 'default',
  ].join('|');
  return `commercial-event-${createHash('sha256').update(identity).digest('hex').slice(0, 48)}`;
};

/** Records customer-facing commercial facts without adding retention logic. */
export class CommercialActivityEventService {
  constructor(private readonly persistence: Phase3Persistence) {}

  async record(input: CommercialActivityEventInput) {
    const event = CustomerCommercialActivityEventSchema.parse({
      ...input,
      eventId: eventIdFor(input),
      createdAt: input.createdAt ?? now(),
    });
    return this.persistence.putCustomerActivityEvent(event);
  }
}
