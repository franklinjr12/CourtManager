import { z } from 'zod';

export const IdentifierSchema = z.string().min(1).max(128);
export const DateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const LocalTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const MoneySchema = z.number().finite().nonnegative().max(10_000_000);
export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Expected an uppercase ISO 4217 currency code.');
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
  'CUSTOMER_PORTAL',
  'OTHER',
]);
export const ReservationModeSchema = z.enum([
  'STAFF_ONLY',
  'REQUEST_APPROVAL',
  'AUTO_CONFIRM',
]);
export const BookingPolicySchema = z
  .object({
    reservationMode: ReservationModeSchema,
    bookAheadDays: z.number().int().positive().max(365),
    cancellationCutoffHours: z.number().int().min(0).max(168),
    minimumReservationMinutes: z.number().int().positive().max(240),
    maximumReservationMinutes: z.number().int().positive().max(240),
    maximumActiveBookings: z.number().int().positive().max(100),
  })
  .superRefine((policy, ctx) => {
    if (policy.maximumReservationMinutes < policy.minimumReservationMinutes)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumReservationMinutes'],
        message: 'Maximum reservation duration must not be below minimum.',
      });
    if (
      policy.maximumReservationMinutes <
      Math.ceil(policy.minimumReservationMinutes / 30) * 30
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maximumReservationMinutes'],
        message: 'Policy must allow at least one 30-minute booking duration.',
      });
  });
export const DEFAULT_BOOKING_POLICY = {
  reservationMode: 'REQUEST_APPROVAL',
  bookAheadDays: 30,
  cancellationCutoffHours: 6,
  minimumReservationMinutes: 60,
  maximumReservationMinutes: 120,
  maximumActiveBookings: 3,
} as const;
export const PublicBookingPolicySchema = BookingPolicySchema;
export const BookingPolicyInputSchema = BookingPolicySchema;
export const RequestStatusSchema = z.enum([
  'REQUESTED',
  'CONFIRMED',
  'REJECTED',
  'WITHDRAWN',
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

// Phase 3 commercial contracts
export const PlanStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
export const BillingIntervalSchema = z.enum(['WEEKLY', 'MONTHLY', 'CUSTOM']);
export const MembershipStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
]);
export const CustomerPackageStatusSchema = z.enum([
  'ACTIVE',
  'CONSUMED',
  'EXPIRED',
  'CANCELLED',
]);
export const PackageDefinitionStatusSchema = PlanStatusSchema;
export const BenefitTypeSchema = z.enum([
  'COURT_TIME',
  'CLASS_ATTENDANCE',
  'PRIVATE_LESSON',
  'OPEN_GAME',
  'FIXED_COURT_SLOT',
]);
export const BenefitPeriodSchema = z.enum([
  'WEEK',
  'MONTH',
  'MEMBERSHIP_PERIOD',
  'PACKAGE_LIFETIME',
]);
export const BenefitQuantityTypeSchema = z.enum(['FINITE', 'UNLIMITED']);
export const BenefitUnitSchema = z.enum([
  'COURT_MINUTES',
  'SESSION',
  'GAME',
  'OCCURRENCE',
]);

const FiniteBenefitQuantitySchema = z.object({
  quantityType: z.literal('FINITE'),
  // Quantities are normalized domain units: minutes for court time and
  // integer sessions/games/occurrences for other benefits.
  quantity: z.number().int().positive().max(10_000_000),
});
const UnlimitedBenefitQuantitySchema = z.object({
  quantityType: z.literal('UNLIMITED'),
  quantity: z.never().optional(),
});
const BenefitQuantitySchema = z.union([
  FiniteBenefitQuantitySchema,
  UnlimitedBenefitQuantitySchema,
]);
const PlanBenefitBaseSchema = z.object({
  benefitId: IdentifierSchema.optional(),
  period: BenefitPeriodSchema,
  label: z.string().min(1).max(160).optional(),
  // Optional class selectors keep common commercial restrictions explicit
  // without introducing a general-purpose rules language.
  classType: z.enum(['GROUP', 'PRIVATE']).optional(),
  classId: IdentifierSchema.optional(),
  sportId: IdentifierSchema.optional(),
});

const CourtTimeBenefitSchema = PlanBenefitBaseSchema.extend({
  type: z.literal('COURT_TIME'),
  unit: z.literal('COURT_MINUTES'),
}).and(BenefitQuantitySchema);
const ClassAttendanceBenefitSchema = PlanBenefitBaseSchema.extend({
  type: z.literal('CLASS_ATTENDANCE'),
  unit: z.literal('SESSION'),
}).and(BenefitQuantitySchema);
const PrivateLessonBenefitSchema = PlanBenefitBaseSchema.extend({
  type: z.literal('PRIVATE_LESSON'),
  unit: z.literal('SESSION'),
}).and(BenefitQuantitySchema);
const OpenGameBenefitSchema = PlanBenefitBaseSchema.extend({
  type: z.literal('OPEN_GAME'),
  unit: z.literal('GAME'),
}).and(BenefitQuantitySchema);
const FixedCourtSlotBenefitSchema = PlanBenefitBaseSchema.extend({
  type: z.literal('FIXED_COURT_SLOT'),
  unit: z.literal('OCCURRENCE'),
  courtId: IdentifierSchema,
  weekday: WeekdaySchema,
  startTime: LocalTimeSchema,
  endTime: LocalTimeSchema,
}).superRefine((benefit, ctx) => {
  if (benefit.endTime <= benefit.startTime)
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endTime'],
      message: 'Fixed court slot end time must be after start time.',
    });
});

export const PlanBenefitSchema = z.union([
  CourtTimeBenefitSchema,
  ClassAttendanceBenefitSchema,
  PrivateLessonBenefitSchema,
  OpenGameBenefitSchema,
  FixedCourtSlotBenefitSchema,
]);
// Package definitions use the same structural benefit vocabulary. The
// package workflow uses the package lifetime as the allowance boundary.
export const PackageBenefitSchema = PlanBenefitSchema.superRefine(
  (benefit, ctx) => {
    if (benefit.period !== 'PACKAGE_LIFETIME')
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['period'],
        message: 'Package benefits must use the package lifetime period.',
      });
  },
);

export const PlanSchema = z
  .object({
    planId: IdentifierSchema,
    organizationId: IdentifierSchema,
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    status: PlanStatusSchema,
    basePrice: MoneySchema,
    currency: CurrencyCodeSchema,
    billingInterval: BillingIntervalSchema,
    customIntervalDays: z.number().int().positive().max(365).optional(),
    benefits: z.array(PlanBenefitSchema).min(1).max(50),
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().optional(),
  })
  .superRefine((plan, ctx) => {
    if (
      plan.billingInterval === 'CUSTOM' &&
      plan.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      plan.billingInterval !== 'CUSTOM' &&
      plan.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a custom duration.',
      });
  });
