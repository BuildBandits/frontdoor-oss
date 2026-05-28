import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import db from '../server/db.js';
import {
  approvePluginRegistry,
  dispatchPluginEvent,
  getRuntimePlugins,
  upsertPluginRegistry,
} from '../server/services/plugins.js';

beforeEach(() => {
  db.prepare('DELETE FROM plugin_registry').run();
  db.prepare("UPDATE branding_settings SET plugins_enabled = 0 WHERE id = 'default'").run();
});

test('pending plugins stay out of runtime and backend delivery until approved', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    return { ok: true, status: 200 };
  };

  try {
    upsertPluginRegistry({
      id: 'ticket-plugin',
      name: 'Ticket Plugin',
      version: '1.0.0',
      entry: 'https://plugins.example.com/plugin.mjs',
      backendEnabled: true,
      backendUrl: 'https://plugins.example.com/webhook',
      eventSubscriptions: ['auth.login'],
      approved: false,
    });

    assert.equal(getRuntimePlugins().length, 0);

    const pendingSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' });
    assert.equal(fetchCalls, 0);
    assert.equal(pendingSummary.attempted, 0);
    assert.equal(pendingSummary.delivered, 0);
    assert.equal(pendingSummary.failed, 0);

    const approvedPlugin = approvePluginRegistry('ticket-plugin', 'owner-1');
    assert.equal(approvedPlugin?.approved, true);
    assert.equal(getRuntimePlugins().length, 0);

    const approvedSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' });
    assert.equal(fetchCalls, 0);
    assert.equal(approvedSummary.attempted, 0);
    assert.equal(approvedSummary.delivered, 0);
    assert.equal(approvedSummary.failed, 0);

    db.prepare("UPDATE branding_settings SET plugins_enabled = 1 WHERE id = 'default'").run();
    assert.equal(getRuntimePlugins().length, 1);

    const enabledSummary = await dispatchPluginEvent('auth.login', { userId: 'u-1' });
    assert.equal(fetchCalls, 1);
    assert.equal(enabledSummary.attempted, 1);
    assert.equal(enabledSummary.delivered, 1);
    assert.equal(enabledSummary.failed, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
