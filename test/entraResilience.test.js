import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ConfidentialClientApplication } from '@azure/msal-node';

process.env.ENTRA_GROUP_SYNC = 'true';
process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
process.env.AZURE_CLIENT_SECRET = 'test-secret';
process.env.AZURE_TENANT_ID = '00000000-0000-0000-0000-000000000002';

const { default: db } = await import('../server/db.js');
const { isEntraUserDeleted, refreshGroupCacheFromTenant, resetTenantRefreshTimer } = await import('../server/services/entraGroups.js');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetTenantRefreshTimer();
});

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

test('Graph throttling is retried as Graph asks before giving up', async () => {
  const responses = [
    json(429, { error: { code: 'TooManyRequests' } }, { 'Retry-After': '0' }),
    json(503, { error: { code: 'ServiceUnavailable' } }, { 'Retry-After': '0' }),
    json(200, { value: [] }),
  ];
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return responses.shift(); };
  assert.equal(await isEntraUserDeleted('user-1', { acquireToken: async () => 'token' }), false);
  assert.equal(calls, 3);

  calls = 0;
  globalThis.fetch = async () => { calls += 1; return json(429, {}, { 'Retry-After': '0' }); };
  assert.equal(await isEntraUserDeleted('user-1', { acquireToken: async () => 'token' }), false);
  assert.equal(calls, 4, 'stops after the maximum number of attempts');
});

test('the tenant group catalog is refreshed at most once per interval, and concurrent sign-ins share it', async (t) => {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'app-token' }));
  let pages = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/groups?')) {
      pages += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json(200, { value: [{ id: 'tenant-g1', displayName: 'Tenant Group' }] });
    }
    return realFetch(url);
  };

  const [first, second] = await Promise.all([refreshGroupCacheFromTenant(), refreshGroupCacheFromTenant()]);
  assert.equal(pages, 1);
  assert.deepEqual([first.skipped, second.skipped], [false, false]);
  assert.equal(db.prepare("SELECT display_name FROM entra_group_cache WHERE entra_group_id = 'tenant-g1'").get().display_name, 'Tenant Group');

  const third = await refreshGroupCacheFromTenant();
  assert.equal(third.skipped, true);
  assert.equal(pages, 1);

  await refreshGroupCacheFromTenant({ force: true });
  assert.equal(pages, 2);
});

test('unchanged tenant groups are not rewritten on every refresh', async (t) => {
  t.mock.method(ConfidentialClientApplication.prototype, 'acquireTokenByClientCredential', async () => ({ accessToken: 'app-token' }));
  globalThis.fetch = async () => json(200, { value: [{ id: 'tenant-g2', displayName: 'Stable Group', description: 'Same' }] });

  await refreshGroupCacheFromTenant({ force: true });
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('UPDATE entra_group_cache SET last_seen_at = ? WHERE entra_group_id = ?').run(anHourAgo, 'tenant-g2');

  // Seen again within a day with the same data: the row is left alone.
  await refreshGroupCacheFromTenant({ force: true });
  assert.equal(db.prepare("SELECT last_seen_at FROM entra_group_cache WHERE entra_group_id = 'tenant-g2'").get().last_seen_at, anHourAgo);

  // A renamed group is updated.
  globalThis.fetch = async () => json(200, { value: [{ id: 'tenant-g2', displayName: 'Renamed Group', description: 'Same' }] });
  await refreshGroupCacheFromTenant({ force: true });
  const row = db.prepare("SELECT display_name, last_seen_at FROM entra_group_cache WHERE entra_group_id = 'tenant-g2'").get();
  assert.equal(row.display_name, 'Renamed Group');
  assert.notEqual(row.last_seen_at, anHourAgo);
});
