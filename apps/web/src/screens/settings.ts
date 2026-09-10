import { errorMessage } from '../core/presentation.js';
import type { OpeningHours, Organization, Court, Sport } from '../core/types.js';
import { formatMoney, t, weekdayLabel } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request } from './runtime.js';
const button = (label: string, attrs = '') =>
  `<button type="button" class="button" ${attrs}>${escapeText(label)}</button>`;
const days = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];
const defaultHours = (): OpeningHours =>
  Object.fromEntries(
    days.map((day) => [day, { open: '07:00', close: '23:00' }]),
  );
const hourFields = (hours: OpeningHours) =>
  days
    .map((day) => {
      const closed = hours[day] === null;
      const value = hours[day] ?? { open: '07:00', close: '23:00' };
      return `<div class="hour-row"><strong>${weekdayLabel(day)}</strong><label>${t('settings.open')}<input name="open-${day}" type="time" value="${escapeText(value.open)}" ${closed ? 'disabled' : 'required'}></label><label>${t('settings.close')}<input name="close-${day}" type="time" value="${escapeText(value.close)}" ${closed ? 'disabled' : 'required'}></label><label class="check"><input name="closed-${day}" type="checkbox" ${closed ? 'checked' : ''}> ${t('settings.closed')}</label></div>`;
    })
    .join('');
const courtForm = (court?: Court) => {
  const hours = court?.openingHours ?? defaultHours();
  return `<form id="court-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="100" value="${escapeText(court?.name)}"></label><label>${t('common.sport')}<input name="sport" required maxlength="80" value="${escapeText(court?.sport)}"></label><label>${t('settings.hourlyPrice')}<input name="defaultHourlyPrice" type="number" min="0" step="0.01" required value="${escapeText(court?.defaultHourlyPrice ?? 80)}"></label><label>${t('settings.slotSize')}<select name="slotMinutes"><option value="30">${t('common.minutes', { count: 30 })}</option><option value="60">${t('common.minutes', { count: 60 })}</option></select></label><label class="check"><input name="publiclyRequestable" type="checkbox" ${court?.publiclyRequestable !== false ? 'checked' : ''}> ${t('settings.publicBookingEnabled')}</label><label class="check"><input name="active" type="checkbox" ${court?.active !== false ? 'checked' : ''}> ${t('common.active')}</label><label class="full">${t('common.notes')}<textarea name="notes" maxlength="2000">${escapeText(court?.notes)}</textarea></label><fieldset class="full"><legend>${t('settings.openingHours')}</legend>${hourFields(hours)}</fieldset><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${court ? t('common.saveChanges') : t('settings.addCourt')}</button></div></form>`;
};

const organizationForm = (org: Organization) =>
  `<form id="organization-form" class="form-grid"><label>${t('common.name')}<input name="name" required maxlength="160" value="${escapeText(org.name)}"></label><label>${t('settings.publicSlug')}<input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value="${escapeText(org.slug)}"></label><label>${t('settings.timezone')}<input name="timezone" required value="${escapeText(org.timezone)}"></label><label>${t('settings.currency')}<input name="currency" required maxlength="3" value="${escapeText(org.currency)}"></label><label>${t('common.phone')}<input name="phone" value="${escapeText(org.phone)}"></label><label>${t('common.email')}<input name="email" type="email" value="${escapeText(org.email)}"></label><label class="check full"><input name="classes" type="checkbox" ${org.features.classes ? 'checked' : ''}> ${t('settings.enableClasses')}</label><p class="form-error" role="alert"></p><div class="form-actions full"><button class="button primary">${t('settings.saveOrganization')}</button></div></form>`;


