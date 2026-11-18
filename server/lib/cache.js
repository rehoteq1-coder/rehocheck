'use strict';

/**
 * Tiny in-memory TTL cache with an entry cap — enough for a single Render
 * instance and it keeps repeat scans off the provider rate limits.
 */

class TtlCache {
  constructor({ ttlMs = 10 * 60 * 1000, maxEntries = 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // Refresh recency for FIFO eviction.
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs = this.ttlMs) {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
    return value;
  }

  get size() {
    return this.store.size;
  }
}

module.exports = { TtlCache };
