// Errors that are safe to expose to API clients verbatim. Anything else is
// downgraded to a generic message in respondWithError, so DB/fs internals
// never leak in 500 responses.
export class UserFacingError extends Error {
  constructor(message, { statusCode = 400, code = null, hint = null } = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
    this.expose = true;
  }
}

export function respondWithError(res, error, fallback = { status: 500, code: 'internal_server_error' }) {
  if (error?.expose && error.statusCode) {
    const body = { error: error.message };
    if (error.hint) body.hint = error.hint;
    if (error.code) body.code = error.code;
    return res.status(error.statusCode).json(body);
  }
  return res.status(fallback.status || 500).json({ error: fallback.code || 'internal_server_error' });
}
