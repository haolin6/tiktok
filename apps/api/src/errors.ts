export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}

export function validationError(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}
