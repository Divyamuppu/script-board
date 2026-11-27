// Script board — email sender (sends from YOUR Google account, no Brevo)
//
// Setup (one time, ~3 minutes):
// 1. Go to script.google.com → New project → name it "Script board email".
// 2. Replace everything with this file → Save.
// 3. Deploy → New deployment → gear icon → Web app.
//      Execute as: Me
//      Who has access: Anyone
//    Deploy → allow access → copy the Web app URL (ends in /exec).
// 4. Netlify → Environment variables → MAIL_WEBHOOK = that URL. Redeploy.
//    (You can delete BREVO_API_KEY and MAIL_FROM.)
//
// Safety: this only emails the domains/addresses listed below, so the URL can't be used to spam outsiders.

const ALLOWED_DOMAINS = ["atomcontent.in"];
const EXTRA_EMAILS = [];          // e.g. ["freelancer@gmail.com"]

const ok_ = e => /^[^\s@]+@[^\s@]+$/.test(e) && (EXTRA_EMAILS.includes(e) || ALLOWED_DOMAINS.some(d => e.endsWith("@" + d)));
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents || "{}");
    const to = [...new Set((b.to || []).map(s => String(s).trim().toLowerCase()))].filter(ok_).slice(0, 10);
    if (!to.length) return out_({ ok: false, error: "no_recipients" });
    if (MailApp.getRemainingDailyQuota() < to.length) return out_({ ok: false, error: "daily_quota" });
    const replyTo = String(b.replyTo || "").trim().toLowerCase();
    to.forEach(addr => MailApp.sendEmail({
      to: addr,
      subject: String(b.subject || "Script board").slice(0, 200),
      body: String(b.text || "").slice(0, 8000),
      name: b.fromName ? `${String(b.fromName).slice(0, 40)} via Script board` : "Script board",
      replyTo: ok_(replyTo) ? replyTo : undefined,
    }));
    return out_({ ok: true, sent: to.length });
  } catch (err) {
    return out_({ ok: false, error: String(err).slice(0, 200) });
  }
}

// Run once from the editor to check it works (sends to you).
function testEmail() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), "Script board test", "If you can read this, board emails will work.");
}
