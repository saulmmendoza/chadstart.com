'use strict';

/**
 * Playwright global teardown: closes the test server started in global-setup.js.
 */

module.exports = async function globalTeardown() {
  if (global.__TEST_SERVER__) {
    await new Promise((resolve) => global.__TEST_SERVER__.close(resolve));
  }
};
