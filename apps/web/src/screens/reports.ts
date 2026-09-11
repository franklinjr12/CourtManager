import { formatMoney, t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { escapeText, request } from './runtime.js';

export async function reports() {
  await shell(async () => {
    const now = new Date(),
      from = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`,
      to = now.toISOString().slice(0, 10);
    const data = await request<Record<string, unknown>>(
      `/reports/operations?from=${from}&to=${to}`,
    );
    const utilization =
      (data.utilization as Array<Record<string, unknown>> | undefined) ?? [];
    return `<div class="toolbar"><div><h2>${t('reports.title')}</h2><p class="muted">${escapeText(String(data.from))} — ${escapeText(String(data.to))}</p></div></div><article class="card"><div class="metrics"><div class="metric"><span>${t('dashboard.reservations')}</span><strong>${data.totalReservations}</strong></div><div class="metric"><span>${t('reservations.noShow')}</span><strong>${data.noShow}</strong></div><div class="metric"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(Number(data.expectedRevenue))}</strong></div><div class="metric"><span>${t('profile.outstanding')}</span><strong>${formatMoney(Number(data.outstanding))}</strong></div></div></article><article class="card table-wrap section-card"><h3>${t('common.court')}</h3><table><thead><tr><th>${t('common.name')}</th><th>${t('reports.scheduled')}</th><th>${t('reports.actual')}</th></tr></thead><tbody>${utilization.map((item) => `<tr><td>${escapeText(String(item.courtName))}</td><td>${Number(item.scheduledUtilizationPercent).toFixed(1)}%</td><td>${Number(item.actualUtilizationPercent).toFixed(1)}%</td></tr>`).join('')}</tbody></table></article>`;
  });
}
