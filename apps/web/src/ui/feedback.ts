import { getAppContext } from '../app/context.js';
import { escapeHtml } from '../dom.js';

export const renderToast = (
  message: string,
  kind: 'success' | 'error' = 'success',
) => {
  const { app } = getAppContext();
  app.querySelector('.toast')?.remove();
  app.insertAdjacentHTML(
    'beforeend',
    `<div class="toast ${kind}" role="status">${escapeHtml(message)}</div>`,
  );
  window.setTimeout(() => app.querySelector('.toast')?.remove(), 3500);
};

export const toast = (
  message: string,
  kind: 'success' | 'error' = 'success',
) => {
  sessionStorage.setItem(
    'court-manager-toast',
    JSON.stringify({ message, kind }),
  );
  renderToast(message, kind);
  window.setTimeout(
    () => sessionStorage.removeItem('court-manager-toast'),
    5000,
  );
};
