import { expect, test } from '@playwright/test';
import { captureBrowserFailures, loginAs } from './helpers/session.js';

const pluginId = 'e2e-hardened-plugin';
const moduleSource = `
export function register(api) {
  api.registerNavigationItem({
    id: 'e2e-hardened-plugin.nav',
    label: 'Hardened plugin',
    href: '/admin/plugins',
    roles: ['owner'],
  });
}

export function onUnload({ reason }) {
  window.sessionStorage.setItem('e2e-plugin-unload-reason', reason);
}
`;

test.describe('hardened plugin lifecycle', () => {
  test('loads only an approved role-authorised artifact and obeys the global kill switch', async ({ browser }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const browserFailures = captureBrowserFailures(ownerPage);
    await loginAs({ context: ownerContext, page: ownerPage }, 'owner');

    const installResponse = await ownerContext.request.post('/api/plugins/import', {
      data: {
        manifest: {
          id: pluginId,
          name: 'E2E Hardened Plugin',
          version: '1.0.0',
          permissions: ['navigation.write', 'navigation.use'],
          roles: ['owner'],
        },
        moduleSource,
      },
    });
    expect(installResponse.status()).toBe(201);

    const pendingRuntime = await ownerContext.request.get('/api/plugins/runtime');
    expect(await pendingRuntime.json()).toEqual({ plugins: [] });

    const approveResponse = await ownerContext.request.post(`/api/plugins/${pluginId}/approve`);
    expect(approveResponse.ok()).toBeTruthy();
    const approvedPlugin = (await approveResponse.json()).plugin;
    expect(approvedPlugin.approved).toBe(true);
    expect(approvedPlugin.approvedDigest).toBe(approvedPlugin.contentDigest);

    const enableResponse = await ownerContext.request.put('/api/branding', {
      data: { pluginsEnabled: true },
    });
    expect(enableResponse.ok()).toBeTruthy();

    const ownerPluginRequests = [];
    ownerPage.on('request', (request) => {
      if (request.url().includes('/api/plugins/files/')) ownerPluginRequests.push(request.url());
    });
    await ownerPage.goto('/');
    await expect(ownerPage.getByRole('link', { name: 'Hardened plugin' })).toBeVisible();
    expect(ownerPluginRequests).toHaveLength(1);

    await ownerPage.goto('/admin/plugins');
    const pluginCard = ownerPage.locator('article').filter({ hasText: 'E2E Hardened Plugin' });
    await pluginCard.getByRole('button', { name: 'Revoke approval' }).click();
    await expect.poll(
      () => ownerPage.evaluate(() => sessionStorage.getItem('e2e-plugin-unload-reason'))
    ).toBe('approval-revoked');
    await expect(ownerPage.getByRole('link', { name: 'Hardened plugin' })).toHaveCount(0);

    await pluginCard.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(ownerPage.getByRole('link', { name: 'Hardened plugin' })).toBeVisible();

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    const userPluginRequests = [];
    userPage.on('request', (request) => {
      if (request.url().includes('/api/plugins/files/')) userPluginRequests.push(request.url());
    });
    await loginAs({ context: userContext, page: userPage }, 'user');
    await userPage.goto('/');
    await expect(userPage.getByRole('link', { name: 'Hardened plugin' })).toHaveCount(0);
    expect(userPluginRequests).toEqual([]);
    await userContext.close();

    await ownerPage.evaluate(() => sessionStorage.removeItem('e2e-plugin-unload-reason'));
    await ownerPage.goto('/admin/customization');
    await ownerPage.getByLabel('Enable plugins for Frontdoor').selectOption('off');
    await ownerPage.locator('#plugins').getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(
      () => ownerPage.evaluate(() => sessionStorage.getItem('e2e-plugin-unload-reason'))
    ).toBe('disabled');
    await expect(ownerPage.getByRole('link', { name: 'Hardened plugin' })).toHaveCount(0);

    await ownerPage.goto('/admin/plugins');
    await expect(ownerPage).toHaveURL(/\/admin\/plugins$/);
    expect(browserFailures).toEqual([]);
    await expect(ownerPage.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();
    await ownerContext.close();
  });
});
