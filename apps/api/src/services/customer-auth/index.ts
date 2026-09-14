import { randomUUID } from 'node:crypto';
import {
  type AuthContext,
  type CustomerAccount,
  type CustomerAuthContext,
  type CustomerSelfProfile,
  type CustomerSportPreferences,
} from '@court-manager/contracts';
import type { Key, RecordItem, Repository, Write } from '../../db.js';
import { normalizeEmail, normalizePhone } from '../../domain.js';
import { AppError } from '../../errors.js';
import { phase2Keys } from '../../persistence/phase2-keys.js';
import {
  createToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../../security.js';

type Input = Record<string, unknown>;
type CustomerAccountTokenType = 'ACTIVATION' | 'RESET';
const assertRole = (ctx: AuthContext, roles: AuthContext['role'][]) => {
  if (!roles.includes(ctx.role))
    throw new AppError(
      'FORBIDDEN',
      'You do not have permission for this operation.',
    );
};
const now = () => new Date().toISOString();
const id = () => randomUUID();
const key = (entity: string, value: string): Key => ({
  PK: `${entity.toUpperCase()}#${value}`,
  SK: 'META',
});
const orgKey = (org: string, entity: string, value: string): Key => ({
  PK: `ORG#${org}`,
  SK: `${entity.toUpperCase()}#${value}`,
});
const as = <T = Record<string, unknown>>(item: RecordItem): T =>
  Object.fromEntries(
    Object.entries(item).filter(
      ([name]) => !['PK', 'SK', 'entity'].includes(name),
    ),
  ) as T;
const stored = (
  value: Record<string, unknown>,
  PK: string,
  SK = 'META',
  entity?: RecordItem['entity'],
): RecordItem =>
  ({ ...value, PK, SK, ...(entity ? { entity } : {}) }) as RecordItem;
const customerSelfProfile = (customer: RecordItem): CustomerSelfProfile => ({
  customerId: String(customer.customerId),
  organizationId: String(customer.organizationId),
  name: String(customer.name),
  ...(typeof customer.phone === 'string' ? { phone: customer.phone } : {}),
  email: String(customer.email),
  createdAt: String(customer.createdAt),
  updatedAt: String(customer.updatedAt),
});

/** Customer sessions deliberately use separate records and context from staff. */
export class CustomerAuthService {
  constructor(private readonly repo: Repository) {}
  private sessionKey(token: string): Key {
    return { PK: `CUSTOMER_SESSION#${hashToken(token)}`, SK: 'META' };
  }
  private accountKey(organizationId: string, customerAccountId: string): Key {
    return orgKey(organizationId, 'CUSTOMER_ACCOUNT', customerAccountId);
  }
  private async accountByEmail(organizationId: string, email: string) {
    const lookup = await this.repo.get<RecordItem>({
      PK: `CUSTOMER_ACCOUNT_EMAIL#${organizationId}#${normalizeEmail(email)}`,
      SK: 'META',
    });
    return lookup
      ? this.repo.get<RecordItem>(
          this.accountKey(organizationId, String(lookup.customerAccountId)),
        )
      : undefined;
  }
  async login(slug: string, email: string, password: string) {
    const organizations = await this.repo.scan<RecordItem>(
      (item) =>
        item.entity === 'organization' &&
        item.slug === slug &&
        item.active === true,
    );
    const organization = organizations[0];
    if (!organization) throw new AppError('UNAUTHORIZED', 'Invalid login.');
    const organizationId = String(organization.organizationId);
    const account = await this.accountByEmail(organizationId, email);
    const customer = account
      ? await this.repo.get<RecordItem>(
          orgKey(organizationId, 'CUSTOMER', String(account.customerId)),
        )
      : undefined;
    if (
      !account ||
      account.entity !== 'customerAccount' ||
      account.status !== 'ACTIVE' ||
      !customer ||
      customer.entity !== 'customer' ||
      customer.archived ||
      !(await verifyPassword(password, String(account.passwordHash)))
    )
      throw new AppError('UNAUTHORIZED', 'Invalid login.');
    const token = createToken();
    const timestamp = now();
    const expiresAt =
      Math.floor(Date.now() / 1000) +
      Number(process.env.CUSTOMER_SESSION_TTL_SECONDS ?? 86400);
    await this.repo.transactWrite([
      {
        type: 'put',
        item: stored(
          {
            customerSessionId: id(),
            organizationId,
            customerId: String(customer.customerId),
            customerAccountId: String(account.customerAccountId),
            tokenHash: hashToken(token),
            expiresAt,
            createdAt: timestamp,
          },
          this.sessionKey(token).PK,
          'META',
          'customerSession',
        ),
        condition: 'attribute_not_exists(PK)',
      },
      {
        type: 'put',
        item: stored(
          { ...as(account), lastLoginAt: timestamp, updatedAt: timestamp },
          account.PK,
          account.SK,
          'customerAccount',
        ),
      },
    ]);
    const accountResponse = as<CustomerAccount>(account);
    delete (accountResponse as Partial<CustomerAccount>).passwordHash;
    return {
      token,
      organizationId,
      customerId: String(customer.customerId),
      customerAccountId: String(account.customerAccountId),
      customer: customerSelfProfile(customer),
      account: accountResponse,
    };
  }
  async authenticate(token: string): Promise<CustomerAuthContext> {
    const session = await this.repo.get<RecordItem>(this.sessionKey(token));
    if (
      !session ||
      session.entity !== 'customerSession' ||
      Number(session.expiresAt) <= Math.floor(Date.now() / 1000)
    )
      throw new AppError('UNAUTHORIZED', 'Customer session expired.');
    const organizationId = String(session.organizationId);
    const account = await this.repo.get<RecordItem>(
      this.accountKey(organizationId, String(session.customerAccountId)),
    );
    const customer = await this.repo.get<RecordItem>(
      orgKey(organizationId, 'CUSTOMER', String(session.customerId)),
    );
    if (
      !account ||
      account.entity !== 'customerAccount' ||
      account.status !== 'ACTIVE' ||
      account.customerId !== session.customerId ||
      !customer ||
      customer.entity !== 'customer' ||
      customer.archived
    )
      throw new AppError('UNAUTHORIZED', 'Customer account is unavailable.');
    return {
      organizationId,
      customerId: String(session.customerId),
      customerAccountId: String(session.customerAccountId),
      actorType: 'CUSTOMER',
    };
  }
  async logout(token: string) {
    await this.repo.delete(this.sessionKey(token));
  }
  async session(ctx: CustomerAuthContext) {
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', ctx.customerId),
    );
    if (!customer)
      throw new AppError('UNAUTHORIZED', 'Customer account is unavailable.');
    const account = await this.repo.get<RecordItem>(
      this.accountKey(ctx.organizationId, ctx.customerAccountId),
    );
    if (
      !account ||
      account.entity !== 'customerAccount' ||
      account.customerId !== ctx.customerId
    )
      throw new AppError('UNAUTHORIZED', 'Customer account is unavailable.');
    const accountResponse = as<CustomerAccount>(account);
    delete (accountResponse as Partial<CustomerAccount>).passwordHash;
    return {
      ...ctx,
      customer: customerSelfProfile(customer),
      account: accountResponse,
    };
  }
}

