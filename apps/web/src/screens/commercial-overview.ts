import type {
  CustomerPackage,
  FixedCourtAgreement,
  Membership,
} from '@court-manager/contracts';
import type { Customer } from '../core/types.js';
import { formatDate, formatMoney, t, weekdayLabel } from '../i18n.js';
import { shell } from '../ui/shell.js';
import { escapeText, request } from './runtime.js';

type StaffPackage = CustomerPackage & {
  creditBalances?: Array<{
    unit: string;
    quantityType: 'FINITE' | 'UNLIMITED';
    remainingQuantity: number;
  }>;
};

type FinanceSummary = { outstanding: number };

const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return dateKey(result);
};

export const commercialOverviewMetrics = ({
  memberships,
  renewals,
  overdue,
  packages,
  agreements,
  today,
}: {
  memberships: Membership[];
  renewals: Membership[];
  overdue?: Membership[];
  packages: CustomerPackage[];
  agreements: FixedCourtAgreement[];
  today: string;
}) => ({
  activeMemberships: memberships.filter((item) => item.status === 'ACTIVE')
    .length,
  renewalsDue: renewals.length,
  overdueMemberships:
    overdue?.length ??
    memberships.filter(
      (item) =>
        item.status === 'ACTIVE' &&
        item.currentPeriodEnd < today &&
        Boolean(item.nextRenewalDate),
    ).length,
  packagesExpiring: packages.filter((item) => item.status === 'ACTIVE').length,
  activeFixedAgreements: agreements.filter((item) => item.status === 'ACTIVE')
    .length,
});

export const commercialOutstandingAmount = (summaries: FinanceSummary[]) =>
  summaries.reduce((total, summary) => total + summary.outstanding, 0);

const statusBadge = (status: string) =>
  `<span class="status-badge status-${escapeText(status)}">${escapeText(t(`status.${status}` as never))}</span>`;

const commercialNav = () =>
  `<nav class="commercial-nav" aria-label="${escapeText(t('nav.commercial'))}"><a class="active" href="/commercial">${t('commercial.overview')}</a><a href="/commercial/plans">${t('plans.title')}</a><a href="/commercial/memberships">${t('memberships.title')}</a><a href="/commercial/packages">${t('packages.title')}</a><a href="/commercial/fixed-courts">${t('fixedCourtAgreements.title')}</a></nav>`;

const packageRemaining = (item: StaffPackage) => {
  const balances = item.creditBalances ?? [];
  if (!balances.length) return t('commercial.noBalance');
  return balances
    .map((balance) =>
      balance.quantityType === 'UNLIMITED'
        ? t('packages.unlimited')
        : `${balance.remainingQuantity} ${t(`packages.unit.${balance.unit}` as never)}`,
    )
    .join(' · ');
};

