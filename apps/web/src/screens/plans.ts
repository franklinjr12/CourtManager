import type { Plan, PlanBenefit } from '@court-manager/contracts';
import type { Court } from '../core/types.js';
import { formatMoney, t, weekdayLabel } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request, screen } from './runtime.js';

const benefitTypes = [
  'COURT_TIME',
  'CLASS_ATTENDANCE',
  'PRIVATE_LESSON',
  'OPEN_GAME',
  'FIXED_COURT_SLOT',
] as const;
const benefitPeriods = ['WEEK', 'MONTH', 'MEMBERSHIP_PERIOD'] as const;
const weekdays = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

const label = (namespace: string, value: string) =>
  t(`${namespace}.${value}` as never);

const benefitSummary = (benefit: PlanBenefit, courts: Court[]) => {
  if (benefit.type === 'FIXED_COURT_SLOT') {
    const court = courts.find((item) => item.courtId === benefit.courtId);
    return `${weekdayLabel(benefit.weekday)} ${benefit.startTime}–${benefit.endTime} · ${court?.name ?? benefit.courtId}`;
  }
  const quantity =
    benefit.quantityType === 'UNLIMITED'
      ? t('plans.unlimited')
      : `${benefit.quantity} ${label('plans.unit', benefit.unit)}`;
  return `${quantity} · ${label('plans.period', benefit.period)}`;
};

const statusBadge = (status: Plan['status']) =>
  `<span class="status-badge status-${escapeText(status)}">${escapeText(label('plans.status', status))}</span>`;

export async function plans() {
  const [data, courts] = await Promise.all([
    request<Plan[]>('/plans?limit=100'),
    request<Court[]>('/courts'),
  ]);
  await shell(() => {
    setTimeout(() => wirePlans(courts), 0);
    return `<div class="toolbar"><div><h2>${t('plans.title')}</h2><p class="muted">${t('plans.description')}</p></div><button class="button primary" id="add-plan">${t('plans.add')}</button></div><article class="card table-wrap"><table><thead><tr><th>${t('common.name')}</th><th>${t('common.price')}</th><th>${t('plans.billingInterval')}</th><th>${t('plans.benefits')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.length ? data.map((plan) => `<tr><td><strong>${escapeText(plan.name)}</strong>${plan.description ? `<br><small class="muted">${escapeText(plan.description)}</small>` : ''}</td><td>${escapeText(formatMoney(plan.basePrice, plan.currency))}</td><td>${escapeText(label('plans.interval', plan.billingInterval))}${plan.customIntervalDays ? ` · ${plan.customIntervalDays} ${t('plans.days')}` : ''}</td><td><ul class="plan-benefits">${plan.benefits.map((benefit) => `<li>${escapeText(benefit.label ? `${benefit.label}: ` : '')}${escapeText(benefitSummary(benefit, courts))}</li>`).join('')}</ul></td><td>${statusBadge(plan.status)}</td><td class="row-actions"><button class="button small" data-edit-plan="${escapeText(plan.planId)}">${t('common.edit')}</button>${plan.status !== 'ARCHIVED' ? `<button class="button small" data-archive-plan="${escapeText(plan.planId)}">${t('common.archive')}</button>` : ''}</td></tr>`).join('') : `<tr><td colspan="6" class="empty">${t('plans.empty')}</td></tr>`}</tbody></table></article>`;
  });
  wirePlanButtons(data, courts);
}

function wirePlans(courts: Court[]) {
  screen()
    ?.querySelector('#add-plan')
    ?.addEventListener('click', () => openPlanModal(undefined, courts));
}

function wirePlanButtons(data: Plan[], courts: Court[]) {
  screen()
    ?.querySelectorAll<HTMLElement>('[data-edit-plan]')
    .forEach((element) => {
      const plan = data.find(
        (item) => item.planId === element.dataset.editPlan,
      );
      if (plan)
        element.addEventListener('click', () => openPlanModal(plan, courts));
    });
  screen()
    ?.querySelectorAll<HTMLElement>('[data-archive-plan]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        if (!window.confirm(t('plans.archiveConfirmation'))) return;
        try {
          await request(`/plans/${element.dataset.archivePlan}/archive`, {
            method: 'POST',
          });
          toast(t('plans.archived'));
          await renderRoute();
        } catch (error) {
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      }),
    );
}

