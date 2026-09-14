import type {
  CustomerClass,
  CustomerClassPage,
} from '@court-manager/contracts';
import { errorMessage } from '../core/presentation.js';
import { customerRequest } from '../customer-auth.js';
import { formatMoney, t, weekdayLabel } from '../i18n.js';
import { escapeText } from './runtime.js';

const schedule = (cls: CustomerClass) =>
  `${cls.startDate}${cls.endDate ? ` – ${cls.endDate}` : ''}, ${
    cls.scheduleType === 'WEEKLY'
      ? `${t('portal.everyWeeks', { count: cls.intervalWeeks })}, ${weekdayLabel(cls.weekday)}, `
      : ''
  }${cls.startTime} (${cls.timezone}), ${t('common.minutes', { count: cls.durationMinutes })}`;

const actionLabel = (action: string) =>
  action === 'leave'
    ? t('portal.leaveClass')
    : action === 'leave-waitlist'
      ? t('portal.leaveWaitlist')
      : action === 'waitlist'
        ? t('portal.joinWaitlist')
        : t('portal.enroll');

const actionState = (cls: CustomerClass) =>
  cls.enrollment?.status === 'ACTIVE'
    ? t('portal.enrolled')
    : cls.waitlist?.status === 'ACTIVE'
      ? t('portal.onWaitlist')
      : cls.enrollment
        ? t('portal.enrollmentCancelled')
        : t('portal.notEnrolled');

const card = (cls: CustomerClass) => {
  const waiting = cls.waitlist?.status === 'ACTIVE';
  const action =
    cls.enrollment?.status === 'ACTIVE'
      ? 'leave'
      : waiting
        ? 'leave-waitlist'
        : cls.full
          ? 'waitlist'
          : 'enroll';
  return `<article class="card portal-class-card" data-customer-class="${escapeText(cls.classId)}"${cls.waitlist?.waitlistId ? ` data-waitlist-id="${escapeText(cls.waitlist.waitlistId)}"` : ''}>
    <div class="portal-card-heading"><div><h3>${escapeText(cls.name)}</h3><p class="muted">${escapeText(cls.sport)} · ${escapeText(cls.coachName)} · ${escapeText(cls.courtName)}</p></div><span class="status-badge">${escapeText(actionState(cls))}</span></div>
    <p>${escapeText(schedule(cls))}</p>
    <p class="muted">${escapeText(t('portal.enrolledCount', { enrolled: cls.enrolledCount, capacity: cls.capacity }))} · ${escapeText(cls.full ? t('portal.full') : t('portal.spacesAvailable'))}</p>
    <p class="muted">${escapeText(formatMoney(cls.pricePerParticipant, cls.currency))} ${escapeText(t('portal.perSession'))}</p>
    <button class="button${action === 'waitlist' ? '' : ' primary'}" data-class-action="${action}">${escapeText(actionLabel(action))}</button>
    <p role="status" class="portal-inline-status"></p>
  </article>`;
};

export async function mountCustomerClasses(root: HTMLElement) {
  root.innerHTML = `<section class="portal-activities"><div class="portal-section-heading"><div><h2>${t('portal.classes')}</h2><p class="muted">${t('portal.classesHint')}</p></div></div><div data-class-list></div><p data-class-status class="loading" role="status" aria-live="polite">${t('common.loading')}</p><button class="button" data-more-classes hidden>${t('portal.loadMore')}</button></section>`;
  const list = root.querySelector<HTMLElement>('[data-class-list]')!;
  const status = root.querySelector<HTMLElement>('[data-class-status]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-more-classes]')!;
  let cursor: string | null = null;
  const load = async (append = false) => {
    more.disabled = true;
    if (!append) status.textContent = t('common.loading');
    try {
      const result = await customerRequest<CustomerClassPage>(
        `/customer/classes${append && cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      if (!append) list.replaceChildren();
      list.insertAdjacentHTML('beforeend', result.data.map(card).join(''));
      cursor = result.nextCursor;
      more.hidden = !cursor;
      status.className = list.children.length ? '' : 'empty';
      status.textContent = list.children.length
        ? ''
        : t('portal.noActiveClasses');
    } catch (error) {
      status.textContent = errorMessage(error);
      status.className = 'error';
    } finally {
      more.disabled = false;
    }
  };
  more.addEventListener('click', () => void load(true));
  list.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
      '[data-class-action]',
    );
    if (!button) return;
    const article = button.closest<HTMLElement>('[data-customer-class]')!;
    const feedback = article.querySelector<HTMLElement>('[role="status"]')!;
    const action = button.dataset.classAction;
    button.disabled = true;
    feedback.textContent =
      action === 'leave'
        ? t('portal.leavingClass')
        : action === 'leave-waitlist'
          ? t('portal.leavingWaitlist')
          : action === 'waitlist'
            ? t('portal.joiningWaitlist')
            : t('portal.enrolling');
    try {
      if (action === 'leave-waitlist')
        await customerRequest(
          `/customer/waitlists/${encodeURIComponent(article.dataset.waitlistId ?? '')}`,
          { method: 'DELETE' },
        );
      else
        await customerRequest(
          `/customer/classes/${encodeURIComponent(article.dataset.customerClass!)}/${action}`,
          { method: 'POST' },
        );
      await load();
      status.className = 'success';
      status.textContent =
        action === 'leave'
          ? t('portal.enrollmentCancelledSuccess')
          : action === 'waitlist'
            ? t('portal.waitlistJoined')
            : action === 'leave-waitlist'
              ? t('portal.waitlistLeft')
              : t('portal.enrollmentConfirmed');
    } catch (error) {
      await load();
      status.className = 'error';
      status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
  await load();
}
