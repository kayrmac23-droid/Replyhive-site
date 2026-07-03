# Replyhive — marketing site

Single-page site for Replyhive (AI chat assistants for small business), with a
working demo chatbot and a lead-capture form.

## Structure

- `index.html` — the whole landing page (HTML, CSS, JS inline).
- `api/chat.js` — Vercel serverless function that proxies the demo chatbot to
  the Anthropic API so the API key is never exposed in the browser.
- `api/lead.js` — Vercel serverless function that receives the "Get my free
  demo" form and emails the lead via Resend. No secrets on the client.
- `api/_rateLimit.js` — shared best-effort in-memory rate limiter used by both
  functions (the leading `_` keeps Vercel from treating it as an endpoint).

## Setup after deploying to Vercel

### 1. Chatbot demo — required for the live demo to work
In the Vercel project, add an Environment Variable:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic API key (from console.anthropic.com) |

Redeploy after adding it. The demo calls `claude-sonnet-4-6`.

### 2. Lead form — required for the demo form to reach you
The "Get my free demo" form posts to `api/lead.js`, which emails you the lead
via [Resend](https://resend.com). Add these Environment Variables in Vercel:

| Name | Required | Value |
| --- | --- | --- |
| `RESEND_API_KEY` | yes | API key from resend.com |
| `LEAD_TO_EMAIL` | no | Inbox that receives leads (default `hello@replyhive.com.au`) |
| `LEAD_FROM_EMAIL` | no | Verified Resend sender (default `onboarding@resend.dev` for testing) |

The `from` address must be on a domain you've verified in Resend. Until
`replyhive.com.au` is verified there, leave `LEAD_FROM_EMAIL` unset so it uses
Resend's shared `onboarding@resend.dev` sender, which works immediately for
testing. Once the domain is verified, set `LEAD_FROM_EMAIL` to something like
`Replyhive <leads@replyhive.com.au>` so replies thread correctly.

Captured fields: name, business name, email, phone. The endpoint is rate
limited to 5 submissions per IP per 10 minutes.

## Local preview
Open `index.html` directly in a browser. The chatbot needs the deployed
`/api/chat` endpoint (and the env var) to respond.
