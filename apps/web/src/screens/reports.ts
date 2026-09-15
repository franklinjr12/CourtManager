import { formatMoney, t } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { escapeText, renderRoute, request } from './runtime.js';

type Row = Record<string, unknown>;

export async function reports() {
  const params = new URLSearchParams(location.search),
    requestedFrom = params.get('from'),
    requestedTo = params.get('to');
  await shell(
    async () => {
      const query =
        requestedFrom && requestedTo
          ? `?from=${encodeURIComponent(requestedFrom)}&to=${encodeURIComponent(requestedTo)}`
          : '';
      const data = await request<Row>(`/reports/operations${query}`),
        utilization = (data.utilization as Row[] | undefined) ?? [],
        commercial = (data.commercial as Row | undefined) ?? {},
        memberships = (commercial.memberships as Row | undefined) ?? {},
        packages = (commercial.packages as Row | undefined) ?? {},
        fixedCourts = (commercial.fixedCourts as Row | undefined) ?? {},
        plans = (memberships.byPlan as Row[] | undefined) ?? [],
        creditUtilization = (packages.credits as Row[] | undefined) ?? [];
      return `<div class="toolbar"><div><h2>${t('reports.title')}</h2><p class="muted">${escapeText(String(data.from))} — ${escapeText(String(data.to))} · ${escapeText(String(data.timezone ?? 'UTC'))}</p></div></div><form id="reports-filter" class="card form-grid"><label>${t('reports.from')}<input name="from" type="date" value="${escapeText(String(data.from))}" required></label><label>${t('reports.to')}<input name="to" type="date" value="${escapeText(String(data.to))}" required></label><div class="form-actions"><button class="button primary">${t('common.applyFilters')}</button></div></form><article class="card"><div class="metrics"><div class="metric"><span>${t('dashboard.reservations')}</span><strong>${data.totalReservations}</strong></div><div class="metric"><span>${t('reservations.noShow')}</span><strong>${data.noShow}</strong></div><div class="metric"><span>${t('dashboard.expectedRevenue')}</span><strong>${formatMoney(Number(data.expectedRevenue))}</strong></div><div class="metric"><span>${t('profile.outstanding')}</span><strong>${formatMoney(Number(data.outstanding))}</strong></div></div></article><article class="card"><h3>${t('reports.commercial')}</h3><p class="muted">${t('reports.expectedPaymentsHint')}</p><div class="metrics"><div class="metric"><span>${t('reports.activeMemberships')}</span><strong>${memberships.activeCount ?? data.activeMemberships ?? 0}</strong></div><div class="metric"><span>${t('reports.membershipExpected')}</span><strong>${formatMoney(Number(memberships.expectedCharges ?? data.membershipExpectedRevenue))}</strong></div><div class="metric"><span>${t('reports.membershipPayments')}</span><strong>${formatMoney(Number(memberships.recordedPayments ?? data.membershipRecordedPayments))}</strong></div><div class="metric"><span>${t('reports.membershipOutstanding')}</span><strong>${formatMoney(Number(memberships.outstandingAmount ?? data.membershipOutstandingAmount))}</strong></div><div class="metric"><span>${t('reports.packagesIssued')}</span><strong>${packages.issuedCount ?? data.packagesIssued ?? 0}</strong></div><div class="metric"><span>${t('reports.packageSales')}</span><strong>${formatMoney(Number(packages.salesValue ?? data.packageSalesValue))}</strong></div><div class="metric"><span>${t('reports.fixedAgreements')}</span><strong>${fixedCourts.agreementCount ?? data.fixedCourtAgreements ?? 0}</strong></div><div class="metric"><span>${t('reports.fixedExpected')}</span><strong>${formatMoney(Number(fixedCourts.expectedRevenue ?? data.fixedCourtExpectedRevenue))}</strong></div></div></article><article class="card table-wrap"><h3>${t('reports.membershipsByPlan')}</h3><table><thead><tr><th>${t('common.name')}</th><th>${t('common.active')}</th></tr></thead><tbody>${plans.length ? plans.map((plan) => `<tr><td>${escapeText(String(plan.planName))}</td><td>${Number(plan.count)}</td></tr>`).join('') : `<tr><td colspan="2" class="empty">${t('reports.noCommercialData')}</td></tr>`}</tbody></table></article><article class="card table-wrap"><h3>${t('reports.packageUtilization')}</h3><table><thead><tr><th>${t('reports.unit')}</th><th>${t('reports.issued')}</th><th>${t('reports.consumed')}</th><th>${t('reports.expired')}</th><th>${t('reports.utilization')}</th></tr></thead><tbody>${creditUtilization.length ? creditUtilization.map((item) => `<tr><td>${escapeText(String(item.unit))}</td><td>${Number(item.issuedQuantity)}</td><td>${Number(item.consumedQuantity)}</td><td>${Number(item.expiredQuantity)}</td><td>${Number(item.utilizationPercent).toFixed(1)}%</td></tr>`).join('') : `<tr><td colspan="5" class="empty">${t('reports.noCommercialData')}</td></tr>`}</tbody></table></article><article class="card table-wrap section-card"><h3>${t('common.court')}</h3><table><thead><tr><th>${t('common.name')}</th><th>${t('reports.scheduled')}</th><th>${t('reports.actual')}</th></tr></thead><tbody>${utilization.map((item) => `<tr><td>${escapeText(String(item.courtName))}</td><td>${Number(item.scheduledUtilizationPercent).toFixed(1)}%</td><td>${Number(item.actualUtilizationPercent).toFixed(1)}%</td></tr>`).join('')}</tbody></table></article>`;
    },
    () => {
      document
        .querySelector<HTMLFormElement>('#reports-filter')
        ?.addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement,
            values = new FormData(form),
            from = String(values.get('from') ?? ''),
            to = String(values.get('to') ?? '');
          if (from && to) {
            history.pushState({}, '', `/reports?from=${from}&to=${to}`);
            void renderRoute();
          }
        });
    },
  );
}
