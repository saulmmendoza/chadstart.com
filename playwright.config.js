// @ts-check
'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  globalSetup:    require.resolve('./test/browser/global-setup.js'),
  globalTeardown: require.resolve('./test/browser/global-teardown.js'),
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:4321',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
