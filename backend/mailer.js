let transporter = null;

const BREVO_API_BASE_URL = 'https://api.brevo.com/v3';

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function getMailProvider() {
  const configuredProvider = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase();
  const supportedProviders = new Set(['google_apps_script', 'brevo', 'smtp']);
  if (configuredProvider && !supportedProviders.has(configuredProvider)) {
    throw new Error(`Unsupported mail provider: ${configuredProvider}`);
  }
  if (configuredProvider) return configuredProvider;
  if (
    String(process.env.GOOGLE_APPS_SCRIPT_URL || '').trim()
    && String(process.env.GOOGLE_APPS_SCRIPT_SECRET || '').trim()
  ) {
    return 'google_apps_script';
  }
  return String(process.env.BREVO_API_KEY || '').trim() ? 'brevo' : 'smtp';
}

function getTransporter() {
  if (transporter) return transporter;

  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number.parseInt(process.env.SMTP_PORT || '465', 10);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
  if (!host || !Number.isInteger(port) || !user || !pass) {
    throw new Error('SMTP is not configured');
  }

  // Loaded only when SMTP is selected. Render free services block SMTP ports,
  // while local or paid deployments may still choose this transport.
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: readBoolean(process.env.SMTP_SECURE, port === 465),
    auth: { user, pass },
  });
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseSender(value) {
  const sender = String(value || '').trim();
  const match = sender.match(/^\s*(.*?)\s*<\s*([^<>]+)\s*>\s*$/);
  if (!match) return { name: '', email: sender };
  return {
    name: match[1].replace(/^"|"$/g, '').trim(),
    email: match[2].trim(),
  };
}

function getBrevoSender() {
  const mailFrom = parseSender(process.env.MAIL_FROM);
  const email = String(
    process.env.BREVO_SENDER_EMAIL || mailFrom.email || process.env.SMTP_USER || '',
  ).trim();
  const name = String(process.env.BREVO_SENDER_NAME || mailFrom.name || 'Parici').trim();
  if (!email) throw new Error('BREVO_SENDER_EMAIL is not configured');
  return { name, email };
}

async function brevoRequest(path, { method = 'GET', body } = {}) {
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) throw new Error('BREVO_API_KEY is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(`${BREVO_API_BASE_URL}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Brevo API request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = null;
  }

  if (!response.ok) {
    const details = responseBody?.message || responseText.slice(0, 300) || 'unknown error';
    throw new Error(`Brevo API returned ${response.status}: ${details}`);
  }

  return {
    status: response.status,
    body: responseBody,
  };
}

async function sendWithBrevo({ to, username, subject, html }) {
  const response = await brevoRequest('/smtp/email', {
    method: 'POST',
    body: {
      sender: getBrevoSender(),
      to: [{ email: to, name: username }],
      subject,
      htmlContent: html,
      tags: ['password-reset'],
    },
  });

  return {
    provider: 'brevo',
    messageId: response.body?.messageId || null,
  };
}

function getGoogleAppsScriptConfiguration() {
  const endpoint = String(process.env.GOOGLE_APPS_SCRIPT_URL || '').trim();
  const secret = String(process.env.GOOGLE_APPS_SCRIPT_SECRET || '').trim();
  if (!endpoint) throw new Error('GOOGLE_APPS_SCRIPT_URL is not configured');
  if (!secret) throw new Error('GOOGLE_APPS_SCRIPT_SECRET is not configured');

  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('GOOGLE_APPS_SCRIPT_URL is invalid');
  }
  if (
    parsedEndpoint.protocol !== 'https:'
    || parsedEndpoint.hostname !== 'script.google.com'
    || !parsedEndpoint.pathname.startsWith('/macros/s/')
    || !parsedEndpoint.pathname.endsWith('/exec')
  ) {
    throw new Error('GOOGLE_APPS_SCRIPT_URL must be a deployed Google Apps Script /exec URL');
  }

  return { endpoint: parsedEndpoint.toString(), secret };
}

async function sendWithGoogleAppsScript({ to, subject, text, html }) {
  const { endpoint, secret } = getGoogleAppsScriptConfiguration();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ secret, to, subject, text, html }),
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Google Apps Script request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    throw new Error('Google Apps Script returned an invalid response');
  }
  if (!response.ok || responseBody?.ok !== true) {
    const details = responseBody?.error || `HTTP ${response.status}`;
    throw new Error(`Google Apps Script rejected the email: ${details}`);
  }

  return {
    provider: 'google_apps_script',
    messageId: responseBody.requestId || null,
  };
}

function buildPasswordResetMessage({ username, resetUrl, expiresInHours }) {
  const safeUsername = escapeHtml(username);
  const safeResetUrl = escapeHtml(resetUrl);
  const expirationLabel = expiresInHours === 1 ? 'une heure' : `${expiresInHours} heures`;

  return {
    subject: 'Réinitialisation de votre mot de passe Parici',
    text: [
      `Bonjour ${username},`,
      '',
      'Une demande de réinitialisation du mot de passe de votre compte Parici a été effectuée.',
      `Choisissez un nouveau mot de passe en ouvrant ce lien : ${resetUrl}`,
      '',
      `Ce lien est valable pendant ${expirationLabel} et ne peut être utilisé qu’une seule fois.`,
      'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.',
    ].join('\n'),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1e293b;max-width:560px;margin:auto">
        <h1 style="color:#0c1d57;font-size:24px">Nouveau mot de passe Parici</h1>
        <p>Bonjour <strong>${safeUsername}</strong>,</p>
        <p>Une demande de réinitialisation du mot de passe de votre compte Parici a été effectuée.</p>
        <p style="margin:28px 0">
          <a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#12297a;color:#fff;text-decoration:none;font-weight:700">
            Choisir un nouveau mot de passe
          </a>
        </p>
        <p>Ce lien est valable pendant ${expirationLabel} et ne peut être utilisé qu’une seule fois.</p>
        <p style="color:#64748b;font-size:14px">Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.</p>
      </div>
    `,
  };
}

async function sendPasswordResetEmail({ to, username, resetUrl, expiresInHours }) {
  const message = buildPasswordResetMessage({ username, resetUrl, expiresInHours });
  const provider = getMailProvider();
  if (provider === 'google_apps_script') {
    return sendWithGoogleAppsScript({ to, ...message });
  }
  if (provider === 'brevo') {
    return sendWithBrevo({ to, username, ...message });
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_USER || '').trim();
  if (!from) throw new Error('MAIL_FROM is not configured');
  return getTransporter().sendMail({ from, to, ...message });
}

module.exports = {
  sendPasswordResetEmail,
};
