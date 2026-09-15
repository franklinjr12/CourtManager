import type { CustomerActivityItem } from '@court-manager/contracts';
import { dateValue, timeValue, errorMessage } from '../core/presentation.js';
import type { Customer, Reservation } from '../core/types.js';
import { button } from '../dom.js';
import {
  formatMoney,
  paymentStatusLabel,
  reservationStatusLabel,
  t,
} from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, navigate, renderRoute, request } from './runtime.js';
const customerForm = (customer?: Customer) =>
  `<form id="customer-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(customer?.name)}"></label><label>${t('common.phone')}<input name="phone" maxlength="40" value="${escapeText(customer?.phone)}"></label><label>${t('common.email')}<input name="email" type="email" value="${escapeText(customer?.email)}"></label><label class="full">${t('common.notes')}<textarea name="notes" maxlength="4000">${escapeText(customer?.notes)}</textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${customer ? t('common.saveChanges') : t('customers.create')}</button></div></form>`;

export async function openCustomerModal(
  onCreated?: (customer: Customer) => void,
  customer?: Customer,
) {
  openModal(
    customer ? t('customers.edit') : t('customers.create'),
    customerForm(customer),
  );
  const form = app.querySelector<HTMLFormElement>('#customer-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const payload = {
        name: String(values.name),
        phone: String(values.phone || '') || undefined,
        email: String(values.email || '') || undefined,
        notes: String(values.notes || '') || undefined,
      };
      const saved = await request<Customer>(
        customer ? `/customers/${customer.customerId}` : '/customers',
        { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
      );
      closeModal();
      toast(customer ? t('customers.updated') : t('customers.created'));
      onCreated?.(saved);
      if (!onCreated) await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
export const customerOptions = (customers: Customer[], selected = '') =>
  customers
    .map(
      (c) =>
        `<option value="${escapeText(c.customerId)}" ${c.customerId === selected ? 'selected' : ''}>${escapeText(c.name)}${c.phone ? ` — ${escapeText(c.phone)}` : ''}</option>`,
    )
    .join('');

export async function customers() {
  const query = new URLSearchParams(location.search).get('search') ?? '';
  await shell(async () => {
    const data = await request<Customer[]>(
      `/customers?limit=100${query ? `&search=${encodeURIComponent(query)}` : ''}`,
    );
    setTimeout(wireCustomerList, 0);
    return `<div class="toolbar"><div><h2>${t('customers.title')}</h2><p class="muted">${t('customers.description')}</p></div><button class="button primary" id="add-customer">${t('customers.add')}</button></div><form id="customer-search" class="search-bar"><input name="search" placeholder="${t('customers.searchPlaceholder')}" value="${escapeText(query)}"><button class="button">${t('common.search')}</button></form><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.name')}</th><th>${t('common.phone')}</th><th>${t('common.email')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.phone)}</td><td>${escapeText(c.email)}</td><td>${c.archived ? t('common.archived') : t('common.active')}</td><td class="row-actions">${button(t('common.edit'), `data-edit-customer="${escapeText(c.customerId)}"`)}${c.archived ? '' : button(t('common.archive'), `data-archive-customer="${escapeText(c.customerId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('customers.noCustomers')}</p>`}</article>`;
  });
}
function wireCustomerList() {
  app.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
    const edit = row.querySelector<HTMLElement>('[data-edit-customer]');
    const name = row.querySelector('td');
    if (edit && name && !name.querySelector('a'))
      name.innerHTML = `<a href="/customers/${encodeURIComponent(String(edit.dataset.editCustomer))}">${escapeText(name.textContent ?? '')}</a>`;
  });
  app
    .querySelector<HTMLButtonElement>('#add-customer')
    ?.addEventListener('click', () => void openCustomerModal());
  app
    .querySelector<HTMLFormElement>('#customer-search')
    ?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = formData(event.currentTarget as HTMLFormElement);
      navigate(
        `/customers${values.search ? `?search=${encodeURIComponent(String(values.search))}` : ''}`,
      );
    });
  app.querySelectorAll<HTMLElement>('[data-edit-customer]').forEach((element) =>
    element.addEventListener('click', async () => {
      const customer = await request<Customer>(
        `/customers/${element.dataset.editCustomer}`,
      );
      await openCustomerModal(undefined, customer);
    }),
  );
  app
    .querySelectorAll<HTMLElement>('[data-archive-customer]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        if (!window.confirm(t('customers.archiveConfirmation'))) return;
        try {
          await request(
            `/customers/${element.dataset.archiveCustomer}/archive`,
            { method: 'POST' },
          );
          toast(t('customers.archived'));
          await renderRoute();
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-edit-customer]')
    .forEach((element) => {
      const actions = element.parentElement;
      if (actions && !actions.querySelector('[data-customer-history]'))
        actions.insertAdjacentHTML(
          'beforeend',
          button(
            t('customers.history'),
            `data-customer-history="${escapeText(element.dataset.editCustomer)}"`,
          ),
        );
    });
  app
    .querySelectorAll<HTMLElement>('[data-customer-history]')
    .forEach((element) =>
      element.addEventListener(
        'click',
        () => void openCustomerHistory(String(element.dataset.customerHistory)),
      ),
    );
}

async function openCustomerHistory(customerId: string) {
  const [customer, reservationsData, activities] = await Promise.all([
    request<Customer>(`/customers/${customerId}`),
    request<Reservation[]>(
      `/reservations?customerId=${encodeURIComponent(customerId)}&limit=100`,
    ),
    request<CustomerActivityItem[]>(
      `/customers/${encodeURIComponent(customerId)}/activities?limit=100`,
    ),
  ]);
  const commercialEvents = activities.filter(
    (activity) => activity.activityType === 'COMMERCIAL',
  );
  openModal(
    t('customers.historyTitle', { name: customer.name }),
    `<p class="muted">${escapeText(customer.phone ?? '')} ${escapeText(customer.email ?? '')}</p>${reservationsData.length ? `<div class="table-wrap"><table><thead><tr><th>${t('common.dateTime')}</th><th>${t('common.status')}</th><th>${t('common.expected')}</th><th>${t('common.payment')}</th></tr></thead><tbody>${reservationsData.map((reservation) => `<tr><td>${escapeText(dateValue(reservation.startAt))} ${escapeText(timeValue(reservation.startAt))}</td><td>${reservationStatusLabel(reservation.status)}</td><td>${formatMoney(reservation.expectedAmount)}</td><td>${paymentStatusLabel(reservation.paymentStatus ?? 'UNPAID')}</td></tr>`).join('')}</tbody></table></div>` : ''}${commercialEvents.length ? `<section><h3>${t('customers.commercialHistory')}</h3><div class="table-wrap"><table><thead><tr><th>${t('common.dateTime')}</th><th>${t('common.description')}</th><th>${t('common.source')}</th></tr></thead><tbody>${commercialEvents.map((activity) => `<tr><td>${escapeText(dateValue(activity.startAt))} ${escapeText(timeValue(activity.startAt))}</td><td>${escapeText(activity.title)}</td><td>${escapeText(`${activity.sourceType ?? ''} · ${activity.sourceId}`)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}${reservationsData.length || commercialEvents.length ? '' : `<p class="empty">${t('customers.noHistory')}</p>`}`,
  );
}
