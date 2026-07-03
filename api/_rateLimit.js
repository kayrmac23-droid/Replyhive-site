// Shared guards for the serverless functions: rate limiting + origin checks.
//
// Rate limiting has two modes:
//   1. Redis-backed (recommended for production) — set UPSTASH_REDIS_REST_URL
//      and UPSTASH_REDIS_REST_TOKEN in Vercel and the limit is enforced
//      consistently across ALL function instances. Upstash's free tier
//      (10k commands/day) is plenty for this site, and it's called via plain
//      fetch — no npm dependency.
//   2. In-memory fallback — per-instance and reset on cold start, so it only
//      blunts bursts from a single IP hitting a warm instance. Serverless
//      platforms run many instances in parallel, so on its own this is NOT a
//      hard guarantee. It remains as the zero-config fallback and as the
//      safety net if Redis is unreachable.
//
// Files in /api whose name starts with "_" are ignored by Vercel's router, so
// this is a plain helper module, not an HTTP endpoint.

const buckets = new Map();

// Best-effort client IP. Vercel populates x-forwarded-for; the first entry is
// the original client. Falls back to the socket address.
export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length) return String(xff[0]).trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Origin gate for endpoints that spend money (Anthropic tokens, Resend quota).
// Browsers send an Origin header on every POST — same-origin included — so a
// legitimate visitor using the site always passes. Requests with no Origin
// (curl, scripts) or a foreign Origin are rejected. A determined attacker can
// spoof the header, but this kills drive-by scrapers, cross-site embedding of
// the endpoint, and casual "free Claude proxy" abuse.
//
// Allowed automatically: the host the request was served on (production
// domain, any *.vercel.app preview — no hardcoding needed). Additional hosts
// can be allowed via ALLOWED_EXTRA_ORIGINS (comma-separated hostnames).
export function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin || typeof origin !== 'string') return false;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const servedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (originHost && originHost === servedHost) return true;
  const extras = (process.env.ALLOWED_EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/^https?:\/\//, ''))
    .filter(Boolean);
  return extras.includes(originHost);
}

// Fixed-window counter, in-memory. Returns { ok, remaining, retryAfter, limit }.
function rateLimitMemory(key, { limit, windowMs }) {
  const now = Date.now();
  let entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    entry = { count: 0, reset: now + windowMs };
    buckets.set(key, entry);
  }
  entry.count += 1;

  // Opportunistic cleanup so the map can't grow without bound.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (now > v.reset) buckets.delete(k);
    }
  }

  const remaining = Math.max(0, limit - entry.count);
  const retryAfter = Math.max(1, Math.ceil((entry.reset - now) / 1000));
  return { ok: entry.count <= limit, remaining, retryAfter, limit };
}

// Fixed-window counter backed by Upstash Redis over REST (plain fetch, no
// dependency). Consistent across all function instances.
async function rateLimitRedis(key, { limit, windowMs }, url, token) {
  const res = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', `rl:${key}`],
      ['PEXPIRE', `rl:${key}`, String(windowMs), 'NX'],
      ['PTTL', `rl:${key}`],
    ]),
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const data = await res.json();
  const count = Number(data?.[0]?.result ?? 0);
  const ttlMs = Number(data?.[2]?.result ?? windowMs);
  const retryAfter = Math.max(1, Math.ceil((ttlMs > 0 ? ttlMs : windowMs) / 1000));
  return {
    ok: count > 0 && count <= limit,
    remaining: Math.max(0, limit - count),
    retryAfter,
    limit,
  };
}

// Public API. Async: prefers Redis when configured, falls back to in-memory
// on any Redis error so the product never goes down because the limiter did.
export async function rateLimit(key, opts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      return await rateLimitRedis(key, opts, url, token);
    } catch (e) {
      console.error('rateLimit: Redis unavailable, falling back to memory', e?.message || e);
    }
  }
  return rateLimitMemory(key, opts);
}
