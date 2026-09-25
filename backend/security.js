/* ============================================================
   Moonlit — security helpers (rate limiting + brute-force guard)
   ------------------------------------------------------------
   Simple in-memory limiters. Good enough for a single Node
   process (PM2 runs one instance). If you ever scale to
   multiple servers, replace with a Redis-backed limiter.
   ============================================================ */

/* Generic fixed-window rate limiter.
   opts: { windowMs, max, keyFn(req)->string, message } */
function rateLimit({ windowMs, max, keyFn, message }) {
  const hits = new Map();
  // Drop expired buckets regularly so the map doesn't grow forever.
  const timer = setInterval(() => {
    const t = Date.now();
    for (const [k, e] of hits) if (t > e.resetAt) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = (keyFn || ((r) => r.ip || "unknown"))(req);
    const t = Date.now();
    let e = hits.get(key);
    if (!e || t > e.resetAt) e = { count: 0, resetAt: t + windowMs };
    e.count += 1;
    hits.set(key, e);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, max - e.count)));
    if (e.count > max) {
      return res.status(429).json({
        error: message || "请求太频繁了，休息一下再试吧。",
      });
    }
    next();
  };
}

/* Brute-force guard for the admin endpoints.
   After `maxFails` failed token checks from one IP inside
   `windowMs`, that IP is blocked for `blockMs`. */
function adminBruteForceGuard({ windowMs = 10 * 60 * 1000, maxFails = 10, blockMs = 60 * 60 * 1000 } = {}) {
  const fails = new Map(); // ip -> { count, firstAt }
  const blocked = new Map(); // ip -> unblockAt

  function isBlocked(ip) {
    const until = blocked.get(ip);
    if (!until) return false;
    if (Date.now() > until) {
      blocked.delete(ip);
      return false;
    }
    return true;
  }

  return {
    check(req, res, next) {
      const ip = req.ip || "unknown";
      if (isBlocked(ip)) {
        return res.status(429).json({ error: "尝试次数过多，请一小时后再试。" });
      }
      next();
    },
    fail(req) {
      const ip = req.ip || "unknown";
      const t = Date.now();
      let e = fails.get(ip);
      if (!e || t - e.firstAt > windowMs) e = { count: 0, firstAt: t };
      e.count += 1;
      fails.set(ip, e);
      if (e.count >= maxFails) {
        blocked.set(ip, t + blockMs);
        fails.delete(ip);
        console.warn(`🔒 Admin brute-force block: ${ip} for ${blockMs / 60000} min`);
      }
    },
    reset(req) {
      fails.delete(req.ip || "unknown");
    },
  };
}

module.exports = { rateLimit, adminBruteForceGuard };