export const PlanInputSchema = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    basePrice: MoneySchema,
    currency: CurrencyCodeSchema.optional(),
    billingInterval: BillingIntervalSchema.default('MONTHLY'),
    customIntervalDays: z.number().int().positive().max(365).optional(),
    benefits: z.array(PlanBenefitSchema).min(1).max(50),
    status: PlanStatusSchema.default('ACTIVE'),
  })
  .superRefine((plan, ctx) => {
    if (
      plan.billingInterval === 'CUSTOM' &&
      plan.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      plan.billingInterval !== 'CUSTOM' &&
      plan.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a custom duration.',
      });
  });
export const PlanCreateInputSchema = PlanInputSchema;
export const PlanUpdateInputSchema = PlanInputSchema.innerType()
  .partial()
  .superRefine((plan, ctx) => {
    if (
      plan.billingInterval === 'CUSTOM' &&
      plan.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      plan.billingInterval !== undefined &&
      plan.billingInterval !== 'CUSTOM' &&
      plan.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a custom duration.',
      });
  });

export const MembershipPeriodStatusSchema = z.enum([
  'UPCOMING',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
]);
export const MembershipPeriodSchema = z
  .object({
    membershipPeriodId: IdentifierSchema,
    organizationId: IdentifierSchema,
    membershipId: IdentifierSchema,
    periodNumber: z.number().int().positive(),
    startDate: DateSchema,
    endDate: DateSchema,
    status: MembershipPeriodStatusSchema,
    price: MoneySchema,
    currency: CurrencyCodeSchema,
    chargeId: IdentifierSchema.optional(),
    renewalIdempotencyKey: IdentifierSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().optional(),
  })
  .superRefine((period, ctx) => {
    if (period.endDate < period.startDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message:
          'Membership period end date must not be before its start date.',
      });
  });

export const MembershipSchema = z
  .object({
    membershipId: IdentifierSchema,
    organizationId: IdentifierSchema,
    customerId: IdentifierSchema,
    planId: IdentifierSchema,
    planNameSnapshot: z.string().min(1).max(160),
    status: MembershipStatusSchema,
    startDate: DateSchema,
    currentPeriodStart: DateSchema,
    currentPeriodEnd: DateSchema,
    nextRenewalDate: DateSchema.optional(),
    currentPeriodId: IdentifierSchema.optional(),
    price: MoneySchema,
    currency: CurrencyCodeSchema,
    billingInterval: BillingIntervalSchema,
    customIntervalDays: z.number().int().positive().max(365).optional(),
    benefitSnapshot: z.array(PlanBenefitSchema).min(1).max(50),
    createdAt: z.string(),
    updatedAt: z.string(),
    pausedAt: z.string().optional(),
    cancelledAt: z.string().optional(),
    cancelledBy: IdentifierSchema.optional(),
    cancellationReason: z.string().max(1000).optional(),
    cancellationEffectiveDate: DateSchema.optional(),
    expiredAt: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((membership, ctx) => {
    if (membership.currentPeriodEnd < membership.currentPeriodStart)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currentPeriodEnd'],
        message: 'Current membership period end must not be before its start.',
      });
    if (
      membership.billingInterval === 'CUSTOM' &&
      membership.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      membership.billingInterval !== 'CUSTOM' &&
      membership.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a custom duration.',
      });
  });
