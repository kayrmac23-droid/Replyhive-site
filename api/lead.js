// Serverless lead-capture endpoint for the "Get my free demo" form.
// Receives a demo request and emails it to the Replyhive inbox via Resend.
// Every secret stays server-side — nothing here is exposed to the browser.
//
// Set these in the Vercel project's Environment Variables:
//   RESEND_API_KEY   — from resend.com (REQUIRED — without it every lead is
//                      rejected with an error; this is the revenue pipeline)
//   LEAD_TO_EMAIL    — inbox that receives leads (optional; default hello@replyhive.com.au)
//   LEAD_FROM_EMAIL  — verified Resend sender (optional; default onboarding@resend.dev for testing)
//
// The "from" address must be on a domain you've verified in Resend. Until
// replyhive.com.au is verified there, leave LEAD_FROM_EMAIL unset so it uses
// Resend's shared onboarding sender, which works immediately for testing.
//
// Hardening:
//   - Origin gate: only the site's own form is accepted.
//   - Honeypot: bots that fill the hidden "website" field get a fake success
//     and no email is sent.
//   - Control characters are stripped from every field (header-injection
//     defense in depth; Resend also sanitizes, but belts and braces).
//   - LEAD_FALLBACK logging: if Resend is down or rejects the send, the full
//     lead is written to the function log so it can be recovered from
//     Vercel → Project → Logs instead of vanishing.

import { getClientIp, originAllowed, rateLimit } from './_rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // strip control chars incl. CRLF (header-injection defense)
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Only accept submissions from the site's own form.
  if (!originAllowed(req)) {
    return res.status(403).json({ error: 'Please use the form on the Replyhive website, or email hello@replyhive.com.au.' });
  }

  // Rate limit: 5 submissions per IP per 10 minutes.
  const ip = getClientIp(req);
  const rl = await rateLimit(`lead:${ip}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set — leads cannot be delivered');
    return res.status(500).json({ error: 'The lead form is not configured yet — please email hello@replyhive.com.au directly.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const name = clean(body.name, 100);
    const business = clean(body.business, 100);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);

    // Honeypot: real visitors never see this field; bots auto-fill it.
    // Answer with a fake success so bots don't learn and adapt.
    if (clean(body.website, 200)) {
      console.log('lead honeypot tripped', ip);
      return res.status(200).json({ ok: true });
    }

    if (!name || !business || !phone || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please fill in your name, business, a valid email, and phone number.' });
    }

    const to = process.env.LEAD_TO_EMAIL || 'hello@replyhive.com.au';
    const from = process.env.LEAD_FROM_EMAIL || 'Replyhive Leads <onboarding@resend.dev>';

    const rows = [
      ['Name', name],
      ['Business', business],
      ['Email', email],
      ['Phone', phone],
    ];
    const html = `<h2>New demo request</h2><table cellpadding="6">${rows
      .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
      .join('')}</table>`;
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n');

    const upstream = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `New demo request — ${business}`,
        html,
        text,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      // Never lose a lead: write it to the function log so it can be
      // recovered from Vercel → Logs even when email delivery fails.
      console.error('LEAD_FALLBACK', JSON.stringify({ name, business, email, phone }));
      console.error('Resend error', upstream.status, detail);
      return res.status(502).json({ error: 'We could not send your request right now — please email hello@replyhive.com.au directly.' });
    }

    console.log('LEAD_OK', business);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead handler failed', e);
    return res.status(500).json({ error: 'Something went wrong — please email hello@replyhive.com.au directly.' });
  }
}