const selectOptions = (
  values: readonly string[],
  selected: string,
  namespace: string,
) =>
  values
    .map(
      (value) =>
        `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeText(label(namespace, value))}</option>`,
    )
    .join('');

function benefitRow(
  benefit: PlanBenefit | undefined,
  courts: Court[],
  index: number,
) {
  const type = benefit?.type ?? 'COURT_TIME';
  const period = benefit?.period ?? 'MONTH';
  const fixed = type === 'FIXED_COURT_SLOT';
  const fixedBenefit =
    benefit?.type === 'FIXED_COURT_SLOT' ? benefit : undefined;
  const quantityType =
    benefit && 'quantityType' in benefit ? benefit.quantityType : 'FINITE';
  const quantity = benefit && 'quantity' in benefit ? benefit.quantity : 60;
  return `<fieldset class="benefit-row" data-benefit-row><legend>${t('plans.benefit')} ${index + 1}</legend><div class="form-grid"><label>${t('plans.benefitType')}<select data-benefit-field="type" data-benefit-type>${selectOptions(benefitTypes, type, 'plans.type')}</select></label><label>${t('plans.period')}<select data-benefit-field="period">${selectOptions(benefitPeriods, period, 'plans.period')}</select></label><label>${t('plans.quantityType')}<select data-benefit-field="quantityType">${selectOptions(['FINITE', 'UNLIMITED'], quantityType, 'plans.quantityType')}</select></label><label>${t('plans.quantity')}<input data-benefit-field="quantity" type="number" min="1" step="1" value="${quantityType === 'FINITE' ? escapeText(quantity) : ''}" ${quantityType === 'UNLIMITED' ? 'disabled' : 'required'}></label><label class="full">${t('plans.benefitLabel')} <span class="muted">(${t('common.optional')})</span><input data-benefit-field="label" value="${escapeText(benefit?.label ?? '')}"></label><div class="full fixed-fields" data-fixed-fields ${fixed ? '' : 'hidden'}><div class="form-grid"><label>${t('common.court')}<select data-benefit-field="courtId">${courts.map((court) => `<option value="${escapeText(court.courtId)}" ${court.courtId === fixedBenefit?.courtId ? 'selected' : ''}>${escapeText(court.name)}</option>`).join('')}</select></label><label>${t('common.weekday')}<select data-benefit-field="weekday">${selectOptions(weekdays, fixedBenefit?.weekday ?? 'MONDAY', 'weekday')}</select></label><label>${t('common.startTime')}<input data-benefit-field="startTime" type="time" value="${escapeText(fixedBenefit?.startTime ?? '18:00')}"></label><label>${t('common.end')}<input data-benefit-field="endTime" type="time" value="${escapeText(fixedBenefit?.endTime ?? '19:00')}"></label></div></div><div class="form-actions full"><span></span><button type="button" class="button small" data-remove-benefit>${t('plans.removeBenefit')}</button></div></div></fieldset>`;
}

function planForm(plan: Plan | undefined, courts: Court[]) {
  return `<form id="plan-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(plan?.name ?? '')}"></label><label>${t('common.price')}<input name="basePrice" type="number" min="0" step="0.01" required value="${escapeText(plan?.basePrice ?? 0)}"></label><label>${t('plans.billingInterval')}<select name="billingInterval">${selectOptions(['WEEKLY', 'MONTHLY', 'CUSTOM'], plan?.billingInterval ?? 'MONTHLY', 'plans.interval')}</select></label><label data-custom-days ${plan?.billingInterval !== 'CUSTOM' ? 'hidden' : ''}>${t('plans.customIntervalDays')}<input name="customIntervalDays" type="number" min="1" max="365" value="${escapeText(plan?.customIntervalDays ?? '')}"></label><label>${t('plans.status')}<select name="status" ${plan?.status === 'ARCHIVED' ? 'disabled' : ''}>${selectOptions(plan?.status === 'ARCHIVED' ? ['ARCHIVED'] : ['ACTIVE', 'INACTIVE'], plan?.status ?? 'ACTIVE', 'plans.status')}</select></label><label class="full">${t('common.description')} <span class="muted">(${t('common.optional')})</span><textarea name="description" maxlength="2000">${escapeText(plan?.description ?? '')}</textarea></label><div class="full"><div class="section-head"><h3>${t('plans.benefits')}</h3><button type="button" class="button small" id="add-benefit">${t('plans.addBenefit')}</button></div><div id="plan-benefits">${(plan?.benefits ?? [undefined]).map((benefit, index) => benefitRow(benefit, courts, index)).join('')}</div></div><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${plan ? t('common.saveChanges') : t('plans.create')}</button></div></form>`;
}

