import type {
  CustomerReservationParticipant,
  ReservationParticipantInput,
  ReservationParticipantsPage,
} from '@court-manager/contracts';
import { errorMessage } from '../core/presentation.js';
import { customerRequest } from '../customer-auth.js';
import { t } from '../i18n.js';
import { escapeText } from './runtime.js';

export function wireReservationParticipants(root: HTMLElement) {
  root
    .querySelectorAll<HTMLButtonElement>('[data-reservation-participants]')
    .forEach((button) => {
      button.addEventListener('click', async () => {
        const container = button
          .closest('article')!
          .querySelector<HTMLElement>('[data-participants-panel]')!;
        if (!container.hidden) {
          container.hidden = true;
          button.setAttribute('aria-expanded', 'false');
          return;
        }
        container.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        container.innerHTML = `<p class="loading" role="status">${t('common.loading')}</p>`;
        const base = `/customer/reservations/${encodeURIComponent(button.dataset.reservationParticipants!)}/participants`;
        let rows: CustomerReservationParticipant[] = [];
        let editingId: string | undefined;
        let draftId = crypto.randomUUID();
        let page: ReservationParticipantsPage;
        const load = async (cursor?: string) => {
          page = await customerRequest<ReservationParticipantsPage>(
            `${base}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          );
          rows = cursor ? [...rows, ...page.participants] : page.participants;
          const draft = cursor
            ? container.querySelector<HTMLFormElement>('form')
            : null;
          const values = draft ? new FormData(draft) : null;
          render();
          const form = container.querySelector<HTMLFormElement>('form');
          if (values && form) {
            for (const name of ['name', 'email', 'phone'])
              (form.elements.namedItem(name) as HTMLInputElement).value =
                String(values.get(name) ?? '');
            if (editingId) {
              form.querySelector<HTMLButtonElement>(
                '[type="submit"]',
              )!.textContent = t('portal.saveParticipant');
              form.querySelector<HTMLElement>('[data-cancel-edit]')!.hidden =
                false;
            }
          }
        };
        const render = () => {
          const activeRows = rows.filter((row) => row.status === 'ACTIVE');
          container.innerHTML = `<h4>${t('portal.whoIsPlaying')}</h4><p class="muted">${t('portal.ownerNoNeed')}</p><ul class="portal-participant-list">${activeRows
            .map(
              (row) =>
                `<li><span>${escapeText(row.name)}</span>${page.mutable ? ` <span class="row-actions"><button type="button" class="button small" data-edit-participant="${escapeText(row.participantId)}" aria-label="${escapeText(t('portal.editParticipant', { name: row.name }))}">${t('common.edit')}</button> <button type="button" class="button small danger" data-remove-participant="${escapeText(row.participantId)}" aria-label="${escapeText(t('portal.removeParticipant', { name: row.name }))}">${t('common.delete')}</button></span>` : ''}</li>`,
            )
            .join(
              '',
            )}</ul>${activeRows.length ? '' : `<p class="empty">${t('portal.noParticipants')}</p>`}${page.nextCursor ? `<button type="button" class="button small" data-more-participants>${t('portal.loadMoreParticipants')}</button>` : ''}${page.mutable ? `<form class="form-grid portal-participant-form"><label>${t('portal.participantName')}<input name="name" required maxlength="160"></label><label>${t('portal.participantEmail')}<input name="email" type="email" maxlength="254"></label><label>${t('portal.participantPhone')}<input name="phone" maxlength="40"></label><div class="form-actions full"><button class="button primary" type="submit">${t('portal.addParticipant')}</button><button class="button" type="button" data-cancel-edit hidden>${t('portal.cancelEdit')}</button></div><p class="form-error full" role="alert"></p></form>` : `<p class="muted">${t('portal.participantsReadOnly')}</p>`}<p role="status" aria-live="polite" data-participant-result></p>`;
          const result = container.querySelector<HTMLElement>(
            '[data-participant-result]',
          )!;
          const form = container.querySelector<HTMLFormElement>('form');
          const reset = () => {
            editingId = undefined;
            draftId = crypto.randomUUID();
            form?.reset();
            if (form) {
              form.querySelector<HTMLButtonElement>(
                '[type="submit"]',
              )!.textContent = t('portal.addParticipant');
              form.querySelector<HTMLElement>('[data-cancel-edit]')!.hidden =
                true;
            }
          };
          const run = async (operation: () => Promise<unknown>) => {
            container
              .querySelectorAll<HTMLButtonElement>('button')
              .forEach((control) => {
                control.disabled = true;
              });
            try {
              await operation();
              editingId = undefined;
              draftId = crypto.randomUUID();
              await load();
              container.querySelector<HTMLElement>(
                '[data-participant-result]',
              )!.textContent = t('portal.participantsSaved');
            } catch (error) {
              result.textContent = errorMessage(error);
            } finally {
              container
                .querySelectorAll<HTMLButtonElement>('button')
                .forEach((control) => {
                  control.disabled = false;
                });
            }
          };
          form?.addEventListener('submit', (event) => {
            event.preventDefault();
            const values = new FormData(form);
            const input: ReservationParticipantInput = {
              name: String(values.get('name') ?? '').trim(),
              ...(values.get('email')
                ? { email: String(values.get('email')).trim() }
                : {}),
              ...(values.get('phone')
                ? { phone: String(values.get('phone')).trim() }
                : {}),
            };
            void run(() =>
              customerRequest(`${base}/${editingId ?? draftId}`, {
                method: 'PUT',
                body: JSON.stringify(input),
              }),
            );
          });
          form
            ?.querySelector('[data-cancel-edit]')
            ?.addEventListener('click', reset);
          container
            .querySelectorAll<HTMLButtonElement>('[data-edit-participant]')
            .forEach((control) =>
              control.addEventListener('click', () => {
                const row = rows.find(
                  (item) =>
                    item.participantId === control.dataset.editParticipant,
                );
                if (!row || !form) return;
                editingId = row.participantId;
                for (const name of ['name', 'email', 'phone'] as const)
                  (form.elements.namedItem(name) as HTMLInputElement).value =
                    row[name] ?? '';
                form.querySelector<HTMLButtonElement>(
                  '[type="submit"]',
                )!.textContent = t('portal.saveParticipant');
                form.querySelector<HTMLElement>('[data-cancel-edit]')!.hidden =
                  false;
                (form.elements.namedItem('name') as HTMLInputElement).focus();
              }),
            );
          container
            .querySelectorAll<HTMLButtonElement>('[data-remove-participant]')
            .forEach((control) =>
              control.addEventListener('click', () => {
                void run(() =>
                  customerRequest(
                    `${base}/${control.dataset.removeParticipant}`,
                    { method: 'DELETE' },
                  ),
                );
              }),
            );
          container
            .querySelector('[data-more-participants]')
            ?.addEventListener('click', async () => {
              try {
                await load(page.nextCursor ?? undefined);
              } catch (error) {
                result.textContent = errorMessage(error);
              }
            });
        };
        try {
          await load();
        } catch (error) {
          container.innerHTML = `<p class="error" role="alert">${escapeText(errorMessage(error))}</p>`;
        }
      });
    });
}
