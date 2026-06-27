# Fieldr — marketing site

Single-page site for Fieldr (AI chat assistants for small business), with a
working demo chatbot and a lead-capture form.

## Structure

- `index.html` — the whole landing page (HTML, CSS, JS inline).
- `api/chat.js` — Vercel serverless function that proxies the demo chatbot to
  the Anthropic API so the API key is never exposed in the browser.

## Setup after deploying to Vercel

### 1. Chatbot demo — required for the live demo to work
In the Vercel project, add an Environment Variable:

| Name | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your Anthropic API key (from console.anthropic.com) |

Redeploy after adding it. The demo calls `claude-sonnet-4-6`.

### 2. Lead form — required for the email form to reach you
1. Create a free form at <https://formspree.io> (it emails you each submission).
2. Copy the form ID — the part after `/f/` in the endpoint it gives you.
3. In `index.html`, set `FORMSPREE_FORM_ID` to that ID.

Until the ID is set, the "Get my free demo" button falls back to opening the
visitor's email client addressed to hello@fieldr.au, so no lead is lost.

## Local preview
Open `index.html` directly in a browser. The chatbot needs the deployed
`/api/chat` endpoint (and the env var) to respond.
