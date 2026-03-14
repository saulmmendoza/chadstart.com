'use strict';

const assert = require('assert');
const { getAiProvider, isAiConfigured } = require('../server/express-server');

// Save originals so we can restore after each test
const ENV_KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY'];
function clearAiEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

describe('AI provider detection', () => {
  beforeEach(clearAiEnv);
  after(clearAiEnv);

  it('returns null when no AI keys are set', () => {
    assert.strictEqual(getAiProvider(), null);
  });

  it('returns "openai" when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.strictEqual(getAiProvider(), 'openai');
  });

  it('returns "anthropic" when ANTHROPIC_API_KEY is set', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    assert.strictEqual(getAiProvider(), 'anthropic');
  });

  it('returns "google" when GOOGLE_API_KEY is set', () => {
    process.env.GOOGLE_API_KEY = 'gkey';
    assert.strictEqual(getAiProvider(), 'google');
  });

  it('returns "google" when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'gemini-key';
    assert.strictEqual(getAiProvider(), 'google');
  });

  it('returns "openrouter" when OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    assert.strictEqual(getAiProvider(), 'openrouter');
  });

  it('openai takes priority over anthropic when both are set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    assert.strictEqual(getAiProvider(), 'openai');
  });

  it('anthropic takes priority over google when openai is absent', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.GOOGLE_API_KEY = 'gkey';
    assert.strictEqual(getAiProvider(), 'anthropic');
  });

  it('google takes priority over openrouter when neither openai nor anthropic are set', () => {
    process.env.GOOGLE_API_KEY = 'gkey';
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    assert.strictEqual(getAiProvider(), 'google');
  });
});

describe('isAiConfigured', () => {
  beforeEach(clearAiEnv);
  after(clearAiEnv);

  it('returns false when no keys are set', () => {
    assert.strictEqual(isAiConfigured(), false);
  });

  it('returns true when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    assert.strictEqual(isAiConfigured(), true);
  });

  it('returns true when OPENROUTER_API_KEY is set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test';
    assert.strictEqual(isAiConfigured(), true);
  });
});
