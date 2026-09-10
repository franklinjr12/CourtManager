export const required = (selector: string, parent: ParentNode = document) => {
  const element = parent.querySelector<HTMLElement>(selector);
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
  element.textContent = 'Loading…';
  return element;
};
