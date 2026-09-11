import { dateValue, timeValue, errorMessage } from '../core/presentation.js';
import type { Customer, Payment, Reservation } from '../core/types.js';
import { button } from '../dom.js';
import { formatMoney, paymentMethodLabel, t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { customerOptions } from './customers.js';
import { app, escapeText, renderRoute, request, screen } from './runtime.js';

export async function openPaymentModal(reservation?: Reservation) {
  const reservationsData = reservation
    ? [reservation]
    : await request<Reservation[]>('/reservations');
  const customers = await request<Customer[]>('/customers?limit=100');
  openModal(
    t('finance.record'),
    `<form id="payment-form" class="form-grid"><label class="full">${t('common.reservation' as never)}<select name="reservationId" required>${reservationsData.map((r) => `<option value="${escapeText(r.reservationId)}" data-customer="${escapeText(r.customerId)}" data-remaining="${escapeText(r.remainingAmount ?? r.expectedAmount)}">${escapeText(dateValue(r.startAt))} ${escapeText(timeValue(r.startAt))} · ${formatMoney(r.expectedAmount)}</option>`).join('')}</select></label><label>${t('common.customer')}<select name="customerId" required>${customerOptions(customers, reservation?.customerId)}</select></label><label>${t('common.price')}<input name="amount" type="number" min="0" step="0.01" required value="${escapeText(reservation?.remainingAmount ?? '')}"></label><label>${t('common.payment')}<select name="method"><option value="PIX">${paymentMethodLabel('PIX')}</option><option value="CASH">${paymentMethodLabel('CASH')}</option><option value="CREDIT_CARD">${paymentMethodLabel('CREDIT_CARD')}</option><option value="DEBIT_CARD">${paymentMethodLabel('DEBIT_CARD')}</option><option value="BANK_TRANSFER">${paymentMethodLabel('BANK_TRANSFER')}</option><option value="OTHER">${paymentMethodLabel('OTHER')}</option></select></label><label>${t('finance.paidAt')}<input name="paidAt" type="datetime-local" required value="${escapeText(new Date().toISOString().slice(0, 16))}"></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('finance.record')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#payment-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form
    ?.querySelector('[name="reservationId"]')
    ?.addEventListener('change', (event) => {
      const option = (event.target as HTMLSelectElement).selectedOptions[0];
      if (!option) return;
      const customer = form.elements.namedItem(
        'customerId',
      ) as HTMLSelectElement;
      customer.value = String(option.dataset.customer ?? '');
      const amount = form.elements.namedItem('amount') as HTMLInputElement;
      amount.value = String(option.dataset.remaining ?? '');
    });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentForm = event.currentTarget as HTMLFormElement;
    setBusy(currentForm, true);
    try {
      const values = formData(currentForm);
      await request('/payments', {
        method: 'POST',
        body: JSON.stringify({
          ...values,
          amount: Number(values.amount),
          paidAt: new Date(String(values.paidAt)).toISOString(),
        }),
      });
      closeModal();
      toast(t('finance.paymentRecorded'));
      await renderRoute();
    } catch (error) {
      showFormError(currentForm, error);
      setBusy(currentForm, false);
    }
  });
}
export async function finance() {
  const [data, summary, balances, charges] = await Promise.all([
    request<Payment[]>('/payments'),
    request<{
      expectedRevenue: number;
      recordedPayments: number;
      outstanding: number;
      expenses: number;
    }>('/finance/summary'),
    request<
      Array<{
        customerId: string;
        customerName: string;
        charges: number;
        payments: number;
        outstanding: number;
      }>
    >('/finance/balances'),
    request<Array<Record<string, unknown>>>('/charges'),
  ]);
  await shell(
    async () => {
      return `<div class="toolbar"><div><h2>${t('finance.title')}</h2><p class="muted">${t('finance.description')}</p></div><button class="button primary" id="record-payment">${t('finance.record')}</button></div><div class="metrics"><article class="metric card"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(summary.expectedRevenue)}</strong></article><article class="metric card"><span>${t('finance.recorded')}</span><strong>${formatMoney(summary.recordedPayments)}</strong></article><article class="metric card"><span>${t('profile.outstanding')}</span><strong>${formatMoney(summary.outstanding)}</strong></article><article class="metric card"><span>${t('common.expenses' as never)}</span><strong>${formatMoney(summary.expenses)}</strong></article></div><article class="card table-wrap"><h3>${t('profile.outstanding')}</h3>${balances.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('common.expected')}</th><th>${t('common.paid')}</th><th>${t('profile.outstanding')}</th></tr></thead><tbody>${balances.map((item) => `<tr><td>${escapeText(item.customerName)}</td><td>${formatMoney(item.charges)}</td><td>${formatMoney(item.payments)}</td><td>${formatMoney(item.outstanding)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('profile.noActivity')}</p>`}</article><article class="card table-wrap section-card"><h3>${t('finance.reservationClass')}</h3>${charges.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('common.expected')}</th><th>${t('common.paid')}</th><th>${t('profile.outstanding')}</th></tr></thead><tbody>${charges.map((charge) => `<tr><td>${escapeText(String(charge.customerId))}</td><td>${formatMoney(Number(charge.amount))}</td><td>${formatMoney(Number(charge.paidAmount))}</td><td>${formatMoney(Number(charge.outstanding))}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('profile.noActivity')}</p>`}</article><article class="card table-wrap section-card">${data.length ? `<table><thead><tr><th>${t('finance.paidAt')}</th><th>${t('common.price')}</th><th>${t('common.payment')}</th><th>${t('finance.reservationClass')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((p) => `<tr><td>${escapeText(dateValue(p.paidAt))}</td><td>${formatMoney(p.amount)}</td><td>${paymentMethodLabel(p.method)}</td><td>${escapeText(p.reservationId ?? p.classId)}</td><td>${button(t('common.delete'), `data-delete-payment="${escapeText(p.paymentId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('finance.noPayments')}</p>`}</article>`;
    },
    () => {
      screen()
        ?.querySelector('#record-payment')
        ?.addEventListener('click', () => void openPaymentModal());
      screen()
        ?.querySelectorAll<HTMLElement>('[data-delete-payment]')
        .forEach((element) =>
          element.addEventListener('click', async () => {
            if (!window.confirm(t('finance.deleteConfirmation'))) return;
            try {
              await request(`/payments/${element.dataset.deletePayment}`, {
                method: 'DELETE',
              });
              toast(t('finance.deleted'));
              await renderRoute();
            } catch (error) {
              toast(errorMessage(error), 'error');
            }
          }),
        );
    },
  );
}
