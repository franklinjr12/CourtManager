import type {
  CreditTransaction,
  CustomerPackage,
  PackageBenefit,
  PackageDefinition,
} from '@court-manager/contracts';
import type { Customer } from '../core/types.js';
import { formatDate, formatDateTime, formatMoney, t } from '../i18n.js';
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

type StaffPackage = CustomerPackage & {
  creditBalances?: Array<{
    unit: string;
    quantityType: 'FINITE' | 'UNLIMITED';
    issuedQuantity: number;
    consumedQuantity: number;
    remainingQuantity: number;
  }>;
};

const packageTypes = [
  'COURT_TIME',
  'CLASS_ATTENDANCE',
  'PRIVATE_LESSON',
] as const;
const label = (value: string) => t(`packages.type.${value}` as never);
const statusLabel = (value: string) => t(`packages.status.${value}` as never);
const statusBadge = (status: string) =>
  `<span class="status-badge status-${escapeText(status)}">${escapeText(statusLabel(status))}</span>`;
const commercialNav = () =>
  `<nav class="commercial-nav" aria-label="${escapeText(t('nav.commercial'))}"><a href="/commercial">${t('commercial.overview')}</a><a href="/commercial/plans">${t('plans.title')}</a><a href="/commercial/memberships">${t('memberships.title')}</a><a class="active" href="/commercial/packages">${t('packages.title')}</a><a href="/commercial/fixed-courts">${t('fixedCourtAgreements.title')}</a></nav>`;

const packageBalance = (item: StaffPackage) => {
  const balances = item.creditBalances ?? [];
  if (!balances.length) return t('commercial.noBalance');
  return balances
    .map((balance) =>
      balance.quantityType === 'UNLIMITED'
        ? t('packages.unlimited')
        : `${balance.remainingQuantity} ${t(`packages.unit.${balance.unit}` as never)}`,
    )
    .join(' · ');
};

const benefitSummary = (benefit: PackageBenefit) => {
  const quantityType =
    'quantityType' in benefit ? benefit.quantityType : 'UNLIMITED';
  return quantityType === 'UNLIMITED'
    ? t('packages.unlimited')
    : `${'quantity' in benefit ? benefit.quantity : 0} ${t(`packages.unit.${benefit.unit}` as never)}`;
};

