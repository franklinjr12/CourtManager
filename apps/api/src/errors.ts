export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'SCHEDULE_CONFLICT'
  | 'DUPLICATE'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
    public readonly status = code === 'UNAUTHORIZED'
      ? 401
      : code === 'FORBIDDEN'
        ? 403
        : code === 'NOT_FOUND'
          ? 404
          : code === 'SCHEDULE_CONFLICT' ||
              code === 'CONFLICT' ||
              code === 'DUPLICATE'
            ? 409
            : code === 'RATE_LIMITED'
              ? 429
              : code === 'VALIDATION_ERROR'
                ? 400
                : 422,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export const notFound = (entity: string) =>
  new AppError('NOT_FOUND', `${entity} was not found.`);
