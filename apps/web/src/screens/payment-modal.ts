import {
  dateValue,
  isoFromWallClock,
  nowInputValue,
  timeValue,
} from '../core/presentation.js';
import type { Customer, CustomerCharge, Reservation } from '../core/types.js';
import {
  chargeDescriptionLabel,
  chargeSourceLabel,
  formatMoney,
  paymentMethodLabel,
  t,
} from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { customerOptions } from './customers.js';
import { app, escapeText, renderRoute, request } from './runtime.js';

type TargetType = 'reservation' | 'charge';

export const chargeOptionLabel = (charge: CustomerCharge) =>
  `${chargeSourceLabel(charge.sourceType)} · ${chargeDescriptionLabel(charge.description)} · ${formatMoney(charge.outstanding)}`;

export function paymentRequestBody(values: Record<string, unknown>) {
  const idKey = values.targetType === 'charge' ? 'chargeId' : 'reservationId';
  return {
    customerId: values.customerId,
    [idKey]: values.targetId,
    amount: Number(values.amount),
    method: values.method,
    paidAt: isoFromWallClock(String(values.paidAt)),
    notes: values.notes || undefined,
  };
}

const targetOption = (
  id: string,
  label: string,
  remaining: unknown,
  selected: boolean,
) =>
  `<option value="${escapeText(id)}" data-remaining="${escapeText(remaining)}"${selected ? ' selected' : ''}>${escapeText(label)}</option>`;

const openCharges = (charges: CustomerCharge[]) =>
  charges.filter((c) => c.status === 'ACTIVE' && c.outstanding > 0);

export async function openPaymentModal(
  reservation?: Reservation,
  prefill?: { charge: CustomerCharge },
) {
  const reservationsData = reservation
    ? [reservation]
    : await request<Reservation[]>('/reservations');
  const customers = await request<Customer[]>('/customers?limit=100');
  const initialCustomer =
    prefill?.charge.customerId ?? reservation?.customerId ?? '';
  const initialType: TargetType = prefill ? 'charge' : 'reservation';
  const initialTarget = prefill?.charge.chargeId ?? reservation?.reservationId;
  const initialAmount = prefill
    ? prefill.charge.outstanding
    : (reservation?.remainingAmount ?? '');
  openModal(
    t('finance.record'),
    `<form id="payment-form" class="form-grid"><label>${t('common.customer')}<select name="customerId" required><option value=""></option>${customerOptions(customers, initialCustomer)}</select></label><label>${t('finance.payFor')}<select name="targetType"><option value="reservation"${initialType === 'reservation' ? ' selected' : ''}>${t('finance.payForReservation')}</option><option value="charge"${initialType === 'charge' ? ' selected' : ''}>${t('finance.payForCharge')}</option></select></label><label class="full">${t('finance.target')}<select name="targetId" required></select></label><p class="muted full" data-target-empty hidden></p><label>${t('common.amount')}<input name="amount" type="number" min="0.01" step="0.01" required value="${escapeText(initialAmount)}"></label><label>${t('common.payment')}<select name="method">${['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'OTHER'].map((m) => `<option value="${m}">${paymentMethodLabel(m)}</option>`).join('')}</select></label><label>${t('finance.paidAt')}<input name="paidAt" type="datetime-local" required value="${escapeText(nowInputValue())}"></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('finance.record')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#payment-form');
  if (!form) return;
  const field = <T extends HTMLElement>(name: string) =>
    form.elements.namedItem(name) as T;
  const customerSelect = field<HTMLSelectElement>('customerId');
  const typeSelect = field<HTMLSelectElement>('targetType');
  const targetSelect = field<HTMLSelectElement>('targetId');
  const amountInput = field<HTMLInputElement>('amount');
  const empty = form.querySelector<HTMLElement>('[data-target-empty]');
  form.querySelector('[data-close]')?.addEventListener('click', closeModal);

  let selectedTarget = initialTarget;
  const syncAmount = () => {
    const option = targetSelect.selectedOptions[0];
    if (option?.dataset.remaining !== undefined)
      amountInput.value = option.dataset.remaining;
  };
  const renderTargets = async () => {
    const customerId = customerSelect.value;
    const type = typeSelect.value as TargetType;
    let options: string[] = [];
    if (customerId && type === 'charge') {
      const fetched = openCharges(
        await request<CustomerCharge[]>(
          `/charges?customerId=${encodeURIComponent(customerId)}&outstandingOnly=true`,
        ),
      );
      const extra =
        prefill &&
        prefill.charge.customerId === customerId &&
        !fetched.some((c) => c.chargeId === prefill.charge.chargeId)
          ? [prefill.charge]
          : [];
      options = [...extra, ...fetched].map((c) =>
        targetOption(
          c.chargeId,
          chargeOptionLabel(c),
          c.outstanding,
          c.chargeId === selectedTarget,
        ),
      );
    } else if (customerId) {
      options = reservationsData
        .filter((r) => r.customerId === customerId)
        .map((r) =>
          targetOption(
            r.reservationId,
            `${dateValue(r.startAt)} ${timeValue(r.startAt)} · ${formatMoney(r.expectedAmount)}`,
            r.remainingAmount ?? r.expectedAmount,
            r.reservationId === selectedTarget,
          ),
        );
    }
    targetSelect.innerHTML = options.join('');
    if (empty) {
      empty.hidden = !customerId || options.length > 0;
      empty.textContent = t(
        type === 'charge'
          ? 'finance.noOpenCharges'
          : 'finance.noCustomerReservations',
      );
    }
    syncAmount();
    selectedTarget = undefined;
  };
  customerSelect.addEventListener('change', () => void renderTargets());
  typeSelect.addEventListener('change', () => void renderTargets());
  targetSelect.addEventListener('change', syncAmount);
  await renderTargets();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const currentForm = event.currentTarget as HTMLFormElement;
    const amount = Number(formData(currentForm).amount);
    if (!(amount > 0)) {
      showFormError(currentForm, new Error(t('finance.amountMustBePositive')));
      return;
    }
    const remaining = Number(
      targetSelect.selectedOptions[0]?.dataset.remaining,
    );
    if (
      Number.isFinite(remaining) &&
      amount > remaining + 0.005 &&
      !window.confirm(t('finance.overpayConfirmation'))
    )
      return;
    setBusy(currentForm, true);
    try {
      await request('/payments', {
        method: 'POST',
        body: JSON.stringify(paymentRequestBody(formData(currentForm))),
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
