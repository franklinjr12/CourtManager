import { dateValue, timeValue, errorMessage } from '../core/presentation.js';
import type { Payment } from '../core/types.js';
import { button } from '../dom.js';
import { formatMoney, paymentMethodLabel, t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { shell } from '../ui/shell.js';
import { openPaymentModal } from './payment-modal.js';
import { app, escapeText, renderRoute, request, screen } from './runtime.js';

export { openPaymentModal };
export async function finance() {
  const customerId = new URLSearchParams(location.search).get('customerId');
  const [data, summary, balances, charges] = await Promise.all([
    request<Payment[]>(
      `/payments${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`,
    ),
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
    request<Array<Record<string, unknown>>>(
      `/charges${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ''}`,
    ),
  ]);
  await shell(
    async () => {
      return `<div class="toolbar"><div><h2>${t('finance.title')}</h2><p class="muted">${t('finance.description')}</p></div><button class="button primary" id="record-payment">${t('finance.record')}</button></div><div class="metrics"><article class="metric card"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(summary.expectedRevenue)}</strong></article><article class="metric card"><span>${t('finance.recorded')}</span><strong>${formatMoney(summary.recordedPayments)}</strong></article><article class="metric card"><span>${t('profile.outstanding')}</span><strong>${formatMoney(summary.outstanding)}</strong></article><article class="metric card"><span>${t('common.expenses' as never)}</span><strong>${formatMoney(summary.expenses)}</strong></article></div><article class="card table-wrap"><h3>${t('profile.outstanding')}</h3>${balances.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('common.expected')}</th><th>${t('common.paid')}</th><th>${t('profile.outstanding')}</th></tr></thead><tbody>${balances.map((item) => `<tr><td>${escapeText(item.customerName)}</td><td>${formatMoney(item.charges)}</td><td>${formatMoney(item.payments)}</td><td>${formatMoney(item.outstanding)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('profile.noActivity')}</p>`}</article><article class="card table-wrap section-card"><h3>${t('finance.reservationClass')}</h3>${charges.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('common.expected')}</th><th>${t('common.paid')}</th><th>${t('profile.outstanding')}</th></tr></thead><tbody>${charges.map((charge) => `<tr><td>${escapeText(String(charge.customerId))}</td><td>${formatMoney(Number(charge.amount))}</td><td>${formatMoney(Number(charge.paidAmount))}</td><td>${formatMoney(Number(charge.outstanding))}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('profile.noActivity')}</p>`}</article><article class="card table-wrap section-card">${data.length ? `<table><thead><tr><th>${t('finance.paidAt')}</th><th>${t('common.amount')}</th><th>${t('common.payment')}</th><th>${t('finance.reservationClass')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((p) => `<tr><td>${escapeText(dateValue(p.paidAt))}</td><td>${formatMoney(p.amount)}</td><td>${paymentMethodLabel(p.method)}</td><td>${escapeText(p.reservationId ?? p.classId ?? p.chargeId)}</td><td>${button(t('common.delete'), `data-delete-payment="${escapeText(p.paymentId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('finance.noPayments')}</p>`}</article>`;
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
