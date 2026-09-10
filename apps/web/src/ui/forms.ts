import { formData } from '../dom.js';
import { translateError } from '../i18n.js';

export { formData };

export const setBusy = (form: HTMLFormElement, busy: boolean) => {
  form.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = busy;
  });
  form.classList.toggle('busy', busy);
};

export const showFormError = (form: HTMLFormElement, error: unknown) => {
  let element = form.querySelector<HTMLElement>('.form-error');
  if (!element) {
    element = document.createElement('p');
    element.className = 'form-error';
    element.setAttribute('role', 'alert');
    form.append(element);
  }
  element.textContent = translateError(error);
};