function openPlanModal(plan: Plan | undefined, courts: Court[]) {
  openModal(plan ? t('plans.edit') : t('plans.add'), planForm(plan, courts));
  const form = app.querySelector<HTMLFormElement>('#plan-form');
  const benefits = app.querySelector<HTMLElement>('#plan-benefits');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  const updateFixedFields = (row: HTMLElement) => {
    const type = row.querySelector<HTMLSelectElement>('[data-benefit-type]');
    const fixed = row.querySelector<HTMLElement>('[data-fixed-fields]');
    const quantityType = row.querySelector<HTMLSelectElement>(
      '[data-benefit-field="quantityType"]',
    );
    const quantity = row.querySelector<HTMLInputElement>(
      '[data-benefit-field="quantity"]',
    );
    if (fixed) fixed.hidden = type?.value !== 'FIXED_COURT_SLOT';
    if (quantity) {
      quantity.disabled = quantityType?.value === 'UNLIMITED';
      quantity.required = !quantity.disabled;
    }
  };
  const wireBenefitRow = (row: HTMLElement) => {
    row
      .querySelectorAll('select')
      .forEach((select) =>
        select.addEventListener('change', () => updateFixedFields(row)),
      );
    row
      .querySelector('[data-remove-benefit]')
      ?.addEventListener('click', () => {
        if (benefits && benefits.children.length > 1) row.remove();
      });
    updateFixedFields(row);
  };
  benefits
    ?.querySelectorAll<HTMLElement>('[data-benefit-row]')
    .forEach(wireBenefitRow);
  app.querySelector('#add-benefit')?.addEventListener('click', () => {
    if (!benefits) return;
    benefits.insertAdjacentHTML(
      'beforeend',
      benefitRow(undefined, courts, benefits.children.length),
    );
    const row = benefits.lastElementChild;
    if (row instanceof HTMLElement) wireBenefitRow(row);
  });
  form
    ?.querySelector('[name="billingInterval"]')
    ?.addEventListener('change', (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      const field = form.querySelector<HTMLElement>('[data-custom-days]');
      if (field) field.hidden = select.value !== 'CUSTOM';
    });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const benefitsInput = [
        ...form.querySelectorAll<HTMLElement>('[data-benefit-row]'),
      ].map((row) => {
        const value = (field: string) =>
          row.querySelector<HTMLInputElement | HTMLSelectElement>(
            `[data-benefit-field="${field}"]`,
          )?.value ?? '';
        const type = value('type');
        const benefit = {
          type,
          period: value('period'),
          quantityType: value('quantityType'),
          ...(value('quantityType') === 'FINITE'
            ? { quantity: Number(value('quantity')) }
            : {}),
          unit:
            type === 'COURT_TIME'
              ? 'COURT_MINUTES'
              : type === 'OPEN_GAME'
                ? 'GAME'
                : type === 'FIXED_COURT_SLOT'
                  ? 'OCCURRENCE'
                  : 'SESSION',
          ...(value('label') ? { label: value('label') } : {}),
          ...(type === 'FIXED_COURT_SLOT'
            ? {
                courtId: value('courtId'),
                weekday: value('weekday'),
                startTime: value('startTime'),
                endTime: value('endTime'),
              }
            : {}),
        };
        return benefit;
      });
      const input = {
        name: values.name,
        description: values.description || undefined,
        basePrice: Number(values.basePrice),
        billingInterval: values.billingInterval,
        customIntervalDays:
          values.billingInterval === 'CUSTOM'
            ? Number(values.customIntervalDays)
            : undefined,
        status: values.status,
        benefits: benefitsInput,
      };
      await request(plan ? `/plans/${plan.planId}` : '/plans', {
        method: plan ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      });
      closeModal();
      toast(plan ? t('plans.updated') : t('plans.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
