// @ts-check
'use strict';

/**
 * Browser tests for the Admin UI navigation.
 * Validates that switching between Dashboard, API Keys, Config Editor and an
 * entity shows exactly the right panel and hides all others.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** IDs of every top-level content area in the admin UI. */
const AREAS = ['dashboard-area', 'table-view', 'api-keys-area', 'config-area'];

/**
 * Assert that only `visibleId` is shown; all other areas must be hidden.
 * @param {import('@playwright/test').Page} page
 * @param {string} visibleId
 */
async function assertOnlyAreaVisible(page, visibleId) {
  for (const id of AREAS) {
    const el = page.locator(`#${id}`);
    if (id === visibleId) {
      await expect(el, `#${id} should be visible`).not.toHaveClass(/hidden/);
    } else {
      await expect(el, `#${id} should be hidden`).toHaveClass(/hidden/);
    }
  }
}

// ── Login fixture ─────────────────────────────────────────────────────────────

/**
 * Log in to the admin UI and return once the dashboard is visible.
 * @param {import('@playwright/test').Page} page
 * @param {{ email: string, password: string, collectionName: string }} creds
 */
async function loginToAdmin(page, creds) {
  // The collection input is in a hidden section by default; reveal it first
  const collectionSection = page.locator('#login-collection-section');
  if (await collectionSection.isHidden()) {
    await page.click('#toggle-collection-btn');
  }
  await page.fill('#login-collection', creds.collectionName);
  await page.fill('#login-email', creds.email);
  await page.fill('#login-password', creds.password);
  await page.click('#login-btn');
  // Wait for the login overlay to disappear
  await expect(page.locator('#login-overlay')).toBeHidden({ timeout: 10000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Admin UI – navigation area switching', () => {
  let creds;

  test.beforeAll(() => {
    const stateFile = process.env.TEST_STATE_FILE;
    if (!stateFile || !fs.existsSync(stateFile)) {
      throw new Error('TEST_STATE_FILE not set or missing – was global setup run?');
    }
    creds = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    // Override BASE_URL from state so we target the correct port
    process.env.TEST_BASE_URL = `http://localhost:${creds.port}`;
  });

  test.beforeEach(async ({ page }) => {
    const baseUrl = `http://localhost:${creds.port}`;
    await page.goto(`${baseUrl}/admin`);
    await loginToAdmin(page, creds);
    // The dashboard is selected by default after login
    await expect(page.locator('#dashboard-area')).not.toHaveClass(/hidden/, { timeout: 10000 });
  });

  test('Dashboard shows only dashboard-area', async ({ page }) => {
    // Already on dashboard after login; verify it explicitly
    await page.click('#nav-dashboard-item');
    await assertOnlyAreaVisible(page, 'dashboard-area');
  });

  test('API Keys shows only api-keys-area', async ({ page }) => {
    await page.click('#nav-apikeys-item');
    await expect(page.locator('#api-keys-area')).not.toHaveClass(/hidden/);
    await assertOnlyAreaVisible(page, 'api-keys-area');
  });

  test('Config Editor shows only config-area', async ({ page }) => {
    await page.click('#nav-config-item');
    await expect(page.locator('#config-area')).not.toHaveClass(/hidden/);
    await assertOnlyAreaVisible(page, 'config-area');
  });

  test('Clicking an entity shows only table-view', async ({ page }) => {
    // Wait for the sidebar to be populated with entities
    await expect(page.locator('#nav-entities')).not.toBeEmpty({ timeout: 5000 });
    const firstEntity = page.locator('#nav-entities .nav-item').first();
    await expect(firstEntity).toBeVisible();
    await firstEntity.click();
    await expect(page.locator('#table-view')).not.toHaveClass(/hidden/);
    await assertOnlyAreaVisible(page, 'table-view');
  });

  test('Switching from entity to API Keys hides table-view', async ({ page }) => {
    // Navigate to an entity first
    await expect(page.locator('#nav-entities')).not.toBeEmpty({ timeout: 5000 });
    await page.locator('#nav-entities .nav-item').first().click();
    await expect(page.locator('#table-view')).not.toHaveClass(/hidden/);

    // Now switch to API Keys
    await page.click('#nav-apikeys-item');
    await assertOnlyAreaVisible(page, 'api-keys-area');
  });

  test('Switching from API Keys back to an entity shows table-view', async ({ page }) => {
    // Go to API Keys
    await page.click('#nav-apikeys-item');
    await assertOnlyAreaVisible(page, 'api-keys-area');

    // Go back to an entity
    await expect(page.locator('#nav-entities')).not.toBeEmpty({ timeout: 5000 });
    await page.locator('#nav-entities .nav-item').first().click();
    await assertOnlyAreaVisible(page, 'table-view');
  });
});
