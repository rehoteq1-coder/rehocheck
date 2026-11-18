'use strict';

/**
 * POST /api/verify-news
 * Body: { headline }
 * Asks Claude for a structured fact-check verdict and returns:
 *   { verdict, credibility_score, misinformation_score, summary, sources_note, warning }
 * or { error } — exactly what index.html renders.
 */

const express = require('express');
const { fetchJson, UpstreamError } = require('../lib/http');
const { validateHeadline, ApiError, asyncHandler } = require('../lib/validate');
const { TtlCache } = require('../lib/cache');

const router = express.Router();

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const API_VERSION = '2023-06-01';

// Identical claims are cached for 6 hours to keep token spend predictable.
const cache = new TtlCache({ ttlMs: 6 * 60 * 60 * 1000, maxEntries: 500 });

const SYSTEM_PROMPT = `You are RehoCheck, a careful fact-checking analyst for a Nigerian audience.

Judge ONLY the claim supplied by the user. Never invent sources, quotes, dates or statistics.
If you do not know whether something is true, say UNVERIFIABLE — never guess.

Reply with JSON only, no markdown fences, no commentary, using exactly this schema:
{
  "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIABLE",
  "credibility_score": <0-100 integer, 100 = certainly true>,
  "misinformation_score": <0-100 integer, 100 = certainly false>,
  "summary": "<2-4 sentences of plain-English reasoning>",
  "sources_note": "<what would or did corroborate this: named outlets, official bodies, or 'no credible source identified'>",
  "warning": "<optional one-line caution, or an empty string>"
}

Use MISLEADING when the claim contains a true element presented in a distorting way.`;

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

const clampScore = (value, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
};

function normalise(parsed) {
  const allowed = ['TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIABLE'];
  const verdict = allowed.includes(String(parsed.verdict || '').toUpperCase())
    ? String(parsed.verdict).toUpperCase()
    : 'UNVERIFIABLE';

  return {
    verdict,
    credibility_score: clampScore(parsed.credibility_score, verdict === 'FALSE' ? 15 : 50),
    misinformation_score: clampScore(parsed.misinformation_score, verdict === 'FALSE' ? 85 : 45),
    summary: String(parsed.summary || '').slice(0, 1200),
    sources_note: String(parsed.sources_note || '').slice(0, 600),
    warning: String(parsed.warning || '').slice(0, 400),
  };
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const headline = validateHeadline(req.body && req.body.headline);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new ApiError(503, 'News verification is not configured on the server');

    const cached = cache.get(headline.toLowerCase());
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    let data;
    try {
      data = await fetchJson(ANTHROPIC_URL, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 800,
          temperature: 0.1,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `Claim to fact-check:\n"""${headline}"""\n\nReturn JSON only.`,
            },
          ],
        }),
        timeout: 40000,
        retries: 1,
      });
    } catch (err) {
      if (err instanceof UpstreamError) {
        throw new ApiError(502, `Fact-check service failed: ${err.message}`);
      }
      throw err;
    }

    const text = Array.isArray(data && data.content)
      ? data.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
      : '';

    const parsed = extractJson(text);

    if (!parsed) {
      // Model answered off-format: surface it honestly rather than as a verdict.
      return res.status(200).json({
        verdict: 'UNVERIFIABLE',
        credibility_score: 50,
        misinformation_score: 50,
        summary: text.slice(0, 1000) || 'The analysis service returned an empty response.',
        sources_note: 'Automated response could not be parsed into a structured verdict.',
        warning: 'Treat this as unchecked until a full analysis is available.',
      });
    }

    const result = normalise(parsed);
    cache.set(headline.toLowerCase(), result);
    res.setHeader('X-Cache', 'MISS');
    return res.json(result);
  })
);

module.exports = router;
