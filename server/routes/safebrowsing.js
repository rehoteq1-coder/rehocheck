'use strict';

/**
 * POST /api/safebrowsing
 * Body: { url }
 * Proxies Google Safe Browsing v4 threatMatches:find so the API key never
 * reaches the browser. Returns Google's envelope: { matches: [...] }.
 */

const express = require('express');
const { fetchJson, UpstreamError } = require('../lib/http');
const { validateUrl, ApiError, asyncHandler } = require('../lib/validate');
const { TtlCache } = require('../lib/cache');

const router = express.Router();

const ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const cache = new TtlCache({ ttlMs: 10 * 60 * 1000, maxEntries: 2000 });

const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
];

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const url = validateUrl(req.body && req.body.url);

    const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
    if (!key) {
      throw new ApiError(503, 'Google Safe Browsing is not configured on the server');
    }

    const cached = cache.get(url);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    const payload = {
      client: { clientId: 'rehocheck', clientVersion: '2.2.0' },
      threatInfo: {
        threatTypes: THREAT_TYPES,
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }],
      },
    };

    let data;
    try {
      data = await fetchJson(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        timeout: 12000,
        retries: 1,
      });
    } catch (err) {
      if (err instanceof UpstreamError) {
        throw new ApiError(502, `Safe Browsing lookup failed: ${err.message}`);
      }
      throw err;
    }

    // Google returns {} (no body) when the URL is clean.
    const matches = (data && Array.isArray(data.matches) ? data.matches : []).map((m) => ({
      threatType: m.threatType,
      platformType: m.platformType,
      threat: m.threat,
      cacheDuration: m.cacheDuration,
    }));

    const result = { matches };
    cache.set(url, result);
    res.setHeader('X-Cache', 'MISS');
    return res.json(result);
  })
);

module.exports = router;
