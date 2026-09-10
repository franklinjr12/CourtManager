import { timeValue, today, errorMessage } from '../core/presentation.js';
import type { Court, ScheduleItem } from '../core/types.js';
import { button } from '../dom.js';
import { blockReasonLabel, formatDate, paymentStatusLabel, reservationStatusLabel, t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { shell } from '../ui/shell.js';
import { openBlockModal, openReservationDetail, openReservationModal } from './reservations.js';
import { escapeText, navigate, renderRoute, request, screen, timezone } from './runtime.js';

export async function schedule() {
  const date = new URLSearchParams(location.search).get('date') ?? today();
  let renderedItems: ScheduleItem[] = [];
  await shell(async () => {
    const data = await request<{ courts: Court[]; items: ScheduleItem[] }>(
      `/schedule?date=${encodeURIComponent(date)}`,
    );
    const displayItems = data.items.map((item) =>
      item.reservationId
        ? {
            ...item,
            status: `${item.customerName ?? t('common.customer')} Ãƒâ€šÃ‚Â· ${reservationStatusLabel(item.status)} Ãƒâ€šÃ‚Â· ${paymentStatusLabel(item.paymentStatus ?? 'UNPAID')}`,
          }
        : item.classId
          ? { ...item, reason: `${t('schedule.class')} Ãƒâ€šÃ‚Â· ${item.name ?? t('schedule.class')}` }
          : item,
    );
    renderedItems = data.items;

    return `<div class="toolbar"><div><h2>${t('schedule.title')}</h2><p class="muted">${escapeText(formatDate(`${date}T12:00:00`, timezone()))}</p></div><div class="row-actions"><button class="button" id="previous-day">${t('common.previousDay')}</button><button class="button" id="today">${t('dashboard.today')}</button><button class="button" id="next-day">${t('common.nextDay')}</button><button class="button" id="block-court">${t('schedule.blockCourt')}</button><button class="button primary" id="new-booking">${t('reservations.new')}</button></div></div><div class="schedule-grid">${
      data.courts
        .map((court) => {
          const items = displayItems.filter(
            (item) => item.courtId === court.courtId,
          );
          return `<article class="card court"><h3>${escapeText(court.name)} <small>${escapeText(court.sport)}</small></h3>${items.length ? items.map((item) => (item.reservationId ? `<button class="schedule-item" data-reservation="${escapeText(item.reservationId)}"><strong>${escapeText(timeValue(item.startAt))}ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“${escapeText(timeValue(item.endAt))}</strong><span>${t('schedule.reservation')} Ãƒâ€šÃ‚Â· ${escapeText(item.status)}</span></button>` : `<div class="schedule-item blocked"><strong>${escapeText(timeValue(item.startAt))}ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“${escapeText(timeValue(item.endAt))}</strong><span>${item.classId ? `${t('schedule.class')} Ãƒâ€šÃ‚Â· ${escapeText(item.reason)}` : `${t('schedule.blocked')} Ãƒâ€šÃ‚Â· ${blockReasonLabel(item.reason ?? '')}`}</span>${item.blockId ? button(t('schedule.cancelBlock'), `data-block="${escapeText(item.blockId)}"`) : ''}</div>`)).join('') : `<p class="empty">${t('common.available')}</p>`}</article>`;
        })
        .join('') ||
      `<p class="empty">${t('schedule.createCourtHint')}</p>`
    }</div>`;
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
            () =>
              void openReservationDetail(String(element.dataset.reservation)),
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
        strong.textContent = `${strong.textContent} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${reservation.customerName ?? t('common.customer')}`;
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