/** Customer-owned contact data and sports; staff-only customer fields stay out. */
export class CustomerSelfProfileService {
  constructor(private readonly repo: Repository) {}

  private customerKey(ctx: CustomerAuthContext) {
    return orgKey(ctx.organizationId, 'CUSTOMER', ctx.customerId);
  }
  private accountKey(ctx: CustomerAuthContext) {
    return orgKey(
      ctx.organizationId,
      'CUSTOMER_ACCOUNT',
      ctx.customerAccountId,
    );
  }
  private emailKey(organizationId: string, normalizedEmail: string): Key {
    return {
      PK: `CUSTOMER_ACCOUNT_EMAIL#${organizationId}#${normalizedEmail}`,
      SK: 'META',
    };
  }
  private async records(ctx: CustomerAuthContext) {
    const [customer, account] = await Promise.all([
      this.repo.get<RecordItem>(this.customerKey(ctx)),
      this.repo.get<RecordItem>(this.accountKey(ctx)),
    ]);
    if (
      !customer ||
      customer.entity !== 'customer' ||
      customer.archived ||
      !account ||
      account.entity !== 'customerAccount' ||
      account.customerId !== ctx.customerId ||
      account.status !== 'ACTIVE'
    )
      throw new AppError('UNAUTHORIZED', 'Customer account is unavailable.');
    return { account, customer };
  }
  private preferences(
    ctx: CustomerAuthContext,
    customer: RecordItem,
    preference?: RecordItem,
  ): CustomerSportPreferences {
    const legacyPreferredSportId =
      typeof customer.preferredSportId === 'string'
        ? customer.preferredSportId
        : undefined;
    const sportIds = Array.isArray(preference?.sportIds)
      ? preference.sportIds.map(String)
      : legacyPreferredSportId
        ? [legacyPreferredSportId]
        : [];
    const preferredSportId =
      typeof preference?.preferredSportId === 'string'
        ? preference.preferredSportId
        : legacyPreferredSportId;
    return {
      organizationId: ctx.organizationId,
      customerId: ctx.customerId,
      sportIds,
      ...(preferredSportId ? { preferredSportId } : {}),
      updatedAt: String(preference?.updatedAt ?? customer.updatedAt),
    };
  }
  async update(ctx: CustomerAuthContext, input: Input) {
    const { account, customer } = await this.records(ctx);
    const email =
      input.email === undefined
        ? String(customer.email ?? '')
        : normalizeEmail(String(input.email));
    if (!email)
      throw new AppError('VALIDATION_ERROR', 'Customer email is required.');
    const previousEmail = String(account.normalizedEmail);
    if (email !== previousEmail) {
      const [accountLookup, customers] = await Promise.all([
        this.repo.get<RecordItem>(this.emailKey(ctx.organizationId, email)),
        this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
          beginsWith: 'CUSTOMER#',
        }),
      ]);
      if (
        (accountLookup &&
          accountLookup.customerAccountId !== ctx.customerAccountId) ||
        customers.some(
          (item) =>
            item.entity === 'customer' &&
            item.customerId !== ctx.customerId &&
            item.normalizedEmail === email,
        )
      )
        throw new AppError('CONFLICT', 'Email is already used by a customer.');
    }
    const timestamp = now();
    const updatedCustomer = stored(
      {
        ...as(customer),
        ...(input.name === undefined
          ? {}
          : { name: String(input.name).trim() }),
        ...(input.phone === undefined
          ? {}
          : {
              phone: String(input.phone).trim(),
              normalizedPhone: normalizePhone(String(input.phone)),
            }),
        email,
        normalizedEmail: email,
        updatedAt: timestamp,
      },
      customer.PK,
      customer.SK,
      'customer',
    );
    const updatedAccount = stored(
      {
        ...as(account),
        email,
        normalizedEmail: email,
        updatedAt: timestamp,
      },
      account.PK,
      account.SK,
      'customerAccount',
    );
    const writes: Write[] = [
      { type: 'put', item: updatedCustomer },
      { type: 'put', item: updatedAccount },
    ];
    if (email !== previousEmail) {
      writes.push(
        {
          type: 'delete',
          key: this.emailKey(ctx.organizationId, previousEmail),
        },
        {
          type: 'put',
          item: stored(
            {
              organizationId: ctx.organizationId,
              customerAccountId: ctx.customerAccountId,
              customerId: ctx.customerId,
              normalizedEmail: email,
            },
            this.emailKey(ctx.organizationId, email).PK,
            'META',
          ),
          condition: 'attribute_not_exists(PK)',
        },
      );
    }
    await this.repo.transactWrite(writes);
    const accountResponse = as<CustomerAccount>(updatedAccount);
    delete (accountResponse as Partial<CustomerAccount>).passwordHash;
    return {
      customer: customerSelfProfile(updatedCustomer),
      account: accountResponse,
    };
  }
  async sports(ctx: CustomerAuthContext) {
    const { customer } = await this.records(ctx);
    const preference = await this.repo.get<RecordItem>(
      phase2Keys.customerSportPreferences(ctx.organizationId, ctx.customerId),
    );
    return this.preferences(ctx, customer, preference);
  }
  async updateSports(ctx: CustomerAuthContext, input: Input) {
    const { customer } = await this.records(ctx);
    const existingPreference = await this.repo.get<RecordItem>(
      phase2Keys.customerSportPreferences(ctx.organizationId, ctx.customerId),
    );
    const sportIds = Array.from(
      new Set((input.sportIds as string[]).map(String)),
    );
    if (sportIds.length !== (input.sportIds as string[]).length)
      throw new AppError(
        'VALIDATION_ERROR',
        'Sports must not contain duplicates.',
      );
    const legacyPreferredSportId =
      typeof customer.preferredSportId === 'string'
        ? customer.preferredSportId
        : undefined;
    const preferredSportId =
      input.preferredSportId === undefined
        ? sportIds.includes(legacyPreferredSportId ?? '')
          ? legacyPreferredSportId
          : undefined
        : String(input.preferredSportId);
    if (preferredSportId && !sportIds.includes(preferredSportId))
      throw new AppError(
        'VALIDATION_ERROR',
        'Preferred sport must be selected.',
      );
    // A sport that was selected before staff deactivated it remains durable
    // customer history. Only newly added selections must be active.
    const previousSportIds = Array.isArray(existingPreference?.sportIds)
      ? existingPreference.sportIds.map(String)
      : legacyPreferredSportId
        ? [legacyPreferredSportId]
        : [];
    const newlySelectedSportIds = sportIds.filter(
      (sportId) => !previousSportIds.includes(sportId),
    );
    const sports = await this.repo.batchGet<RecordItem>(
      newlySelectedSportIds.map((sportId) =>
        orgKey(ctx.organizationId, 'SPORT', sportId),
      ),
    );
    if (
      sports.length !== newlySelectedSportIds.length ||
      sports.some((sport) => sport.entity !== 'sport' || sport.active !== true)
    )
      throw new AppError(
        'VALIDATION_ERROR',
        'Selected sport is inactive or unavailable.',
      );
    const timestamp = now();
    const preference = stored(
      {
        organizationId: ctx.organizationId,
        customerId: ctx.customerId,
        sportIds,
        ...(preferredSportId ? { preferredSportId } : {}),
        updatedAt: timestamp,
      },
      phase2Keys.customerSportPreferences(ctx.organizationId, ctx.customerId)
        .PK,
      'SPORT_PREFERENCES',
      'customerSportPreferences',
    );
    const customerData = as(customer);
    delete customerData.preferredSportId;
    if (preferredSportId) customerData.preferredSportId = preferredSportId;
    const updatedCustomer = stored(
      { ...customerData, updatedAt: timestamp },
      customer.PK,
      customer.SK,
      'customer',
    );
    const writes: Write[] = [
      { type: 'put', item: preference },
      { type: 'put', item: updatedCustomer },
      ...previousSportIds
        .filter((sportId) => !sportIds.includes(sportId))
        .map((sportId) => ({
          type: 'delete' as const,
          key: phase2Keys.customerBySportPreference(
            ctx.organizationId,
            sportId,
            ctx.customerId,
          ),
        })),
      ...sportIds.map((sportId) => {
        const indexKey = phase2Keys.customerBySportPreference(
          ctx.organizationId,
          sportId,
          ctx.customerId,
        );
        return {
          type: 'put' as const,
          item: stored(
            {
              organizationId: ctx.organizationId,
              sportId,
              customerId: ctx.customerId,
              preferred: sportId === preferredSportId,
              updatedAt: timestamp,
            },
            indexKey.PK,
            indexKey.SK,
            'customerSportPreference',
          ),
        };
      }),
    ];
    await this.repo.transactWrite(writes);
    return this.preferences(ctx, updatedCustomer, preference);
  }
}

