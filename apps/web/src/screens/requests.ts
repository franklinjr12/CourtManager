import { dateValue, timeValue } from '../core/presentation.js';
import type { Customer, RequestItem } from '../core/types.js';
import { button } from '../dom.js';
import { requestStatusLabel, t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { customerOptions } from './customers.js';
import { app, escapeText, renderRoute, request } from './runtime.js';

export async function requests() {
  const [data, customers] = await Promise.all([
    request<RequestItem[]>('/requests'),
    request<Customer[]>('/customers?limit=100'),
  ]);
  await shell(
    async () => {
      return `<div class="toolbar"><div><h2>${t('requests.title')}</h2><p class="muted">${t('requests.pending', { count: data.filter((item) => item.status === 'REQUESTED').length })}</p></div></div><article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('requests.requestedTime')}</th><th>${t('common.court')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((item) => `<tr><td>${escapeText(item.customerName)}<small>${escapeText(item.phone)}</small></td><td>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</td><td>${escapeText(item.courtId)}</td><td>${requestStatusLabel(item.status)}</td><td>${item.status === 'REQUESTED' ? `${button(t('requests.review'), `data-review-request="${escapeText(item.requestId)}"`)}${button(t('requests.confirm'), `data-confirm-request="${escapeText(item.requestId)}"`)}${button(t('requests.reject'), `data-reject-request="${escapeText(item.requestId)}"`)}` : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('requests.noRequests')}</p>`}</article>`;
    },
    () => wireRequests(data, customers),
  );
}
function wireRequests(data: RequestItem[], customers: Customer[]) {
  app
    .querySelectorAll<HTMLElement>('[data-review-request]')
    .forEach((element) =>
      element.addEventListener('click', () => {
        const item = data.find(
          (value) => value.requestId === element.dataset.reviewRequest,
        );
        if (item)
          openModal(
            t('requests.reviewTitle'),
            `<div class="detail-grid"><div><span class="muted">${t('common.customer')}</span><strong>${escapeText(item.customerName)}</strong></div><div><span class="muted">${t('requests.contact')}</span><strong>${escapeText(item.phone)} ${escapeText(item.email)}</strong></div><div><span class="muted">${t('requests.requested')}</span><strong>${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}–${escapeText(timeValue(item.requestedEndAt))}</strong></div></div><p>${escapeText(item.notes || t('common.noNotes'))}</p>`,
          );
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-confirm-request]')
    .forEach((element) =>
      element.addEventListener('click', () => {
        const item = data.find(
          (value) => value.requestId === element.dataset.confirmRequest,
        );
        if (item) openConfirmRequest(item, customers);
      }),
    );
  app
    .querySelectorAll<HTMLElement>('[data-reject-request]')
    .forEach((element) =>
      element.addEventListener(
        'click',
        () => void rejectRequest(String(element.dataset.rejectRequest)),
      ),
    );
}
function openConfirmRequest(item: RequestItem, customers: Customer[]) {
  openModal(
    t('requests.confirmTitle'),
    `<form id="confirm-request-form" class="form-grid"><p class="full">${escapeText(item.customerName)} · ${escapeText(dateValue(item.requestedStartAt))} ${escapeText(timeValue(item.requestedStartAt))}</p><label class="full">${t('common.customer')}<select name="customerId"><option value="">${t('requests.createCustomer')}</option>${customerOptions(customers, item.linkedCustomerId)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('requests.confirmButton')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#confirm-request-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/requests/${item.requestId}/confirm`, {
        method: 'POST',
        body: JSON.stringify(
          values.customerId ? { customerId: values.customerId } : {},
        ),
      });
      closeModal();
      toast(t('requests.confirmed'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function rejectRequest(id: string) {
  openModal(
    t('requests.rejectTitle'),
    `<form id="reject-request-form" class="form-grid"><label class="full">${t('common.reason' as never)}<textarea name="reason" maxlength="1000"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button danger">${t('requests.rejectButton')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#reject-request-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!window.confirm(t('requests.rejectConfirmation'))) return;
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: values.reason || undefined }),
      });
      closeModal();
      toast(t('requests.rejected'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