export const MembershipInputSchema = z
  .object({
    customerId: IdentifierSchema,
    planId: IdentifierSchema,
    startDate: DateSchema,
    price: MoneySchema.optional(),
    currency: CurrencyCodeSchema.optional(),
    billingInterval: BillingIntervalSchema.optional(),
    customIntervalDays: z.number().int().positive().max(365).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((membership, ctx) => {
    if (
      membership.billingInterval === 'CUSTOM' &&
      membership.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
  });
export const MembershipCreateInputSchema = MembershipInputSchema;
export const MembershipUpdateInputSchema = z
  .object({
    price: MoneySchema.optional(),
    billingInterval: BillingIntervalSchema.optional(),
    customIntervalDays: z.number().int().positive().max(365).optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((membership, ctx) => {
    if (
      membership.billingInterval === 'CUSTOM' &&
      membership.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      membership.billingInterval !== undefined &&
      membership.billingInterval !== 'CUSTOM' &&
      membership.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a custom duration.',
      });
  });
export const MembershipCancelInputSchema = z.object({
  effectiveDate: DateSchema.optional(),
  reason: z.string().max(1000).optional(),
});
export const MembershipRenewInputSchema = z.object({
  price: MoneySchema.optional(),
  /** Stable key supplied by the staff client so a retried renewal converges. */
  idempotencyKey: IdentifierSchema.optional(),
});

export const PackageDefinitionSchema = z.object({
  packageDefinitionId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  status: PackageDefinitionStatusSchema,
  price: MoneySchema,
  currency: CurrencyCodeSchema,
  validityDays: z.number().int().positive().max(3650).nullable(),
  benefits: z.array(PackageBenefitSchema).min(1).max(50),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().optional(),
});
export const PackageDefinitionInputSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  price: MoneySchema,
  currency: CurrencyCodeSchema.optional(),
  validityDays: z.number().int().positive().max(3650).nullable(),
  benefits: z.array(PackageBenefitSchema).min(1).max(50),
  status: PackageDefinitionStatusSchema.default('ACTIVE'),
});
export const PackageCreateInputSchema = PackageDefinitionInputSchema;

export const CustomerPackageSchema = z
  .object({
    customerPackageId: IdentifierSchema,
    organizationId: IdentifierSchema,
    customerId: IdentifierSchema,
    packageDefinitionId: IdentifierSchema,
    packageNameSnapshot: z.string().min(1).max(160),
    status: CustomerPackageStatusSchema,
    issuedAt: z.string().datetime({ offset: true }),
    startsAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    price: MoneySchema,
    currency: CurrencyCodeSchema,
    benefitSnapshot: z.array(PackageBenefitSchema).min(1).max(50),
    createdAt: z.string(),
    updatedAt: z.string(),
    consumedAt: z.string().optional(),
    cancelledAt: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((customerPackage, ctx) => {
    if (
      customerPackage.expiresAt &&
      Date.parse(customerPackage.expiresAt) <
        Date.parse(customerPackage.startsAt)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Package expiration must not be before its start.',
      });
  });
export const CustomerPackageInputSchema = z.object({
  // The API derives the customer from /customers/:customerId.
  customerId: IdentifierSchema.optional(),
  packageDefinitionId: IdentifierSchema,
  idempotencyKey: IdentifierSchema.optional(),
  issuedAt: z.string().datetime({ offset: true }).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  price: MoneySchema.optional(),
  currency: CurrencyCodeSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export const CustomerPackageCreateInputSchema = CustomerPackageInputSchema;

export const CreditTransactionTypeSchema = z.enum([
  'ISSUED',
  'CONSUMED',
  'RESTORED',
  'EXPIRED',
  'ADJUSTED',
]);
export const CreditSourceTypeSchema = z.enum([
  'MEMBERSHIP',
  'PACKAGE',
  'MANUAL',
  'FIXED_AGREEMENT',
  'MAKEUP',
]);
export const CreditActivityTypeSchema = z.enum([
  'RESERVATION',
  'CLASS_ATTENDANCE',
  'PRIVATE_LESSON',
  'OPEN_GAME',
  'FIXED_COURT_OCCURRENCE',
]);
const CreditTransactionBaseSchema = z.object({
  creditTransactionId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  sourceType: CreditSourceTypeSchema,
  sourceId: IdentifierSchema,
  membershipPeriodId: IdentifierSchema.optional(),
  benefitId: IdentifierSchema.optional(),
  benefitPeriodKey: z.string().min(1).max(80).optional(),
  transactionType: CreditTransactionTypeSchema,
  unit: BenefitUnitSchema,
  // This is a signed ledger delta. It is always an integer; no floating
  // point credit arithmetic is represented by this contract.
  quantity: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine(
      (quantity) => quantity !== 0,
      'Credit transaction quantity cannot be zero.',
    ),
  activityType: CreditActivityTypeSchema.optional(),
  activityId: IdentifierSchema.optional(),
  relatedTransactionId: IdentifierSchema.optional(),
  reason: z.string().max(1000).optional(),
  occurredAt: z.string().datetime({ offset: true }),
  createdBy: IdentifierSchema,
  createdAt: z.string(),
});
const validateCreditTransaction = (
  transaction: z.infer<typeof CreditTransactionBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  if (
    transaction.transactionType === 'CONSUMED' &&
    (!transaction.activityType || !transaction.activityId)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['activityId'],
      message: 'Consumed credits require an activity reference.',
    });
  }
  if (
    transaction.transactionType === 'ADJUSTED' &&
    !transaction.reason?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: 'Adjusted credits require a reason.',
    });
  }
};
export const CreditTransactionSchema = CreditTransactionBaseSchema.superRefine(
  validateCreditTransaction,
);
export const CreditTransactionInputSchema = CreditTransactionBaseSchema.omit({
  creditTransactionId: true,
  organizationId: true,
  createdAt: true,
}).superRefine((transaction, ctx) => {
  validateCreditTransaction(
    {
      ...transaction,
      creditTransactionId: 'input',
      organizationId: 'input',
      createdAt: 'input',
    },
    ctx,
  );
});

/** Staff-authenticated request for an auditable balance adjustment. */
export const CreditAdjustmentInputSchema = z.object({
  customerId: IdentifierSchema,
  sourceType: CreditSourceTypeSchema,
  sourceId: IdentifierSchema,
  membershipPeriodId: IdentifierSchema.optional(),
  benefitId: IdentifierSchema.optional(),
  benefitPeriodKey: z.string().min(1).max(80).optional(),
  unit: BenefitUnitSchema,
  quantity: z
    .number()
    .int()
    .min(-10_000_000)
    .max(10_000_000)
    .refine(
      (quantity) => quantity !== 0,
      'Adjustment quantity cannot be zero.',
    ),
  reason: z.string().trim().min(1).max(1000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
});

export const EntitlementAllocationStatusSchema = z.enum(['ACTIVE', 'VOID']);
export const EntitlementAllocationSchema = z.object({
  allocationId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  sourceType: CreditSourceTypeSchema,
  sourceId: IdentifierSchema,
  sourceName: z.string().min(1).max(160).optional(),
  membershipPeriodId: IdentifierSchema.optional(),
  benefitId: IdentifierSchema.optional(),
  benefitPeriodKey: z.string().min(1).max(80).optional(),
  activityType: CreditActivityTypeSchema,
  activityId: IdentifierSchema,
  unit: BenefitUnitSchema,
  quantity: z.number().int().positive().max(10_000_000),
  coveredAmount: MoneySchema,
  currency: CurrencyCodeSchema,
  status: EntitlementAllocationStatusSchema,
  createdAt: z.string(),
  voidedAt: z.string().optional(),
  voidedBy: IdentifierSchema.optional(),
});
export const EntitlementAllocationInputSchema =
  EntitlementAllocationSchema.omit({
    allocationId: true,
    organizationId: true,
    createdAt: true,
    voidedAt: true,
    voidedBy: true,
    status: true,
  });

export const FixedCourtAgreementStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
  'EXPIRED',
]);
export const FixedCourtAgreementSchema = z
  .object({
    agreementId: IdentifierSchema,
    organizationId: IdentifierSchema,
    customerId: IdentifierSchema,
    courtId: IdentifierSchema,
    membershipId: IdentifierSchema.optional(),
    reservationSeriesId: IdentifierSchema.optional(),
    status: FixedCourtAgreementStatusSchema,
    weekday: WeekdaySchema,
    startTime: LocalTimeSchema,
    durationMinutes: z.number().int().positive().max(1440),
    startDate: DateSchema,
    endDate: DateSchema.optional(),
    intervalWeeks: z.number().int().positive().max(52),
    monthlyPrice: MoneySchema,
    currency: CurrencyCodeSchema,
    billingInterval: BillingIntervalSchema,
    customIntervalDays: z.number().int().positive().max(365).optional(),
    timezone: z.string().min(1),
    createdAt: z.string(),
    updatedAt: z.string(),
    cancelledAt: z.string().optional(),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((agreement, ctx) => {
    if (agreement.endDate && agreement.endDate < agreement.startDate)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message:
          'Fixed court agreement end date must not be before its start date.',
      });
    if (
      agreement.billingInterval === 'CUSTOM' &&
      agreement.customIntervalDays === undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Custom billing intervals require a duration in days.',
      });
    if (
      agreement.billingInterval !== 'CUSTOM' &&
      agreement.customIntervalDays !== undefined
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customIntervalDays'],
        message: 'Only custom billing intervals may define a duration in days.',
      });
  });
