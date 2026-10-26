/**
 * A small, provider-agnostic email sender for COHESION notifications (playlist comments and shares).
 *
 * It does NOTHING until Barry sets the API key in Netlify (Site configuration → Environment variables, scope:
 * Functions). With no key every call logs one line and returns { sent:false, reason:'no-key' } — no error, no email.
 *
 *   EMAIL_API_KEY      the provider's API key (secret — set it in Netlify only, never in the repo)
 *   EMAIL_FROM         the sender, on a domain verified with the provider, e.g.  COHESION <playlists@mail.example.ie>
 *   EMAIL_PROVIDER     resend (default) | postmark | sendgrid
 *   EMAIL_REPLY_TO     optional reply-to address
 *
 * sendEmail({ to, subject, text, html }) → { sent:true, provider } | { sent:false, reason }
 * A failed send never throws: the caller (the digest) records the failure and moves on.
 */
function config() {
  return {
    key: process.env.EMAIL_API_KEY || '',
    from: process.env.EMAIL_FROM || '',
    provider: String(process.env.EMAIL_PROVIDER || 'resend').toLowerCase().trim(),
    replyTo: process.env.EMAIL_REPLY_TO || '',
  };
}
function enabled() { const c = config(); return !!(c.key && c.from); }

const PROVIDERS = {
  resend: (c, m) => ({ url: 'https://api.resend.com/emails',
    headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
    body: Object.assign({ from: c.from, to: [m.to], subject: m.subject, text: m.text, html: m.html }, c.replyTo ? { reply_to: c.replyTo } : {}) }),
  postmark: (c, m) => ({ url: 'https://api.postmarkapp.com/email',
    headers: { 'X-Postmark-Server-Token': c.key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: Object.assign({ From: c.from, To: m.to, Subject: m.subject, TextBody: m.text, HtmlBody: m.html, MessageStream: 'outbound' }, c.replyTo ? { ReplyTo: c.replyTo } : {}) }),
  sendgrid: (c, m) => {
    const f = /^(.*)<([^>]+)>\s*$/.exec(c.from);
    return { url: 'https://api.sendgrid.com/v3/mail/send',
      headers: { Authorization: 'Bearer ' + c.key, 'Content-Type': 'application/json' },
      body: Object.assign({ personalizations: [{ to: [{ email: m.to }] }],
        from: f ? { email: f[2].trim(), name: f[1].trim() } : { email: c.from.trim() }, subject: m.subject,
        content: [{ type: 'text/plain', value: m.text }].concat(m.html ? [{ type: 'text/html', value: m.html }] : []) },
        c.replyTo ? { reply_to: { email: c.replyTo } } : {}) };
  },
};

async function sendEmail(msg) {
  const c = config();
  const to = String((msg && msg.to) || '').trim();
  if (!c.key || !c.from) {
    console.log('[notify] EMAIL_API_KEY / EMAIL_FROM not set — email "' + String((msg && msg.subject) || '').slice(0, 80) + '" not sent');
    return { sent: false, reason: 'no-key' };
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return { sent: false, reason: 'bad-address' };
  const build = PROVIDERS[c.provider];
  if (!build) { console.error('[notify] unknown EMAIL_PROVIDER "' + c.provider + '"'); return { sent: false, reason: 'bad-provider' }; }
  const r = build(c, { to, subject: String(msg.subject || '').slice(0, 200), text: String(msg.text || ''), html: msg.html ? String(msg.html) : undefined });
  try {
    const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('[notify] ' + c.provider + ' HTTP ' + res.status + ' ' + t.slice(0, 200));
      return { sent: false, reason: 'http-' + res.status };
    }
    return { sent: true, provider: c.provider };
  } catch (e) {
    console.error('[notify] ' + c.provider + ' send failed: ' + e.message);
    return { sent: false, reason: 'network' };
  }
}

module.exports = { sendEmail, enabled, config };
