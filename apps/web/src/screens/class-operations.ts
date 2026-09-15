import { timeValue } from '../core/presentation.js';
import { t } from '../i18n.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { app, escapeText, renderRoute, request } from './runtime.js';

type Participant = { customerId: string; name?: string; status: string };
type Roster = {
  session: { classId: string; startAt: string; endAt: string; status: string };
  participants: Participant[];
};

export async function classDetail(id: string) {
  await shell(async () => {
    const data = await request<{
      name: string;
      sport: string;
      capacity: number;
      sessions: Array<{ sessionId: string; startAt: string; status: string }>;
      enrollments: Array<{ status: string }>;
    }>(`/classes/${id}`);
    return `<div class="toolbar"><h2>${escapeText(data.name)}</h2><a class="button" href="/classes">${t('common.close')}</a></div><article class="card"><p>${escapeText(data.sport)} · ${data.enrollments.filter((x) => x.status === 'ACTIVE').length}/${data.capacity}</p></article><article class="card"><h3>${t('classSession.roster')}</h3><ul>${data.sessions.map((session) => `<li><a href="/class-sessions/${escapeText(session.sessionId)}">${escapeText(session.startAt)} — ${escapeText(session.status)}</a></li>`).join('')}</ul></article>`;
  });
}

export async function classSession(id: string) {
  await shell(async () => {
    const data = await request<Roster>(`/class-sessions/${id}/roster`);
    setTimeout(() => wireRoster(id, data.session.classId), 0);
    return `<div class="toolbar"><h2>${t('classSession.roster')}</h2><span>${escapeText(timeValue(data.session.startAt))}–${escapeText(timeValue(data.session.endAt))}</span></div><article class="card table-wrap"><table><thead><tr><th>${t('common.name')}</th><th>${t('common.status')}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.participants.map((item) => `<tr><td>${escapeText(item.name ?? item.customerId)}</td><td>${escapeText(item.status)}</td><td>${item.status === 'BOOKED' ? `<button class="button small" data-attendance="${escapeText(item.customerId)}">${t('classSession.checkIn')}</button><button class="button small" data-no-show="${escapeText(item.customerId)}">${t('classSession.noShow')}</button>` : item.status === 'CHECKED_IN' ? `<button class="button small" data-complete="${escapeText(item.customerId)}">${t('classSession.complete')}</button>` : ''}<button class="button small" data-makeup="${escapeText(item.customerId)}">${t('profile.issueMakeupCredit')}</button></td></tr>`).join('')}</tbody></table></article><div class="row-actions"><button class="button primary" id="complete-session">${t('classSession.completeClass')}</button><button class="button danger" id="cancel-session">${t('classSession.cancel')}</button></div>`;
  });
}

function wireRoster(id: string, classId: string) {
  const action = (customerId: string, verb: string) =>
    void request(`/class-sessions/${id}/participants/${customerId}/${verb}`, {
      method: 'POST',
    }).then(() => renderRoute());
  app
    .querySelectorAll<HTMLElement>('[data-attendance]')
    .forEach((x) =>
      x.addEventListener('click', () =>
        action(String(x.dataset.attendance), 'check-in'),
      ),
    );
  app
    .querySelectorAll<HTMLElement>('[data-no-show]')
    .forEach((x) =>
      x.addEventListener('click', () =>
        action(String(x.dataset.noShow), 'no-show'),
      ),
    );
  app
    .querySelectorAll<HTMLElement>('[data-complete]')
    .forEach((x) =>
      x.addEventListener('click', () =>
        action(String(x.dataset.complete), 'complete'),
      ),
    );
  app
    .querySelectorAll<HTMLElement>('[data-makeup]')
    .forEach((x) =>
      x.addEventListener('click', () =>
        openMakeupModal(id, classId, String(x.dataset.makeup)),
      ),
    );
  app
    .querySelector('#complete-session')
    ?.addEventListener(
      'click',
      () =>
        void request(`/class-sessions/${id}/complete`, { method: 'POST' }).then(
          () => renderRoute(),
        ),
    );
  app
    .querySelector('#cancel-session')
    ?.addEventListener('click', () => openCancelModal(id));
}

function openMakeupModal(
  sessionId: string,
  classId: string,
  customerId: string,
) {
  openModal(
    t('profile.issueMakeupCredit'),
    `<form id="makeup-credit-form" class="form-grid"><input type="hidden" name="customerId" value="${escapeText(customerId)}"><input type="hidden" name="idempotencyKey" value="makeup-${crypto.randomUUID()}"><label>${t('classSession.makeupCreditReason')}<select name="reason" required><option value="STAFF_GRANTED">${t('makeupCredit.reason.STAFF_GRANTED')}</option><option value="EXCUSED_ABSENCE">${t('makeupCredit.reason.EXCUSED_ABSENCE')}</option><option value="VENUE_CANCELLED">${t('makeupCredit.reason.VENUE_CANCELLED')}</option><option value="OTHER">${t('makeupCredit.reason.OTHER')}</option></select></label><label>${t('classSession.makeupCreditExpiry')}<input name="expiresAt" type="date"></label><p class="form-error full" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('profile.issueMakeupCredit')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#makeup-credit-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/class-sessions/${sessionId}/makeup-credits`, {
        method: 'POST',
        body: JSON.stringify({
          customerId: values.customerId,
          originClassId: classId,
          originSessionId: sessionId,
          reason: values.reason,
          idempotencyKey: values.idempotencyKey,
          expiresAt: values.expiresAt
            ? `${values.expiresAt}T23:59:59.999Z`
            : undefined,
        }),
      });
      closeModal();
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}

function openCancelModal(sessionId: string) {
  openModal(
    t('classSession.cancel'),
    `<form id="cancel-session-form" class="form-grid"><label>${t('common.reason')}<input name="reason" value="${escapeText(t('classSession.venueCancellation'))}" maxlength="1000"></label><label class="check full"><input name="issueMakeupCredits" type="checkbox"> <span>${t('classSession.issueMakeupCredits')}</span></label><p class="form-error full" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button danger">${t('classSession.cancel')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#cancel-session-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/class-sessions/${sessionId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          reason: values.reason || undefined,
          issueMakeupCredits: values.issueMakeupCredits === 'on',
        }),
      });
      closeModal();
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
