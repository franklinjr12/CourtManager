import { formatMoney, t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { request } from './runtime.js';

export async function reports() {
  await shell(async () => {
    const data = await request<Record<string, unknown>>('/reports/summary');
    return `<div class="toolbar"><h2>${t('reports.title')}</h2></div><article class="card"><div class="metrics"><div class="metric"><span>${t('dashboard.reservations')}</span><strong>${data.reservationCount}</strong></div><div class="metric"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(Number(data.expectedRevenue))}</strong></div><div class="metric"><span>${t('finance.recorded' as never)}</span><strong>${formatMoney(Number(data.recordedPayments))}</strong></div></div></article>`;
  });
}


