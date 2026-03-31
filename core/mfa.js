'use strict';

/**
 * TOTP-based Multi-Factor Authentication (RFC 6238).
 *
 * Uses only Node.js built-in crypto — no external dependencies.
 */

const crypto = require('crypto');

// ─── Base32 (RFC 4648) ──────────────────────────────────────────────────────

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += BASE32_CHARS[parseInt(chunk, 2)];
  }
  return result;
}

function base32Decode(str) {
  let bits = '';
  for (const c of str.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

// ─── TOTP (RFC 6238) ────────────────────────────────────────────────────────

/** Generate a 20-byte random secret encoded as base32. */
function generateMfaSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Compute a 6-digit TOTP code for the given base32 secret and unix timestamp.
 * @param {string} secret  Base32-encoded secret
 * @param {number} [time]  Unix timestamp in seconds (defaults to now)
 */
function generateTotp(secret, time) {
  const timeStep = Math.floor((time !== undefined ? time : Date.now() / 1000) / 30);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(timeStep, 4);

  const key = base32Decode(secret);
  const hmac = crypto.createHmac('sha1', key).update(timeBuffer).digest();

  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24 |
      hmac[offset + 1] << 16 |
      hmac[offset + 2] << 8 |
      hmac[offset + 3]) % 1000000;

  return code.toString().padStart(6, '0');
}

/**
 * Verify a TOTP code against a secret, allowing ±1 time window for clock drift.
 */
function verifyTotp(secret, code) {
  const now = Math.floor(Date.now() / 1000);
  for (let i = -1; i <= 1; i++) {
    if (generateTotp(secret, now + i * 30) === code) return true;
  }
  return false;
}

// ─── Recovery codes ──────────────────────────────────────────────────────────

/** Generate `count` alphanumeric recovery codes of `length` characters each. */
function generateRecoveryCodes(count = 8, length = 8) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(length).toString('hex').slice(0, length));
  }
  return codes;
}

// ─── OTPAuth URI (for QR codes) ──────────────────────────────────────────────

function buildOtpauthUri(secret, email, issuer) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(email)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  base32Encode,
  base32Decode,
  generateMfaSecret,
  generateTotp,
  verifyTotp,
  generateRecoveryCodes,
  buildOtpauthUri,
};
