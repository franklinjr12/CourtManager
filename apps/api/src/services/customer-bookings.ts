import type {
  Court,
  CustomerAuthContext,
  CustomerReservationInput,
} from '@court-manager/contracts';
import { AppError } from '../errors.js';
import { BookingPolicyService } from './booking-policy.js';

type StaffContext = {
  organizationId: string;
  userId: string;
  role: 'STAFF';
};
type CourtReader = {
  list(ctx: StaffContext): Promise<unknown>;
  get(ctx: StaffContext, courtId: string): Promise<unknown>;
};
type ScheduleReader = {
  availability(
    ctx: StaffContext,
    court: Court,
    date: string,
    durationMinutes: number,
  ): Promise<string[]>;
};
type ReservationWriter = {
  create(ctx: StaffContext, input: Record<string, unknown>): Promise<unknown>;
};
type RequestWriter = {
  createForCustomer(
    customer: CustomerAuthContext,
    input: CustomerReservationInput,
  ): Promise<unknown>;
};

export class CustomerBookingService {
  constructor(
    private readonly policyService: BookingPolicyService,
    private readonly courts: CourtReader,
    private readonly schedule: ScheduleReader,
    private readonly reservations: ReservationWriter,
    private readonly requests: RequestWriter,
  ) {}
  private staffContext(customer: CustomerAuthContext) {
    return {
      organizationId: customer.organizationId,
      userId: `customer:${customer.customerAccountId}`,
      role: 'STAFF' as const,
    };
  }
  async policy(customer: CustomerAuthContext) {
    return this.policyService.policy(customer.organizationId);
  }
  async availability(
    customer: CustomerAuthContext,
    input: {
      courtId?: string;
      sport?: string;
      date: string;
      durationMinutes: number;
    },
  ) {
    const ctx = this.staffContext(customer);
    const policy = await this.policy(customer);
    const timezone = await this.policyService.organizationTimezone(
      customer.organizationId,
    );
    const window = this.policyService.customerBookingWindow(policy, timezone);
    const courts = ((await this.courts.list(ctx)) as Court[]).filter(
      (court) =>
        court.publiclyRequestable === true &&
        (!input.courtId || court.courtId === input.courtId) &&
        (!input.sport ||
          court.sport.toLocaleLowerCase() === input.sport.toLocaleLowerCase()),
    );
    if (input.courtId && !courts.length)
      throw new AppError('NOT_FOUND', 'Court is not publicly available.');
    const allowedDurations = [
      ...new Set(
        courts.flatMap((court) =>
          this.policyService.customerAllowedDurations(policy, court),
        ),
      ),
    ].sort((a, b) => a - b);
    if (policy.reservationMode === 'STAFF_ONLY')
      return { courts: [], allowedDurations, onlineBookingAvailable: false };
    if (input.date < window.firstDate || input.date > window.lastDate)
      return { courts: [], allowedDurations, onlineBookingAvailable: true };
    if (
      !courts.some((court) =>
        this.policyService
          .customerAllowedDurations(policy, court)
          .includes(input.durationMinutes),
      )
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Reservation duration is not allowed by venue policy.',
      );
    return {
      courts: await Promise.all(
        courts
          .filter((court) =>
            this.policyService
              .customerAllowedDurations(policy, court)
              .includes(input.durationMinutes),
          )
          .map(async (court) => ({
            courtId: court.courtId,
            name: court.name,
            sport: court.sport,
            slotMinutes: court.slotMinutes,
            available: await this.schedule.availability(
              ctx,
              court,
              input.date,
              input.durationMinutes,
            ),
          })),
      ),
      allowedDurations,
      onlineBookingAvailable: true,
    };
  }
  async create(customer: CustomerAuthContext, input: CustomerReservationInput) {
    const policy = await this.policy(customer);
    if (policy.reservationMode === 'REQUEST_APPROVAL')
      return this.requests.createForCustomer(customer, input);
    if (policy.reservationMode === 'AUTO_CONFIRM') {
      const ctx = this.staffContext(customer);
      const court = (await this.courts.get(ctx, input.courtId)) as Court;
      this.policyService.assertCustomerCanBook(
        policy,
        await this.policyService.organizationTimezone(customer.organizationId),
        court,
        input.startAt,
        input.endAt,
      );
      await this.policyService.assertCustomerCanCreateBooking(
        customer.organizationId,
        customer.customerId,
        policy,
      );
      return this.reservations.create(ctx, {
        ...input,
        customerId: customer.customerId,
        source: 'CUSTOMER_PORTAL',
      });
    }
    throw new AppError(
      'FORBIDDEN',
      'Online booking is disabled for this venue.',
    );
  }
}
