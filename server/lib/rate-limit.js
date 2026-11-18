'use strict';

/**
 * Fixed-window, in-memory rate limiter. Protects the provider keys from
 * abuse (the "10 scans/day" free tier lives here, not in the browser).
 * For multi-instance deployments swap the Map for Redis.
 */

function rateLimit({ windowMs = 5 * 60 * 1000, max = 60, keyPrefix = 'rl' } = {}) {
  const buckets = new Map();

  // Drop expired buckets periodically so the Map cannot grow forever.
  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, windowMs);
  if (sweeper.unref) sweeper.unref();

  return function rateLimitMiddleware(req, res, next) {
    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: `Too many checks from this device. Try again in ${retryAfter}s.`,
      });
    }
    return next();
  };
}

module.exports = { rateLimit };
