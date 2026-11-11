// Paged tool results (review round 1): a list tool never returns a silently
// truncated list. Every page says how many items exist and how to get the next.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET = 'mcp-pagination-test-secret-0123456789ab';

const { default: db } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { randomToken, sha256 } = await import('../server/services/mcp/crypto.js');
const { paginate, CursorError } = await import('../server/services/mcp/pagination.js');

// Seeded on top of whatever the fresh database already holds; totals are read back.
const PAGED_APPS = 205;
let APP_COUNT;
let GROUP_COUNT;
let server;
let base;
const tokens = {};

function issueToken(userId) {
  db.prepare("INSERT OR IGNORE INTO mcp_grants (id, user_id, client_id, client_name, scope) VALUES (?, ?, 'pg-client', 'Paging Test', 'frontdoor.read')").run(`grant-${userId}`, userId);
  const token = randomToken();
  db.prepare("INSERT INTO mcp_tokens (token_hash, grant_id, kind, family_id, resource, expires_at) VALUES (?, ?, 'access', 'f', ?, datetime('now', '+10 minutes'))")
    .run(sha256(token), `grant-${userId}`, `${base}/mcp`);
  return token;
}

async function callTool(token, name, args = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-11-25',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const data = raw.split('\n').find((line) => line.startsWith('data: '));
  const body = JSON.parse(data ? data.slice(6) : raw);
  return body.result ?? { isError: true, protocolError: body.error };
}

// Follows nextCursor to the end; asserts every page is consistent on the way.
async function collect(token, name, args, key) {
  const items = [];
  let cursor;
  let pages = 0;
  do {
    const page = (await callTool(token, name, { ...args, ...(cursor ? { cursor } : {}) })).structuredContent;
    items.push(...page[key]);
    assert.equal(page.hasMore, Boolean(page.nextCursor), 'hasMore and nextCursor agree');
    cursor = page.nextCursor;
    pages += 1;
    assert.ok(pages < 50, 'paging terminates');
  } while (cursor);
  return items;
}

const pad = (index) => String(index).padStart(3, '0');

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FRONTEND_URL = base;

  const run = (sql, ...params) => db.prepare(sql).run(...params);
  run("INSERT INTO users (id, email, display_name, role, is_active) VALUES ('p-user', 'p-user@x.test', 'P', 'user', 1), ('p-admin', 'p-admin@x.test', 'A', 'admin_readonly', 1)");
  run("INSERT INTO user_groups (id, name) VALUES ('pg-all', 'All staff')");
  run("INSERT INTO user_group_members (user_id, group_id) VALUES ('p-user', 'pg-all'), ('p-admin', 'pg-all')");
  const insertApp = db.prepare("INSERT INTO apps (id, name, slug, description, target_url, mode, tags, sort_order) VALUES (?, ?, ?, 'Paged app', 'https://x.example.com', 'redirect', ?, 0)");
  const grant = db.prepare("INSERT INTO app_permissions (app_id, group_id) VALUES (?, 'pg-all')");
  const insertGroup = db.prepare('INSERT INTO user_groups (id, name) VALUES (?, ?)');
  db.transaction(() => {
    // Same sort_order and, in pairs, the same name: only a tie-breaker makes the order total.
    for (let index = 0; index < PAGED_APPS; index += 1) {
      insertApp.run(`pa-${pad(index)}`, `App ${pad(Math.floor(index / 2))}`, `app-${pad(index)}`, index % 2 ? '["odd"]' : '[]');
      grant.run(`pa-${pad(index)}`);
    }
    for (let index = 0; index < 204; index += 1) insertGroup.run(`pg-${pad(index)}`, `Team ${pad(index)}`);
  })();
  APP_COUNT = db.prepare('SELECT COUNT(*) AS n FROM apps').get().n;
  GROUP_COUNT = db.prepare('SELECT COUNT(*) AS n FROM user_groups').get().n;
  assert.ok(APP_COUNT > 200 && GROUP_COUNT > 200, 'more items than the maximum limit');
  run("INSERT OR IGNORE INTO mcp_clients (id, kind, client_id, name, redirect_uris, secret_hash, created_by) VALUES ('pg', 'registered', 'pg-client', 'Paging Test', '[\"https://x.example/cb\"]', 'h', 'p-admin')");
  run('UPDATE mcp_settings SET enabled = 1');
  for (const id of ['p-user', 'p-admin']) tokens[id] = issueToken(id);
});

after(() => new Promise((resolve) => server.close(resolve)));

test('paginate: pages, totals and the end of the list', () => {
  const items = Array.from({ length: 5 }, (_, index) => index);
  const first = paginate(items, { limit: 2, scope: 's' });
  assert.deepEqual([first.page, first.total, first.hasMore], [[0, 1], 5, true]);
  const second = paginate(items, { limit: 2, scope: 's', cursor: first.nextCursor });
  assert.deepEqual(second.page, [2, 3]);
  const last = paginate(items, { limit: 2, scope: 's', cursor: second.nextCursor });
  assert.deepEqual([last.page, last.hasMore, last.nextCursor], [[4], false, undefined]);
  const exact = paginate(items, { limit: 5, scope: 's' });
  assert.deepEqual([exact.hasMore, exact.nextCursor], [false, undefined]);
  assert.deepEqual(paginate([], { limit: 5, scope: 's' }), { page: [], total: 0, hasMore: false, nextCursor: undefined });
});

