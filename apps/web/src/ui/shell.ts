import { t } from '../i18n.js';
import { app, escapeText, navigate, request, session, setSession } from '../screens/runtime.js';
import { renderToast } from './feedback.js';
import { languageSelector, wireLanguageSelector } from './language-selector.js';
import { localizeEnumOptions } from './modal.js';

export async function shell(
  content: () => Promise<string> | string,
  onMount?: () => void,
) {
  const current = session();
  if (!current) {
    navigate('/login');
    return;
  }
  const role = current.user.role;
  const navigation = [
    ['/today', t('nav.today'), ['OWNER', 'STAFF', 'COACH']],
    ['/schedule', t('nav.schedule'), ['OWNER', 'STAFF', 'COACH']],
    ['/requests', t('nav.requests'), ['OWNER', 'STAFF']],
    ['/reservations', t('nav.reservations'), ['OWNER', 'STAFF']],
    ['/customers', t('nav.customers'), ['OWNER', 'STAFF']],
    ['/finance', t('nav.finance'), ['OWNER', 'STAFF']],
    ['/classes', t('nav.classes'), ['OWNER', 'STAFF', 'COACH']],
    ['/reports', t('nav.reports'), ['OWNER', 'STAFF']],
    ['/staff', t('nav.staff'), ['OWNER']],
    ['/settings', t('nav.settings'), ['OWNER']],
  ] as const;
  app.innerHTML = `<div class="shell"><aside><h1>Court Manager</h1><nav>${navigation.filter((item) => item[2].includes(role as never)).map((item) => `<a href="${item[0]}">${item[1]}</a>`).join('')}</nav><button id="logout" class="link-button">${t('nav.logOut')}</button></aside><main class="content"><header><span>${escapeText(current.organization?.name ?? t('nav.sportsCenter'))}</span><span>${languageSelector()} ${escapeText(current.user.name)}</span></header><section id="screen"><div class="loading">${t('common.loading')}</div></section></main></div>`;
  wireLanguageSelector();
  const queuedToast = sessionStorage.getItem('court-manager-toast');
  if (queuedToast) {
    sessionStorage.removeItem('court-manager-toast');
    const queued = JSON.parse(queuedToast) as {
      message: string;
      kind: 'success' | 'error';
    };
    window.setTimeout(() => renderToast(queued.message, queued.kind), 0);
  }
  app.querySelector('#logout')?.addEventListener('click', async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      setSession(null);
      navigate('/login');
    }
  });
  const target = document.querySelector<HTMLElement>('#screen');
  if (target) {
    target.innerHTML = await content();
    localizeEnumOptions(target);
    onMount?.();
  }
}