export const FixedCourtAgreementInputSchema = z.object({
  customerId: IdentifierSchema,
  courtId: IdentifierSchema,
  membershipId: IdentifierSchema.optional(),
  reservationSeriesId: IdentifierSchema.optional(),
  weekday: WeekdaySchema,
  startTime: LocalTimeSchema,
  durationMinutes: z.number().int().positive().max(1440),
  startDate: DateSchema,
  endDate: DateSchema.optional(),
  intervalWeeks: z.number().int().positive().max(52).default(1),
  monthlyPrice: MoneySchema,
  currency: CurrencyCodeSchema.optional(),
  billingInterval: BillingIntervalSchema.default('MONTHLY'),
  customIntervalDays: z.number().int().positive().max(365).optional(),
  timezone: z.string().min(1).optional(),
  notes: z.string().max(2000).optional(),
  preview: z.boolean().default(false),
  skipConflicts: z.boolean().default(false),
});
export const FixedCourtAgreementActionInputSchema = z.object({
  effectiveDate: DateSchema.optional(),
  skipConflicts: z.boolean().default(false),
});
export const FixedCourtAgreementSlotChangeInputSchema = z
  .object({
    effectiveDate: DateSchema,
    courtId: IdentifierSchema.optional(),
    weekday: WeekdaySchema.optional(),
    startTime: LocalTimeSchema.optional(),
    durationMinutes: z.number().int().positive().max(240).optional(),
    intervalWeeks: z.number().int().positive().max(52).optional(),
    monthlyPrice: MoneySchema.optional(),
    notes: z.string().max(2000).optional(),
    skipConflicts: z.boolean().default(false),
  })
  .refine(
    (value) =>
      value.courtId !== undefined ||
      value.weekday !== undefined ||
      value.startTime !== undefined ||
      value.durationMinutes !== undefined ||
      value.intervalWeeks !== undefined ||
      value.monthlyPrice !== undefined ||
      value.notes !== undefined,
    'At least one future agreement term must change.',
  );
export const FixedCourtAgreementBillingInputSchema = z.object({
  periodStartDate: DateSchema.optional(),
});

export const FixedCourtOccurrenceStatusSchema = z.enum([
  'SCHEDULED',
  'BOOKED',
  'COMPLETED',
  'CANCELLED',
  'MISSED',
]);
export const FixedCourtOccurrenceSchema = z.object({
  occurrenceId: IdentifierSchema,
  organizationId: IdentifierSchema,
  agreementId: IdentifierSchema,
  customerId: IdentifierSchema,
  courtId: IdentifierSchema,
  reservationId: IdentifierSchema.optional(),
  date: DateSchema,
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: FixedCourtOccurrenceStatusSchema,
  price: MoneySchema,
  currency: CurrencyCodeSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  cancelledAt: z.string().optional(),
});

export const CommercialReportQuantitySchema = z.object({
  unit: BenefitUnitSchema,
  issuedQuantity: z.number().int().nonnegative(),
  consumedQuantity: z.number().int().nonnegative(),
  expiredQuantity: z.number().int().nonnegative(),
  utilizationPercent: z.number().finite().nonnegative(),
});
export const CommercialReportQuantityTotalSchema = z.object({
  unit: BenefitUnitSchema,
  quantity: z.number().int().nonnegative(),
});
export const CommercialReportMembershipPlanSchema = z.object({
  planId: IdentifierSchema,
  planName: z.string().min(1).max(160),
  count: z.number().int().nonnegative(),
});
export const CommercialReportSchema = z.object({
  timezone: z.string().min(1),
  from: DateSchema,
  to: DateSchema,
  activeMemberships: z.number().int().nonnegative(),
  membershipsByPlan: z.array(CommercialReportMembershipPlanSchema),
  newMemberships: z.number().int().nonnegative(),
  cancelledMemberships: z.number().int().nonnegative(),
  membershipExpectedRevenue: MoneySchema,
  membershipRecordedPayments: MoneySchema,
  membershipOutstandingAmount: MoneySchema,
  packagesIssued: z.number().int().nonnegative(),
  packageSalesValue: MoneySchema,
  packageCreditsIssued: z.array(CommercialReportQuantityTotalSchema),
  packageCreditsConsumed: z.array(CommercialReportQuantityTotalSchema),
  packageCreditsExpired: z.array(CommercialReportQuantityTotalSchema),
  packageUtilization: z.array(CommercialReportQuantitySchema),
  fixedCourtAgreements: z.number().int().nonnegative(),
  fixedCourtExpectedRevenue: MoneySchema,
});

export const CreditBalanceSummarySchema = z.object({
  sourceType: CreditSourceTypeSchema,
  sourceId: IdentifierSchema,
  membershipPeriodId: IdentifierSchema.optional(),
  benefitId: IdentifierSchema.optional(),
  benefitPeriodKey: z.string().min(1).max(80).optional(),
  unit: BenefitUnitSchema,
  quantityType: BenefitQuantityTypeSchema,
  issuedQuantity: z.number().int().nonnegative(),
  consumedQuantity: z.number().int().nonnegative(),
  restoredQuantity: z.number().int().nonnegative(),
  expiredQuantity: z.number().int().nonnegative(),
  adjustedQuantity: z.number().int().default(0),
  remainingQuantity: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export const MakeupCreditReasonSchema = z.enum([
  'VENUE_CANCELLED',
  'EXCUSED_ABSENCE',
  'STAFF_GRANTED',
  'OTHER',
]);
export const MakeupCreditStatusSchema = z.enum([
  'ACTIVE',
  'CONSUMED',
  'EXPIRED',
  'CANCELLED',
]);
export const MakeupCreditSchema = z
  .object({
    makeupCreditId: IdentifierSchema,
    organizationId: IdentifierSchema,
    customerId: IdentifierSchema,
    originClassId: IdentifierSchema,
    originSessionId: IdentifierSchema,
    reason: MakeupCreditReasonSchema,
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    status: MakeupCreditStatusSchema,
    createdBy: IdentifierSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    consumedAt: z.string().datetime({ offset: true }).optional(),
    cancelledAt: z.string().datetime({ offset: true }).optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: IdentifierSchema.optional(),
  })
  .superRefine((credit, ctx) => {
    if (
      credit.expiresAt &&
      Date.parse(credit.expiresAt) <= Date.parse(credit.issuedAt)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Makeup credit expiration must be after it is issued.',
      });
  });
export const MakeupCreditInputSchema = z
  .object({
    customerId: IdentifierSchema.optional(),
    originClassId: IdentifierSchema,
    originSessionId: IdentifierSchema,
    reason: MakeupCreditReasonSchema,
    issuedAt: z.string().datetime({ offset: true }).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    notes: z.string().max(1000).optional(),
    idempotencyKey: IdentifierSchema.optional(),
  })
  .superRefine((credit, ctx) => {
    if (
      credit.expiresAt &&
      credit.issuedAt &&
      Date.parse(credit.expiresAt) <= Date.parse(credit.issuedAt)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'Makeup credit expiration must be after it is issued.',
      });
  });
