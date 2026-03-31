'use strict';

const https = require('https');
const http = require('http');
const logger = require('../utils/logger');

let _config = null;

/**
 * Initialize the SMS service from config.
 * @param {object} config  sms config section: { provider: 'twilio'|'http', url? }
 */
function initSms(config) {
  _config = config || null;
  if (_config) {
    logger.info('SMS service initialized' + (_config.provider ? ` (provider: ${_config.provider})` : ''));
  }
}

/**
 * Send an SMS message.
 * @param {string} to       Phone number (E.164 format preferred)
 * @param {string} message  Message body
 */
async function sendSms(to, message) {
  if (!_config) throw new Error('SMS service not configured');

  const provider = (_config.provider || 'http').toLowerCase();

  if (provider === 'twilio') {
    return _sendTwilio(to, message);
  }
  return _sendHttp(to, message);
}

/** Send via Twilio REST API. */
function _sendTwilio(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) throw new Error('Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER)');

  const data = new URLSearchParams({ To: to, From: from, Body: message }).toString();
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.twilio.com',
      port: 443,
      path: `/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`Twilio error ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Send via generic HTTP webhook. */
function _sendHttp(to, message) {
  const url = _config.url;
  if (!url) throw new Error('SMS HTTP provider URL not configured');

  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const data = JSON.stringify({ to, message });

  return new Promise((resolve, reject) => {
    const mod = isHttps ? https : http;
    const req = mod.request({
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
        else reject(new Error(`SMS HTTP error ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Check if SMS is configured. */
function getSmsStatus() {
  if (!_config) return { configured: false };
  return { configured: true, provider: _config.provider || 'http' };
}

module.exports = { initSms, sendSms, getSmsStatus };