function openingHoursFrom(form: HTMLFormElement) {
  return Object.fromEntries(
    days.map((day) => [
      day,
      (form.elements.namedItem(`closed-${day}`) as HTMLInputElement).checked
        ? null
        : {
            open: String(
              (form.elements.namedItem(`open-${day}`) as HTMLInputElement)
                .value,
            ),
            close: String(
              (form.elements.namedItem(`close-${day}`) as HTMLInputElement)
                .value,
            ),
          },
    ]),
  );
}
async function openCourtModal(court?: Court) {
  openModal(court ? t('settings.editCourt') : t('settings.addCourt'), courtForm(court));
  const form = app.querySelector<HTMLFormElement>('#court-form');
  if (!form) return;
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  days.forEach((day) =>
    (
      form?.elements.namedItem(`closed-${day}`) as HTMLInputElement | null
    )?.addEventListener('change', (event: Event) => {
      const closed = (event.currentTarget as HTMLInputElement).checked;
      (
        form.elements.namedItem(`open-${day}`) as HTMLInputElement | null
      )?.toggleAttribute('disabled', closed);
      (
        form.elements.namedItem(`close-${day}`) as HTMLInputElement | null
      )?.toggleAttribute('disabled', closed);
    }),
  );
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      const payload = {
        name: String(values.name),
        sport: String(values.sport),
        defaultHourlyPrice: Number(values.defaultHourlyPrice),
        slotMinutes: Number(values.slotMinutes),
        publiclyRequestable: values.publiclyRequestable === 'on',
        active: values.active === 'on',
        notes: String(values.notes || '') || undefined,
        openingHours: openingHoursFrom(form),
      };
      await request(court ? `/courts/${court.courtId}` : '/courts', {
        method: court ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      closeModal();
      toast(court ? t('settings.courtUpdated') : t('settings.courtAdded'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
async function openSportModal(sport?: Sport) {
  openModal(
    sport ? t('settings.editSport') : t('settings.addSport'),
    `<form id="sport-form" class="form-grid"><label class="full">${t('common.name')}<input name="name" required maxlength="80" value="${escapeText(sport?.name)}"></label><label class="check full"><input name="active" type="checkbox" ${sport?.active !== false ? 'checked' : ''}> ${t('common.active')}</label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${sport ? t('common.saveChanges') : t('settings.addSport')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#sport-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(sport ? `/sports/${sport.sportId}` : '/sports', {
        method: sport ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: values.name,
          active: values.active === 'on',
        }),
      });
      closeModal();
      toast(sport ? t('settings.sportUpdated') : t('settings.sportAdded'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
export async function settings() {
  await shell(async () => {
    const [org, courts, sports] = await Promise.all([
      request<Organization>('/organization'),
      request<Court[]>('/courts?includeArchived=true'),
      request<Sport[]>('/sports?includeInactive=true'),
    ]);
    return `<div class="toolbar"><div><h2>${t('settings.title')}</h2><p class="muted">${t('settings.description')}</p></div><button class="button primary" id="add-court">${t('settings.addCourt')}</button></div><article class="card"><h3>${t('settings.organization')}</h3>${organizationForm(org)}</article><article class="card section-card"><div class="section-head"><div><h3>${t('settings.sports')}</h3><p class="muted">${t('settings.activeSummary', { active: sports.filter((s) => s.active).length, inactive: sports.filter((s) => !s.active).length })}</p></div><button class="button" id="add-sport">${t('settings.addSport')}</button></div><div class="court-list">${sports.length ? sports.map((sport) => `<article class="list-row ${sport.active ? '' : 'archived'}"><div><strong>${escapeText(sport.name)}</strong><small>${sport.active ? t('common.active') : t('common.inactive')}</small></div><div class="row-actions">${button(t('common.edit'), `data-edit-sport="${escapeText(sport.sportId)}"`)}${button(sport.active ? t('common.deactivate') : t('common.activate'), `data-toggle-sport="${escapeText(sport.sportId)}" data-active="${sport.active ? 'false' : 'true'}"`)}</div></article>`).join('') : `<p class="empty">${t('settings.noSports')}</p>`}</div></article><article class="card section-card"><div class="section-head"><div><h3>${t('settings.courts')}</h3><p class="muted">${t('settings.courtSummary', { active: courts.filter((c) => !c.archivedAt).length, archived: courts.filter((c) => c.archivedAt).length })}</p></div></div><div class="court-list">${courts.length ? courts.map((c) => `<article class="list-row ${c.archivedAt ? 'archived' : ''}"><div><strong>${escapeText(c.name)}</strong><span>${escapeText(c.sport)} Â· ${formatMoney(c.defaultHourlyPrice)}${t('common.hour')} Â· ${c.slotMinutes} min</span><small>${c.archivedAt ? t('common.archived') : c.active ? t('common.active') : t('common.inactive')} Â· ${c.publiclyRequestable ? t('settings.publicBookingEnabled') : t('common.private')}</small></div><div class="row-actions">${button(t('common.edit'), `data-edit-court="${escapeText(c.courtId)}"`)}${c.archivedAt ? button(t('common.restore'), `data-restore-court="${escapeText(c.courtId)}"`) : button(t('common.archive'), `data-archive-court="${escapeText(c.courtId)}"`)}</div></article>`).join('') : `<p class="empty">${t('settings.noCourts')}</p>`}</div></article>`;
  }, wireSettings);
}
function wireSettings() {
  app
    .querySelector('#add-sport')
    ?.addEventListener('click', () => void openSportModal());
  app.querySelectorAll<HTMLElement>('[data-edit-sport]').forEach((element) =>
    element.addEventListener('click', async () => {
      const sport = await request<Sport>(`/sports/${element.dataset.editSport}`);
      await openSportModal(sport);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-toggle-sport]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await request(`/sports/${element.dataset.toggleSport}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: element.dataset.active === 'true' }),
        });
        toast(t('settings.sportStatusUpdated'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app
    .querySelector<HTMLButtonElement>('#add-court')
    ?.addEventListener('click', () => void openCourtModal(undefined));
  app.querySelectorAll<HTMLElement>('[data-edit-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      const court = await request<Court>(
        `/courts/${element.dataset.editCourt}`,
      );
      await openCourtModal(court);
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-archive-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      if (!window.confirm(t('settings.archiveCourtConfirmation')))
        return;
      try {
        await request(`/courts/${element.dataset.archiveCourt}/archive`, {
          method: 'POST',
        });
        toast(t('settings.courtArchived'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app.querySelectorAll<HTMLElement>('[data-restore-court]').forEach((element) =>
    element.addEventListener('click', async () => {
      try {
        await request(`/courts/${element.dataset.restoreCourt}/restore`, {
          method: 'POST',
        });
        toast(t('settings.courtRestored'));
        await renderRoute();
      } catch (error) {
        toast(errorMessage(error), 'error');
      }
    }),
  );
  app
    .querySelector<HTMLFormElement>('#organization-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      setBusy(form, true);
      try {
        const values = formData(form);
        const current = await request<Organization>('/organization');
        await request('/organization', {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            slug: values.slug,
            timezone: values.timezone,
            currency: String(values.currency).toUpperCase(),
            phone: values.phone || undefined,
            email: values.email || undefined,
            features: { ...current.features, classes: values.classes === 'on' },
          }),
        });
        toast(t('settings.organizationSaved'));
        setBusy(form, false);
      } catch (error) {
        showFormError(form, error);
        setBusy(form, false);
      }
    });
}


