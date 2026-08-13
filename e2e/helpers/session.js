import { expect } from '@playwright/test';

export async function loginAs({ context, page }, role) {
  const loginResponse = await context.request.post('/api/auth/dev-login', {
    data: { role },
  });
  expect(loginResponse.ok()).toBeTruthy();

  const preferencesResponse = await context.request.put('/api/auth/me/preferences', {
    data: { homeTourSeenAt: new Date().toISOString() },
  });
  expect(preferencesResponse.ok()).toBeTruthy();
  const { user } = await preferencesResponse.json();

  await page.goto('/login');
  await page.evaluate((cachedUser) => {
    window.localStorage.setItem('frontdoor_user', JSON.stringify(cachedUser));
  }, user);

  return user;
}

export function captureBrowserFailures(page) {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      failures.push(`console: ${message.text()}`);
    }
  });

  return failures;
}

export async function skipTourIfVisible(page) {
  const skipButton = page.getByRole('button', { name: 'Skip tour' });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
  }
}
