import type { Session } from '../core/types.js';
import { t } from '../i18n.js';
import { formData, setBusy, showFormError } from '../ui/forms.js';
import {
  languageSelector,
  wireLanguageSelector,
} from '../ui/language-selector.js';
import { app, navigate, request, setSession } from './runtime.js';

export function login() {
  app.innerHTML = `<main class="login"><form id="login-form" class="card"><div class="login-head"><h1>Court Manager</h1>${languageSelector()}</div><p class="muted">${t('login.subtitle')}</p><label>${t('common.email')}<input name="email" type="email" required autocomplete="email"></label><label>${t('login.password')}<input name="password" type="password" required autocomplete="current-password"></label><button class="button primary">${t('login.submit')}</button><p id="login-error" class="error" role="alert"></p></form></main>`;
  wireLanguageSelector();
  app
    .querySelector<HTMLFormElement>('#login-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      setBusy(form, true);
      try {
        const data = await request<Session>('/auth/login', {
          method: 'POST',
          body: JSON.stringify(formData(form)),
        });
        setSession(data);
        navigate('/today');
      } catch (error) {
        showFormError(form, error);
        setBusy(form, false);
      }
    });
}
