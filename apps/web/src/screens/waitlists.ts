import { dateValue, timeValue } from '../core/presentation.js';
import type { StaffWaitlist } from '../core/types.js';
import { button } from '../dom.js';
import { t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request } from './runtime.js';

const joinedAt = (value: string) => `${dateValue(value)} ${timeValue(value)}`;

const capacityLabel = (item: StaffWaitlist) => {
  if (item.type === 'CLASS')
    return `${item.currentAvailability.enrolledCount ?? 0} / ${item.currentAvailability.capacity ?? 0} ${t('waitlists.enrolled')}`;
  return item.currentAvailability.available
    ? t('waitlists.nowAvailable')
    : t('waitlists.unavailable');
};

const statusLabel = (status: StaffWaitlist['status']) =>
  t(`status.${status}` as never);

export async function waitlists() {
  const data = await request<StaffWaitlist[]>('/waitlists');
  const actionable = data.filter((item) => item.actionable);
  const grouped = [
    ...new Map(
      actionable.map((item) => [
        item.requestedActivity,
        actionable.filter(
          (candidate) => candidate.requestedActivity === item.requestedActivity,
        ).length,
      ]),
    ).entries(),
  ];
  await shell(
    () =>
      `<div class="toolbar"><div><h2>${t('waitlists.title')}</h2><p class="muted">${t('waitlists.description')}</p></div></div>${actionable.length ? `<section class="card"><h3>${t('waitlists.opportunities')}</h3><div class="attention-list">${grouped.map(([activity, count]) => `<p><strong>${escapeText(activity)}</strong> · ${t('waitlists.waiting', { count })}</p>`).join('')}</div></section>` : ''}<article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('waitlists.type')}</th><th>${t('common.customer')}</th><th>${t('waitlists.requestedActivity')}</th><th>${t('waitlists.joined')}</th><th>${t('waitlists.currentState')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((item) => `<tr><td>${item.type === 'CLASS' ? t('waitlists.class') : t('waitlists.court')}</td><td>${escapeText(item.customerName)}</td><td>${escapeText(item.requestedActivity)}</td><td>${escapeText(joinedAt(item.joinedAt))}</td><td>${escapeText(capacityLabel(item))}</td><td>${escapeText(statusLabel(item.status))}</td><td>${item.status === 'ACTIVE' ? `${button(item.type === 'CLASS' ? t('waitlists.enroll') : t('waitlists.createReservation'), `data-fulfill-waitlist="${escapeText(item.waitlistId)}"`)}${button(t('waitlists.expire'), `data-expire-waitlist="${escapeText(item.waitlistId)}"`)}` : item.linkedReservationId ? escapeText(item.linkedReservationId) : item.linkedEnrollmentId ? escapeText(item.linkedEnrollmentId) : '—'}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('waitlists.empty')}</p>`}</article>`,
    () => wireWaitlists(data),
  );
}

function wireWaitlists(data: StaffWaitlist[]) {
  app
    .querySelectorAll<HTMLButtonElement>('[data-fulfill-waitlist]')
    .forEach((element) => {
      element.addEventListener('click', async () => {
        const item = data.find(
          (candidate) =>
            candidate.waitlistId === element.dataset.fulfillWaitlist,
        );
        if (!item) return;
        element.disabled = true;
        try {
          await request(
            `/waitlists/${encodeURIComponent(item.waitlistId)}/fulfill`,
            {
              method: 'POST',
            },
          );
          toast(
            item.type === 'CLASS'
              ? t('waitlists.enrolledSuccess')
              : t('waitlists.reservationCreated'),
          );
          await renderRoute();
        } catch (error) {
          element.disabled = false;
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      });
    });
  app
    .querySelectorAll<HTMLButtonElement>('[data-expire-waitlist]')
    .forEach((element) => {
      element.addEventListener('click', async () => {
        element.disabled = true;
        try {
          await request(
            `/waitlists/${encodeURIComponent(String(element.dataset.expireWaitlist))}/expire`,
            { method: 'POST' },
          );
          toast(t('waitlists.expired'));
          await renderRoute();
        } catch (error) {
          element.disabled = false;
          toast(
            String(error instanceof Error ? error.message : error),
            'error',
          );
        }
      });
    });
}
