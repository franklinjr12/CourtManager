import { dateValue, timeValue, errorMessage } from '../core/presentation.js';
import { t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request } from './runtime.js';

type TodayData = { date: string; summary: { reservations: number; classSessions: number; pendingRequests: number; uncheckedIn: number; outstandingActions: number }; courts: Array<{ court: { name: string }; status: string; current?: Record<string, unknown>; next?: Record<string, unknown> }>; arrivalsNextHour: Record<string, unknown>[]; overdueCheckIns: Array<{ reservationId: string; label: string }>; pendingRequests: Record<string, unknown>[]; attention: Array<{ type: string; label: string; reservationId?: string }> };
export async function today() {
  await shell(async () => {
    const data = await request<TodayData>('/today');
    setTimeout(() => wireToday(data), 0);
    const courtRows = data.courts.map((item) => `<article class="card"><strong>${escapeText(item.court.name)}</strong><span class="status-badge status-${escapeText(item.status)}">${escapeText(item.status === 'AVAILABLE' ? t('today.available') : item.status)}</span>${item.current ? `<p>${escapeText(String(item.current.customerName ?? item.current.className ?? item.current.reason ?? ''))}<br><small>${escapeText(timeValue(String(item.current.startAt)))}–${escapeText(timeValue(String(item.current.endAt)))}</small></p>` : `<p class="muted">${t('today.available')}</p>`}${item.next ? `<small class="muted">${t('today.next')}: ${escapeText(String(item.next.customerName ?? item.next.className ?? ''))} ${escapeText(timeValue(String(item.next.startAt)))}</small>` : ''}</article>`).join('');
    return `<div class="toolbar"><div><h2>${t('today.title')} — ${escapeText(dateValue(`${data.date}T12:00:00Z`))}</h2></div><a class="button" href="/schedule">${t('dashboard.openSchedule')}</a></div><div class="metrics"><article class="metric card"><span>${t('dashboard.reservations')}</span><strong>${data.summary.reservations}</strong></article><article class="metric card"><span>${t('today.classSessions')}</span><strong>${data.summary.classSessions}</strong></article><article class="metric card"><span>${t('today.pendingRequests')}</span><strong>${data.summary.pendingRequests}</strong></article><article class="metric card"><span>${t('today.uncheckedIn')}</span><strong>${data.summary.uncheckedIn}</strong></article></div><h3>${t('today.current')}</h3><div class="schedule-grid">${courtRows || `<p class="empty">${t('dashboard.noReservations')}</p>`}</div><article class="card section-card"><div class="section-head"><h3>${t('today.attention')}</h3></div>${data.attention.length ? `<ul>${data.attention.map((item) => `<li>${escapeText(item.label)} ${item.reservationId ? `<button class="button small" data-check-in="${escapeText(item.reservationId)}">${t('classSession.checkIn')}</button>` : ''}</li>`).join('')}</ul>` : `<p class="empty">${t('profile.noActivity')}</p>`}</article>`;
  });
}
function wireToday(data: TodayData) {
  app.querySelectorAll<HTMLElement>('[data-check-in]').forEach((button) => button.addEventListener('click', async () => { try { await request(`/reservations/${button.dataset.checkIn}/check-in`, { method: 'POST' }); await renderRoute(); } catch (error) { window.alert(errorMessage(error)); } }));
  void data;
}
