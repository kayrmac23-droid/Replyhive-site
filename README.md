# Replyhive — marketing site

Single-page site for Replyhive (AI chat assistants for small business), with a
working demo chatbot and a lead-capture form.

## Structure

- `index.html` — the whole landing page (HTML, CSS, JS inline).
- `api/chat.js` — Vercel serverless function that proxies the demo chatbot to
  the Anthropic API so the API key is never exposed in the browser.
- `api/lead.js` — Vercel serverless function that receives the "Get my free
  demo" form and emails the lead via Resend. No secrets on the client.
- `api/_rateLimit.js` — shared guards: rate limiting (Redis-backed when
  configured, in-memory fallback) and the origin gate (the leading `_` keeps
  Vercel from treating it as an endpoint).
- `vercel.json` — security headers (CSP, frame denial, etc.) and function
  duration caps.
- `og.jpg` — social share card (used when the link is shared on
  Facebook/WhatsApp/LinkedIn/etc.).
- `robots.txt` — allows crawling of the page, blocks `/api/`.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Required | Value |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | **yes** — demo bot is dead without it | API key from console.anthropic.com |
| `RESEND_API_KEY` | **yes — this is the revenue pipeline.** Without it every lead submission fails with an error. | API key from resend.com |
| `LEAD_TO_EMAIL` | no | Inbox that receives leads (default `hello@replyhive.com.au`) |
| `LEAD_FROM_EMAIL` | no | Verified Resend sender (default `onboarding@resend.dev` for testing) |
| `UPSTASH_REDIS_REST_URL` | recommended | From a free Upstash Redis database — makes rate limits consistent across all function instances |
| `UPSTASH_REDIS_REST_TOKEN` | recommended | Ditto |
| `ALLOWED_EXTRA_ORIGINS` | no | Comma-separated extra hostnames allowed to call the APIs (the site's own host is always allowed automatically) |

Redeploy after adding or changing env vars.

### Resend notes
The `from` address must be on a domain you've verified in Resend. Until
`replyhive.com.au` is verified there, leave `LEAD_FROM_EMAIL` unset so it uses
Resend's shared `onboarding@resend.dev` sender, which works immediately for
testing. Once the domain is verified, set `LEAD_FROM_EMAIL` to something like
`Replyhive <leads@replyhive.com.au>` so replies thread correctly.

Captured fields: name, business name, email, phone. The endpoint is rate
limited to 5 submissions per IP per 10 minutes, protected by a honeypot field
against bots, and if Resend delivery ever fails the lead is written to the
function log (search Vercel logs for `LEAD_FALLBACK`) so it is never lost.

## Cost controls — the demo spends real money per message

`api/chat.js` calls `claude-sonnet-4-6`. Guards in place:

- **Origin gate** — only requests originating from the site itself are served;
  scripts and other sites hitting the endpoint directly get a 403.
- **Rate limit** — 20 messages per IP per minute. With the Upstash env vars set
  this is enforced globally; without them it is per-instance best-effort.
- **Input caps** — last 12 turns, 800 chars per message.
- **Output cap** — `max_tokens` 300 (the bot speaks in 2–3 sentences anyway).

Worst-case cost per message is roughly $0.014; a normal demo conversation runs
well under a cent per message.

**Also set a monthly spend limit in the Anthropic console
(console.anthropic.com → Settings → Limits).** That is the only cap an attacker
cannot route around, and it turns a worst-case incident into a bounded number.

## Custom domain — replyhive.com.au

DNS is on Cloudflare and mail (MX → Google) already works. To fix the web 502:

1. Vercel → the project → Settings → Domains → add `replyhive.com.au` and
   `www.replyhive.com.au`.
2. Cloudflare → DNS: point the apex `@` at Vercel — either `A 76.76.21.21` or
   `CNAME @ → cname.vercel-dns.com` (Cloudflare flattens it), and
   `CNAME www → cname.vercel-dns.com`.
3. Set both records to **DNS only (grey cloud)** — Vercel terminates TLS
   itself. If you want Cloudflare proxying instead, SSL/TLS mode must be
   **Full (Strict)**, but grey-cloud is the simpler, recommended setup.
4. Wait for the certificate to issue in Vercel (a few minutes), then check
   `https://replyhive.com.au`.

The page's canonical URL and social share tags already point at
`https://replyhive.com.au/`, so they take full effect once the domain is live.

## Local preview

Open `index.html` directly in a browser. The chatbot and lead form need the
deployed `/api/*` endpoints (and env vars) to respond — and both endpoints
require a matching `Origin` header, so test them through the deployed site
rather than curl.
