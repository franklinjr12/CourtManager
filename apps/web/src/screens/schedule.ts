import { timeValue, today, errorMessage } from '../core/presentation.js';
import type { Court, ScheduleItem } from '../core/types.js';
import { button } from '../dom.js';
import {
  blockReasonLabel,
  formatDate,
  paymentStatusLabel,
  reservationStatusLabel,
  t,
} from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { shell } from '../ui/shell.js';
import {
  openBlockModal,
  openReservationDetail,
  openReservationModal,
} from './reservations.js';
import {
  escapeText,
  navigate,
  renderRoute,
  request,
  screen,
  timezone,
} from './runtime.js';
import { scheduleItemPosition, scheduleTimeline } from './schedule-layout.js';

const itemContent = (item: ScheduleItem, status: string) =>
  item.reservationId
    ? `<strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>${t('schedule.reservation')} · ${escapeText(status)}</span>`
    : `<strong>${escapeText(timeValue(item.startAt))}–${escapeText(timeValue(item.endAt))}</strong><span>${item.classId ? escapeText(status) : `${t('schedule.blocked')} · ${blockReasonLabel(status)}`}</span>${item.blockId ? button(t('schedule.cancelBlock'), `data-block="${escapeText(item.blockId)}"`) : ''}`;

const renderItem = (
  item: ScheduleItem,
  timeline: ReturnType<typeof scheduleTimeline>,
  zone: string,
) => {
  const status = item.reservationId
    ? `${item.customerName ?? t('common.customer')} · ${reservationStatusLabel(item.status)} · ${paymentStatusLabel(item.paymentStatus ?? 'UNPAID')}`
    : item.classId
      ? `${t('schedule.class')} · ${item.name ?? t('schedule.class')}`
      : (item.reason ?? '');
  const position = timeline
    ? scheduleItemPosition(item, timeline, zone)
    : undefined;
  const style = position
    ? ` style="grid-row: ${position.rowStart} / span ${position.rowSpan}"`
    : '';
  return item.reservationId
    ? `<button class="schedule-item"${style} data-reservation="${escapeText(item.reservationId)}">${itemContent(item, status)}</button>`
    : `<div class="schedule-item blocked"${style}>${itemContent(item, status)}</div>`;
};

export async function schedule() {
  const date = new URLSearchParams(location.search).get('date') ?? today();
  let renderedItems: ScheduleItem[] = [];
  await shell(async () => {
    const data = await request<{ courts: Court[]; items: ScheduleItem[] }>(
      `/schedule?date=${encodeURIComponent(date)}`,
    );
    const scheduleZone = timezone();
    const timeline = scheduleTimeline(data.items, scheduleZone);
    renderedItems = data.items;
    const timelineStyle = timeline
      ? ` style="--schedule-slots: ${timeline.slotCount}"`
      : '';
    const courts = data.courts
      .map((court) => {
        const items = data.items.filter(
          (item) => item.courtId === court.courtId,
        );
        const content = items.length
          ? items
              .map((item) => renderItem(item, timeline, scheduleZone))
              .join('')
          : `<p class="empty">${t('common.available')}</p>`;
        return `<article class="card court"><h3>${escapeText(court.name)} <small>${escapeText(court.sport)}</small></h3>${timeline ? `<div class="schedule-column">${content}</div>` : content}</article>`;
      })
      .join('');

    return `<div class="toolbar"><div><h2>${t('schedule.title')}</h2><p class="muted">${escapeText(formatDate(`${date}T12:00:00`, scheduleZone))}</p></div><div class="row-actions"><button class="button" id="previous-day">${t('common.previousDay')}</button><button class="button" id="today">${t('dashboard.today')}</button><button class="button" id="next-day">${t('common.nextDay')}</button><button class="button" id="block-court">${t('schedule.blockCourt')}</button><button class="button primary" id="new-booking">${t('reservations.new')}</button></div></div><div class="schedule-grid${timeline ? ' schedule-timeline' : ''}"${timelineStyle}>${courts || `<p class="empty">${t('schedule.createCourtHint')}</p>`}</div>`;
  });
  screen()
    ?.querySelector('#new-booking')
    ?.addEventListener('click', () => void openReservationModal(date));
  screen()
    ?.querySelector('#block-court')
    ?.addEventListener('click', () => void openBlockModal(date));
  screen()
    ?.querySelectorAll<HTMLElement>('[data-reservation]')
    .forEach((element) =>
      element.addEventListener(
        'click',
        () => void openReservationDetail(String(element.dataset.reservation)),
      ),
    );
  screen()
    ?.querySelectorAll<HTMLElement>('[data-block]')
    .forEach((element) =>
      element.addEventListener('click', async () => {
        if (!window.confirm(t('schedule.cancelBlockConfirmation'))) return;
        try {
          await request(`/blocks/${element.dataset.block}/cancel`, {
            method: 'POST',
          });
          toast(t('schedule.cancelBlock'));
          await renderRoute();
        } catch (error) {
          toast(errorMessage(error), 'error');
        }
      }),
    );
  screen()
    ?.querySelectorAll<HTMLElement>('[data-reservation]')
    .forEach((element) => {
      const reservation = renderedItems.find(
        (item) => item.reservationId === element.dataset.reservation,
      );
      const strong = element.querySelector('strong');
      if (reservation && strong)
        strong.textContent = `${strong.textContent} — ${reservation.customerName ?? t('common.customer')}`;
    });
  const move = (amount: number) => {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + amount);
    navigate(`/schedule?date=${next.toISOString().slice(0, 10)}`);
  };
  screen()
    ?.querySelector('#previous-day')
    ?.addEventListener('click', () => move(-1));
  screen()
    ?.querySelector('#next-day')
    ?.addEventListener('click', () => move(1));
  screen()
    ?.querySelector('#today')
    ?.addEventListener('click', () => navigate('/schedule'));
}
