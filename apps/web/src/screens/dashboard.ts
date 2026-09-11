import { timeValue } from '../core/presentation.js';
import type { Reservation } from '../core/types.js';
import { formatMoney, t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { escapeText, request } from './runtime.js';

export async function dashboard() {
  await shell(async () => {
    const data = await request<{
      reservationsToday: number;
      pendingRequests: number;
      expectedRevenue: number;
      recordedPayments: number;
      outstanding: number;
      upcoming: Reservation[];
    }>('/dashboard');
    return `<div class="toolbar"><div><h2>${t('dashboard.today')}</h2><p class="muted">${t('dashboard.overview')}</p></div><a class="button primary" href="/schedule">${t('dashboard.openSchedule')}</a></div><div class="metrics"><article class="metric card"><span>${t('dashboard.reservations')}</span><strong>${data.reservationsToday}</strong></article><article class="metric card"><span>${t('dashboard.pendingRequests')}</span><strong>${data.pendingRequests}</strong></article><article class="metric card"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(data.expectedRevenue)}</strong></article><article class="metric card"><span>${t('dashboard.outstanding')}</span><strong>${formatMoney(data.outstanding)}</strong></article></div><article class="card"><h3>${t('dashboard.upcoming')}</h3>${data.upcoming.length ? `<ul>${data.upcoming.map((item) => `<li>${escapeText(timeValue(item.startAt))} — ${formatMoney(item.expectedAmount)}</li>`).join('')}</ul>` : `<p class="empty">${t('dashboard.noReservations')}</p>`}</article>`;
  });
}
