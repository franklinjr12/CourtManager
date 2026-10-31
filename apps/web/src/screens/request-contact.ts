import { dateValue, timeValue } from '../core/presentation.js';
import type { Court, RequestItem } from '../core/types.js';
import { button } from '../dom.js';
import { t } from '../i18n.js';
import { toast } from '../ui/feedback.js';
import { escapeText, session } from './runtime.js';

export type RequestContactContext = { venueName: string; courtName: string };

export function normalizeWhatsAppPhone(phone: string): string | null {
  let digits = phone.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits) return null;
  if (phone.trim().startsWith('+')) return digits;
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13)
    return digits;
  // Assumption (CM-004, to confirm with product owner): numbers without a country code are Brazilian (+55).
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

export function requestConfirmationMessage(input: {
  customerName?: string;
  venueName: string;
  courtName: string;
  date: string;
  startTime: string;
  durationMinutes: number;
}): string {
  return t('requests.confirmationMessage', {
    name: input.customerName ?? '',
    venue: input.venueName,
    court: input.courtName,
    date: input.date,
    time: input.startTime,
    duration: input.durationMinutes,
  });
}

export const whatsAppUrl = (phoneDigits: string, message: string) =>
  `https://wa.me/${phoneDigits}?text=${encodeURIComponent(message)}`;

export function requestContactContext(
  courts: Court[],
  item: RequestItem,
): RequestContactContext {
  return {
    venueName: session()?.organization?.name ?? '',
    courtName:
      courts.find((court) => court.courtId === item.courtId)?.name ??
      item.courtId,
  };
}

const messageFor = (item: RequestItem, context: RequestContactContext) =>
  requestConfirmationMessage({
    customerName: item.customerName,
    venueName: context.venueName,
    courtName: context.courtName,
    date: dateValue(item.requestedStartAt),
    startTime: timeValue(item.requestedStartAt),
    durationMinutes: Math.round(
      (new Date(item.requestedEndAt).getTime() -
        new Date(item.requestedStartAt).getTime()) /
        60000,
    ),
  });

export function requestContactActions(
  item: RequestItem,
  context: RequestContactContext,
): string {
  const digits = normalizeWhatsAppPhone(item.phone);
  const href = digits ? whatsAppUrl(digits, messageFor(item, context)) : '';
  return `<div class="form-actions full" data-request-contact>${item.phone.trim() ? button(t('requests.copyPhone'), 'data-copy-phone') : ''}${button(t('requests.copyName'), 'data-copy-name')}${button(t('requests.copyMessage'), 'data-copy-message')}${digits ? `<a class="button primary" data-open-whatsapp target="_blank" rel="noopener noreferrer" href="${escapeText(href)}">${t('requests.openWhatsApp')}</a>` : ''}</div>`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t('requests.copied'));
  } catch {
    toast(t('requests.copyFailed'), 'error');
  }
}

export function wireRequestContactActions(
  root: ParentNode,
  item: RequestItem,
  context: RequestContactContext,
) {
  const on = (selector: string, text: () => string) =>
    root
      .querySelector(`[data-request-contact] ${selector}`)
      ?.addEventListener('click', () => void copy(text()));
  on('[data-copy-phone]', () => item.phone);
  on('[data-copy-name]', () => item.customerName);
  on('[data-copy-message]', () => messageFor(item, context));
}
