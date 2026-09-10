import { getAppContext } from '../app/context.js';
import { escapeHtml } from '../dom.js';
import {
  attendanceStatusLabel,
  blockReasonLabel,
  paymentMethodLabel,
  reservationSourceLabel,
  weekdayLabel,
  t,
} from '../i18n.js';

let modalReturn: HTMLElement | null = null;
let modalKeyHandler: ((event: KeyboardEvent) => void) | null = null;

export const localizeEnumOptions = (container: ParentNode) => {
  container.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
    select.querySelectorAll<HTMLOptionElement>('option').forEach((option) => {
      const value = option.value || option.textContent?.trim() || '';
      if (!option.hasAttribute('value')) option.value = value;
      if (select.name === 'status' && ['PRESENT', 'ABSENT', 'EXCUSED'].includes(value)) option.textContent = attendanceStatusLabel(value);
      else if (select.name === 'method') option.textContent = paymentMethodLabel(value);
      else if (select.name === 'source') option.textContent = reservationSourceLabel(value);
      else if (select.name === 'reason') option.textContent = blockReasonLabel(value);
      else if (select.name === 'weekday' && /^\d$/.test(value)) option.textContent = weekdayLabel(Number(value));
    });
  });
};

export const closeModal = () => {
  const { app } = getAppContext();
  app.querySelector('.modal-backdrop')?.remove();
  if (modalKeyHandler) {
    document.removeEventListener('keydown', modalKeyHandler);
    modalKeyHandler = null;
  }
  const focus = modalReturn;
  modalReturn = null;
  focus?.focus();
};

export const openModal = (
  title: string,
  body: string,
  returnFocus?: HTMLElement,
) => {
  const { app } = getAppContext();
  closeModal();
  modalReturn = returnFocus ?? (document.activeElement as HTMLElement);
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="modal-backdrop" role="presentation"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${escapeHtml(title)}</h2><button type="button" class="icon-button" data-close aria-label="${t('common.close')}">×</button></div><div class="modal-body">${body}</div></section></div>`,
  );
  localizeEnumOptions(app);
  const backdrop = app.querySelector('.modal-backdrop');
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  backdrop?.querySelector<HTMLElement>('[data-close]')?.addEventListener('click', closeModal);
  modalKeyHandler = (event) => {
    if (event.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', modalKeyHandler);
  backdrop?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
};
