// Best-effort in-memory rate limiter shared by the serverless functions.
//
// NOTE: on Vercel this memory is per-instance and resets on a cold start, so it
// throttles bursts from a single IP but is not a hard, globally-consistent
// guarantee. That is enough to blunt casual abuse of the demo + lead endpoints
// without adding a dependency. For a strict, shared limit across all instances,
// back it with Upstash Redis or Vercel KV — kept dependency-free here on purpose.
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

// Fixed-window counter. Returns { ok, remaining, retryAfter, limit }.
export function rateLimit(key, { limit, windowMs }) {
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
