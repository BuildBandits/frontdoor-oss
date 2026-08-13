import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  dispatchPluginEvent,
  getRuntimePlugins,
  importPluginBundle,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
});

test('pending plugins stay out of runtime and backend delivery until approved', async () => {
  let deliveryCalls = 0;
  const deliveryTransport = async () => {
    deliveryCalls += 1;
    return { ok: true, status: 200 };
  };

  await importPluginBundle({
      manifest: {
        id: 'ticket-plugin',
        name: 'Ticket Plugin',
        version: '1.0.0',
      },
      moduleSource: 'export function register() {}',
      backendEnabled: true,
      backendUrl: 'https://plugins.example.com/webhook',
      eventSubscriptions: ['auth.login'],
    });

    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 0);

    const pendingSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' }, { deliveryTransport });
    assert.equal(deliveryCalls, 0);
    assert.equal(pendingSummary.attempted, 0);
    assert.equal(pendingSummary.delivered, 0);
    assert.equal(pendingSummary.failed, 0);

    const approvedPlugin = approvePluginRegistry('ticket-plugin', 'owner-1');
    assert.equal(approvedPlugin?.approved, true);
    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 0);

    const approvedSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' }, { deliveryTransport });
    assert.equal(deliveryCalls, 0);
    assert.equal(approvedSummary.attempted, 0);
    assert.equal(approvedSummary.delivered, 0);
    assert.equal(approvedSummary.failed, 0);

    db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
    assert.equal(getRuntimePlugins({ role: 'owner' }).length, 1);

    const enabledSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' }, { deliveryTransport });
    assert.equal(deliveryCalls, 1);
    assert.equal(enabledSummary.attempted, 1);
    assert.equal(enabledSummary.delivered, 1);
    assert.equal(enabledSummary.failed, 0);
});

test('backend events expose only the documented minimal payload', async () => {
  let deliveredBody;
  await importPluginBundle({
    manifest: {
      id: 'privacy-plugin',
      name: 'Privacy Plugin',
      version: '1.0.0',
    },
    moduleSource: 'export function register() {}',
    backendEnabled: true,
    backendUrl: 'https://plugins.example.com/webhook',
    eventSubscriptions: ['auth.login'],
  });
  approvePluginRegistry('privacy-plugin', 'owner-1');
  db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();

  const summary = await dispatchPluginEvent('auth.login', {
    user: {
      id: 'user-1',
      role: 'user',
      email: 'private@example.com',
      displayName: 'Private User',
    },
    auth: {
      via: 'microsoft',
      isNewUser: true,
      microsoftId: 'entra-private-id',
    },
    source: 'must-not-leak',
  }, {
    actorId: 'user-1',
    source: 'internal-call-site',
    deliveryTransport: async ({ body }) => {
      deliveredBody = JSON.parse(body);
      return { ok: true, status: 204 };
    },
  });

  assert.equal(summary.delivered, 1);
  assert.deepEqual(deliveredBody.payload, {
    user: { id: 'user-1', role: 'user' },
    auth: { via: 'microsoft', isNewUser: true },
  });
  assert.deepEqual(deliveredBody.context, { testMode: false });
  assert.equal(JSON.stringify(deliveredBody).includes('private@example.com'), false);
  assert.equal(JSON.stringify(deliveredBody).includes('entra-private-id'), false);
  assert.equal(JSON.stringify(deliveredBody).includes('internal-call-site'), false);
});

test('backend events reject wildcard subscriptions and unknown event names', async () => {
  await assert.rejects(
    importPluginBundle({
      manifest: { id: 'wildcard-plugin', name: 'Wildcard Plugin', version: '1.0.0' },
      moduleSource: 'export function register() {}',
      backendEnabled: true,
      backendUrl: 'https://plugins.example.com/webhook',
      eventSubscriptions: ['*'],
    }),
    /Unsupported plugin event subscription/
  );

  await assert.rejects(
    dispatchPluginEvent('internal.secret.event', {}),
    /Unsupported plugin event/
  );
});

test('backend secrets stay encrypted in SQLite and are only decrypted for delivery', async () => {
  const previousKey = process.env.PLUGIN_SECRET_ENCRYPTION_KEY;
  process.env.PLUGIN_SECRET_ENCRYPTION_KEY = 'test-only-plugin-secret-key-material-123456789';
  try {
    const plugin = await importPluginBundle({
      manifest: { id: 'secret-plugin', name: 'Secret Plugin', version: '1.0.0' },
      moduleSource: 'export function register() {}',
      backendEnabled: true,
      backendUrl: 'https://plugins.example.com/webhook',
      backendSecret: 'private-webhook-secret',
      eventSubscriptions: ['auth.login'],
    });
    const stored = db.prepare('SELECT backend_secret FROM plugin_registry WHERE id = ?').get('secret-plugin');
    assert.match(stored.backend_secret, /^enc:v1:/);
    assert.equal(stored.backend_secret.includes('private-webhook-secret'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(plugin, 'backendSecret'), false);

    approvePluginRegistry('secret-plugin', 'owner-1');
    db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
    let deliveredSecret;
    await dispatchPluginEvent('auth.login', { userId: 'user-1' }, {
      deliveryTransport: async ({ headers }) => {
        deliveredSecret = headers['X-Frontdoor-Plugin-Secret'];
        return { ok: true, status: 200 };
      },
    });
    assert.equal(deliveredSecret, 'private-webhook-secret');
  } finally {
    if (previousKey === undefined) delete process.env.PLUGIN_SECRET_ENCRYPTION_KEY;
    else process.env.PLUGIN_SECRET_ENCRYPTION_KEY = previousKey;
  }
});
