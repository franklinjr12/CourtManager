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
  app.innerHTML = `<div class="shell"><aside><h1>Court Manager</h1><nav><a href="/dashboard">${t('nav.dashboard')}</a><a href="/schedule">${t('nav.schedule')}</a><a href="/requests">${t('nav.requests')}</a><a href="/reservations">${t('nav.reservations')}</a><a href="/customers">${t('nav.customers')}</a><a href="/finance">${t('nav.finance')}</a><a href="/classes">${t('nav.classes')}</a><a href="/reports">${t('nav.reports')}</a><a href="/settings">${t('nav.settings')}</a></nav><button id="logout" class="link-button">${t('nav.logOut')}</button></aside><main class="content"><header><span>${escapeText(current.organization?.name ?? t('nav.sportsCenter'))}</span><span>${languageSelector()} ${escapeText(current.user.name)}</span></header><section id="screen"><div class="loading">${t('common.loading')}</div></section></main></div>`;
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

