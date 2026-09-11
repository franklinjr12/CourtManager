import { today } from '../core/presentation.js';
import type { Organization, Court, Customer, SportClass } from '../core/types.js';
import { button } from '../dom.js';
import { attendanceStatusLabel, t, weekdayLabel } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import { closeModal, openModal } from '../ui/modal.js';
import { shell } from '../ui/shell.js';
import { customerOptions } from './customers.js';
import { app, escapeText, renderRoute, request, screen, session } from './runtime.js';
export async function classes() {
  const org = await request<Organization>('/organization');
  const data = await request<SportClass[]>('/classes');
  const courts = await request<Court[]>('/courts');
  const customers = session()?.user.role === 'COACH' ? [] : await request<Customer[]>('/customers?limit=100');
  const coaches = session()?.user.role === 'COACH' ? [] : await request<Array<{ userId: string; name: string }>>('/coaches');
  await shell(async () => {
    setTimeout(() => wireClasses(data, customers), 0);
    return `<div class="toolbar"><div><h2>${t('classes.title')}</h2><p class="muted">${t('classes.description')}</p></div>${org.features.classes ? `<button class="button primary" id="add-class">${t('classes.add')}</button>` : ''}</div>${org.features.classes ? `<article class="card table-wrap">${data.length ? `<table><thead><tr><th>${t('common.name')}</th><th>${t('common.sport')}</th><th>${t('common.schedule' as never)}</th><th>${t('classes.capacity' as never)}</th><th>${t('common.actions')}</th></tr></thead><tbody>${data.map((c) => `<tr><td>${escapeText(c.name)}</td><td>${escapeText(c.sport)}</td><td>${escapeText(c.startDate)} ${escapeText(c.startTime)}</td><td>${c.capacity}</td><td>${button(t('classes.enroll'), `data-enroll-class="${escapeText(c.classId)}"`)} ${button(t('classes.attendance'), `data-attendance-class="${escapeText(c.classId)}"`)}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t('classes.noClasses' as never)}</p>`}</article>` : `<article class="card"><h3>${t('classes.disabled')}</h3><p class="empty">${t('classes.enableHint')}</p><a class="button" href="/settings">${t('classes.openSettings')}</a></article>`}`;
  });
  if (org.features.classes)
    setTimeout(() => {
      if (session()?.user.role === 'COACH') {
        screen()?.querySelector('#add-class')?.remove();
        screen()?.querySelectorAll('[data-enroll-class]').forEach((element) => element.remove());
      }
      screen()
        ?.querySelector('#add-class')
        ?.addEventListener('click', () => void openClassModal(courts, coaches));
    }, 0);
}
function classForm(courts: Court[], _coaches: Array<{ userId: string; name: string }>) {
  return `<form id="class-form" class="form-grid"><label>${t('common.name')}<input name="name" required></label><label>${t('common.sport')}<input name="sport" required></label><label>${t('common.court')}<select name="courtId" required>${courts.map((c) => `<option value="${escapeText(c.courtId)}">${escapeText(c.name)}</option>`).join('')}</select></label><label>${t('classes.capacity')}<input name="capacity" type="number" min="1" required value="10"></label><label>${t('common.price')}<input name="price" type="number" min="0" step="0.01" required value="0"></label><label>${t('common.weekday' as never)}<select name="weekday">${[0, 1, 2, 3, 4, 5, 6].map((day) => `<option value="${day}">${weekdayLabel(day)}</option>`).join('')}</select></label><label>${t('common.startTime')}<input name="startTime" type="time" required value="18:00"></label><label>${t('common.duration')}<input name="durationMinutes" type="number" min="30" required value="60"></label><label>${t('common.start')} ${t('common.date')}<input name="startDate" type="date" required value="${today()}"></label><label>${t('common.end')} ${t('common.date')}<input name="endDate" type="date" value="${today()}"></label><label class="full">${t('common.notes')}<textarea name="notes"></textarea></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.create')}</button></div></form>`;
}
function openClassModal(courts: Court[], coaches: Array<{ userId: string; name: string }>) {
  openModal(t('classes.add'), classForm(courts, coaches));
  const form = app.querySelector<HTMLFormElement>('#class-form');
  if (form) {
    form.insertAdjacentHTML('afterbegin', `<label>${t('staff.role')}<select name="coachId" required>${coaches.map((coach) => `<option value="${escapeText(coach.userId)}">${escapeText(coach.name)}</option>`).join('')}</select></label>`);
    const price = form.elements.namedItem('price');
    if (price instanceof HTMLElement) price.setAttribute('name', 'pricePerParticipant');
  }
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/classes', {
        method: 'POST',
        body: JSON.stringify({
          name: values.name,
          sport: values.sport,
          coachId: values.coachId,
          courtId: values.courtId,
          capacity: Number(values.capacity),
          pricePerParticipant: Number(values.pricePerParticipant),
          weekday: Number(values.weekday),
          startTime: values.startTime,
          durationMinutes: Number(values.durationMinutes),
          startDate: values.startDate,
          endDate: values.endDate || undefined,
          notes: values.notes || undefined,
        }),
      });
      closeModal();
      toast(t('classes.created'));
      await renderRoute();
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
function openEnrollmentModal(
  classId: string,
  customers: Customer[],
  returnFocus: HTMLElement,
) {
  openModal(
    t('classes.enrollCustomer'),
    `<form id="enroll-form" class="form-grid"><label class="full">${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.enroll')}</button></div></form>`,
    returnFocus,
  );
  const form = app.querySelector<HTMLFormElement>('#enroll-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request(`/classes/${classId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ customerId: values.customerId }),
      });
      closeModal();
      toast(t('classes.enrolled'));
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
function wireClasses(data: SportClass[], customers: Customer[]) {
  void data;
  app
    .querySelectorAll<HTMLElement>('[data-enroll-class]')
    .forEach((element) =>
      element.addEventListener('click', () =>
        openEnrollmentModal(
          String(element.dataset.enrollClass),
          customers,
          element,
        ),
      ),
    );
  app
    .querySelectorAll<HTMLElement>('[data-attendance-class]')
    .forEach((element) =>
      element.addEventListener('click', () =>
        openAttendanceModal(String(element.dataset.attendanceClass), customers),
      ),
    );
}
function openAttendanceModal(classId: string, customers: Customer[]) {
  openModal(
    t('classes.recordAttendance'),
    `<form id="attendance-form" class="form-grid"><input type="hidden" name="classId" value="${escapeText(classId)}"><label class="full">${t('common.customer')}<select name="customerId" required>${customerOptions(customers)}</select></label><label>${t('common.date')}<input name="date" type="date" required value="${today()}"></label><label>${t('common.status')}<select name="status"><option value="PRESENT">${attendanceStatusLabel('PRESENT')}</option><option value="ABSENT">${attendanceStatusLabel('ABSENT')}</option><option value="EXCUSED">${attendanceStatusLabel('EXCUSED')}</option></select></label><p class="form-error" role="alert"></p><div class="form-actions full"><button type="button" class="button" data-close>${t('common.cancel')}</button><button class="button primary">${t('classes.saveAttendance')}</button></div></form>`,
  );
  const form = app.querySelector<HTMLFormElement>('#attendance-form');
  form?.querySelector('[data-close]')?.addEventListener('click', closeModal);
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(form, true);
    try {
      const values = formData(form);
      await request('/classes/attendance', {
        method: 'POST',
        body: JSON.stringify(values),
      });
      closeModal();
      toast(t('classes.attendanceSaved'));
    } catch (error) {
      showFormError(form, error);
      setBusy(form, false);
    }
  });
}
