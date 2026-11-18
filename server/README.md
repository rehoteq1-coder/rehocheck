# RehoCheck API

Express service behind `index.html`. Holds the Google Safe Browsing, VirusTotal and
Anthropic keys so they never ship to the browser, and normalises provider errors into
JSON the UI can explain to a user.

## Run

```bash
cp .env.example .env     # add GOOGLE_SAFE_BROWSING_KEY, VIRUSTOTAL_API_KEY, ANTHROPIC_API_KEY
npm install
npm start                # http://0.0.0.0:3000
```

`npm run dev` uses `node --watch`. `npm run smoke` boots the app on an ephemeral port and
checks every route (validation, CORS preflight, 404s, 503s when a key is missing).

## Files

| Path | Responsibility |
|---|---|
| `index.js` | App assembly: JSON body limit, CORS, opt-in logging, rate limiter, routes, static hosting, error handler |
| `lib/env.js` | Dependency-free `.env` loader; real env vars always win |
| `lib/http.js` | `fetchJson` — hard timeout via `AbortController`, one retry for transport/5xx, typed `UpstreamError` |
| `lib/cache.js` | TTL + size-capped in-memory cache |
| `lib/validate.js` | URL/headline/analysis-id validation, `ApiError`, `asyncHandler` |
| `lib/rate-limit.js` | Fixed-window per-IP limiter with `X-RateLimit-*` headers |
| `routes/safebrowsing.js` | Google v4 `threatMatches:find`, 10-min cache, threat types limited to the four useful ones |
| `routes/virustotal.js` | Reuses an existing URL report when engine data exists (saves quota), otherwise submits and returns the analysis id to poll |
| `routes/news.js` | Claude Messages API, strict JSON schema, score clamping, 6-hour cache by headline |

## Request rules

- Bodies are capped at **32 KB**; only JSON is accepted.
- `url` must be absolute `http(s)` with a dotted host, ≤2048 chars; loopback/private/
  link-local hosts are rejected so the API can't be used as an internal SSRF probe.
- `headline` must be 5–800 characters.
- Default limit: **60 requests / 5 min / IP** (configurable via `RATE_LIMIT_*`).

## Error contract

Every failure returns JSON `{ "error": "human readable" }` with a meaningful status:

| Status | Meaning | UI shows |
|---|---|---|
| 400 | Bad input | inline red message under the field |
| 429 | Rate limited | inline message with retry hint |
| 503 | Provider key not configured | "scanner unavailable" / partial-check note |
| 502/504 | Upstream failed or timed out | "scanner unavailable" / partial-check note |

The front-end treats a missing `matches` array or a 5xx as **unknown**, never as safe.

## Scaling notes

Caches and the rate limiter are per-process. Running multiple instances (or a multi-region
Render plan) needs a shared Redis for both; everything else is stateless.

## Cost controls

- Safe Browsing results cached 10 minutes per URL.
- VirusTotal: existing reports reused before any submit; identical URLs within 2 minutes
  share one analysis id.
- News verification cached 6 hours per headline, `max_tokens: 800`, `temperature: 0.1`.
