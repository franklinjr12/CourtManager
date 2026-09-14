let phoneSeq = 0;

export function uniqueEmail(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.trunc(Math.random() * 1e6)}@example.test`;
}

export function uniquePhone() {
  phoneSeq += 1;
  return `41${String(Date.now()).slice(-7)}${String(phoneSeq).padStart(2, '0')}`;
}

export function uniqueName(prefix: string) {
  return `${prefix} ${Date.now()}`;
}

export const PORTAL_PASSWORD = 'portal-password';

export function tokenFromLink(link: string) {
  return new URL(link, 'http://localhost:5173').searchParams.get('token');
}
