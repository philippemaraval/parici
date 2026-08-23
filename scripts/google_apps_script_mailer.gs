const CAMINO_SECRET_PROPERTY = 'CAMINO_MAIL_SECRET';

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(event) {
  let payload;
  try {
    payload = JSON.parse(event && event.postData ? event.postData.contents : '');
  } catch (error) {
    return jsonResponse({ ok: false, error: 'invalid_request' });
  }

  const expectedSecret = PropertiesService
    .getScriptProperties()
    .getProperty(CAMINO_SECRET_PROPERTY);
  if (!expectedSecret) {
    return jsonResponse({ ok: false, error: 'secret_not_configured' });
  }
  if (!payload || payload.secret !== expectedSecret) {
    return jsonResponse({ ok: false, error: 'unauthorized' });
  }

  const to = String(payload.to || '').trim().toLowerCase();
  const subject = String(payload.subject || '').trim();
  const text = String(payload.text || '');
  const html = String(payload.html || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return jsonResponse({ ok: false, error: 'invalid_recipient' });
  }
  if (!subject || subject.length > 200 || !text || text.length > 20000 || !html || html.length > 100000) {
    return jsonResponse({ ok: false, error: 'invalid_message' });
  }
  if (MailApp.getRemainingDailyQuota() < 1) {
    return jsonResponse({ ok: false, error: 'daily_quota_exhausted' });
  }

  const requestId = Utilities.getUuid();
  try {
    MailApp.sendEmail({
      to,
      subject,
      body: text,
      htmlBody: html,
      name: 'Parici',
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: `send_failed: ${String(error && error.message ? error.message : error)}`,
    });
  }

  return jsonResponse({
    ok: true,
    requestId,
    remainingDailyQuota: MailApp.getRemainingDailyQuota(),
  });
}
