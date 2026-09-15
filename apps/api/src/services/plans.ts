import { randomUUID } from 'node:crypto';
import {
  PlanInputSchema,
  PlanSchema,
  PlanUpdateInputSchema,
  type AuthContext,
  type Plan,
  type PlanBenefit,
  type PlanInput,
  type PlanUpdateInput,
} from '@court-manager/contracts';
import type { Repository } from '../db.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';

const now = () => new Date().toISOString();

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
    'Plan validation failed.',
    error.flatten() as Record<string, unknown>,
  );

const planId = () => `plan-${randomUUID()}`;

const withBenefitIds = (benefits: PlanBenefit[]) =>
  benefits.map((benefit) => ({
    ...benefit,
    benefitId: benefit.benefitId ?? `benefit-${randomUUID()}`,
  }));

/**
 * Staff-managed commercial plan definitions.
 *
 * A plan is only an offering. Memberships copy the relevant commercial
 * values when they are created, so changing this record never rewrites an
 * existing customer's agreement.
 */
export class PlanService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
  ) {}

  private async organizationCurrency(organizationId: string) {
    const organization = await this.repo.get({
      PK: `ORG#${organizationId}`,
      SK: 'META',
    });
    const currency = String(organization?.currency ?? 'BRL');
    return /^[A-Z]{3}$/.test(currency) ? currency : 'BRL';
  }

  private async inputWithCurrency(
    organizationId: string,
    input: unknown,
  ): Promise<PlanInput> {
    const parsed = PlanInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    return {
      ...parsed.data,
      currency:
        parsed.data.currency ??
        (await this.organizationCurrency(organizationId)),
    };
  }

  private validatePlan(input: unknown) {
    const parsed = PlanSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    return parsed.data;
  }

  async list(
    ctx: AuthContext,
    options: { status?: Plan['status']; limit?: number } = {},
  ) {
    assertStaff(ctx);
    return this.persistence.listPlans(ctx.organizationId, options);
  }

  async get(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const plan = await this.persistence.getPlan(ctx.organizationId, id);
    if (!plan) throw new AppError('NOT_FOUND', 'Plan was not found.');
    return plan;
  }

  async create(ctx: AuthContext, input: unknown) {
    assertStaff(ctx);
    const parsed = await this.inputWithCurrency(ctx.organizationId, input);
    if (parsed.status === 'ARCHIVED')
      throw new AppError(
        'VALIDATION_ERROR',
        'A new plan must be active or inactive before it is archived.',
      );
    const timestamp = now();
    const plan = this.validatePlan({
      ...parsed,
      planId: planId(),
      organizationId: ctx.organizationId,
      benefits: withBenefitIds(parsed.benefits),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.persistence.putPlan(plan);
    return plan;
  }

  async update(ctx: AuthContext, id: string, input: unknown) {
    assertStaff(ctx);
    const current = await this.persistence.getPlan(ctx.organizationId, id);
    if (!current) throw new AppError('NOT_FOUND', 'Plan was not found.');
    const parsed = PlanUpdateInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (
      current.status === 'ARCHIVED' &&
      parsed.data.status !== undefined &&
      parsed.data.status !== 'ARCHIVED'
    )
      throw new AppError(
        'INVALID_STATE',
        'Archived plans cannot be reactivated.',
      );
    const candidate = {
      ...current,
      ...parsed.data,
      planId: current.planId,
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
    };
    const plan = this.validatePlan(candidate);
    await this.persistence.putPlan(plan, current);
    return plan;
  }

  async archive(ctx: AuthContext, id: string) {
    assertStaff(ctx);
    const current = await this.persistence.getPlan(ctx.organizationId, id);
    if (!current) throw new AppError('NOT_FOUND', 'Plan was not found.');
    if (current.status === 'ARCHIVED') return current;
    return this.update(ctx, id, {
      status: 'ARCHIVED',
    } satisfies PlanUpdateInput);
  }
}
