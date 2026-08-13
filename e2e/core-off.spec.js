import { expect, test } from '@playwright/test';
import {
  captureBrowserFailures,
  loginAs,
  skipTourIfVisible,
} from './helpers/session.js';

test.describe('FrontDoor core with plugins disabled', () => {
  test('protects core routes and never bootstraps plugins for an anonymous user', async ({ page, request }) => {
    const pluginRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/plugins/runtime') || req.url().includes('/api/plugins/files/')) {
        pluginRequests.push(req.url());
      }
    });

    await page.goto('/admin');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Frontdoor' })).toBeVisible();
    await expect(page.getByText('Dev Login')).toBeVisible();
    expect(pluginRequests).toEqual([]);

    const runtimeResponse = await request.get('/api/plugins/runtime');
    expect(runtimeResponse.status()).toBe(401);

    const assetResponse = await request.get('/api/plugins/files/not-present/index.mjs');
    expect(assetResponse.status()).toBe(401);
  });

  test('supports the real dev-login UI without plugin activity', async ({ page }) => {
    const browserFailures = captureBrowserFailures(page);
    const pluginRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/plugins/runtime') || req.url().includes('/api/plugins/files/')) {
        pluginRequests.push(req.url());
      }
    });

    await page.goto('/login');
    await page.getByRole('button', { name: 'Owner', exact: true }).click();
    await page.getByRole('button', { name: 'Enter as Owner' }).click();
    await expect(page).toHaveURL(/\/$/);
    await skipTourIfVisible(page);

    await expect(page.getByPlaceholder('Search an application...')).toBeVisible();
    await expect(page.getByText('Demo App', { exact: true })).toBeVisible();
    expect(pluginRequests).toEqual([]);
    expect(browserFailures).toEqual([]);
  });

  test('keeps owner catalogue, search, admin and fallback routes functional', async ({ context, page }) => {
    const browserFailures = captureBrowserFailures(page);
    await loginAs({ context, page }, 'owner');

    await page.goto('/');
    await expect(page.getByText('Demo App', { exact: true })).toBeVisible();
    await expect(page.getByText('Dashboard', { exact: true })).toBeVisible();
    await expect(page.getByText('Docs', { exact: true })).toBeVisible();

    const search = page.getByPlaceholder('Search an application...');
    await search.fill('Docs');
    await expect(page.getByText('Docs', { exact: true })).toBeVisible();
    await expect(page.getByText('Demo App', { exact: true })).toBeHidden();

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Apps management' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New app' })).toBeVisible();

    await page.goto('/admin/plugins');
    await expect(page).toHaveURL(/\/admin\/plugins$/);
    await expect(page.getByRole('heading', { name: 'Plugins', exact: true })).toBeVisible();

    await page.goto('/route-that-does-not-exist');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByPlaceholder('Search an application...')).toBeVisible();
    expect(browserFailures).toEqual([]);
  });

  test('preserves read-only admin and standard-user role boundaries', async ({ browser }) => {
    const readOnlyContext = await browser.newContext();
    const readOnlyPage = await readOnlyContext.newPage();
    await loginAs({ context: readOnlyContext, page: readOnlyPage }, 'admin_readonly');
    await readOnlyPage.goto('/admin');
    await expect(readOnlyPage.getByRole('heading', { name: 'Apps management' })).toBeVisible();
    await expect(readOnlyPage.getByText('This page is read-only.')).toBeVisible();
    await readOnlyPage.goto('/admin/customization');
    await expect(readOnlyPage).toHaveURL(/\/$/);
    await readOnlyContext.close();

    const userContext = await browser.newContext();
    const userPage = await userContext.newPage();
    await loginAs({ context: userContext, page: userPage }, 'user');
    await userPage.goto('/admin');
    await expect(userPage).toHaveURL(/\/$/);
    await expect(userPage.getByPlaceholder('Search an application...')).toBeVisible();
    await expect(userPage.getByRole('link', { name: 'Apps', exact: true })).toHaveCount(0);
    await userContext.close();
  });

  test('logs out cleanly and invalidates the browser session', async ({ context, page }) => {
    await loginAs({ context, page }, 'owner');
    await page.goto('/');

    await page.locator('#frontdoor-account-menu-button').click();
    await page.getByRole('button', { name: 'Sign out' }).click();

    await page.waitForURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Frontdoor' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('frontdoor_user'))).toBeNull();
    const meResponse = await context.request.get('/api/auth/me');
    expect(meResponse.status()).toBe(401);
  });
});
