'use strict';
// Tests have been split into focused files. Run them with: npm test
// Each *.test.js file covers one feature area:
//   schema-validator.test.js  – schema validation
//   entity-engine.test.js     – entity engine & buildCore
//   db.test.js                – database CRUD, filters, relations
//   openapi.test.js           – OpenAPI spec generation
//   yaml-loader.test.js       – YAML config loading
//   auth.test.js              – JWT auth & middleware
//   validation.test.js        – request body validation & defaults
//   seeder.test.js            – database seeder
//   upload.test.js            – file upload helpers & sharp integration
//   groups.test.js            – group property serialization & validation
//   settings.test.js          – rate limits, env vars, API limiters
//   sdk.test.js               – backend SDK (createBackendSdk)
//   access-policies.test.js   – access policy enforcement
//   middleware.test.js        – middleware SDK injection
