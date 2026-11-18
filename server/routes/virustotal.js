'use strict';

/**
 * POST /api/virustotal               -> get/submit an analysis for a URL
 * GET  /api/virustotal/analysis/:id  -> fetch that analysis report while it runs
 *
 * The front-end reads VirusTotal's own envelope (data.attributes.*), so we
 * pass VT's JSON through instead of inventing a new shape.
 *
 * Flow:
 *   1. Ask VT for the URL's *existing* report.
 *      - Has engine data  -> return it immediately (no submit, saves quota).
 *      - 404 / empty      -> submit the URL for a fresh analysis, return the id.
 *   2. The browser then polls GET /analysis/:id a few times.
 */

const express = require('express');
const { fetchJson, UpstreamError } = require('../lib/http');
const { validateUrl, validateAnalysisId, ApiError, asyncHandler } = require('../lib/validate');
const { TtlCache } = require('../lib/cache');

const router = express.Router();

const VT_BASE = 'https://www.virustotal.com/api/v3';

// url -> analysis id, so two clicks in a row don't burn two submissions.
const recentSubmissions = new TtlCache({ ttlMs: 2 * 60 * 1000, maxEntries: 1000 });

function apiKey() {
  const key = process.env.VIRUSTOTAL_API_KEY;
  if (!key) throw new ApiError(503, 'VirusTotal is not configured on the server');
  return key;
}

function hasEngineData(stats) {
  if (!stats) return false;
  return (
    (Number(stats.malicious) || 0) +
      (Number(stats.suspicious) || 0) +
      (Number(stats.harmless) || 0) +
      (Number(stats.undetected) || 0) >
    0
  );
}

function reportPayload(id, attributes) {
  return {
    data: {
      type: 'analysis',
      id,
      attributes: {
        status: attributes.status || 'completed',
        stats: attributes.stats || null,
        last_analysis_stats: attributes.stats || null,
      },
    },
  };
}

/* --- submit / cached report --------------------------------------------- */

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const url = validateUrl(req.body && req.body.url);

    const key = apiKey();
    const headers = { 'x-apikey': key, Accept: 'application/json' };

    // 1. Existing report? (VT URL ids are base64url of the URL, no padding.)
    const urlId = Buffer.from(url, 'utf8').toString('base64url');
    try {
      const existing = await fetchJson(`${VT_BASE}/urls/${urlId}`, { headers, timeout: 12000 });
      const attributes = (existing && existing.data && existing.data.attributes) || {};
      const stats = attributes.last_analysis_stats || attributes.stats;
      if (hasEngineData(stats)) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(reportPayload(urlId, { status: 'completed', stats }));
      }
    } catch (err) {
      const notFound = err instanceof UpstreamError && err.status === 404;
      if (!notFound) {
        if (err instanceof UpstreamError) {
          throw new ApiError(502, `VirusTotal lookup failed: ${err.message}`);
        }
        throw err;
      }
    }

    // 2. Recently submitted by another request? Reuse that analysis id.
    const pending = recentSubmissions.get(url);
    if (pending) {
      res.setHeader('X-Cache', 'HIT');
      return res.json({ data: { type: 'analysis', id: pending } });
    }

    // 3. Submit a fresh analysis.
    let submitted;
    try {
      submitted = await fetchJson(`${VT_BASE}/urls`, {
        method: 'POST',
        headers: {
          'x-apikey': key,
          'content-type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ url }).toString(),
        timeout: 15000,
      });
    } catch (err) {
      if (err instanceof UpstreamError) {
        throw new ApiError(502, `VirusTotal submission failed: ${err.message}`);
      }
      throw err;
    }

    const analysisId = submitted && submitted.data && submitted.data.id;
    if (!analysisId) throw new ApiError(502, 'VirusTotal did not return an analysis id');

    recentSubmissions.set(url, analysisId);
    res.setHeader('X-Cache', 'MISS');
    return res.json({ data: { type: 'analysis', id: analysisId } });
  })
);

/* --- poll --------------------------------------------------------------- */

router.get(
  '/analysis/:id',
  asyncHandler(async (req, res) => {
    const id = validateAnalysisId(req.params.id);

    const key = apiKey();

    let data;
    try {
      data = await fetchJson(`${VT_BASE}/analyses/${id}`, {
        headers: { 'x-apikey': key, Accept: 'application/json' },
        timeout: 15000,
      });
    } catch (err) {
      if (err instanceof UpstreamError) {
        throw new ApiError(502, `VirusTotal report fetch failed: ${err.message}`);
      }
      throw err;
    }

    const attributes = (data && data.data && data.data.attributes) || {};
    const stats = attributes.stats || attributes.last_analysis_stats || null;

    return res.json(
      reportPayload(id, {
        status: attributes.status || 'unknown',
        stats: hasEngineData(stats) ? stats : null,
      })
    );
  })
);

module.exports = router;
