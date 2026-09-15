import type {
  Membership,
  MembershipPeriod,
  Plan,
} from '@court-manager/contracts';
import type { Customer } from '../core/types.js';
import { formatDate, formatMoney, t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import {
  app,
  escapeText,
  navigate,
  renderRoute,
  request,
  screen,
} from './runtime.js';

type CreditBalance = {
  sourceType: string;
  sourceId: string;
  benefitId?: string;
  unit: string;
  quantityType: 'FINITE' | 'UNLIMITED';
  consumedQuantity: number;
  remainingQuantity: number;
};
type ChargeRow = {
  membershipId?: string;
  membershipPeriodId?: string;
  amount: number;
  paidAmount: number;
  paymentStatus: string;
};
const today = () => new Date().toISOString().slice(0, 10);
const statusBadge = (status: Membership['status']) =>
  `<span class="status-badge status-${escapeText(status)}">${escapeText(t(`memberships.status.${status}` as never))}</span>`;
const option = (value: string, label: string, selected?: string) =>
  `<option value="${escapeText(value)}"${value === selected ? ' selected' : ''}>${escapeText(label)}</option>`;
const commercialNav = () =>
  `<nav class="commercial-nav" aria-label="${escapeText(t('nav.commercial'))}"><a href="/commercial">${t('commercial.overview')}</a><a href="/commercial/plans">${t('plans.title')}</a><a class="active" href="/commercial/memberships">${t('memberships.title')}</a><a href="/commercial/packages">${t('packages.title')}</a><a href="/commercial/fixed-courts">${t('fixedCourtAgreements.title')}</a></nav>`;

const filters = (
  query: URLSearchParams,
  plans: Plan[],
  customers: Customer[],
) =>
  `<form id="membership-filters" class="filters card"><label>${t('common.status')}<select name="status">${option('', t('common.all' as never))}${['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'].map((value) => option(value, t(`memberships.status.${value}` as never), query.get('status') ?? undefined)).join('')}</select></label><label>${t('memberships.plan')}<select name="planId">${option('', t('common.all' as never))}${plans.map((plan) => option(plan.planId, plan.name, query.get('planId') ?? undefined)).join('')}</select></label><label>${t('memberships.customer')}<select name="customerId">${option('', t('common.all' as never))}${customers
    .filter((customer) => !customer.archived)
    .map((customer) =>
      option(
        customer.customerId,
        customer.name,
        query.get('customerId') ?? undefined,
      ),
    )
    .join(
      '',
    )}</select></label><label>${t('memberships.renewalFrom')}<input name="renewalFrom" type="date" value="${escapeText(query.get('renewalFrom') ?? '')}"></label><label>${t('memberships.renewalTo')}<input name="renewalTo" type="date" value="${escapeText(query.get('renewalTo') ?? '')}"></label><button class="button" type="submit">${t('common.applyFilters' as never)}</button></form>`;

export async function memberships() {
  const query = new URLSearchParams(location.search);
  const params = new URLSearchParams({ limit: '100' });
  for (const key of [
    'status',
    'planId',
    'customerId',
    'renewalFrom',
    'renewalTo',
  ]) {
    const value = query.get(key);
    if (value) params.set(key, value);
  }
  const [data, customers, plans] = await Promise.all([
    request<Membership[]>(`/memberships?${params}`),
    request<Customer[]>('/customers?limit=100'),
    request<Plan[]>('/plans?limit=100'),
  ]);
  const customerName = (id: string) =>
    customers.find((customer) => customer.customerId === id)?.name ?? id;
  await shell(
    () =>
      `<div class="toolbar"><div><h2>${t('memberships.title')}</h2><p class="muted">${t('memberships.description')}</p></div><button class="button primary" id="add-membership">${t('memberships.add')}</button></div>${commercialNav()}${filters(query, plans, customers)}<article class="card table-wrap"><table><thead><tr><th>${t('memberships.customer')}</th><th>${t('memberships.plan')}</th><th>${t('common.price')}</th><th>${t('memberships.period')}</th><th>${t('memberships.nextRenewal')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.length ? data.map((membership) => `<tr><td><strong>${escapeText(customerName(membership.customerId))}</strong></td><td><button class="link-button inline-link" data-membership-details="${escapeText(membership.membershipId)}">${escapeText(membership.planNameSnapshot)}</button></td><td>${escapeText(formatMoney(membership.price, membership.currency))}</td><td>${escapeText(formatDate(membership.currentPeriodStart))} – ${escapeText(formatDate(membership.currentPeriodEnd))}</td><td>${membership.nextRenewalDate ? escapeText(formatDate(membership.nextRenewalDate)) : '—'}</td><td>${statusBadge(membership.status)}</td><td class="row-actions">${membership.status === 'ACTIVE' ? `<button class="button small" data-membership-action="pause" data-membership-id="${escapeText(membership.membershipId)}">${t('memberships.pause')}</button><button class="button small" data-membership-action="cancel" data-membership-id="${escapeText(membership.membershipId)}">${t('memberships.cancel')}</button><button class="button small" data-membership-action="renew" data-membership-id="${escapeText(membership.membershipId)}">${t('memberships.renew')}</button>` : membership.status === 'PAUSED' ? `<button class="button small" data-membership-action="resume" data-membership-id="${escapeText(membership.membershipId)}">${t('memberships.resume')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="7" class="empty">${t('memberships.empty')}</td></tr>`}</tbody></table></article>`,
    () => wireMemberships(customers),
  );
}

function wireMemberships(customers: Customer[]) {
  screen()
    ?.querySelector('#add-membership')
    ?.addEventListener('click', () => void openMembershipModal());
  screen()
    ?.querySelector('#membership-filters')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formData(event.currentTarget as HTMLFormElement);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(values))
        if (value) params.set(key, String(value));
      navigate(
        `/commercial/memberships${params.toString() ? `?${params}` : ''}`,
      );
    });
  screen()
    ?.querySelectorAll<HTMLElement>('[data-membership-details]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () =>
          void openMembershipDetails(
            button.dataset.membershipDetails ?? '',
            customers,
          ),
      ),
    );
  screen()
    ?.querySelectorAll<HTMLElement>('[data-membership-action]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () =>
          void performMembershipAction(
            button.dataset.membershipAction ?? '',
            button.dataset.membershipId ?? '',
          ),
      ),
    );
}

async function performMembershipAction(action: string, id: string) {
  if (!action || !id) return;
  if (action === 'cancel' && !window.confirm(t('memberships.cancel'))) return;
  try {
    await request(`/memberships/${id}/${action}`, {
      method: 'POST',
      body: membershipActionBody(action),
    });
    toast(
      t(
        `memberships.${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : action === 'cancel' ? 'cancelled' : 'renewed'}` as never,
      ),
    );
    await renderRoute();
  } catch (error) {
    toast(String(error instanceof Error ? error.message : error), 'error');
  }
}

export const membershipActionBody = (
  action: string,
  idempotencyKey: string = crypto.randomUUID(),
) => JSON.stringify(action === 'renew' ? { idempotencyKey } : {});

async function openMembershipDetails(id: string, customers: Customer[]) {
  const membership = await request<Membership>(`/memberships/${id}`);
  const [periods, summary, charges] = await Promise.all([
    request<MembershipPeriod[]>(`/memberships/${id}/periods`),
    request<{ balance: { credits: CreditBalance[] } }>(
      `/customers/${membership.customerId}/commercial-summary`,
    ),
    request<ChargeRow[]>(
      `/charges?customerId=${encodeURIComponent(membership.customerId)}&sourceType=MEMBERSHIP`,
    ),
  ]);
  const balances = summary.balance.credits.filter(
    (balance) => balance.sourceType === 'MEMBERSHIP' && balance.sourceId === id,
  );
  const customer =
    customers.find((item) => item.customerId === membership.customerId)?.name ??
    membership.customerId;
  const charge = charges.find(
    (item) =>
      item.membershipId === id ||
      periods.some(
        (period) => period.membershipPeriodId === item.membershipPeriodId,
      ),
  );
  const allowance = membership.benefitSnapshot
    .map((benefit) => {
      const balance = balances.find(
        (item) => item.benefitId === benefit.benefitId,
      );
      const quantityType =
        'quantityType' in benefit ? benefit.quantityType : 'UNLIMITED';
      const quantity = 'quantity' in benefit ? benefit.quantity : undefined;
      const text =
        quantityType === 'UNLIMITED'
          ? t('memberships.unlimited')
          : `${balance?.remainingQuantity ?? 0} / ${quantity}`;
      return `<li><strong>${escapeText(benefit.label ?? t(`plans.type.${benefit.type}` as never))}</strong><span>${escapeText(text)} ${escapeText(t(`plans.unit.${benefit.unit}` as never))}</span>${quantityType === 'FINITE' ? `<div class="progress"><span style="width:${Math.min(100, ((balance?.consumedQuantity ?? 0) / Math.max(1, quantity ?? 1)) * 100)}%"></span></div>` : ''}</li>`;
    })
    .join('');
  openModal(
    t('memberships.details'),
    `<div class="detail-grid"><div><small class="muted">${t('memberships.customer')}</small><strong>${escapeText(customer)}</strong></div><div><small class="muted">${t('memberships.plan')}</small><strong>${escapeText(membership.planNameSnapshot)}</strong></div><div><small class="muted">${t('common.price')}</small><strong>${escapeText(formatMoney(membership.price, membership.currency))}</strong></div><div><small class="muted">${t('common.status')}</small><strong>${statusBadge(membership.status)}</strong></div><div><small class="muted">${t('memberships.period')}</small><strong>${escapeText(formatDate(membership.currentPeriodStart))} – ${escapeText(formatDate(membership.currentPeriodEnd))}</strong></div><div><small class="muted">${t('memberships.nextRenewal')}</small><strong>${escapeText(membership.nextRenewalDate ? formatDate(membership.nextRenewalDate) : '—')}</strong></div></div><article><h3>${t('memberships.allowance')}</h3><ul class="detail-list">${allowance}</ul></article><article class="section-card"><h3>${t('memberships.chargeState')}</h3><p>${charge ? `${escapeText(t(`paymentStatus.${charge.paymentStatus}` as never))} · ${escapeText(formatMoney(charge.paidAmount, membership.currency))} / ${escapeText(formatMoney(charge.amount, membership.currency))}` : t('memberships.noCharge')}</p></article><article class="section-card table-wrap"><h3>${t('memberships.history')}</h3><table><thead><tr><th>${t('memberships.periodNumber')}</th><th>${t('common.start')}</th><th>${t('common.end')}</th><th>${t('common.status')}</th><th>${t('common.price')}</th></tr></thead><tbody>${periods.map((period) => `<tr><td>${period.periodNumber}</td><td>${escapeText(formatDate(period.startDate))}</td><td>${escapeText(formatDate(period.endDate))}</td><td>${escapeText(t(`memberships.periodStatus.${period.status}` as never))}</td><td>${escapeText(formatMoney(period.price, period.currency))}</td></tr>`).join('')}</tbody></table></article><div class="form-actions detail-actions">${membership.status === 'ACTIVE' ? `<button class="button" data-detail-action="pause">${t('memberships.pause')}</button><button class="button danger" data-detail-action="cancel">${t('memberships.cancel')}</button><button class="button primary" data-detail-action="renew">${t('memberships.renew')}</button>` : membership.status === 'PAUSED' ? `<button class="button primary" data-detail-action="resume">${t('memberships.resume')}</button>` : ''}<button class="button" data-close>${t('common.close')}</button></div>`,
  );
  app.querySelector('[data-close]')?.addEventListener('click', closeModal);
  app.querySelectorAll<HTMLElement>('[data-detail-action]').forEach((button) =>
    button.addEventListener('click', async () => {
      closeModal();
      await performMembershipAction(button.dataset.detailAction ?? '', id);
    }),
  );
}

async function openMembershipModal() {
  const [customers, plans] = await Promise.all([
    request<Customer[]>('/customers?limit=100'),
    request<Plan[]>('/plans?status=ACTIVE&limit=100'),
  ]);
  openModal(
    t('memberships.add'),
    `<form id="membership-form" class="form-grid"><label>${t('memberships.customer')}<select name="customerId" required>${customers
      .filter((customer) => !customer.archived)
      .map(
        (customer) =>
          `<option value="${escapeText(customer.customerId)}">${escapeText(customer.name)}</option>`,
      )
      .join(
        '',
      )}</select></label><label>${t('memberships.plan')}<select name="planId" required>${plans.map((plan) => `<option value="${escapeText(plan.planId)}">${escapeText(plan.name)} · ${escapeText(formatMoney(plan.basePrice, plan.currency))}</option>`).join('')}</select></label><label>${t('common.start')}<input name="startDate" type="date" required value="${today()}"></label><label>${t('common.price')}<input name="price" type="number" min="0" step="0.01" placeholder="${t('common.optional')}"></label><label class="full">${t('common.notes')} <span class="muted">(${t('common.optional')})</span><textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('memberships.create')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#membership-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/memberships', {
        method: 'POST',
        body: JSON.stringify({
          customerId: values.customerId,
          planId: values.planId,
          startDate: values.startDate,
          price: values.price ? Number(values.price) : undefined,
          notes: values.notes || undefined,
        }),
      });
      closeModal();
      toast(t('memberships.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
