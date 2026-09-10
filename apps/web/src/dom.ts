import { t } from './i18n.js';

export const required = <T extends HTMLElement = HTMLElement>(
  selector: string,
  parent: ParentNode = document,
) => {
  const element = parent.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
};
export const escapeHtml = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
export const emptyState = (message: string) => {
  const element = document.createElement('p');
  element.className = 'empty';
  element.textContent = message;
  return element;
};
export const loadingState = () => {
  const element = document.createElement('p');
  element.className = 'loading';
  element.textContent = t('common.loading');
  return element;
};

export const formData = (form: HTMLFormElement) =>
  Object.fromEntries(new FormData(form).entries());

export const button = (label: string, attrs = '') =>
  `<button type="button" class="button" ${attrs}>${escapeHtml(label)}</button>`;
