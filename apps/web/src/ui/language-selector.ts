import { getAppContext } from '../app/context.js';
import { getLocale, setLocale, t, type Locale } from '../i18n.js';

export const languageSelector = () =>
  `<label class="language-selector"><span class="sr-only">${t('common.language')}</span><select class="language-control" data-language-selector aria-label="${t('common.language')}"><option value="pt-BR" ${getLocale() === 'pt-BR' ? 'selected' : ''}>${t('common.portugueseBrazil')}</option><option value="en-US" ${getLocale() === 'en-US' ? 'selected' : ''}>${t('common.englishUS')}</option></select></label>`;

export const wireLanguageSelector = () => {
  const { app, renderRoute } = getAppContext();
  app.querySelector<HTMLSelectElement>('[data-language-selector]')?.addEventListener('change', (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!['pt-BR', 'en-US'].includes(value)) return;
    setLocale(value as Locale);
    void renderRoute();
  });
};