export async function commercialOverview() {
  const today = dateKey();
  const renewalTo = addDays(new Date(), 30);
  const [
    memberships,
    renewals,
    overdue,
    packages,
    agreements,
    membershipFinance,
    packageFinance,
    fixedAgreementFinance,
    customers,
  ] = await Promise.all([
    request<Membership[]>('/memberships?status=ACTIVE&limit=100'),
    request<Membership[]>('/memberships/renewals-due?windowDays=30&limit=100'),
    request<Membership[]>('/memberships/overdue?limit=100'),
    request<StaffPackage[]>(
      '/customer-packages/expiring-soon?windowDays=30&limit=100',
    ),
    request<FixedCourtAgreement[]>(
      '/fixed-court-agreements?status=ACTIVE&limit=100',
    ),
    request<FinanceSummary>('/finance/summary?sourceType=MEMBERSHIP'),
    request<FinanceSummary>('/finance/summary?sourceType=PACKAGE'),
    request<FinanceSummary>(
      '/finance/summary?sourceType=FIXED_COURT_AGREEMENT',
    ),
    request<Customer[]>('/customers?limit=100'),
  ]);
  const finance = {
    outstanding: commercialOutstandingAmount([
      membershipFinance,
      packageFinance,
      fixedAgreementFinance,
    ]),
  };
  const metrics = commercialOverviewMetrics({
    memberships,
    renewals,
    packages,
    overdue,
    agreements,
    today,
  });
  const customerName = (id: string) =>
    customers.find((customer) => customer.customerId === id)?.name ?? id;
  const upcoming = [...renewals]
    .sort((a, b) =>
      String(a.nextRenewalDate).localeCompare(String(b.nextRenewalDate)),
    )
    .slice(0, 6);
  const expiringPackages = [...packages]
    .sort((a, b) => String(a.expiresAt).localeCompare(String(b.expiresAt)))
    .slice(0, 6);
  const activeAgreements = agreements.filter(
    (item) => item.status === 'ACTIVE',
  );

  await shell(
    () =>
      `<div class="toolbar"><div><h2>${t('commercial.overview')}</h2><p class="muted">${t('commercial.description')}</p></div><a class="button primary" href="/commercial/memberships">${t('commercial.manageMemberships')}</a></div>${commercialNav()}<div class="metrics"><a class="metric card" href="/commercial/memberships?status=ACTIVE"><span>${t('commercial.activeMemberships')}</span><strong>${metrics.activeMemberships}</strong></a><a class="metric card" href="/commercial/memberships?renewalFrom=${today}&renewalTo=${renewalTo}"><span>${t('commercial.renewalsDue')}</span><strong>${metrics.renewalsDue}</strong></a><a class="metric card ${metrics.overdueMemberships ? 'attention' : ''}" href="/commercial/memberships?status=ACTIVE"><span>${t('commercial.overdueMemberships')}</span><strong>${metrics.overdueMemberships}</strong></a><a class="metric card" href="/commercial/packages?expirationFrom=${today}&expirationTo=${renewalTo}"><span>${t('commercial.packagesExpiring')}</span><strong>${metrics.packagesExpiring}</strong></a><article class="metric card"><span>${t('commercial.outstanding')}</span><strong>${formatMoney(finance.outstanding)}</strong></article><a class="metric card" href="/commercial/fixed-courts"><span>${t('commercial.activeFixedAgreements')}</span><strong>${metrics.activeFixedAgreements}</strong></a></div><div class="commercial-grid"><article class="card table-wrap"><div class="section-head"><div><h3>${t('commercial.renewalsDue')}</h3><p class="muted">${t('commercial.next30Days')}</p></div><a class="button small" href="/commercial/memberships?renewalFrom=${today}&renewalTo=${renewalTo}">${t('commercial.viewAll')}</a></div>${upcoming.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('memberships.plan')}</th><th>${t('memberships.nextRenewal')}</th><th>${t('common.status')}</th></tr></thead><tbody>${upcoming.map((item) => `<tr><td>${escapeText(customerName(item.customerId))}</td><td>${escapeText(item.planNameSnapshot)}</td><td>${escapeText(formatDate(item.nextRenewalDate ?? item.currentPeriodEnd))}</td><td>${statusBadge(item.status)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('commercial.noRenewals')}</p>`}</article><article class="card table-wrap"><div class="section-head"><div><h3>${t('commercial.packagesExpiring')}</h3><p class="muted">${t('commercial.next30Days')}</p></div><a class="button small" href="/commercial/packages?expirationFrom=${today}&expirationTo=${renewalTo}">${t('commercial.viewAll')}</a></div>${expiringPackages.length ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('packages.definition')}</th><th>${t('packages.expires')}</th><th>${t('profile.remaining')}</th></tr></thead><tbody>${expiringPackages.map((item) => `<tr><td>${escapeText(customerName(item.customerId))}</td><td>${escapeText(item.packageNameSnapshot)}</td><td>${escapeText(formatDate(item.expiresAt ?? today))}</td><td>${escapeText(packageRemaining(item))}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('commercial.noExpiringPackages')}</p>`}</article><article class="card table-wrap"><div class="section-head"><h3>${t('commercial.activeFixedAgreements')}</h3><a class="button small" href="/commercial/fixed-courts">${t('commercial.viewAll')}</a></div>${
        activeAgreements.length
          ? `<table><thead><tr><th>${t('common.customer')}</th><th>${t('common.weekday')}</th><th>${t('common.time')}</th><th>${t('common.price')}</th></tr></thead><tbody>${activeAgreements
              .slice(0, 6)
              .map(
                (item) =>
                  `<tr><td>${escapeText(customerName(item.customerId))}</td><td>${escapeText(weekdayLabel(item.weekday))}</td><td>${escapeText(item.startTime)}</td><td>${escapeText(formatMoney(item.monthlyPrice, item.currency))}</td></tr>`,
              )
              .join('')}</tbody></table>`
          : `<p class="empty">${t('commercial.noFixedAgreements')}</p>`
      }</article><article class="card"><div class="section-head"><h3>${t('commercial.operationalNotes')}</h3></div><p class="muted">${t('commercial.manualBillingHint')}</p><a class="button" href="/finance">${t('commercial.openFinance')}</a></article></div>`,
  );
}
