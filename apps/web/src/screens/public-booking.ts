import { endIsoFromInputs, isoFromInputs, errorMessage } from '../core/presentation.js';
import { t } from '../i18n.js';
import { formData } from '../ui/forms.js';
import { languageSelector, wireLanguageSelector } from '../ui/language-selector.js';
import { localizeEnumOptions } from '../ui/modal.js';
import { app, escapeText, request } from './runtime.js';
export async function publicBooking(slug: string) {
  try {
    const venue = await request<{
      name: string;
      timezone: string;
      courts: {
        courtId: string;
        name: string;
        sport: string;
        slotMinutes: number;
      }[];
    }>(`/public/venues/${encodeURIComponent(slug)}`);
      app.innerHTML = `<main class="login"><section class="card public-booking"><div class="public-head"><h1>${escapeText(venue.name)}</h1>${languageSelector()}</div><p class="muted">${t('public.title')}</p><form id="public-form"><label>${t('common.court')}<select name="courtId" required>${venue.courts.map((court) => `<option value="${escapeText(court.courtId)}">${escapeText(court.name)} â€” ${escapeText(court.sport)}</option>`).join('')}</select></label><label>${t('common.date')}<input type="date" name="date" required></label><label>${t('common.startTime')}<input type="time" name="time" required></label><label>${t('common.duration')}<select name="durationMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option><option value="120">${t('common.hours', { count: 2 })}</option></select></label><label>${t('common.name')}<input name="customerName" required></label><label>${t('common.phone')}<input name="phone" required></label><label>${t('common.email')} (${t('common.optional')})<input name="email" type="email"></label><label>${t('common.notes')} (${t('common.optional')})<textarea name="notes"></textarea></label><p class="notice">${t('public.disclaimer')}</p><button class="button primary">${t('public.sendRequest')}</button><p id="public-result" role="status"></p></form></section></main>`;
      wireLanguageSelector();
      localizeEnumOptions(app);
    const publicForm = app.querySelector<HTMLFormElement>('#public-form');
    const publicTime = publicForm?.elements.namedItem(
      'time',
    ) as HTMLInputElement | null;
    publicTime?.replaceWith(
      Object.assign(document.createElement('select'), {
        name: 'time',
        required: true,
        innerHTML: `<option value="">${t('common.loading')}</option>`,
      }),
    );
    const loadPublicAvailability = async () => {
      if (!publicForm) return;
      const courtId = String(
        (publicForm.elements.namedItem('courtId') as HTMLSelectElement).value,
      );
      const date = String(
        (publicForm.elements.namedItem('date') as HTMLInputElement).value,
      );
      const duration = String(
        (publicForm.elements.namedItem('durationMinutes') as HTMLSelectElement)
          .value,
      );
      const start = publicForm.elements.namedItem('time') as HTMLSelectElement;
      start.innerHTML = `<option>${t('common.loading')}</option>`;
      try {
        const data = await request<{ available: string[] }>(
          `/public/venues/${encodeURIComponent(slug)}/availability?courtId=${encodeURIComponent(courtId)}&date=${encodeURIComponent(date)}&durationMinutes=${duration}`,
        );
        start.innerHTML = data.available.length
          ? data.available
              .map(
                (value) =>
                  `<option value="${escapeText(value)}">${escapeText(value)}</option>`,
              )
              .join('')
          : `<option value="">${t('common.noAvailableTimes')}</option>`;
      } catch (error) {
        start.innerHTML = `<option value="">${escapeText(errorMessage(error))}</option>`;
      }
    };
    publicForm
      ?.querySelector('[name="courtId"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    publicForm
      ?.querySelector('[name="date"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    publicForm
      ?.querySelector('[name="durationMinutes"]')
      ?.addEventListener('change', () => void loadPublicAvailability());
    void loadPublicAvailability();
    app
      .querySelector<HTMLFormElement>('#public-form')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const values = formData(form);
        const start = isoFromInputs(
            String(values.date),
            String(values.time),
            venue.timezone,
          ),
          end = endIsoFromInputs(
            String(values.date),
            String(values.time),
            Number(values.durationMinutes),
            venue.timezone,
          );
        const result = app.querySelector('#public-result')!;
        try {
          await request(`/public/venues/${encodeURIComponent(slug)}/requests`, {
            method: 'POST',
            body: JSON.stringify({
              courtId: values.courtId,
              requestedStartAt: start,
              requestedEndAt: end,
              customerName: values.customerName,
              phone: values.phone,
              email: values.email || undefined,
              notes: values.notes || undefined,
            }),
          });
          result.textContent = t('public.requestSent');
          form.reset();
        } catch (error) {
          result.textContent = errorMessage(error);
        }
      });
  } catch (error) {
    app.innerHTML = `<main class="login"><article class="card error-state"><div class="public-head"><h2>${t('errors.venueUnavailable')}</h2>${languageSelector()}</div><p>${escapeText(errorMessage(error))}</p></article></main>`;
    wireLanguageSelector();
  }
}


