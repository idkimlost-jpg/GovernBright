export class NotFoundError extends Error {
  readonly statusCode = 404;
}

export class ConflictError extends Error {
  readonly statusCode = 409;
}