export const CustomerBalanceSummarySchema = z.object({
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  currency: CurrencyCodeSchema,
  totalCharges: MoneySchema,
  totalPayments: MoneySchema,
  totalCovered: MoneySchema,
  financialCreditAmount: MoneySchema,
  outstandingAmount: MoneySchema,
  overdueAmount: MoneySchema,
  credits: z.array(CreditBalanceSummarySchema),
  asOf: z.string().datetime({ offset: true }),
});
export const CommercialActivitySummarySchema = z.object({
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  activeMembershipCount: z.number().int().nonnegative(),
  activePackageCount: z.number().int().nonnegative(),
  nextMembershipRenewalDate: DateSchema.optional(),
  nextPackageExpirationDate: DateSchema.optional(),
  balance: CustomerBalanceSummarySchema,
  generatedAt: z.string().datetime({ offset: true }),
});
export const CustomerCommercialSummarySchema = z.object({
  balance: CustomerBalanceSummarySchema,
  activity: CommercialActivitySummarySchema,
  memberships: z.array(MembershipSchema),
  packages: z.array(CustomerPackageSchema),
  fixedCourtAgreements: z.array(FixedCourtAgreementSchema),
  upcomingRenewals: z.array(MembershipSchema),
  expiringBenefits: z.array(CreditBalanceSummarySchema),
});
/** Customer-safe commercial views intentionally omit organization and staff-only fields. */
export const CustomerEntitlementUsageSchema = z.object({
  benefitId: IdentifierSchema.optional(),
  label: z.string().min(1).max(160).optional(),
  type: BenefitTypeSchema,
  unit: BenefitUnitSchema,
  quantityType: BenefitQuantityTypeSchema,
  issuedQuantity: z.number().int().nonnegative(),
  consumedQuantity: z.number().int().nonnegative(),
  restoredQuantity: z.number().int().nonnegative(),
  expiredQuantity: z.number().int().nonnegative(),
  adjustedQuantity: z.number().int(),
  remainingQuantity: z.number().int().nonnegative(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});
export const CustomerPortalMembershipSchema = z.object({
  membershipId: IdentifierSchema,
  planId: IdentifierSchema,
  planNameSnapshot: z.string().min(1).max(160),
  status: MembershipStatusSchema,
  startDate: DateSchema,
  currentPeriodStart: DateSchema,
  currentPeriodEnd: DateSchema,
  nextRenewalDate: DateSchema.optional(),
  currentPeriodId: IdentifierSchema.optional(),
  price: MoneySchema,
  currency: CurrencyCodeSchema,
  billingInterval: BillingIntervalSchema,
  customIntervalDays: z.number().int().positive().max(365).optional(),
  benefits: z.array(CustomerEntitlementUsageSchema),
});
export const CustomerPortalMembershipPeriodSchema = z.object({
  membershipPeriodId: IdentifierSchema,
  periodNumber: z.number().int().positive(),
  startDate: DateSchema,
  endDate: DateSchema,
  status: MembershipPeriodStatusSchema,
  price: MoneySchema,
  currency: CurrencyCodeSchema,
});
export const CustomerPortalPackageSchema = z.object({
  customerPackageId: IdentifierSchema,
  packageDefinitionId: IdentifierSchema,
  packageNameSnapshot: z.string().min(1).max(160),
  status: CustomerPackageStatusSchema,
  issuedAt: z.string().datetime({ offset: true }),
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }).optional(),
  price: MoneySchema,
  currency: CurrencyCodeSchema,
  benefits: z.array(CustomerEntitlementUsageSchema),
});
export const CustomerPortalCreditSchema = CustomerEntitlementUsageSchema.extend(
  {
    sourceType: CreditSourceTypeSchema,
    sourceId: IdentifierSchema,
    sourceName: z.string().min(1).max(160),
  },
);
export const CustomerPortalCreditHistorySchema = z.object({
  transactionType: CreditTransactionTypeSchema,
  unit: BenefitUnitSchema,
  quantity: z.number().int(),
  activityType: CreditActivityTypeSchema.optional(),
  activityId: IdentifierSchema.optional(),
  occurredAt: z.string().datetime({ offset: true }),
});
export const CustomerPortalMembershipDetailSchema = z.object({
  membership: CustomerPortalMembershipSchema,
  periods: z.array(CustomerPortalMembershipPeriodSchema),
  history: z.array(CustomerPortalCreditHistorySchema),
});
export const CustomerPortalPackageDetailSchema = z.object({
  package: CustomerPortalPackageSchema,
  history: z.array(CustomerPortalCreditHistorySchema),
});
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
  bookingPolicy: BookingPolicySchema.default(() => ({
    ...DEFAULT_BOOKING_POLICY,
  })),
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
export const CustomerAccountStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export const CustomerAccountSchema = z.object({
  customerAccountId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  email: z.string().email(),
  normalizedEmail: z.string().email(),
  passwordHash: z.string().min(1),
  status: CustomerAccountStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  lastLoginAt: z.string().optional(),
});
export const CustomerAccountCreateInputSchema = z.object({
  customerId: IdentifierSchema,
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export const CustomerPortalRegistrationInputSchema = z.object({
  name: z.string().min(1).max(160),
  email: z.string().email(),
  phone: z.string().min(5).max(40),
  password: z.string().min(1).max(200),
});
export const CustomerPortalPasswordInputSchema = z.object({
  token: z.string().min(1).max(200),
  password: z.string().min(1).max(200),
});
export const CustomerAuthLoginInputSchema = z.object({
  slug: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export const CustomerAuthRegistrationInputSchema =
  CustomerPortalRegistrationInputSchema.extend({
    slug: z.string().min(1).max(120),
  });
export const CustomerAuthPasswordInputSchema =
  CustomerPortalPasswordInputSchema.extend({
    slug: z.string().min(1).max(120),
  });
export const CustomerAccountResponseSchema = CustomerAccountSchema.omit({
  passwordHash: true,
});
export const CustomerProfileUpdateSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    phone: z.string().min(5).max(40).optional(),
    email: z.string().email().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one profile field is required.',
  });
export const CustomerSelfProfileSchema = z.object({
  customerId: IdentifierSchema,
  organizationId: IdentifierSchema,
  name: z.string().min(1).max(160),
  phone: z.string().optional(),
  email: z.string().email(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const CustomerSportPreferencesSchema = z.object({
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  // The preference record and its per-sport indexes are updated atomically.
  // 49 keeps a complete replacement within DynamoDB's 100 transaction actions.
  sportIds: z.array(IdentifierSchema).max(49),
  preferredSportId: IdentifierSchema.optional(),
  updatedAt: z.string(),
});
export const CustomerSportPreferencesInputSchema = z.object({
  sportIds: z.array(IdentifierSchema).max(49),
  preferredSportId: IdentifierSchema.optional(),
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
  sport: z.string().min(1).max(80).optional(),
  // The original service value remains stable when entitlement coverage
  // reduces expectedAmount to the uncovered direct-charge amount.
  serviceAmount: MoneySchema.optional(),
  expectedAmount: MoneySchema,
  fixedCourtAgreementId: IdentifierSchema.optional(),
  fixedCourtOccurrenceId: IdentifierSchema.optional(),
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
  cancellationActor: z.enum(['STAFF', 'CUSTOMER']).optional(),
  cancelledByCustomerAccountId: IdentifierSchema.optional(),
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
  withdrawnAt: z.string().optional(),
  withdrawnByCustomerAccountId: IdentifierSchema.optional(),
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
export const ChargeSourceTypeSchema = z.enum([
  'RESERVATION',
  'CLASS',
  'MEMBERSHIP',
  'PACKAGE',
  'FIXED_COURT_AGREEMENT',
]);
export const ChargeSchema = z.object({
  chargeId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  sourceType: ChargeSourceTypeSchema,
  sourceId: IdentifierSchema,
  reservationId: IdentifierSchema.optional(),
  classId: IdentifierSchema.optional(),
  classSessionId: IdentifierSchema.optional(),
  membershipId: IdentifierSchema.optional(),
  membershipPeriodId: IdentifierSchema.optional(),
  packageId: IdentifierSchema.optional(),
  fixedCourtAgreementId: IdentifierSchema.optional(),
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
export const CustomerSessionSchema = z.object({
  customerSessionId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  customerAccountId: IdentifierSchema,
  tokenHash: z.string().min(1),
  expiresAt: z.number().int().positive(),
  createdAt: z.string(),
  lastSeenAt: z.string().optional(),
});
export const CustomerSessionResponseSchema = z.object({
  token: z.string().min(1),
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  customerAccountId: IdentifierSchema,
  customer: CustomerSelfProfileSchema,
  account: CustomerAccountResponseSchema.optional(),
});
export const CustomerReservationInputSchema = z
  .object({
    courtId: IdentifierSchema,
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    notes: z.string().max(4000).optional(),
  })
  .refine((value) => Date.parse(value.endAt) > Date.parse(value.startAt), {
    path: ['endAt'],
    message: 'Reservation end must be after start.',
  });
export const OrganizationUpdateInputSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  timezone: z.string().min(1).optional(),
  currency: z.string().length(3).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  features: z
    .object({ classes: z.boolean(), finance: z.boolean() })
    .partial()
    .optional(),
  bookingPolicy: BookingPolicySchema.optional(),
});
export const ReservationCancellationEligibilitySchema = z.object({
  reservationId: IdentifierSchema,
  eligible: z.boolean(),
  status: ReservationStatusSchema,
  cutoffAt: z.string().datetime({ offset: true }),
  evaluatedAt: z.string().datetime({ offset: true }),
  reason: z.string().optional(),
});
export const CustomerReservationSummarySchema = z.object({
  itemType: z.literal('RESERVATION'),
  reservationId: IdentifierSchema,
  court: z.object({
    courtId: IdentifierSchema,
    name: z.string(),
    sport: z.string(),
  }),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  status: ReservationStatusSchema,
  source: ReservationSourceSchema,
  expectedAmount: MoneySchema,
  paymentStatus: z.enum(['UNPAID', 'PARTIALLY_PAID', 'PAID']).optional(),
  entitlementAllocations: z.array(EntitlementAllocationSchema).optional(),
  cancellationEligibility: ReservationCancellationEligibilitySchema,
});
export const CustomerAvailabilityCourtSchema = z.object({
  courtId: IdentifierSchema,
  name: z.string(),
  sport: z.string(),
  slotMinutes: z.number().int().positive().optional(),
  available: z.array(LocalTimeSchema),
});
export const CustomerAvailabilitySchema = z.object({
  allowedDurations: z.array(z.number().int().positive()),
  onlineBookingAvailable: z.boolean(),
  courts: z.array(CustomerAvailabilityCourtSchema),
});
export const CustomerRebookingDraftSchema = z.object({
  sourceReservationId: IdentifierSchema,
  date: DateSchema,
  startTime: LocalTimeSchema,
  durationMinutes: z.number().int().positive(),
  sport: z.string().min(1).max(80),
  preferredCourtId: IdentifierSchema.nullable(),
  availability: CustomerAvailabilitySchema,
});
export const CustomerReservationRequestSchema = z.object({
  itemType: z.literal('REQUEST'),
  requestId: IdentifierSchema,
  court: z.object({
    courtId: IdentifierSchema,
    name: z.string(),
    sport: z.string(),
  }),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: RequestStatusSchema,
  createdAt: z.string(),
});
export const ReservationParticipantStatusSchema = z.enum(['ACTIVE', 'REMOVED']);
export const ReservationParticipantSchema = z.object({
  participantId: IdentifierSchema,
  organizationId: IdentifierSchema,
  reservationId: IdentifierSchema,
  customerId: IdentifierSchema.optional(),
  name: z.string().trim().min(1).max(160),
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  status: ReservationParticipantStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  removedAt: z.string().optional(),
  createdByActorType: z.literal('CUSTOMER').optional(),
});
export const ReservationParticipantInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
  })
  .strict();
export type ReservationParticipantInput = z.infer<
  typeof ReservationParticipantInputSchema
>;
export const CustomerReservationParticipantSchema = z.object({
  participantId: IdentifierSchema,
  name: z.string().trim().min(1).max(160),
  email: z.string().email().optional(),
  phone: z.string().trim().min(1).max(40).optional(),
  status: ReservationParticipantStatusSchema,
});
export const ReservationParticipantsPageSchema = z.object({
  participants: z.array(CustomerReservationParticipantSchema),
  mutable: z.boolean(),
  nextCursor: z.string().nullable(),
});
export type ReservationParticipantsPage = z.infer<
  typeof ReservationParticipantsPageSchema
>;
export type CustomerReservationParticipant = z.infer<
  typeof CustomerReservationParticipantSchema
>;
export const CustomerReservationDetailSchema =
  CustomerReservationSummarySchema.extend({
    participants: z.array(CustomerReservationParticipantSchema),
    participantsMutable: z.boolean(),
    participantsNextCursor: z.string().nullable(),
    cancellationEligibility: ReservationCancellationEligibilitySchema,
  });
export const WaitlistTypeSchema = z.enum(['COURT_SLOT', 'CLASS', 'COURT']);
export const WaitlistStatusSchema = z.enum([
  'ACTIVE',
  'FULFILLED',
  'CANCELLED',
  'EXPIRED',
]);
export const WaitlistSchema = z
  .object({
    waitlistId: IdentifierSchema,
    organizationId: IdentifierSchema,
    customerId: IdentifierSchema,
    type: WaitlistTypeSchema,
    courtId: IdentifierSchema.optional(),
    classId: IdentifierSchema.optional(),
    desiredDate: DateSchema.optional(),
    desiredStartTime: LocalTimeSchema.optional(),
    durationMinutes: z.number().int().positive().max(1440).optional(),
    status: WaitlistStatusSchema,
    joinedAt: z.string(),
    fulfilledAt: z.string().optional(),
    fulfilledBy: IdentifierSchema.optional(),
    linkedReservationId: IdentifierSchema.optional(),
    linkedEnrollmentId: IdentifierSchema.optional(),
    cancelledAt: z.string().optional(),
    cancelledBy: IdentifierSchema.optional(),
  })
  .superRefine((waitlist, ctx) => {
    if (waitlist.type === 'COURT_SLOT' || waitlist.type === 'COURT') {
      if (!waitlist.courtId)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['courtId'],
          message: 'Court waitlists require a court.',
        });
      if (!waitlist.desiredDate)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['desiredDate'],
          message: 'Court waitlists require a desired date.',
        });
      if (!waitlist.desiredStartTime)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['desiredStartTime'],
          message: 'Court waitlists require a desired start time.',
        });
      if (!waitlist.durationMinutes)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['durationMinutes'],
          message: 'Court waitlists require a duration.',
        });
    }
    if (waitlist.type === 'CLASS' && !waitlist.classId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['classId'],
        message: 'Class waitlists require a class.',
      });
  });
