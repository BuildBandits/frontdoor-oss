import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { serveAvatarForUser } from '../server/services/avatars.js';

function createResponse() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      this.ended = true;
    },
    sendFile(filePath) {
      this.sentFilePath = filePath;
    },
    send(body) {
      this.body = body;
    },
  };
}

describe('avatar fallback rendering', () => {
  it('serves an initials placeholder instead of a 404 when no cached avatar exists', async () => {
    const res = createResponse();

    await serveAvatarForUser({
      id: 'missing-avatar-user-for-test',
      display_name: 'Ada Lovelace',
      email: 'ada.lovelace@example.com',
      avatar_color: '#123456',
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    const body = Buffer.isBuffer(res.body) ? res.body.toString('utf8') : String(res.body || '');
    assert.match(body, /Ada Lovelace avatar/);
    assert.match(body, />AL</);
    assert.match(body, /#123456/);
  });
});
