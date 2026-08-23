const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');

test('password reset mail uses SMTP configuration without exposing HTML input', async () => {
  const originalLoad = Module._load;
  const originalEnv = { ...process.env };
  let transportOptions = null;
  let sentMessage = null;

  Module._load = function mockLoad(request, parent, isMain) {
    if (request === 'nodemailer') {
      return {
        createTransport(options) {
          transportOptions = options;
          return {
            async sendMail(message) {
              sentMessage = message;
              return { messageId: 'test-message' };
            },
          };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  Object.assign(process.env, {
    MAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'camino.sunmedia@gmail.com',
    SMTP_PASS: 'abcd efgh ijkl mnop',
    MAIL_FROM: 'Camino <camino.sunmedia@gmail.com>',
  });

  try {
    const mailerPath = path.join(ROOT, 'backend/mailer.js');
    delete require.cache[mailerPath];
    const { sendPasswordResetEmail } = require(mailerPath);
    await sendPasswordResetEmail({
      to: 'joueur@example.com',
      username: '<Joueur>',
      resetUrl: 'https://example.com/reset?token=a&next=b',
      expiresInHours: 1,
    });

    assert.deepEqual(transportOptions.auth, {
      user: 'camino.sunmedia@gmail.com',
      pass: 'abcdefghijklmnop',
    });
    assert.equal(transportOptions.secure, true);
    assert.equal(sentMessage.to, 'joueur@example.com');
    assert.match(sentMessage.html, /&lt;Joueur&gt;/);
    assert.match(sentMessage.html, /token=a&amp;next=b/);
    assert.doesNotMatch(sentMessage.html, /<Joueur>/);
  } finally {
    Module._load = originalLoad;
    process.env = originalEnv;
  }
});

test('password reset mail uses the Brevo HTTPS API on Render-compatible configuration', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let requestedUrl = null;
  let requestedOptions = null;

  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      status: 201,
      async text() {
        return JSON.stringify({ messageId: '<brevo-test-message>' });
      },
    };
  };

  Object.assign(process.env, {
    MAIL_PROVIDER: 'brevo',
    BREVO_API_KEY: 'test-brevo-key',
    BREVO_SENDER_EMAIL: 'camino.sunmedia@gmail.com',
    BREVO_SENDER_NAME: 'Camino',
  });

  try {
    const mailerPath = path.join(ROOT, 'backend/mailer.js');
    delete require.cache[mailerPath];
    const { sendPasswordResetEmail } = require(mailerPath);
    const result = await sendPasswordResetEmail({
      to: 'pmphilippemaraval@gmail.com',
      username: '<Testmail>',
      resetUrl: 'https://example.com/reset?token=a&next=b',
      expiresInHours: 1,
    });

    assert.equal(requestedUrl, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(requestedOptions.method, 'POST');
    assert.equal(requestedOptions.headers['api-key'], 'test-brevo-key');
    const body = JSON.parse(requestedOptions.body);
    assert.deepEqual(body.sender, {
      name: 'Camino',
      email: 'camino.sunmedia@gmail.com',
    });
    assert.deepEqual(body.to, [{
      email: 'pmphilippemaraval@gmail.com',
      name: '<Testmail>',
    }]);
    assert.match(body.htmlContent, /&lt;Testmail&gt;/);
    assert.match(body.htmlContent, /token=a&amp;next=b/);
    assert.doesNotMatch(body.htmlContent, /<Testmail>/);
    assert.equal(Object.hasOwn(body, 'textContent'), false);
    assert.deepEqual(body.tags, ['password-reset']);
    assert.equal(result.provider, 'brevo');
    assert.equal(result.messageId, '<brevo-test-message>');
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
});

test('password reset mail uses a secured Google Apps Script HTTPS relay', async () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let requestedUrl = null;
  let requestedOptions = null;

  global.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ ok: true, requestId: 'google-test-request' });
      },
    };
  };

  Object.assign(process.env, {
    MAIL_PROVIDER: 'google_apps_script',
    GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/test-deployment/exec',
    GOOGLE_APPS_SCRIPT_SECRET: 'test-google-secret',
  });

  try {
    const mailerPath = path.join(ROOT, 'backend/mailer.js');
    delete require.cache[mailerPath];
    const { sendPasswordResetEmail } = require(mailerPath);
    const result = await sendPasswordResetEmail({
      to: 'pmphilippemaraval@gmail.com',
      username: '<Testmail>',
      resetUrl: 'https://example.com/reset?token=a&next=b',
      expiresInHours: 1,
    });

    assert.equal(requestedUrl, 'https://script.google.com/macros/s/test-deployment/exec');
    assert.equal(requestedOptions.method, 'POST');
    assert.equal(requestedOptions.redirect, 'follow');
    const body = JSON.parse(requestedOptions.body);
    assert.equal(body.secret, 'test-google-secret');
    assert.equal(body.to, 'pmphilippemaraval@gmail.com');
    assert.match(body.text, /Bonjour <Testmail>/);
    assert.match(body.html, /&lt;Testmail&gt;/);
    assert.match(body.html, /token=a&amp;next=b/);
    assert.doesNotMatch(body.html, /<Testmail>/);
    assert.equal(result.provider, 'google_apps_script');
    assert.equal(result.messageId, 'google-test-request');
  } finally {
    global.fetch = originalFetch;
    process.env = originalEnv;
  }
});
