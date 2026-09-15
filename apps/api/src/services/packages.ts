import { createHash, randomUUID } from 'node:crypto';
import {
  ChargeSchema,
  CustomerPackageInputSchema,
  CustomerPackageSchema,
  PackageDefinitionInputSchema,
  PackageDefinitionSchema,
  type AuthContext,
  type CustomerPackage,
  type PackageBenefit,
  type PackageDefinition,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { dayKeyInTimezone } from '../domain.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';
import type { CommercialActivityEventService } from './commercial-activity-events.js';
import { addCommercialDays, evaluatePackage } from './commercial-evaluation.js';
import { EntitlementService } from './entitlements.js';

const now = () => new Date().toISOString();
const definitionId = () => `package-definition-${randomUUID()}`;
const customerPackageId = () => `customer-package-${randomUUID()}`;

const assertStaff = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const validationError = (error: { flatten: () => unknown }) =>
  new AppError(
    'VALIDATION_ERROR',
    'Package validation failed.',
    error.flatten() as Record<string, unknown>,
  );

const addDays = (value: string, days: number) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new AppError('VALIDATION_ERROR', 'Expected a valid issue date.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const withBenefitIds = (benefits: PackageBenefit[]) =>
  benefits.map((benefit) => ({
    ...benefit,
    benefitId: benefit.benefitId ?? `benefit-${randomUUID()}`,
  }));

type CreditPackageBenefit = Extract<
  PackageBenefit,
  { type: 'COURT_TIME' | 'CLASS_ATTENDANCE' | 'PRIVATE_LESSON' }
>;

const supportedBenefits = (benefits: PackageBenefit[]) => {
  if (
    benefits.some(
      (benefit) =>
        !['COURT_TIME', 'CLASS_ATTENDANCE', 'PRIVATE_LESSON'].includes(
          benefit.type,
        ),
    )
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'Packages support court time, class attendance, and private lessons.',
    );
  return benefits as CreditPackageBenefit[];
};

export class PackageService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
    private readonly entitlements: EntitlementService,
    private readonly activityEvents?: CommercialActivityEventService,
  ) {}

  private async recordEvent(
    eventType: 'PACKAGE_ISSUED' | 'PACKAGE_EXPIRED',
    customerPackage: CustomerPackage,
    occurredAt: string,
  ) {
    await this.activityEvents?.record({
      organizationId: customerPackage.organizationId,
      customerId: customerPackage.customerId,
      eventType,
      sourceType: 'PACKAGE',
      sourceId: customerPackage.customerPackageId,
      occurredAt,
    });
  }

  private async organizationCurrency(organizationId: string) {
    const organization = await this.repo.get({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    const currency = String(organization?.currency ?? 'BRL');
    return /^[A-Z]{3}$/.test(currency) ? currency : 'BRL';
  }

  private async organizationTimezone(organizationId: string) {
    const organization = await this.repo.get({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    return String(organization?.timezone ?? 'UTC');
  }

  private async customerExists(ctx: AuthContext, customerId: string) {
    const customer = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${customerId}`,
    });
    if (!customer || customer.entity !== 'customer' || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
  }

  private async expireIfNeeded(
    customerPackage: CustomerPackage,
    timezone: string,
  ): Promise<CustomerPackage> {
    const evaluation = evaluatePackage(customerPackage, {
      today: dayKeyInTimezone(new Date().toISOString(), timezone),
      asOf: new Date().toISOString(),
      timezone,
    });
    if (!evaluation.expired) return customerPackage;
    const timestamp = now();
    const expired = CustomerPackageSchema.parse({
      ...customerPackage,
      status: 'EXPIRED',
      updatedAt: timestamp,
    });
    await this.persistence.putCustomerPackage(expired, customerPackage);
    await this.recordEvent(
      'PACKAGE_EXPIRED',
      expired,
      expired.expiresAt ?? expired.updatedAt,
    );
    const balances = await this.persistence.listCreditBalancesBySource(
      customerPackage.organizationId,
      'PACKAGE',
      customerPackage.customerPackageId,
      100,
    );
    for (const balance of balances) {
      await this.entitlements.expire({
        organizationId: customerPackage.organizationId,
        customerId: customerPackage.customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        ...(balance.benefitId ? { benefitId: balance.benefitId } : {}),
        ...(balance.benefitPeriodKey
          ? { benefitPeriodKey: balance.benefitPeriodKey }
          : {}),
        createdBy: 'system',
        reason: 'Package expired',
      });
    }
    return expired;
  }

  private validDefinition(value: unknown) {
    const parsed = PackageDefinitionSchema.safeParse(value);
    if (!parsed.success) throw validationError(parsed.error);
    return parsed.data;
  }

  async listDefinitions(
    ctx: AuthContext,
    options: { status?: PackageDefinition['status']; limit?: number } = {},
  ) {
    assertStaff(ctx);
    return this.persistence.listPackageDefinitions(ctx.organizationId, options);
  }

  async getDefinition(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const definition = await this.persistence.getPackageDefinition(
      ctx.organizationId,
      id,
    );
    if (!definition)
      throw new AppError('NOT_FOUND', 'Package definition was not found.');
    return definition;
  }

  async createDefinition(ctx: AuthContext, input: unknown) {
    assertStaff(ctx);
    const parsed = PackageDefinitionInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data.status === 'ARCHIVED')
      throw new AppError(
        'VALIDATION_ERROR',
        'A new package definition cannot start archived.',
      );
    const timestamp = now();
    const definition = this.validDefinition({
      ...parsed.data,
      packageDefinitionId: definitionId(),
      organizationId: ctx.organizationId,
      currency:
        parsed.data.currency ??
        (await this.organizationCurrency(ctx.organizationId)),
      benefits: withBenefitIds(parsed.data.benefits),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.persistence.putPackageDefinition(definition);
    return definition;
  }

  async updateDefinition(ctx: AuthContext, id: string, input: unknown) {
    assertStaff(ctx);
    const current = await this.getDefinition(ctx, id);
    const parsed = PackageDefinitionInputSchema.partial().safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (
      current.status === 'ARCHIVED' &&
      parsed.data.status !== undefined &&
      parsed.data.status !== 'ARCHIVED'
    )
      throw new AppError(
        'INVALID_STATE',
        'Archived package definitions cannot be reactivated.',
      );
    const candidate = this.validDefinition({
      ...current,
      ...parsed.data,
      packageDefinitionId: current.packageDefinitionId,
      organizationId: current.organizationId,
      createdAt: current.createdAt,
      updatedAt: now(),
      ...(parsed.data.benefits
        ? { benefits: withBenefitIds(parsed.data.benefits) }
        : {}),
      ...(parsed.data.status === 'ARCHIVED'
        ? { archivedAt: current.archivedAt ?? now() }
        : current.status === 'ARCHIVED'
          ? { archivedAt: current.archivedAt }
          : {}),
    });
    await this.persistence.putPackageDefinition(candidate, current);
    return candidate;
  }

  async archiveDefinition(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.getDefinition(ctx, id);
    if (current.status === 'ARCHIVED') return current;
    return this.updateDefinition(ctx, id, { status: 'ARCHIVED' });
  }

  async listCustomerPackages(
    ctx: AuthContext,
    customerId: string,
    options: { activeOnly?: boolean; limit?: number } = {},
  ) {
    assertStaff(ctx);
    await this.customerExists(ctx, customerId);
    const timezone = await this.organizationTimezone(ctx.organizationId);
    const packages = await this.persistence.listPackagesByCustomer(
      ctx.organizationId,
      customerId,
      options,
    );
    const evaluated = await Promise.all(
      packages.map((item) => this.expireIfNeeded(item, timezone)),
    );
    return options.activeOnly
      ? evaluated.filter((item) => item.status === 'ACTIVE')
      : evaluated;
  }

  async getCustomerPackage(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const customerPackage = await this.persistence.getCustomerPackage(
      ctx.organizationId,
      id,
    );
    if (!customerPackage)
      throw new AppError('NOT_FOUND', 'Customer package was not found.');
    return this.withBalance(
      await this.expireIfNeeded(
        customerPackage,
        await this.organizationTimezone(ctx.organizationId),
      ),
    );
  }

  private async withBalance(customerPackage: CustomerPackage) {
    const balances = await this.persistence.listCreditBalancesBySource(
      customerPackage.organizationId,
      'PACKAGE',
      customerPackage.customerPackageId,
      100,
    );
    return {
      ...customerPackage,
      creditBalances: balances.map((balance) => ({
        sourceType: balance.sourceType,
        sourceId: balance.sourceId,
        ...(balance.benefitId ? { benefitId: balance.benefitId } : {}),
        unit: balance.unit,
        quantityType: balance.quantityType,
        issuedQuantity: balance.issuedQuantity,
        consumedQuantity: balance.consumedQuantity,
        restoredQuantity: balance.restoredQuantity,
        expiredQuantity: balance.expiredQuantity,
        adjustedQuantity: balance.adjustedQuantity ?? 0,
        remainingQuantity: Math.max(0, balance.remainingQuantity),
        ...(balance.expiresAt ? { expiresAt: balance.expiresAt } : {}),
      })),
    };
  }

  async list(
    ctx: AuthContext,
    options: {
      status?: CustomerPackage['status'];
      packageDefinitionId?: string;
      customerId?: string;
      expirationFrom?: string;
      expirationTo?: string;
      remainingMin?: number;
      remainingMax?: number;
      expiringSoon?: boolean;
      windowDays?: number;
      limit?: number;
    } = {},
  ) {
    assertStaff(ctx);
    const limit = options.limit ?? 100;
    const timezone = await this.organizationTimezone(ctx.organizationId);
    const today = dayKeyInTimezone(new Date().toISOString(), timezone);
    const queryFrom = options.expiringSoon ? today : options.expirationFrom;
    const queryTo = options.expiringSoon
      ? addCommercialDays(today, options.windowDays ?? 30)
      : options.expirationTo;
    const packages = options.customerId
      ? await this.persistence.listPackagesByCustomer(
          ctx.organizationId,
          options.customerId,
          { limit },
        )
      : queryFrom && queryTo
        ? await this.persistence.listPackagesExpiring(
            ctx.organizationId,
            queryFrom,
            queryTo,
            limit,
          )
        : await this.persistence.listPackagesByOrganization(
            ctx.organizationId,
            limit,
          );
    const evaluated = await Promise.all(
      packages.map((item) => this.expireIfNeeded(item, timezone)),
    );
    const filtered = evaluated
      .filter((item) => !options.status || item.status === options.status)
      .filter(
        (item) =>
          !options.packageDefinitionId ||
          item.packageDefinitionId === options.packageDefinitionId,
      )
      .filter(
        (item) =>
          !options.expirationFrom ||
          (item.expiresAt &&
            item.expiresAt.slice(0, 10) >= options.expirationFrom),
      )
      .filter(
        (item) =>
          !options.expirationTo ||
          (item.expiresAt &&
            item.expiresAt.slice(0, 10) <= options.expirationTo),
      );
    const expiring = filtered.filter((item) =>
      options.expiringSoon
        ? evaluatePackage(item, {
            today,
            timezone,
            windowDays: options.windowDays ?? 30,
          }).expiringSoon
        : true,
    );
    const enriched = await Promise.all(
      expiring.map((item) => this.withBalance(item)),
    );
    return enriched
      .filter((item) => {
        const remaining = item.creditBalances.reduce(
          (sum, balance) =>
            sum +
            (balance.quantityType === 'UNLIMITED'
              ? Number.MAX_SAFE_INTEGER
              : balance.remainingQuantity),
          0,
        );
        return (
          (options.remainingMin === undefined ||
            remaining >= options.remainingMin) &&
          (options.remainingMax === undefined ||
            remaining <= options.remainingMax)
        );
      })
      .slice(0, limit);
  }

  async transactions(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const customerPackage = await this.persistence.getCustomerPackage(
      ctx.organizationId,
      id,
    );
    if (!customerPackage)
      throw new AppError('NOT_FOUND', 'Customer package was not found.');
    return this.persistence.listCreditTransactionsByPackage(
      ctx.organizationId,
      id,
      100,
    );
  }

  private packageIdFor(
    input: { idempotencyKey?: string },
    ctx: AuthContext,
    customerId: string,
  ) {
    if (!input.idempotencyKey) return customerPackageId();
    const digest = createHash('sha256')
      .update(`${ctx.organizationId}|${customerId}|${input.idempotencyKey}`)
      .digest('hex')
      .slice(0, 40);
    return `customer-package-${digest}`;
  }

  private async ensureCredits(
    ctx: AuthContext,
    customerPackage: CustomerPackage,
  ) {
    for (const benefit of supportedBenefits(customerPackage.benefitSnapshot)) {
      const benefitId = benefit.benefitId;
      if (!benefitId) continue;
      await this.entitlements.issue({
        organizationId: ctx.organizationId,
        customerId: customerPackage.customerId,
        sourceType: 'PACKAGE',
        sourceId: customerPackage.customerPackageId,
        unit: benefit.unit,
        quantityType: benefit.quantityType,
        ...(benefit.quantityType === 'FINITE'
          ? { quantity: benefit.quantity }
          : {}),
        benefitId,
        ...(customerPackage.expiresAt
          ? { expiresAt: customerPackage.expiresAt }
          : {}),
        occurredAt: customerPackage.issuedAt,
        createdBy: ctx.userId,
        createdAt: customerPackage.createdAt,
      });
    }
  }

  async issue(ctx: AuthContext, customerId: string, input: unknown) {
    assertStaff(ctx);
    const parsed = CustomerPackageInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data.customerId && parsed.data.customerId !== customerId)
      throw new AppError(
        'VALIDATION_ERROR',
        'Package customer does not match the route customer.',
      );
    await this.customerExists(ctx, customerId);
    const definition = await this.persistence.getPackageDefinition(
      ctx.organizationId,
      parsed.data.packageDefinitionId,
    );
    if (!definition)
      throw new AppError('NOT_FOUND', 'Package definition was not found.');
    if (definition.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        'Only active package definitions can be issued.',
      );

    const issuedAt = parsed.data.issuedAt ?? now();
    const startsAt = parsed.data.startsAt ?? issuedAt;
    const expiresAt =
      definition.validityDays === null
        ? undefined
        : addDays(issuedAt, definition.validityDays);
    const timestamp = now();
    const packageId = this.packageIdFor(
      parsed.data.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: parsed.data.idempotencyKey },
      ctx,
      customerId,
    );
    const customerPackage = CustomerPackageSchema.parse({
      customerPackageId: packageId,
      organizationId: ctx.organizationId,
      customerId,
      packageDefinitionId: definition.packageDefinitionId,
      packageNameSnapshot: definition.name,
      status: 'ACTIVE',
      issuedAt,
      startsAt,
      ...(expiresAt ? { expiresAt } : {}),
      price: parsed.data.price ?? definition.price,
      currency: parsed.data.currency ?? definition.currency,
      benefitSnapshot: structuredClone(definition.benefits),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
    const charge = ChargeSchema.parse({
      chargeId: `package-${packageId}`,
      organizationId: ctx.organizationId,
      customerId,
      sourceType: 'PACKAGE',
      sourceId: packageId,
      packageId,
      description: `Package purchase: ${definition.name}`,
      amount: customerPackage.price,
      serviceAt: issuedAt,
      status: 'ACTIVE',
      createdBy: ctx.userId,
      createdAt: timestamp,
    });

    try {
      await this.persistence.issueCustomerPackage({
        customerPackage,
        charge,
      });
    } catch (error) {
      if (!parsed.data.idempotencyKey) throw error;
      const existing = await this.persistence.getCustomerPackage(
        ctx.organizationId,
        packageId,
      );
      if (!existing) throw error;
      if (
        existing.customerId !== customerId ||
        existing.packageDefinitionId !== definition.packageDefinitionId ||
        existing.issuedAt !== customerPackage.issuedAt ||
        existing.startsAt !== customerPackage.startsAt ||
        existing.expiresAt !== customerPackage.expiresAt ||
        existing.price !== customerPackage.price ||
        existing.currency !== customerPackage.currency ||
        JSON.stringify(existing.benefitSnapshot) !==
          JSON.stringify(customerPackage.benefitSnapshot) ||
        existing.notes !== customerPackage.notes
      )
        throw new AppError(
          'CONFLICT',
          'The package idempotency key is already used for another package.',
        );
      await this.ensureCredits(ctx, existing);
      await this.recordEvent('PACKAGE_ISSUED', existing, existing.issuedAt);
      return existing;
    }
    await this.ensureCredits(ctx, customerPackage);
    await this.recordEvent(
      'PACKAGE_ISSUED',
      customerPackage,
      customerPackage.issuedAt,
    );
    return customerPackage;
  }

  async cancel(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.getCustomerPackage(ctx, id);
    if (current.status === 'CANCELLED') return current;
    if (current.status !== 'ACTIVE')
      throw new AppError(
        'INVALID_STATE',
        `Cannot cancel a ${current.status.toLowerCase()} package.`,
      );
    const cancelled = CustomerPackageSchema.parse({
      ...current,
      status: 'CANCELLED',
      cancelledAt: now(),
      updatedAt: now(),
    });
    await this.persistence.putCustomerPackage(cancelled, current);
    return cancelled;
  }
}