export async function packages() {
  const query = new URLSearchParams(location.search);
  const packageQuery = new URLSearchParams({ limit: '100' });
  for (const key of [
    'status',
    'packageDefinitionId',
    'customerId',
    'expirationFrom',
    'expirationTo',
    'remainingMin',
    'remainingMax',
  ]) {
    const value = query.get(key);
    if (value) packageQuery.set(key, value);
  }
  const [definitions, customers, customerPackages] = await Promise.all([
    request<PackageDefinition[]>('/package-definitions?limit=100'),
    request<Customer[]>('/customers?limit=100'),
    request<StaffPackage[]>(`/customer-packages?${packageQuery}`),
  ]);
  await shell(
    () =>
      `<div class="toolbar"><div><h2>${t('packages.title')}</h2><p class="muted">${t('packages.description')}</p></div><button class="button primary" id="add-package-definition">${t('packages.addDefinition')}</button></div>${commercialNav()}<article class="card table-wrap"><div class="section-head"><h3>${t('packages.definitions')}</h3><button class="button small" id="issue-package">${t('packages.issue')}</button></div><table><thead><tr><th>${t('common.name')}</th><th>${t('common.price')}</th><th>${t('packages.validity')}</th><th>${t('packages.benefits')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${definitions.length ? definitions.map((definition) => `<tr><td><strong>${escapeText(definition.name)}</strong>${definition.description ? `<br><small class="muted">${escapeText(definition.description)}</small>` : ''}</td><td>${escapeText(formatMoney(definition.price, definition.currency))}</td><td>${definition.validityDays === null ? t('packages.noExpiry') : `${definition.validityDays} ${t('packages.days')}`}</td><td><ul class="plan-benefits">${definition.benefits.map((benefit) => `<li>${escapeText(label(benefit.type))}: ${escapeText(benefitSummary(benefit))}</li>`).join('')}</ul></td><td>${statusBadge(definition.status)}</td><td class="row-actions"><button class="button small" data-edit-definition="${escapeText(definition.packageDefinitionId)}">${t('common.edit')}</button>${definition.status !== 'ARCHIVED' ? `<button class="button small" data-archive-definition="${escapeText(definition.packageDefinitionId)}">${t('common.archive')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="6" class="empty">${t('packages.emptyDefinitions')}</td></tr>`}</tbody></table></article><form id="package-filters" class="filters card"><label>${t('common.status')}<select name="status"><option value="">${t('common.all' as never)}</option>${['ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED'].map((value) => `<option value="${value}"${query.get('status') === value ? ' selected' : ''}>${escapeText(statusLabel(value))}</option>`).join('')}</select></label><label>${t('packages.definition')}<select name="packageDefinitionId"><option value="">${t('common.all' as never)}</option>${definitions.map((definition) => `<option value="${escapeText(definition.packageDefinitionId)}"${query.get('packageDefinitionId') === definition.packageDefinitionId ? ' selected' : ''}>${escapeText(definition.name)}</option>`).join('')}</select></label><label>${t('packages.customer')}<select name="customerId"><option value="">${t('common.all' as never)}</option>${customers
        .filter((item) => !item.archived)
        .map(
          (item) =>
            `<option value="${escapeText(item.customerId)}"${query.get('customerId') === item.customerId ? ' selected' : ''}>${escapeText(item.name)}</option>`,
        )
        .join(
          '',
        )}</select></label><label>${t('packages.expirationFrom')}<input name="expirationFrom" type="date" value="${escapeText(query.get('expirationFrom') ?? '')}"></label><label>${t('packages.expirationTo')}<input name="expirationTo" type="date" value="${escapeText(query.get('expirationTo') ?? '')}"></label><label>${t('packages.remainingMin')}<input name="remainingMin" type="number" min="0" value="${escapeText(query.get('remainingMin') ?? '')}"></label><label>${t('packages.remainingMax')}<input name="remainingMax" type="number" min="0" value="${escapeText(query.get('remainingMax') ?? '')}"></label><button class="button" type="submit">${t('common.applyFilters' as never)}</button></form><article class="card table-wrap"><div class="section-head"><div><h3>${t('packages.customerHistory')}</h3><p class="muted">${t('packages.historyHint')}</p></div><button class="button small" id="issue-package-secondary">${t('packages.issue')}</button></div><table><thead><tr><th>${t('packages.customer')}</th><th>${t('common.name')}</th><th>${t('common.price')}</th><th>${t('packages.issued')}</th><th>${t('packages.expires')}</th><th>${t('profile.remaining')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody id="customer-packages">${packageRows(customerPackages, customers)}</tbody></table></article>`,
    () => wirePackages(definitions, customers),
  );
}

const packageRows = (items: StaffPackage[], customers: Customer[]) =>
  items.length
    ? items
        .map(
          (item) =>
            `<tr><td>${escapeText(customers.find((customer) => customer.customerId === item.customerId)?.name ?? item.customerId)}</td><td><button class="link-button inline-link" data-package-details="${escapeText(item.customerPackageId)}">${escapeText(item.packageNameSnapshot)}</button></td><td>${escapeText(formatMoney(item.price, item.currency))}</td><td>${escapeText(formatDate(item.issuedAt.slice(0, 10)))}</td><td>${item.expiresAt ? escapeText(formatDate(item.expiresAt.slice(0, 10))) : t('packages.noExpiry')}</td><td>${escapeText(packageBalance(item))}</td><td>${statusBadge(item.status)}</td><td>${item.status === 'ACTIVE' ? `<button class="button small" data-cancel-package="${escapeText(item.customerPackageId)}">${t('packages.cancel')}</button>` : ''}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="8" class="empty">${t('packages.emptyCustomer')}</td></tr>`;

function wirePackages(definitions: PackageDefinition[], customers: Customer[]) {
  screen()
    ?.querySelector('#add-package-definition')
    ?.addEventListener('click', () => openDefinitionModal());
  screen()
    ?.querySelector('#issue-package')
    ?.addEventListener('click', () => openIssueModal(definitions, customers));
  screen()
    ?.querySelector('#issue-package-secondary')
    ?.addEventListener('click', () => openIssueModal(definitions, customers));
  screen()
    ?.querySelector('#package-filters')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formData(event.currentTarget as HTMLFormElement);
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(values))
        if (value) params.set(key, String(value));
      navigate(`/commercial/packages${params.toString() ? `?${params}` : ''}`);
    });
  screen()
    ?.querySelectorAll<HTMLElement>('[data-edit-definition]')
    .forEach((button) => {
      const definition = definitions.find(
        (item) => item.packageDefinitionId === button.dataset.editDefinition,
      );
      if (definition)
        button.addEventListener('click', () => openDefinitionModal(definition));
    });
  screen()
    ?.querySelectorAll<HTMLElement>('[data-archive-definition]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        if (!window.confirm(t('packages.archiveConfirmation'))) return;
        try {
          await request(
            `/package-definitions/${button.dataset.archiveDefinition}/archive`,
            { method: 'POST' },
          );
          toast(t('packages.archived'));
          await renderRoute();
        } catch (error) {
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      }),
    );
  screen()
    ?.querySelectorAll<HTMLElement>('[data-cancel-package]')
    .forEach((button) =>
      button.addEventListener('click', async () => {
        try {
          await request(
            `/customer-packages/${button.dataset.cancelPackage}/cancel`,
            { method: 'POST' },
          );
          toast(t('packages.cancelled'));
          await renderRoute();
        } catch (error) {
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      }),
    );
  screen()
    ?.querySelectorAll<HTMLElement>('[data-package-details]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () =>
          void openPackageDetails(
            button.dataset.packageDetails ?? '',
            customers,
          ),
      ),
    );
}

function benefitRow(benefit?: PackageBenefit, index = 0) {
  const type = benefit?.type ?? 'COURT_TIME';
  const quantityType =
    benefit && 'quantityType' in benefit ? benefit.quantityType : 'FINITE';
  const quantity = benefit && 'quantity' in benefit ? benefit.quantity : 60;
  return `<fieldset class="benefit-row" data-package-benefit><legend>${t('packages.benefit')} ${index + 1}</legend><div class="form-grid"><label>${t('packages.benefitType')}<select data-field="type">${packageTypes.map((value) => `<option value="${value}"${value === type ? ' selected' : ''}>${escapeText(label(value))}</option>`).join('')}</select></label><label>${t('packages.quantityType')}<select data-field="quantityType"><option value="FINITE"${quantityType === 'FINITE' ? ' selected' : ''}>${t('packages.finite')}</option><option value="UNLIMITED"${quantityType === 'UNLIMITED' ? ' selected' : ''}>${t('packages.unlimited')}</option></select></label><label>${t('packages.quantity')}<input data-field="quantity" type="number" min="1" step="1" value="${quantityType === 'FINITE' ? escapeText(quantity) : ''}"${quantityType === 'UNLIMITED' ? ' disabled' : ''}></label><label class="full">${t('packages.benefitLabel')} <span class="muted">(${t('common.optional')})</span><input data-field="label" value="${escapeText(benefit?.label ?? '')}"></label><div class="form-actions full"><span></span><button type="button" class="button small" data-remove-benefit>${t('packages.removeBenefit')}</button></div></div></fieldset>`;
}

function openDefinitionModal(definition?: PackageDefinition) {
  openModal(
    definition ? t('packages.editDefinition') : t('packages.addDefinition'),
    `<form id="package-definition-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(definition?.name ?? '')}"></label><label>${t('common.price')}<input name="price" type="number" min="0" step="0.01" required value="${escapeText(definition?.price ?? 0)}"></label><label>${t('packages.validityDays')}<input name="validityDays" type="number" min="1" max="3650" value="${escapeText(definition?.validityDays ?? '')}"></label><label class="full">${t('common.description')} <span class="muted">(${t('common.optional')})</span><textarea name="description">${escapeText(definition?.description ?? '')}</textarea></label><div class="full"><div class="section-head"><h3>${t('packages.benefits')}</h3><button type="button" class="button small" id="add-package-benefit">${t('packages.addBenefit')}</button></div><div id="package-benefits">${(definition?.benefits ?? [undefined]).map((benefit, index) => benefitRow(benefit, index)).join('')}</div></div><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${definition ? t('common.saveChanges') : t('packages.createDefinition')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#package-definition-form');
  const benefits = app.querySelector<HTMLElement>('#package-benefits');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  const wireRow = (row: HTMLElement) => {
    const quantityType = row.querySelector<HTMLSelectElement>(
      '[data-field="quantityType"]',
    );
    const quantity = row.querySelector<HTMLInputElement>(
      '[data-field="quantity"]',
    );
    quantityType?.addEventListener('change', () => {
      if (quantity) quantity.disabled = quantityType.value === 'UNLIMITED';
    });
    row
      .querySelector('[data-remove-benefit]')
      ?.addEventListener('click', () => {
        if (benefits && benefits.children.length > 1) row.remove();
      });
  };
  benefits
    ?.querySelectorAll<HTMLElement>('[data-package-benefit]')
    .forEach(wireRow);
  app.querySelector('#add-package-benefit')?.addEventListener('click', () => {
    if (!benefits) return;
    benefits.insertAdjacentHTML(
      'beforeend',
      benefitRow(undefined, benefits.children.length),
    );
    if (benefits.lastElementChild instanceof HTMLElement)
      wireRow(benefits.lastElementChild);
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const benefitsInput = [
        ...form.querySelectorAll<HTMLElement>('[data-package-benefit]'),
      ].map((row) => {
        const value = (name: string) =>
          row.querySelector<HTMLInputElement | HTMLSelectElement>(
            `[data-field="${name}"]`,
          )?.value ?? '';
        const type = value('type');
        return {
          type,
          period: 'PACKAGE_LIFETIME',
          quantityType: value('quantityType'),
          unit: type === 'COURT_TIME' ? 'COURT_MINUTES' : 'SESSION',
          ...(value('quantityType') === 'FINITE'
            ? { quantity: Number(value('quantity')) }
            : {}),
          ...(value('label') ? { label: value('label') } : {}),
        };
      });
      await request(
        definition
          ? `/package-definitions/${definition.packageDefinitionId}`
          : '/package-definitions',
        {
          method: definition ? 'PATCH' : 'POST',
          body: JSON.stringify({
            name: values.name,
            price: Number(values.price),
            validityDays: values.validityDays
              ? Number(values.validityDays)
              : null,
            description: values.description || undefined,
            benefits: benefitsInput,
          }),
        },
      );
      closeModal();
      toast(definition ? t('packages.updated') : t('packages.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

function openIssueModal(
  definitions: PackageDefinition[],
  customers: Customer[],
) {
  const active = definitions.filter((item) => item.status === 'ACTIVE');
  openModal(
    t('packages.issue'),
    `<form id="issue-package-form" class="form-grid"><label>${t('packages.customer')}<select name="customerId" required>${customers
      .filter((item) => !item.archived)
      .map(
        (item) =>
          `<option value="${escapeText(item.customerId)}">${escapeText(item.name)}</option>`,
      )
      .join(
        '',
      )}</select></label><label>${t('packages.definition')}<select name="packageDefinitionId" required>${active.map((item) => `<option value="${escapeText(item.packageDefinitionId)}">${escapeText(item.name)} · ${escapeText(formatMoney(item.price, item.currency))}</option>`).join('')}</select></label><label>${t('packages.issuedAt')}<input name="issuedAt" type="datetime-local" required value="${new Date().toISOString().slice(0, 16)}"></label><label class="full">${t('packages.idempotencyKey')} <span class="muted">(${t('common.optional')})</span><input name="idempotencyKey" maxlength="128"></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('packages.issue')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#issue-package-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/customers/${values.customerId}/packages`, {
        method: 'POST',
        body: JSON.stringify({
          packageDefinitionId: values.packageDefinitionId,
          issuedAt: new Date(String(values.issuedAt)).toISOString(),
          idempotencyKey: values.idempotencyKey || undefined,
        }),
      });
      closeModal();
      toast(t('packages.issuedSuccess'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

async function openPackageDetails(id: string, customers: Customer[]) {
  const [item, transactions] = await Promise.all([
    request<StaffPackage>(`/customer-packages/${id}`),
    request<CreditTransaction[]>(`/customer-packages/${id}/transactions`),
  ]);
  const customer =
    customers.find((value) => value.customerId === item.customerId)?.name ??
    item.customerId;
  const balances = item.creditBalances ?? [];
  openModal(
    t('packages.details'),
    `<div class="detail-grid"><div><small class="muted">${t('packages.customer')}</small><strong>${escapeText(customer)}</strong></div><div><small class="muted">${t('packages.definition')}</small><strong>${escapeText(item.packageNameSnapshot)}</strong></div><div><small class="muted">${t('common.price')}</small><strong>${escapeText(formatMoney(item.price, item.currency))}</strong></div><div><small class="muted">${t('common.status')}</small><strong>${statusBadge(item.status)}</strong></div><div><small class="muted">${t('packages.issued')}</small><strong>${escapeText(formatDateTime(item.issuedAt))}</strong></div><div><small class="muted">${t('packages.expires')}</small><strong>${escapeText(item.expiresAt ? formatDateTime(item.expiresAt) : t('packages.noExpiry'))}</strong></div></div><article><h3>${t('packages.balance')}</h3><ul class="detail-list">${balances.map((balance) => `<li><strong>${escapeText(t(`packages.unit.${balance.unit}` as never))}</strong><span>${balance.quantityType === 'UNLIMITED' ? t('packages.unlimited') : `${balance.remainingQuantity} / ${balance.issuedQuantity}`} (${balance.consumedQuantity} ${t('packages.consumed')})</span></li>`).join('')}</ul></article><article class="section-card table-wrap"><h3>${t('packages.creditHistory')}</h3><table><thead><tr><th>${t('common.date')}</th><th>${t('common.status')}</th><th>${t('packages.quantity')}</th><th>${t('common.reason')}</th></tr></thead><tbody>${transactions.map((transaction) => `<tr><td>${escapeText(formatDateTime(transaction.occurredAt))}</td><td>${escapeText(t(`packages.transaction.${transaction.transactionType}` as never))}</td><td>${transaction.quantity}</td><td>${escapeText(transaction.reason ?? '—')}</td></tr>`).join('')}</tbody></table></article><div class="form-actions detail-actions"><button class="button" data-close>${t('common.close')}</button></div>`,
  );
  app.querySelector('[data-close]')?.addEventListener('click', closeModal);
}
