export class AppError extends Error {
  constructor(code, message, { status = 400, details, cause } = {}) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function assert(condition, code, message, options) {
  if (!condition) throw new AppError(code, message, options);
}

export function errorResponse(error) {
  const isExpected = error instanceof AppError;
  return {
    status: isExpected ? error.status : 500,
    body: {
      error: {
        code: isExpected ? error.code : 'INTERNAL_ERROR',
        message: isExpected ? error.message : 'The operation could not be completed.',
        ...(isExpected && error.details !== undefined ? { details: error.details } : {}),
      },
    },
  };
}
