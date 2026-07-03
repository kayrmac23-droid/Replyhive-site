// Serverless lead-capture endpoint for the "Get my free demo" form.
// Receives a demo request and emails it to the Replyhive inbox via Resend.
// Every secret stays server-side — nothing here is exposed to the browser.
//
// Set these in the Vercel project's Environment Variables:
//   RESEND_API_KEY   — from resend.com (required)
//   LEAD_TO_EMAIL    — inbox that receives leads (optional; default hello@replyhive.com.au)
//   LEAD_FROM_EMAIL  — verified Resend sender (optional; default onboarding@resend.dev for testing)
//
// The "from" address must be on a domain you've verified in Resend. Until
// replyhive.com.au is verified there, leave LEAD_FROM_EMAIL unset so it uses
// Resend's shared onboarding sender, which works immediately for testing.

import { getClientIp, rateLimit } from './_rateLimit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
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

  // Rate limit: 5 submissions per IP per 10 minutes.
  const ip = getClientIp(req);
  const rl = rateLimit(`lead:${ip}`, { limit: 5, windowMs: 10 * 60 * 1000 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'The lead form is not configured yet.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const name = clean(body.name, 100);
    const business = clean(body.business, 100);
    const email = clean(body.email, 200);
    const phone = clean(body.phone, 40);

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
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error('Resend error', upstream.status, detail);
      return res.status(502).json({ error: 'We could not send your request right now. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('lead handler failed', e);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