export const CustomerCourtWaitlistInputSchema = z
  .object({
    courtId: IdentifierSchema,
    desiredDate: DateSchema,
    desiredStartTime: LocalTimeSchema,
    durationMinutes: z.number().int().positive().max(240),
  })
  .strict();
export const CustomerClassWaitlistInputSchema = z
  .object({ classId: IdentifierSchema })
  .strict();
export type CustomerCourtWaitlistInput = z.infer<
  typeof CustomerCourtWaitlistInputSchema
>;
export type CustomerClassWaitlistInput = z.infer<
  typeof CustomerClassWaitlistInputSchema
>;
export const CustomerActivityTypeSchema = z.enum([
  'RESERVATION',
  'CLASS',
  'EVENT',
  'OPEN_GAME',
  'COMMERCIAL',
]);
export const CommercialActivityEventTypeSchema = z.enum([
  'MEMBERSHIP_STARTED',
  'MEMBERSHIP_RENEWED',
  'MEMBERSHIP_PAUSED',
  'MEMBERSHIP_RESUMED',
  'MEMBERSHIP_CANCELLED',
  'MEMBERSHIP_EXPIRED',
  'PACKAGE_ISSUED',
  'PACKAGE_CONSUMED',
  'PACKAGE_EXPIRED',
  'CREDIT_ISSUED',
  'CREDIT_CONSUMED',
  'CREDIT_RESTORED',
  'FIXED_AGREEMENT_STARTED',
  'FIXED_AGREEMENT_CHANGED',
  'FIXED_AGREEMENT_CANCELLED',
]);
export const CustomerCommercialActivityEventSchema = z.object({
  eventId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  eventType: CommercialActivityEventTypeSchema,
  sourceType: CreditSourceTypeSchema,
  sourceId: IdentifierSchema,
  occurredAt: z.string().datetime({ offset: true }),
  createdAt: z.string(),
});
export const CommercialActivityEventSchema =
  CustomerCommercialActivityEventSchema;