/** Customer credentials stay separate from customer history and staff auth. */
export class CustomerAccountService {
  constructor(private readonly repo: Repository) {}

  private async venue(slug: string) {
    const organizations = await this.repo.scan<RecordItem>(
      (item) =>
        item.entity === 'organization' &&
        item.slug === slug &&
        item.active === true,
    );
    const organization = organizations[0];
    if (!organization) throw new AppError('NOT_FOUND', 'Venue was not found.');
    return organization;
  }
  private accountKey(organizationId: string, customerAccountId: string) {
    return orgKey(organizationId, 'CUSTOMER_ACCOUNT', customerAccountId);
  }
  private emailKey(organizationId: string, normalizedEmail: string): Key {
    return {
      PK: `CUSTOMER_ACCOUNT_EMAIL#${organizationId}#${normalizedEmail}`,
      SK: 'META',
    };
  }
  private phoneKey(organizationId: string, normalizedPhone: string): Key {
    return {
      PK: `CUSTOMER_IDENTITY_PHONE#${organizationId}#${normalizedPhone}`,
      SK: 'META',
    };
  }
  private tokenKey(organizationId: string, token: string): Key {
    return {
      PK: `ORG#${organizationId}`,
      SK: `CUSTOMER_ACCOUNT_TOKEN#${hashToken(token)}`,
    };
  }
  private async accountByEmail(organizationId: string, email: string) {
    const lookup = await this.repo.get<RecordItem>(
      this.emailKey(organizationId, email),
    );
    return lookup
      ? this.repo.get<RecordItem>(
          this.accountKey(organizationId, String(lookup.customerAccountId)),
        )
      : undefined;
  }
  private async identityConflict(
    organizationId: string,
    email: string,
    phone: string,
  ) {
    const customers = await this.repo.query<RecordItem>(
      `ORG#${organizationId}`,
      { beginsWith: 'CUSTOMER#' },
    );
    return customers.some(
      (customer) =>
        customer.entity === 'customer' &&
        (customer.normalizedEmail === email ||
          customer.normalizedPhone === phone),
    );
  }
  async register(slug: string, input: Input) {
    const organization = await this.venue(slug);
    const organizationId = String(organization.organizationId);
    const email = normalizeEmail(String(input.email));
    const phone = normalizePhone(String(input.phone));
    if (!email || !phone)
      throw new AppError('VALIDATION_ERROR', 'Email and phone are required.');
    if (
      (await this.accountByEmail(organizationId, email)) ||
      (await this.identityConflict(organizationId, email, phone))
    )
      throw new AppError(
        'CONFLICT',
        'An existing customer cannot be claimed through registration.',
      );
    const timestamp = now(),
      customerId = id(),
      customerAccountId = id();
    const customer = stored(
      {
        customerId,
        organizationId,
        name: String(input.name).trim(),
        phone: String(input.phone).trim(),
        normalizedPhone: phone,
        email,
        normalizedEmail: email,
        tags: [],
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${organizationId}`,
      `CUSTOMER#${customerId}`,
      'customer',
    );
    const account = stored(
      {
        customerAccountId,
        organizationId,
        customerId,
        email,
        normalizedEmail: email,
        passwordHash: await hashPassword(String(input.password)),
        status: 'ACTIVE',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      `ORG#${organizationId}`,
      `CUSTOMER_ACCOUNT#${customerAccountId}`,
      'customerAccount',
    );
    const emailKey = this.emailKey(organizationId, email);
    const phoneKey = this.phoneKey(organizationId, phone);
    const emailLookup = stored(
      { organizationId, customerAccountId, customerId, normalizedEmail: email },
      emailKey.PK,
      emailKey.SK,
    );
    await this.repo.transactWrite([
      { type: 'put', item: customer, condition: 'attribute_not_exists(PK)' },
      { type: 'put', item: account, condition: 'attribute_not_exists(PK)' },
      { type: 'put', item: emailLookup, condition: 'attribute_not_exists(PK)' },
      {
        type: 'put',
        item: stored(
          { organizationId, customerId, normalizedPhone: phone },
          phoneKey.PK,
          phoneKey.SK,
        ),
        condition: 'attribute_not_exists(PK)',
      },
    ]);
    const accountResponse = as<CustomerAccount>(account);
    delete (accountResponse as Partial<CustomerAccount>).passwordHash;
    return { customer: as(customer), account: accountResponse };
  }
  private async generateToken(
    ctx: AuthContext,
    customerId: string,
    type: CustomerAccountTokenType,
  ) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const customer = await this.repo.get<RecordItem>(
      orgKey(ctx.organizationId, 'CUSTOMER', customerId),
    );
    if (!customer || customer.archived)
      throw new AppError('NOT_FOUND', 'Customer was not found.');
    let account = (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'CUSTOMER_ACCOUNT#',
      })
    ).find(
      (item) =>
        item.entity === 'customerAccount' && item.customerId === customerId,
    );
    if (!account && type === 'RESET')
      throw new AppError('NOT_FOUND', 'Customer portal account was not found.');
    const timestamp = now();
    if (!account) {
      const customerAccountId = id(),
        email = normalizeEmail(String(customer.email ?? ''));
      if (!email)
        throw new AppError('VALIDATION_ERROR', 'Customer email is required.');
      if (await this.accountByEmail(ctx.organizationId, email))
        throw new AppError(
          'CONFLICT',
          'Customer email already has portal access.',
        );
      account = stored(
        {
          customerAccountId,
          organizationId: ctx.organizationId,
          customerId,
          email,
          normalizedEmail: email,
          passwordHash: await hashPassword(createToken()),
          status: 'ACTIVE',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        `ORG#${ctx.organizationId}`,
        `CUSTOMER_ACCOUNT#${customerAccountId}`,
        'customerAccount',
      );
      const emailKey = this.emailKey(ctx.organizationId, email);
      await this.repo.transactWrite([
        { type: 'put', item: account, condition: 'attribute_not_exists(PK)' },
        {
          type: 'put',
          item: stored(
            {
              organizationId: ctx.organizationId,
              customerAccountId,
              customerId,
              normalizedEmail: email,
            },
            emailKey.PK,
            emailKey.SK,
          ),
          condition: 'attribute_not_exists(PK)',
        },
      ]);
    }
    const token = createToken(),
      expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24,
      tokenKey = this.tokenKey(ctx.organizationId, token);
    await this.repo.put(
      stored(
        {
          organizationId: ctx.organizationId,
          customerId,
          customerAccountId: account.customerAccountId,
          tokenHash: hashToken(token),
          type,
          expiresAt,
          createdAt: timestamp,
        },
        tokenKey.PK,
        tokenKey.SK,
        'customerAccountToken',
      ),
      'attribute_not_exists(PK)',
    );
    const organization = await this.repo.get<RecordItem>(
      key('organization', ctx.organizationId),
    );
    const action = type === 'ACTIVATION' ? 'activate' : 'reset-password';
    return {
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      link: `/portal/${encodeURIComponent(String(organization?.slug ?? ''))}/${action}?token=${encodeURIComponent(token)}`,
    };
  }
  async enable(ctx: AuthContext, customerId: string) {
    return this.generateToken(ctx, customerId, 'ACTIVATION');
  }
  async reset(ctx: AuthContext, customerId: string) {
    return this.generateToken(ctx, customerId, 'RESET');
  }
  /** Existing sessions stop working because authentication requires ACTIVE. */
  async disable(ctx: AuthContext, customerId: string) {
    assertRole(ctx, ['OWNER', 'STAFF']);
    const account = (
      await this.repo.query<RecordItem>(`ORG#${ctx.organizationId}`, {
        beginsWith: 'CUSTOMER_ACCOUNT#',
      })
    ).find(
      (item) =>
        item.entity === 'customerAccount' && item.customerId === customerId,
    );
    if (!account)
      throw new AppError('NOT_FOUND', 'Customer portal account was not found.');
    await this.repo.put(
      stored(
        { ...as(account), status: 'DISABLED', updatedAt: now() },
        account.PK,
        account.SK,
        'customerAccount',
      ),
    );
    return { customerId, status: 'DISABLED' as const };
  }
  async setPassword(
    slug: string,
    input: Input,
    type: CustomerAccountTokenType,
  ) {
    const organization = await this.venue(slug),
      organizationId = String(organization.organizationId),
      tokenKey = this.tokenKey(organizationId, String(input.token));
    const tokenRecord = await this.repo.get<RecordItem>(tokenKey);
    if (
      !tokenRecord ||
      tokenRecord.entity !== 'customerAccountToken' ||
      tokenRecord.type !== type ||
      Number(tokenRecord.expiresAt) <= Math.floor(Date.now() / 1000)
    )
      throw new AppError(
        'UNAUTHORIZED',
        'Activation link is invalid or expired.',
      );
    const account = await this.repo.get<RecordItem>(
      this.accountKey(organizationId, String(tokenRecord.customerAccountId)),
    );
    if (
      !account ||
      account.entity !== 'customerAccount' ||
      account.customerId !== tokenRecord.customerId
    )
      throw new AppError(
        'UNAUTHORIZED',
        'Activation link is invalid or expired.',
      );
    const updated = stored(
      {
        ...as(account),
        passwordHash: await hashPassword(String(input.password)),
        status: 'ACTIVE',
        updatedAt: now(),
      },
      account.PK,
      account.SK,
      'customerAccount',
    );
    await this.repo.transactWrite([
      { type: 'put', item: updated },
      { type: 'delete', key: tokenKey, condition: 'attribute_exists(PK)' },
    ]);
    return {
      activated: type === 'ACTIVATION',
      passwordReset: type === 'RESET',
    };
  }
}
