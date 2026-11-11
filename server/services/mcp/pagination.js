// Paged list results for MCP tools. A list is never silently truncated: each
// page carries the total, whether more items exist and the cursor for the next.
//
// The cursor is an opaque offset bound to the query that produced it (tool and
// filters), so a cursor reused with other arguments is refused instead of
// silently paging a different list. It is not a secret: forging one only moves
// the offset inside a list the caller may already read in full.
import { createHash } from 'node:crypto';

const MAX_CURSOR_LENGTH = 200;

export class CursorError extends Error {}

const fingerprint = (scope) => createHash('sha256').update(scope).digest('base64url').slice(0, 16);

function encode(offset, scope) {
  return Buffer.from(JSON.stringify({ o: offset, s: fingerprint(scope) })).toString('base64url');
}

function decode(cursor, scope) {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) throw new CursorError('invalid cursor');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new CursorError('invalid cursor');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Number.isSafeInteger(payload.o) || payload.o < 0) {
    throw new CursorError('invalid cursor');
  }
  if (payload.s !== fingerprint(scope)) throw new CursorError('cursor from a different query');
  return payload.o;
}

/**
 * @param {Array} items  the full, deterministically ordered list
 * @param {{ limit: number, scope: string, cursor?: string }} options
 *   scope identifies the query (tool name and filters) the cursor belongs to
 */
export function paginate(items, { limit, scope, cursor }) {
  const offset = cursor === undefined ? 0 : decode(cursor, scope);
  const page = items.slice(offset, offset + limit);
  const end = offset + page.length;
  const hasMore = page.length > 0 && end < items.length;
  return { page, total: items.length, hasMore, nextCursor: hasMore ? encode(end, scope) : undefined };
}
