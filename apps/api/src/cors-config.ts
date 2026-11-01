export const DEFAULT_DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export const parseAllowedOrigins = (raw: string | undefined): string[] => {
  const origins = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter((entry) => entry !== '' && entry !== '*');
  return origins.length > 0 ? origins : DEFAULT_DEV_ORIGINS;
};

export const resolveAllowedOrigins = (
  env: Record<string, string | undefined> = process.env,
): string[] => parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
