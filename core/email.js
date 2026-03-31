'use strict';

/**
 * Email sending service for ChadStart.
 *
 * SMTP connection details can be configured in the YAML `email` section
 * or via environment variables (env vars always take precedence):
 *
 *   SMTP_HOST      SMTP server hostname
 *   SMTP_PORT      SMTP server port (default: 587)
 *   SMTP_USER      SMTP username / login
 *   SMTP_PASS      SMTP password (secret — env var only)
 *   SMTP_FROM      Default "From" address (e.g. "App <noreply@example.com>")
 *
 * Templates support simple {{variable}} interpolation.
 */

const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

/** @type {import('nodemailer').Transporter | null} */
let _transporter = null;

/** @type {{ host: string, port: number, from: string, secure: boolean } | null} */
let _emailConfig = null;

/**
 * Derive email/SMTP configuration from YAML + environment variables.
 * Returns null when no SMTP host is configured (email sending is disabled).
 *
 * @param {object|null} emailYaml  Value of `core.email` (may be null).
 * @returns {{ host: string, port: number, user: string, pass: string, from: string, secure: boolean } | null}
 */
function getEmailConfig(emailYaml) {
  const cfg = emailYaml || {};

  const host = process.env.SMTP_HOST || cfg.host || '';
  if (!host) return null;

  const port = parseInt(process.env.SMTP_PORT || cfg.port || '587', 10);
  const user = process.env.SMTP_USER || cfg.username || '';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || cfg.from || '';
  const secure = cfg.secure !== undefined
    ? cfg.secure
    : port === 465;

  return { host, port, user, pass, from, secure };
}

/**
 * Initialize the email transporter.
 * Safe to call multiple times (recreates on each call for hot-reload support).
 *
 * @param {object|null} emailYaml  Value of `core.email` (may be null).
 * @returns {{ host: string, port: number, from: string, secure: boolean } | null}  The resolved config, or null if disabled.
 */
function initEmail(emailYaml) {
  _transporter = null;
  _emailConfig = null;

  const cfg = getEmailConfig(emailYaml);
  if (!cfg) {
    logger.info('  Email/SMTP not configured — email sending disabled.');
    return null;
  }

  const transportOpts = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
  };

  if (cfg.user) {
    transportOpts.auth = { user: cfg.user, pass: cfg.pass };
  }

  _transporter = nodemailer.createTransport(transportOpts);
  _emailConfig = { host: cfg.host, port: cfg.port, from: cfg.from, secure: cfg.secure };

  logger.info(`  Email/SMTP configured (host: ${cfg.host}:${cfg.port})`);
  return _emailConfig;
}

/**
 * Replace `{{variable}}` placeholders in a template string.
 *
 * @param {string} template  Template with `{{key}}` placeholders.
 * @param {Record<string, string>} vars  Key→value map.
 * @returns {string}
 */
function interpolate(template, vars) {
  if (!template) return '';
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : '';
  });
}

/**
 * Send an email using the configured SMTP transporter.
 *
 * @param {object} options
 * @param {string} options.to           Recipient email address.
 * @param {string} options.subject      Email subject (supports {{var}} interpolation).
 * @param {string} [options.text]       Plain-text body (supports {{var}} interpolation).
 * @param {string} [options.html]       HTML body (supports {{var}} interpolation).
 * @param {string} [options.from]       Override the default "From" address.
 * @param {Record<string, string>} [options.vars]  Variables for template interpolation.
 * @returns {Promise<object>}           Nodemailer send result.
 * @throws {Error}                      When SMTP is not configured or sending fails.
 */
async function sendEmail({ to, subject, text, html, from, vars }) {
  if (!_transporter || !_emailConfig) {
    throw new Error('Email is not configured. Set SMTP_HOST or configure the email section in your YAML config.');
  }

  const templateVars = vars || {};
  const mailOptions = {
    from: from || _emailConfig.from,
    to,
    subject: interpolate(subject, templateVars),
  };

  if (text) mailOptions.text = interpolate(text, templateVars);
  if (html) mailOptions.html = interpolate(html, templateVars);

  return _transporter.sendMail(mailOptions);
}

/**
 * Verify the SMTP connection by attempting a handshake with the server.
 *
 * @returns {Promise<{ success: boolean, message: string }>}
 */
async function verifyConnection() {
  if (!_transporter || !_emailConfig) {
    return { success: false, message: 'Email is not configured. Set SMTP_HOST or configure the email section in your YAML config.' };
  }
  try {
    await _transporter.verify();
    return { success: true, message: `SMTP connection to ${_emailConfig.host}:${_emailConfig.port} verified.` };
  } catch (err) {
    return { success: false, message: `SMTP verification failed: ${err.message}` };
  }
}

/**
 * Returns the current email configuration metadata (without secrets).
 *
 * @returns {{ configured: boolean, host?: string, port?: number, from?: string, secure?: boolean }}
 */
function getEmailStatus() {
  if (!_emailConfig) return { configured: false };
  return {
    configured: true,
    host: _emailConfig.host,
    port: _emailConfig.port,
    from: _emailConfig.from,
    secure: _emailConfig.secure,
  };
}

module.exports = {
  getEmailConfig,
  initEmail,
  interpolate,
  sendEmail,
  verifyConnection,
  getEmailStatus,
};
