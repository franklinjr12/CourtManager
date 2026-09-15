import { createHash, randomUUID } from 'node:crypto';
import {
  MakeupCreditInputSchema,
  MakeupCreditSchema,
  type AuthContext,
  type CustomerAuthContext,
  type MakeupCredit,
} from '@court-manager/contracts';
import type { RecordItem, Repository } from '../db.js';
import { AppError } from '../errors.js';
import type { Phase3Persistence } from '../persistence/phase3-repository.js';
import { EntitlementService } from './entitlements.js';

const now = () => new Date().toISOString();

const assertStaff = (ctx: AuthContext) => {
  if (!['OWNER', 'STAFF'].includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};

const primary = (kind: string, id: string) => ({
  PK: `${kind}#${id}`,
  SK: 'META',
});

const validationError = (error: { flatten: () => unknown }) =>
  new AppError(
    'VALIDATION_ERROR',
    'Makeup credit validation failed.',
    error.flatten() as Record<string, unknown>,
  );

const makeupCreditIdFor = (
  organizationId: string,
  customerId: string,
  idempotencyKey?: string,
) => {
  if (!idempotencyKey) return `makeup-credit-${randomUUID()}`;
  const digest = createHash('sha256')
    .update(`${organizationId}|${customerId}|${idempotencyKey}`)
    .digest('hex')
    .slice(0, 40);
  return `makeup-credit-${digest}`;
};

/** Staff-managed class replacement entitlements backed by the Phase 3 ledger. */
export class MakeupCreditService {
  constructor(
    private readonly persistence: Phase3Persistence,
    private readonly repo: Repository,
    private readonly entitlements: EntitlementService,
  ) {}

  private async assertCustomer(ctx: AuthContext, customerId: string) {
    const customer = await this.repo.get<RecordItem>({
      PK: `ORG#${ctx.organizationId}`,
      SK: `CUSTOMER#${customerId}`,
    });
    if (!customer || customer.entity !== 'customer' || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
  }

  private async assertOrigin(
    ctx: AuthContext,
    originClassId: string,
    originSessionId: string,
  ) {
    const [classRecord, session] = await Promise.all([
      this.repo.get<RecordItem>(primary('CLASS', originClassId)),
      this.repo.get<RecordItem>(primary('CLASS_SESSION', originSessionId)),
    ]);
    if (
      !classRecord ||
      classRecord.organizationId !== ctx.organizationId ||
      !session ||
      session.organizationId !== ctx.organizationId ||
      session.classId !== originClassId
    )
      throw new AppError('NOT_FOUND', 'Origin class session was not found.');
  }

  private async ensureLedger(ctx: AuthContext, credit: MakeupCredit) {
    await this.entitlements.issue({
      organizationId: ctx.organizationId,
      customerId: credit.customerId,
      sourceType: 'MAKEUP',
      sourceId: credit.makeupCreditId,
      benefitId: 'makeup-attendance',
      unit: 'SESSION',
      quantityType: 'FINITE',
      quantity: 1,
      ...(credit.expiresAt ? { expiresAt: credit.expiresAt } : {}),
      occurredAt: credit.issuedAt,
      createdBy: credit.createdBy,
      createdAt: credit.createdAt,
    });
  }

  async issue(ctx: AuthContext, customerId: string, input: unknown) {
    assertStaff(ctx);
    const parsed = MakeupCreditInputSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    if (parsed.data.customerId && parsed.data.customerId !== customerId)
      throw new AppError(
        'VALIDATION_ERROR',
        'Makeup credit customer does not match the route customer.',
      );
    await this.assertCustomer(ctx, customerId);
    await this.assertOrigin(
      ctx,
      parsed.data.originClassId,
      parsed.data.originSessionId,
    );
    const issuedAt = parsed.data.issuedAt ?? now();
    const timestamp = now();
    const credit = MakeupCreditSchema.parse({
      makeupCreditId: makeupCreditIdFor(
        ctx.organizationId,
        customerId,
        parsed.data.idempotencyKey,
      ),
      organizationId: ctx.organizationId,
      customerId,
      originClassId: parsed.data.originClassId,
      originSessionId: parsed.data.originSessionId,
      reason: parsed.data.reason,
      issuedAt,
      ...(parsed.data.expiresAt ? { expiresAt: parsed.data.expiresAt } : {}),
      status: 'ACTIVE',
      createdBy: ctx.userId,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      ...(parsed.data.idempotencyKey
        ? { idempotencyKey: parsed.data.idempotencyKey }
        : {}),
    });
    try {
      await this.persistence.putMakeupCredit(credit);
    } catch (error) {
      if (!parsed.data.idempotencyKey) throw error;
      const existing = await this.persistence.getMakeupCredit(
        ctx.organizationId,
        credit.makeupCreditId,
      );
      if (!existing) throw error;
      if (
        existing.customerId !== customerId ||
        existing.originClassId !== credit.originClassId ||
        existing.originSessionId !== credit.originSessionId ||
        existing.reason !== credit.reason
      ) {
        throw new AppError(
          'CONFLICT',
          'The idempotency key is already used for another makeup credit.',
        );
      }
      await this.ensureLedger(ctx, existing);
      return existing;
    }
    await this.ensureLedger(ctx, credit);
    return credit;
  }

  async issueForSession(
    ctx: AuthContext,
    sessionId: string,
    customerId: string,
    reason: MakeupCredit['reason'] = 'STAFF_GRANTED',
    expiresAt?: string,
  ) {
    const session = await this.repo.get<RecordItem>(
      primary('CLASS_SESSION', sessionId),
    );
    if (!session || session.organizationId !== ctx.organizationId)
      throw new AppError('NOT_FOUND', 'Class session was not found.');
    return this.issue(ctx, customerId, {
      originClassId: String(session.classId),
      originSessionId: sessionId,
      reason,
      ...(expiresAt ? { expiresAt } : {}),
    });
  }

  async list(ctx: AuthContext, customerId: string) {
    assertStaff(ctx);
    await this.assertCustomer(ctx, customerId);
    return this.withBalances(ctx.organizationId, customerId);
  }

  async listForCustomer(ctx: CustomerAuthContext) {
    return this.withBalances(ctx.organizationId, ctx.customerId);
  }

  private async withBalances(organizationId: string, customerId: string) {
    const credits = await this.persistence.listMakeupCreditsByCustomer(
      organizationId,
      customerId,
      { limit: 100 },
    );
    const balances = await this.persistence.listCreditBalancesByCustomer(
      organizationId,
      customerId,
      100,
    );
    const balanceBySource = new Map(
      balances
        .filter(
          (balance) =>
            balance.sourceType === 'MAKEUP' &&
            balance.benefitId === 'makeup-attendance',
        )
        .map((balance) => [balance.sourceId, balance.remainingQuantity]),
    );
    return credits.map((credit) => ({
      ...credit,
      remainingQuantity: balanceBySource.get(credit.makeupCreditId) ?? 0,
    }));
  }

  async expire(ctx: AuthContext, makeupCreditId: string) {
    assertStaff(ctx);
    const credit = await this.persistence.getMakeupCredit(
      ctx.organizationId,
      makeupCreditId,
    );
    if (!credit)
      throw new AppError('NOT_FOUND', 'Makeup credit was not found.');
    if (credit.status !== 'ACTIVE') return credit;
    await this.entitlements.expire({
      organizationId: ctx.organizationId,
      customerId: credit.customerId,
      sourceType: 'MAKEUP',
      sourceId: credit.makeupCreditId,
      benefitId: 'makeup-attendance',
      createdBy: ctx.userId,
      reason: 'Makeup credit expired',
    });
    const timestamp = now();
    const expired = {
      ...credit,
      status: 'EXPIRED' as const,
      updatedAt: timestamp,
    };
    await this.persistence.putMakeupCredit(expired, credit);
    return expired;
  }
}