test('paginate: a cursor past the end (items removed meanwhile) is an empty last page', () => {
  const { nextCursor } = paginate([1, 2, 3, 4], { limit: 3, scope: 's' });
  assert.deepEqual(paginate([1, 2], { limit: 3, scope: 's', cursor: nextCursor }), { page: [], total: 2, hasMore: false, nextCursor: undefined });
});

test('paginate: malformed cursors and cursors from another query are refused, never restarted', () => {
  const { nextCursor } = paginate([1, 2, 3], { limit: 1, scope: 'list_apps:all' });
  const forged = (payload) => Buffer.from(JSON.stringify(payload)).toString('base64url');
  for (const cursor of ['', 'not-base64-json', forged({ o: -1 }), forged({ o: 1.5 }), forged([]), forged({ o: '1' }), 'x'.repeat(300)]) {
    assert.throws(() => paginate([1, 2, 3], { limit: 1, scope: 'list_apps:all', cursor }), CursorError, JSON.stringify(cursor));
  }
  assert.throws(() => paginate([1, 2, 3], { limit: 1, scope: 'list_apps:no_tags', cursor: nextCursor }), CursorError);
});

test('list_apps: more apps than limit 200 says how many more exist and the cursor returns exactly them', async () => {
  const first = (await callTool(tokens['p-admin'], 'list_apps', { limit: 200 })).structuredContent;
  assert.equal(first.apps.length, 200);
  assert.deepEqual([first.total, first.hasMore], [APP_COUNT, true]);
  const rest = (await callTool(tokens['p-admin'], 'list_apps', { limit: 200, cursor: first.nextCursor })).structuredContent;
  assert.equal(rest.apps.length, APP_COUNT - 200);
  assert.deepEqual([rest.total, rest.hasMore, rest.nextCursor], [APP_COUNT, false, undefined]);
  const slugs = [...first.apps, ...rest.apps].map((app) => app.slug);
  assert.equal(new Set(slugs).size, APP_COUNT, 'no app repeated or skipped across pages');
});

test('list_apps: the default limit (100) pages through every app; a filter keeps applying on later pages', async () => {
  const first = (await callTool(tokens['p-admin'], 'list_apps')).structuredContent;
  assert.deepEqual([first.apps.length, first.total, first.hasMore], [100, APP_COUNT, true]);
  assert.equal(new Set((await collect(tokens['p-admin'], 'list_apps', {}, 'apps')).map((app) => app.slug)).size, APP_COUNT);
  const untagged = await collect(tokens['p-admin'], 'list_apps', { filter: 'no_tags', limit: 30 }, 'apps');
  assert.equal(untagged.length, db.prepare("SELECT COUNT(*) AS n FROM apps WHERE tags IS NULL OR tags IN ('', '[]')").get().n);
  assert.ok(untagged.every((app) => app.tags.length === 0));
});

test('list_groups: default and maximum limits page through every group', async () => {
  const first = (await callTool(tokens['p-admin'], 'list_groups', { limit: 200 })).structuredContent;
  assert.deepEqual([first.groups.length, first.total, first.hasMore], [200, GROUP_COUNT, true]);
  assert.equal(new Set((await collect(tokens['p-admin'], 'list_groups', {}, 'groups')).map((group) => group.name)).size, GROUP_COUNT);
});

test('search_my_apps: default (20) and maximum (50) limits page through every reachable app', async () => {
  const first = (await callTool(tokens['p-user'], 'search_my_apps')).structuredContent;
  assert.deepEqual([first.apps.length, first.total, first.hasMore], [20, PAGED_APPS, true]);
  const all = await collect(tokens['p-user'], 'search_my_apps', { limit: 50 }, 'apps');
  assert.equal(new Set(all.map((app) => app.slug)).size, PAGED_APPS);
  const odd = await collect(tokens['p-user'], 'search_my_apps', { tag: 'odd', limit: 50 }, 'apps');
  assert.equal(odd.length, Math.floor(PAGED_APPS / 2));
});

test('a cursor from one query used with another is a tool error, not a fresh first page', async () => {
  const { nextCursor } = (await callTool(tokens['p-admin'], 'list_apps', { limit: 10 })).structuredContent;
  const crossed = await callTool(tokens['p-admin'], 'list_apps', { filter: 'no_tags', limit: 10, cursor: nextCursor });
  assert.equal(crossed.isError, true);
  const otherTool = await callTool(tokens['p-admin'], 'list_groups', { cursor: nextCursor });
  assert.equal(otherTool.isError, true);
  const malformed = await callTool(tokens['p-user'], 'search_my_apps', { cursor: 'garbage' });
  assert.equal(malformed.isError, true);
});

test('tool descriptions tell the assistant that lists are paged', async () => {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25', Authorization: `Bearer ${tokens['p-admin']}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const raw = await res.text();
  const data = raw.split('\n').find((line) => line.startsWith('data: '));
  const { tools } = JSON.parse(data ? data.slice(6) : raw).result;
  for (const name of ['list_apps', 'list_groups', 'search_my_apps']) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.match(tool.description, /nextCursor/, name);
    assert.doesNotMatch(tool.description, /every app in the catalogue/, name);
  }
});