export const CustomerActivityEventSchema =
  CustomerCommercialActivityEventSchema;
export const CustomerActivityActionSchema = z.enum([
  'VIEW',
  'CANCEL',
  'BOOK_AGAIN',
]);
export const CustomerActivityItemSchema = z.object({
  activityId: IdentifierSchema,
  organizationId: IdentifierSchema,
  customerId: IdentifierSchema,
  activityType: CustomerActivityTypeSchema,
  sourceId: IdentifierSchema,
  title: z.string().min(1).max(200),
  subtitle: z.string().min(1).max(200).optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  status: z.string().min(1).max(40),
  eventType: CommercialActivityEventTypeSchema.optional(),
  sourceType: CreditSourceTypeSchema.optional(),
  court: z
    .object({ courtId: IdentifierSchema, name: z.string().min(1).max(100) })
    .optional(),
  sport: z.string().min(1).max(80).optional(),
  actions: z.array(CustomerActivityActionSchema),
  createdAt: z.string(),
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
export const RequestInputSchema = z
  .object({
    courtId: IdentifierSchema,
    requestedStartAt: z.string().datetime({ offset: true }),
    requestedEndAt: z.string().datetime({ offset: true }),
    customerName: z.string().min(1).max(160),
    phone: z.string().min(5).max(40),
    email: z.string().email().optional(),
    notes: z.string().max(2000).optional(),
    honeypot: z.string().max(0).optional(),
  })
  .superRefine((value, ctx) => {
    const duration =
      (Date.parse(value.requestedEndAt) - Date.parse(value.requestedStartAt)) /
      60000;
    if (
      !Number.isInteger(duration) ||
      duration <= 0 ||
      duration > 240 ||
      duration % 30 !== 0
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requestedEndAt'],
        message:
          'Public requests must use 30-minute duration increments up to four hours.',
      });
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
    (v) =>
      [v.chargeId, v.reservationId, v.classId].filter(Boolean).length === 1,
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
export const ClassInputSchema = z
  .object({
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
  })
  .superRefine((value, ctx) => {
    if (value.type === 'PRIVATE' && value.capacity !== 1)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['capacity'],
        message: 'Private lessons have capacity 1.',
      });
    if (
      value.scheduleType === 'WEEKLY' &&
      (value.weekday === undefined || !value.endDate)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Weekly classes require weekday and end date.',
      });
  });

export type Organization = z.infer<typeof OrganizationSchema>;
export type User = z.infer<typeof UserSchema>;
export type Court = z.infer<typeof CourtSchema>;
export type Sport = z.infer<typeof SportSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type BookingPolicy = z.infer<typeof BookingPolicySchema>;
export type PublicBookingPolicy = z.infer<typeof PublicBookingPolicySchema>;
export type CustomerAccount = z.infer<typeof CustomerAccountSchema>;
export type CustomerAccountResponse = z.infer<
  typeof CustomerAccountResponseSchema
>;
export type CustomerSportPreferences = z.infer<
  typeof CustomerSportPreferencesSchema
>;
export type CustomerSelfProfile = z.infer<typeof CustomerSelfProfileSchema>;
export type CustomerSession = z.infer<typeof CustomerSessionSchema>;
export type CustomerSessionResponse = z.infer<
  typeof CustomerSessionResponseSchema
>;
export type Reservation = z.infer<typeof ReservationSchema>;
export type CustomerReservationInput = z.infer<
  typeof CustomerReservationInputSchema
