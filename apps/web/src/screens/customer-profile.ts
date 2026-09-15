import type { CustomerCommercialSummary } from '@court-manager/contracts';
import { dateValue, timeValue } from '../core/presentation.js';
import { formatMoney, reservationStatusLabel, t } from '../i18n.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request } from './runtime.js';
type Profile = {
  customer: {
    name: string;
    phone?: string;
    email?: string;
    notes?: string;
    tags?: string[];
  };
  summary: {
    reservationCount: number;
    completedReservations: number;
    classAttendances: number;
    cancellations: number;
    noShows: number;
    totalCharges: number;
    recordedPayments: number;
    outstanding: number;
  };
  reservations: Array<{
    startAt: string;
    status: string;
    expectedAmount: number;
  }>;
  commercial: CustomerCommercialSummary;
};
type MakeupCredit = {
  makeupCreditId: string;
  originClassId: string;
  originSessionId: string;
  reason: 'VENUE_CANCELLED' | 'EXCUSED_ABSENCE' | 'STAFF_GRANTED' | 'OTHER';
  issuedAt: string;
  expiresAt?: string;
  status: string;
  remainingQuantity: number;
};
export async function customerProfile(id: string) {
  await shell(async () => {
    const [data, makeupCredits] = await Promise.all([
      request<Profile>(`/customers/${id}/profile`),
      request<MakeupCredit[]>(`/customers/${id}/makeup-credits`),
    ]);
    setTimeout(() => {
      wirePortalActions(id);
      app
        .querySelector('[data-issue-makeup]')
        ?.addEventListener('click', () => openMakeupModal(id));
    }, 0);
    return `<div class="toolbar"><div><h2>${escapeText(data.customer.name)}</h2><p class="muted">${escapeText(data.customer.phone ?? '')} ${escapeText(data.customer.email ?? '')}</p></div><div><button class="button" data-enable-portal>Enable portal access</button><button class="button" data-reset-portal>Reset portal password</button><button class="button" data-issue-makeup>${t('profile.issueMakeupCredit')}</button><a class="button" href="/customers">${t('common.close')}</a></div></div><article class="card"><p>${escapeText(data.customer.notes ?? t('common.noNotes'))}</p><p>${(data.customer.tags ?? []).map(escapeText).join(' · ')}</p></article><h3>${t('profile.summary')}</h3><div class="metrics"><div class="metric card"><span>${t('dashboard.reservations')}</span><strong>${data.summary.reservationCount}</strong></div><div class="metric card"><span>${t('profile.attendances')}</span><strong>${data.summary.classAttendances}</strong></div><div class="metric card"><span>${t('reservations.noShow')}</span><strong>${data.summary.noShows}</strong></div><div class="metric card"><span>${t('profile.outstanding')}</span><strong>${formatMoney(data.summary.outstanding, data.commercial.balance.currency)}</strong></div></div>${renderCommercialSummary(data.commercial)}<article class="card table-wrap"><h3>${t('profile.makeupCredits')}</h3>${makeupCredits.length ? `<table><thead><tr><th>${t('profile.origin')}</th><th>${t('profile.reason')}</th><th>${t('profile.remaining')}</th><th>${t('common.status')}</th><th>${t('packages.expires')}</th></tr></thead><tbody>${makeupCredits.map((credit) => `<tr><td>${escapeText(credit.originClassId)} / ${escapeText(credit.originSessionId)}</td><td>${escapeText(t(`makeupCredit.reason.${credit.reason}` as never))}</td><td>${credit.remainingQuantity}</td><td>${escapeText(t(`makeupCredit.status.${credit.status}` as never))}</td><td>${credit.expiresAt ? escapeText(dateValue(credit.expiresAt)) : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('profile.noMakeupCredits')}</p>`}</article><article class="card table-wrap"><h3>${t('dashboard.reservations')}</h3><table><tbody>${data.reservations.map((item) => `<tr><td>${escapeText(dateValue(item.startAt))} ${escapeText(timeValue(item.startAt))}</td><td>${reservationStatusLabel(item.status)}</td><td>${formatMoney(item.expectedAmount, data.commercial.balance.currency)}</td></tr>`).join('')}</tbody></table></article>`;
  });
}

const creditLabel = (unit: string, sourceType: string) =>
  unit === 'COURT_MINUTES'
    ? t('profile.courtTime')
    : sourceType === 'MAKEUP'
      ? t('profile.makeupCredits')
      : unit === 'GAME'
        ? t('profile.openGames')
        : t('profile.classCredits');

const creditAmount = (
  credit: CustomerCommercialSummary['balance']['credits'][number],
) =>
  credit.quantityType === 'UNLIMITED'
    ? t('profile.unlimited')
    : `${credit.remainingQuantity} ${credit.unit === 'COURT_MINUTES' ? t('profile.minutes') : t('profile.units')}`;

const creditHref = (sourceType: string, customerId: string) =>
  sourceType === 'MEMBERSHIP'
    ? `/commercial/memberships?customerId=${customerId}`
    : sourceType === 'FIXED_AGREEMENT'
      ? `/commercial/fixed-courts?customerId=${customerId}`
      : sourceType === 'MAKEUP'
        ? `/customers/${customerId}`
        : `/commercial/packages?customerId=${customerId}`;

function renderCommercialSummary(commercial: CustomerCommercialSummary) {
  const id = encodeURIComponent(commercial.balance.customerId);
  const money = (value: number) =>
    formatMoney(value, commercial.balance.currency);
  const memberships = commercial.memberships.length
    ? commercial.memberships
        .map(
          (membership) =>
            `<tr><td><a href="/commercial/memberships?customerId=${id}">${escapeText(membership.planNameSnapshot)}</a></td><td>${escapeText(t(`memberships.status.${membership.status}` as never))}</td><td>${membership.nextRenewalDate ? escapeText(dateValue(membership.nextRenewalDate)) : '—'}</td><td>${money(membership.price)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${t('profile.noMemberships')}</td></tr>`;
  const packages = commercial.packages.length
    ? commercial.packages
        .map(
          (customerPackage) =>
            `<tr><td><a href="/commercial/packages?customerId=${id}">${escapeText(customerPackage.packageNameSnapshot)}</a></td><td>${escapeText(t(`packages.status.${customerPackage.status}` as never))}</td><td>${customerPackage.expiresAt ? escapeText(dateValue(customerPackage.expiresAt)) : t('packages.noExpiry')}</td><td>${money(customerPackage.price)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${t('profile.noPackages')}</td></tr>`;
  const agreements = commercial.fixedCourtAgreements.length
    ? commercial.fixedCourtAgreements
        .map(
          (agreement) =>
            `<tr><td><a href="/commercial/fixed-courts?customerId=${id}">${escapeText(agreement.weekday)} ${escapeText(agreement.startTime)}</a></td><td>${escapeText(t(`fixedCourtAgreements.status.${agreement.status}` as never))}</td><td>${agreement.durationMinutes} ${t('fixedCourtAgreements.minutes')}</td><td>${money(agreement.monthlyPrice)}</td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${t('profile.noFixedAgreements')}</td></tr>`;
  const credits = commercial.balance.credits.length
    ? commercial.balance.credits
        .map(
          (credit) =>
            `<tr><td>${escapeText(creditLabel(credit.unit, credit.sourceType))}</td><td>${escapeText(creditAmount(credit))}</td><td>${credit.expiresAt ? escapeText(dateValue(credit.expiresAt)) : t('packages.noExpiry')}</td><td><a href="${creditHref(credit.sourceType, id)}">${escapeText(credit.sourceType)}</a></td></tr>`,
        )
        .join('')
    : `<tr><td colspan="4" class="empty">${t('profile.noServiceCredits')}</td></tr>`;
  const renewals = commercial.upcomingRenewals.length
    ? commercial.upcomingRenewals
        .map(
          (membership) =>
            `<li><a href="/commercial/memberships?customerId=${id}">${escapeText(membership.planNameSnapshot)}</a> · ${escapeText(dateValue(membership.nextRenewalDate!))}</li>`,
        )
        .join('')
    : `<li class="muted">${t('profile.noUpcomingRenewals')}</li>`;
  const expiring = commercial.expiringBenefits.length
    ? commercial.expiringBenefits
        .map(
          (credit) =>
            `<li><a href="${creditHref(credit.sourceType, id)}">${escapeText(creditLabel(credit.unit, credit.sourceType))}</a> · ${escapeText(creditAmount(credit))} · ${escapeText(dateValue(credit.expiresAt!))}</li>`,
        )
        .join('')
    : `<li class="muted">${t('profile.noExpiringBenefits')}</li>`;
  return `<section class="commercial-summary" data-commercial-summary><h3>${t('profile.commercial')}</h3><div class="commercial-columns"><article class="card table-wrap"><div class="section-head"><h4>${t('profile.memberships')}</h4><a href="/commercial/memberships?customerId=${id}">${t('profile.viewAll')}</a></div><table><thead><tr><th>${t('common.name')}</th><th>${t('common.status')}</th><th>${t('memberships.nextRenewal')}</th><th>${t('common.price')}</th></tr></thead><tbody>${memberships}</tbody></table></article><article class="card table-wrap"><div class="section-head"><h4>${t('profile.packages')}</h4><a href="/commercial/packages?customerId=${id}">${t('profile.viewAll')}</a></div><table><thead><tr><th>${t('common.name')}</th><th>${t('common.status')}</th><th>${t('packages.expires')}</th><th>${t('common.price')}</th></tr></thead><tbody>${packages}</tbody></table></article><article class="card table-wrap"><div class="section-head"><h4>${t('profile.fixedCourtAgreements')}</h4><a href="/commercial/fixed-courts?customerId=${id}">${t('profile.viewAll')}</a></div><table><thead><tr><th>${t('common.time')}</th><th>${t('common.status')}</th><th>${t('common.duration')}</th><th>${t('common.price')}</th></tr></thead><tbody>${agreements}</tbody></table></article><article class="card table-wrap"><h4>${t('profile.entitlements')}</h4><table><thead><tr><th>${t('common.name')}</th><th>${t('profile.remaining')}</th><th>${t('packages.expires')}</th><th>${t('common.source')}</th></tr></thead><tbody>${credits}</tbody></table></article></div><div class="detail-grid"><article class="card"><h4>${t('profile.upcomingRenewals')}</h4><ul>${renewals}</ul></article><article class="card"><h4>${t('profile.expiringBenefits')}</h4><ul>${expiring}</ul></article></div><article class="card"><h4>${t('profile.financial')}</h4><div class="metrics"><div class="metric"><span>${t('profile.charges')}</span><strong>${money(commercial.balance.totalCharges)}</strong></div><div class="metric"><span>${t('profile.payments')}</span><strong>${money(commercial.balance.totalPayments)}</strong></div><div class="metric"><span>${t('profile.commercialCredits')}</span><strong>${money(commercial.balance.totalCovered)}</strong></div><div class="metric"><span>${t('profile.outstanding')}</span><strong>${money(commercial.balance.outstandingAmount)}</strong></div><div class="metric"><span>${t('profile.financialCredit')}</span><strong>${money(commercial.balance.financialCreditAmount)}</strong></div></div><p class="muted"><a href="/finance?customerId=${id}">${t('profile.viewFinancialRecords')}</a></p></article></section>`;
}

function openMakeupModal(customerId: string) {
  openModal(
    t('profile.issueMakeupCredit'),
    `<form id="customer-makeup-credit-form" class="form-grid"><label>${t('profile.originClass')}<input name="originClassId" required></label><label>${t('profile.originSession')}<input name="originSessionId" required></label><input type="hidden" name="idempotencyKey" value="makeup-${crypto.randomUUID()}"><label>${t('classSession.makeupCreditReason')}<select name="reason" required><option value="STAFF_GRANTED">${t('makeupCredit.reason.STAFF_GRANTED')}</option><option value="EXCUSED_ABSENCE">${t('makeupCredit.reason.EXCUSED_ABSENCE')}</option><option value="VENUE_CANCELLED">${t('makeupCredit.reason.VENUE_CANCELLED')}</option><option value="OTHER">${t('makeupCredit.reason.OTHER')}</option></select></label><label>${t('classSession.makeupCreditExpiry')}<input name="expiresAt" type="date"></label><p class="form-error full" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('profile.issueMakeupCredit')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>(
    '#customer-makeup-credit-form',
  );
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(
        `/customers/${encodeURIComponent(customerId)}/makeup-credits`,
        {
          method: 'POST',
          body: JSON.stringify({
            originClassId: values.originClassId,
            originSessionId: values.originSessionId,
            reason: values.reason,
            idempotencyKey: values.idempotencyKey,
            expiresAt: values.expiresAt
              ? `${values.expiresAt}T23:59:59.999Z`
              : undefined,
          }),
        },
      );
      closeModal();
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

function wirePortalActions(customerId: string) {
  const wire = (selector: string, endpoint: string) =>
    app
      .querySelector<HTMLButtonElement>(selector)
      ?.addEventListener('click', async () => {
        try {
          const result = await request<{ link: string }>(endpoint, {
            method: 'POST',
          });
          await navigator.clipboard.writeText(
            `${location.origin}${result.link}`,
          );
          window.alert('Portal link copied.');
        } catch (error) {
          window.alert(
            error instanceof Error
              ? error.message
              : 'Unable to generate portal link.',
          );
        }
      });
  wire(
    '[data-enable-portal]',
    `/customers/${encodeURIComponent(customerId)}/portal-access`,
  );
  wire(
    '[data-reset-portal]',
    `/customers/${encodeURIComponent(customerId)}/portal-reset`,
  );
}
