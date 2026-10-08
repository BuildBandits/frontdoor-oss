// Errors that are safe to expose to API clients verbatim. Anything else is
// downgraded to a generic message in respondWithError, so DB/fs internals
// never leak in 500 responses.
export class UserFacingError extends Error {
  constructor(message, { statusCode = 400, code = null, hint = null, details = null } = {}) {
    super(message);
    this.name = 'UserFacingError';
    this.statusCode = statusCode;
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.expose = true;
  }
}

// "failed_to_update_branding" -> "Failed to update branding"
function humanizeCode(code) {
  const text = String(code || 'internal_server_error').replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function respondWithError(res, error, fallback = { status: 500, code: 'internal_server_error' }) {
  if (error?.expose && error.statusCode) {
    const body = { error: error.message };
    if (error.hint) body.hint = error.hint;
    if (error.code) body.code = error.code;
    if (error.details) body.details = error.details;
    return res.status(error.statusCode).json(body);
  }
  const code = fallback.code || 'internal_server_error';
  return res.status(fallback.status || 500).json({ error: fallback.message || humanizeCode(code), code });
}