>;
export type ReservationCancellationEligibility = z.infer<
  typeof ReservationCancellationEligibilitySchema
>;
export type CustomerReservationSummary = z.infer<
  typeof CustomerReservationSummarySchema
>;
export type CustomerAvailability = z.infer<typeof CustomerAvailabilitySchema>;
export type CustomerRebookingDraft = z.infer<
  typeof CustomerRebookingDraftSchema
>;
export type CustomerReservationRequest = z.infer<
  typeof CustomerReservationRequestSchema
>;
export type CustomerReservationDetail = z.infer<
  typeof CustomerReservationDetailSchema
>;
export type ReservationParticipant = z.infer<
  typeof ReservationParticipantSchema
>;
export type Waitlist = z.infer<typeof WaitlistSchema>;
export type StaffWaitlist = Waitlist & {
  customerName: string;
  requestedActivity: string;
  courtName?: string;
  className?: string;
  actionable: boolean;
  currentAvailability: {
    available?: boolean;
    enrolledCount?: number;
    capacity?: number;
  };
};
export type CustomerActivityItem = z.infer<typeof CustomerActivityItemSchema>;
export type CustomerCommercialActivityEvent = z.infer<
  typeof CustomerCommercialActivityEventSchema
>;
export type CommercialActivityEvent = CustomerCommercialActivityEvent;
export type ReservationRequest = z.infer<typeof RequestSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Expense = z.infer<typeof ExpenseSchema>;
export type SportClass = z.infer<typeof ClassSchema>;
export type Enrollment = z.infer<typeof EnrollmentSchema>;
export type Attendance = z.infer<typeof AttendanceSchema>;
export type Block = z.infer<typeof BlockSchema>;
export type ClassSession = z.infer<typeof ClassSessionSchema>;
export type Charge = z.infer<typeof ChargeSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type PlanBenefit = z.infer<typeof PlanBenefitSchema>;
export type PlanInput = z.infer<typeof PlanInputSchema>;
export type PlanUpdateInput = z.infer<typeof PlanUpdateInputSchema>;
export type PackageBenefit = z.infer<typeof PackageBenefitSchema>;
export type Membership = z.infer<typeof MembershipSchema>;
export type MembershipPeriod = z.infer<typeof MembershipPeriodSchema>;
export type MembershipUpdateInput = z.infer<typeof MembershipUpdateInputSchema>;
export type PackageDefinition = z.infer<typeof PackageDefinitionSchema>;
export type CustomerPackage = z.infer<typeof CustomerPackageSchema>;
export type MakeupCredit = z.infer<typeof MakeupCreditSchema>;
export type CreditTransaction = z.infer<typeof CreditTransactionSchema>;
export type CreditAdjustmentInput = z.infer<typeof CreditAdjustmentInputSchema>;
export type CreditBalanceSummary = z.infer<typeof CreditBalanceSummarySchema>;
export type EntitlementAllocation = z.infer<typeof EntitlementAllocationSchema>;
export type FixedCourtAgreement = z.infer<typeof FixedCourtAgreementSchema>;
export type FixedCourtAgreementInput = z.infer<
  typeof FixedCourtAgreementInputSchema
>;
export type FixedCourtOccurrence = z.infer<typeof FixedCourtOccurrenceSchema>;
export type CustomerBalanceSummary = z.infer<
  typeof CustomerBalanceSummarySchema
>;
export type CommercialActivitySummary = z.infer<
  typeof CommercialActivitySummarySchema
>;
export type CommercialReportQuantity = z.infer<
  typeof CommercialReportQuantitySchema
>;
export type CommercialReportQuantityTotal = z.infer<
  typeof CommercialReportQuantityTotalSchema
>;
export type CommercialReportMembershipPlan = z.infer<
  typeof CommercialReportMembershipPlanSchema
>;
export type CommercialReport = z.infer<typeof CommercialReportSchema>;
export type CustomerCommercialSummary = z.infer<
  typeof CustomerCommercialSummarySchema
>;
export type CustomerEntitlementUsage = z.infer<
  typeof CustomerEntitlementUsageSchema
>;
export type CustomerPortalCredit = z.infer<typeof CustomerPortalCreditSchema>;
export type CustomerPortalCreditHistory = z.infer<
  typeof CustomerPortalCreditHistorySchema
>;
export type CustomerPortalMembership = z.infer<
  typeof CustomerPortalMembershipSchema
>;
export type CustomerPortalMembershipDetail = z.infer<
  typeof CustomerPortalMembershipDetailSchema
>;
export type CustomerPortalMembershipPeriod = z.infer<
  typeof CustomerPortalMembershipPeriodSchema
>;
export type CustomerPortalPackage = z.infer<typeof CustomerPortalPackageSchema>;
export type CustomerPortalPackageDetail = z.infer<
  typeof CustomerPortalPackageDetailSchema
>;
export type AuthContext = {
  organizationId: string;
  userId: string;
  role: z.infer<typeof RoleSchema>;
};
export type CustomerAuthContext = {
  organizationId: string;
  customerId: string;
  customerAccountId: string;
  actorType: 'CUSTOMER';
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
  | 'block'
  | 'customerAccount'
  | 'customerAccountToken'
  | 'customerSession'
  | 'customerSportPreferences'
  | 'customerSportPreference'
  | 'reservationParticipant'
  | 'waitlist'
  | 'customerActivity'
  | 'customerReservationIndex'
  | 'customerReservationHistoryIndex'
  | 'customerReservationRequestIndex'
  | 'customerReservationPaymentIndex'
  | 'plan'
  | 'membership'
  | 'membershipPeriod'
  | 'packageDefinition'
  | 'customerPackage'
  | 'makeupCredit'
  | 'creditTransaction'
  | 'entitlementAllocation'
  | 'fixedCourtAgreement'
  | 'fixedCourtOccurrence'
  | 'customerActivityEvent';
export const ok = <T>(data: T) => ({ data });
export const collection = <T>(data: T[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
});

export type CustomerClass = {
  classId: string;
  name: string;
  sport: string;
  coachName: string;
  courtName: string;
  scheduleType: 'SINGLE' | 'WEEKLY';
  startDate: string;
  endDate?: string;
  startTime: string;
  durationMinutes: number;
  weekday: number;
  intervalWeeks: number;
  timezone: string;
  currency: string;
  capacity: number;
  enrolledCount: number;
  pricePerParticipant: number;
  full: boolean;
  enrollment: { enrollmentId: string; status: 'ACTIVE' | 'CANCELLED' } | null;
  waitlist?: { waitlistId: string; status: 'ACTIVE' } | null;
};
export type CustomerClassPage = {
  data: CustomerClass[];
  nextCursor: string | null;
};
