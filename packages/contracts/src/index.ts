import { z } from 'zod';

export const IdentifierSchema = z.string().min(1).max(128);
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const MoneySchema = z.number().finite().nonnegative().max(10_000_000);
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});
export const RoleSchema = z.enum(['OWNER', 'STAFF', 'COACH']);
export const ReservationStatusSchema = z.enum([
  'BOOKED',
  'CHECKED_IN',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
export const ReservationSourceSchema = z.enum([
  'STAFF',
  'WHATSAPP',
  'PHONE',
  'WALK_IN',
  'PUBLIC_REQUEST',
  'OTHER',
]);
export const RequestStatusSchema = z.enum([
  'REQUESTED',
  'CONFIRMED',
  'REJECTED',
  'EXPIRED',
]);
export const WeekdaySchema = z.enum([
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]);
export const OpeningHourSchema = z.object({
  open: LocalTimeSchema,
  close: LocalTimeSchema,
});
export const OpeningHoursSchema = z.record(
  WeekdaySchema,
  OpeningHourSchema.nullable(),
);

export const OrganizationSchema = z.object({
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(160),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  active: z.boolean(),
  features: z.object({ classes: z.boolean(), finance: z.boolean() }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const UserSchema = z.object({
  userId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1),
  email: z.string().email(),
  role: RoleSchema,
  passwordHash: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const CourtSchema = z.object({
  courtId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(100),
  sport: z.string().min(1).max(80),
  sportId: IdentifierSchema.optional(),
  active: z.boolean(),
  publiclyRequestable: z.boolean(),
  slotMinutes: z.union([z.literal(30), z.literal(60)]),
  defaultHourlyPrice: MoneySchema,
  openingHours: OpeningHoursSchema,
  notes: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
});
export const SportSchema = z.object({
  sportId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(80),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const CustomerSchema = z.object({
  customerId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(160),
  normalizedPhone: z.string(),
  phone: z.string().optional(),
  normalizedEmail: z.string(),
  email: z.string().email().optional(),
  preferredSportId: IdentifierSchema.optional(),
  tags: z.array(z.string()).default([]),
  notes: z.string().max(4000).optional(),
  archived: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const ReservationSchema = z.object({
  reservationId: IdentifierSchema,
  organizationId: IdentifierSchema,
  courtId: IdentifierSchema,
  customerId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: ReservationStatusSchema,
  source: ReservationSourceSchema,
  expectedAmount: MoneySchema,
  notes: z.string().max(4000).optional(),
  seriesId: IdentifierSchema.optional(),
  createdBy: IdentifierSchema,
  createdAt: z.string(),
  updatedBy: IdentifierSchema,
  updatedAt: z.string(),
  checkedInAt: z.string().optional(),
  checkedInBy: IdentifierSchema.optional(),
  completedAt: z.string().optional(),
  completedBy: IdentifierSchema.optional(),
  cancelledAt: z.string().optional(),
  cancelledBy: IdentifierSchema.optional(),
  noShowAt: z.string().optional(),
  noShowBy: IdentifierSchema.optional(),
});
export const RequestSchema = z.object({
  requestId: IdentifierSchema,
  organizationId: IdentifierSchema,
  courtId: IdentifierSchema,
  requestedStartAt: z.string().datetime({ offset: true }),
  requestedEndAt: z.string().datetime({ offset: true }),
  customerName: z.string().min(1).max(160),
  phone: z.string().min(5).max(40),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
  status: RequestStatusSchema,
  linkedCustomerId: IdentifierSchema.optional(),
  linkedReservationId: IdentifierSchema.optional(),
  createdAt: z.string(),
  reviewedAt: z.string().optional(),
  reviewedBy: IdentifierSchema.optional(),
  rejectionReason: z.string().max(1000).optional(),
});
export const PaymentMethodSchema = z.enum([
  'PIX',
  'CASH',
  'CREDIT_CARD',
  'DEBIT_CARD',
  'BANK_TRANSFER',
  'OTHER',
]);
export const PaymentSchema = z.object({
  paymentId: IdentifierSchema,
  organizationId: IdentifierSchema,
  reservationId: IdentifierSchema.optional(),
  classId: IdentifierSchema.optional(),
  chargeId: IdentifierSchema.optional(),
  customerId: IdentifierSchema,
  amount: MoneySchema,
  method: PaymentMethodSchema,
  paidAt: z.string().datetime({ offset: true }),
  notes: z.string().max(2000).optional(),
  recordedBy: IdentifierSchema,
  createdAt: z.string(),
});
export const ExpenseCategorySchema = z.enum([
  'MAINTENANCE',
  'UTILITIES',
  'STAFF',
  'EQUIPMENT',
  'CLEANING',
  'MARKETING',
  'OTHER',
]);
export const ExpenseSchema = z.object({
  expenseId: IdentifierSchema,
  organizationId: IdentifierSchema,
  date: DateSchema,
  description: z.string().min(1).max(200),
  category: ExpenseCategorySchema,
  amount: MoneySchema,
  notes: z.string().max(2000).optional(),
  createdBy: IdentifierSchema,
  createdAt: z.string(),
});
export const ClassSchema = z.object({
  classId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1),
  sport: z.string().min(1),
  sportId: IdentifierSchema.optional(),
  type: z.enum(['GROUP', 'PRIVATE']).default('GROUP'),
  coachId: IdentifierSchema,
  courtId: IdentifierSchema,
  capacity: z.number().int().positive().max(500),
  price: MoneySchema.optional(),
  pricePerParticipant: MoneySchema.default(0),
  scheduleType: z.enum(['SINGLE', 'WEEKLY']).default('WEEKLY'),
  weekday: z.number().int().min(0).max(6).optional(),
  intervalWeeks: z.number().int().min(1).max(52).default(1),
  startTime: LocalTimeSchema,
  durationMinutes: z.number().int().positive().max(1440),
  startDate: DateSchema,
  endDate: DateSchema.optional(),
  active: z.boolean(),
  notes: z.string().max(2000).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const EnrollmentSchema = z.object({
  enrollmentId: IdentifierSchema,
  organizationId: IdentifierSchema,
  classId: IdentifierSchema,
  customerId: IdentifierSchema,
  status: z.enum(['ACTIVE', 'CANCELLED', 'INACTIVE']),
  joinedAt: z.string(),
  leftAt: z.string().optional(),
});
export const AttendanceSchema = z.object({
  attendanceId: IdentifierSchema,
  organizationId: IdentifierSchema,
  classId: IdentifierSchema,
  sessionId: IdentifierSchema.optional(),
  customerId: IdentifierSchema,
  date: DateSchema,
  status: z.enum(['PRESENT', 'ABSENT', 'EXCUSED']),
  recordedBy: IdentifierSchema,
  createdAt: z.string(),
});
export const ClassSessionStatusSchema = z.enum([
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
]);
export const ParticipantAttendanceStatusSchema = z.enum([
  'BOOKED',
  'CHECKED_IN',
  'COMPLETED',
  'NO_SHOW',
]);
export const ClassSessionSchema = z.object({
  sessionId: IdentifierSchema,
  organizationId: IdentifierSchema,
  classId: IdentifierSchema,
  courtId: IdentifierSchema,
  coachId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: ClassSessionStatusSchema,
  capacity: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  cancelledAt: z.string().optional(),
  cancelledBy: IdentifierSchema.optional(),
  cancellationReason: z.string().optional(),
  completedAt: z.string().optional(),
  completedBy: IdentifierSchema.optional(),
});
export const ChargeSchema = z.object({
  chargeId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  sourceType: z.enum(['RESERVATION', 'CLASS']),
  sourceId: IdentifierSchema,
  reservationId: IdentifierSchema.optional(),
  classId: IdentifierSchema.optional(),
  classSessionId: IdentifierSchema.optional(),
  description: z.string().min(1),
  amount: MoneySchema,
  serviceAt: z.string().datetime({ offset: true }),
  status: z.enum(['ACTIVE', 'VOID']),
  createdBy: IdentifierSchema,
  createdAt: z.string(),
  voidedAt: z.string().optional(),
  voidedBy: IdentifierSchema.optional(),
  voidReason: z.string().optional(),
});
export const BlockSchema = z.object({
  blockId: IdentifierSchema,
  organizationId: IdentifierSchema,
  courtId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.enum([
    'MAINTENANCE',
    'CLEANING',
    'PRIVATE_EVENT',
    'TOURNAMENT',
    'WEATHER',
    'STAFF_USE',
    'OTHER',
  ]),
  notes: z.string().max(2000).optional(),
  active: z.boolean(),
  createdBy: IdentifierSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export const CourtInputSchema = CourtSchema.omit({
  courtId: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
});
export const SportInputSchema = SportSchema.omit({
  sportId: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
});
export const CustomerInputSchema = CustomerSchema.omit({
  customerId: true,
  organizationId: true,
  normalizedPhone: true,
  normalizedEmail: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
});
export const ReservationInputSchema = z.object({
  courtId: IdentifierSchema,
  customerId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  expectedAmount: MoneySchema.optional(),
  source: ReservationSourceSchema.default('STAFF'),
  notes: z.string().max(4000).optional(),
});
export const RecurringReservationInputSchema = z.object({
  courtId: IdentifierSchema,
  customerId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  untilDate: DateSchema,
  frequency: z.literal('WEEKLY').default('WEEKLY'),
  intervalWeeks: z.number().int().min(1).max(52).default(1),
  expectedAmount: MoneySchema.optional(),
  source: ReservationSourceSchema.default('STAFF'),
  preview: z.boolean().default(false),
  skipConflicts: z.boolean().default(false),
  notes: z.string().max(4000).optional(),
});
export const RequestInputSchema = z.object({
  courtId: IdentifierSchema,
  requestedStartAt: z.string().datetime({ offset: true }),
  requestedEndAt: z.string().datetime({ offset: true }),
  customerName: z.string().min(1).max(160),
  phone: z.string().min(5).max(40),
  email: z.string().email().optional(),
  notes: z.string().max(2000).optional(),
  honeypot: z.string().max(0).optional(),
});
export const PaymentInputSchema = z
  .object({
    chargeId: IdentifierSchema.optional(),
    reservationId: IdentifierSchema.optional(),
    classId: IdentifierSchema.optional(),
    customerId: IdentifierSchema,
    amount: MoneySchema,
    method: PaymentMethodSchema,
    paidAt: z.string().datetime({ offset: true }),
    notes: z.string().max(2000).optional(),
  })
  .refine(
    (v) => [v.chargeId, v.reservationId, v.classId].filter(Boolean).length === 1,
    'Exactly one charge, reservation or class is required',
  );
export const BlockInputSchema = z.object({
  courtId: IdentifierSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  reason: z.enum([
    'MAINTENANCE',
    'CLEANING',
    'PRIVATE_EVENT',
    'TOURNAMENT',
    'WEATHER',
    'STAFF_USE',
    'OTHER',
  ]),
  notes: z.string().max(2000).optional(),
});
export const ExpenseInputSchema = ExpenseSchema.omit({
  expenseId: true,
  organizationId: true,
  createdBy: true,
  createdAt: true,
});
export const StaffCreateInputSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email(),
  role: RoleSchema,
  password: z.string().min(1).max(200),
});
export const StaffUpdateInputSchema = StaffCreateInputSchema.partial()
  .omit({ password: true })
  .extend({ active: z.boolean().optional() });
export const StaffPasswordResetInputSchema = z.object({
  password: z.string().min(1).max(200),
});
export const ClassInputSchema = z.object({
  name: z.string().min(1).max(160),
  sport: z.string().min(1).max(80),
  sportId: IdentifierSchema.optional(),
  type: z.enum(['GROUP', 'PRIVATE']).default('GROUP'),
  coachId: IdentifierSchema,
  courtId: IdentifierSchema,
  capacity: z.number().int().positive().max(500),
  pricePerParticipant: MoneySchema.optional(),
  price: MoneySchema.optional(),
  scheduleType: z.enum(['SINGLE', 'WEEKLY']).default('WEEKLY'),
  weekday: z.number().int().min(0).max(6).optional(),
  intervalWeeks: z.number().int().min(1).max(52).default(1),
  startTime: LocalTimeSchema,
  durationMinutes: z.number().int().positive().max(1440),
  startDate: DateSchema,
  endDate: DateSchema.optional(),
  notes: z.string().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.type === 'PRIVATE' && value.capacity !== 1)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['capacity'], message: 'Private lessons have capacity 1.' });
  if (value.scheduleType === 'WEEKLY' && (value.weekday === undefined || !value.endDate))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'Weekly classes require weekday and end date.' });
});

export type Organization = z.infer<typeof OrganizationSchema>;
export type User = z.infer<typeof UserSchema>;
export type Court = z.infer<typeof CourtSchema>;
export type Sport = z.infer<typeof SportSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type Reservation = z.infer<typeof ReservationSchema>;
export type ReservationRequest = z.infer<typeof RequestSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type SportClass = z.infer<typeof ClassSchema>;
export type Enrollment = z.infer<typeof EnrollmentSchema>;
export type Attendance = z.infer<typeof AttendanceSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type ClassSession = z.infer<typeof ClassSessionSchema>;
export type Charge = z.infer<typeof ChargeSchema>;
export type AuthContext = {
  organizationId: string;
  userId: string;
  role: z.infer<typeof RoleSchema>;
};
export type EntityType =
  | 'organization'
  | 'user'
  | 'court'
  | 'sport'
  | 'customer'
  | 'reservation'
  | 'request'
  | 'payment'
  | 'expense'
  | 'class'
  | 'enrollment'
  | 'attendance'
  | 'classSession'
  | 'charge'
  | 'block';
export const ok = <T>(data: T) => ({ data });
export const collection = <T>(data: T[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
});
