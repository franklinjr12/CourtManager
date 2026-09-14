import { dateValue, timeValue } from '../core/presentation.js';
import { formatMoney, reservationStatusLabel, t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, request } from './runtime.js';
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
};
export async function customerProfile(id: string) {
  await shell(async () => {
    const data = await request<Profile>(`/customers/${id}/profile`);
    setTimeout(() => wirePortalActions(id), 0);
    return `<div class="toolbar"><div><h2>${escapeText(data.customer.name)}</h2><p class="muted">${escapeText(data.customer.phone ?? '')} ${escapeText(data.customer.email ?? '')}</p></div><div><button class="button" data-enable-portal>Enable portal access</button><button class="button" data-reset-portal>Reset portal password</button><a class="button" href="/customers">${t('common.close')}</a></div></div><article class="card"><p>${escapeText(data.customer.notes ?? t('common.noNotes'))}</p><p>${(data.customer.tags ?? []).map(escapeText).join(' · ')}</p></article><h3>${t('profile.summary')}</h3><div class="metrics"><div class="metric card"><span>${t('dashboard.reservations')}</span><strong>${data.summary.reservationCount}</strong></div><div class="metric card"><span>${t('profile.attendances')}</span><strong>${data.summary.classAttendances}</strong></div><div class="metric card"><span>${t('reservations.noShow')}</span><strong>${data.summary.noShows}</strong></div><div class="metric card"><span>${t('profile.outstanding')}</span><strong>${formatMoney(data.summary.outstanding)}</strong></div></div><article class="card table-wrap"><h3>${t('dashboard.reservations')}</h3><table><tbody>${data.reservations.map((item) => `<tr><td>${escapeText(dateValue(item.startAt))} ${escapeText(timeValue(item.startAt))}</td><td>${reservationStatusLabel(item.status)}</td><td>${formatMoney(item.expectedAmount)}</td></tr>`).join('')}</tbody></table></article>`;
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
