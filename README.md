# RehoCheck

Nigerian anti-phishing / fact-check app: scan a website, a link from WhatsApp or SMS, or a
news claim, and get a verdict backed by **Google Safe Browsing**, **VirusTotal (70+ engines)**
and **Claude AI**.

```
rehocheck/
├── index.html            # entire front-end: markup + CSS design system + JS (no build step)
├── privacy-policy.html   # public privacy policy
├── SOURCE_CODE_GUIDE.md  # annotated walkthrough of the codebase + security review
└── server/               # API that holds the provider keys
    ├── index.js          # Express bootstrap, CORS, rate limiting, static hosting
    ├── routes/           # safebrowsing.js · virustotal.js · news.js
    ├── lib/              # http (timeout/retry), cache, validate, rate-limit, env
    └── scripts/smoke.js  # 11-check smoke test
```

## Quick start

```bash
cd server
cp .env.example .env          # then add your three API keys
npm install
npm start                     # http://localhost:3000  (serves UI + API)
```

The front-end auto-detects its API base:

| Situation | API base used |
|---|---|
| Served by `server/` (localhost, `*.e2b.app`, or any host that isn't the static deploy) | same origin |
| Hosted statically (GitHub Pages, etc.) | `https://rehoteqcheck-api.onrender.com` |
| `?api=https://your-api.example.com` | that value |
| `localStorage.rehocheck_api` set | that value |

So a single `npm start` gives you a fully working app locally — no CORS, no hard-coded host.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness + which providers are configured |
| `POST` | `/api/safebrowsing` | `{url}` → `{matches:[…]}` (Google v4 lookup) |
| `POST` | `/api/virustotal` | `{url}` → cached report, or `{data:{id}}` for a new analysis |
| `GET` | `/api/virustotal/analysis/:id` | `{data:{attributes:{status,stats}}}` while it runs |
| `POST` | `/api/verify-news` | `{headline}` → verdict + credibility/misinformation scores + summary |

Keys live only in the server process (`GOOGLE_SAFE_BROWSING_KEY`, `VIRUSTOTAL_API_KEY`,
`ANTHROPIC_API_KEY`) — never in the browser.

## Tests

```bash
cd server && npm run smoke          # 11 API checks (work with or without keys)
```

Behavioral coverage of the front-end logic (escaping, verdict matrix, link extraction,
end-to-end rendering) was run against a mock API: 24 unit checks + 19 integration checks.

## Deploying

**Render (recommended, single service)**

- Root directory: `server`
- Build: `npm install`
- Start: `npm start`
- Env: the three keys, plus `CORS_ORIGINS=https://your-frontend-domain`
- `SERVE_STATIC=1` serves `index.html` from the repo root as well, so the API and the UI
  ship as one service.

**Static front-end only** (GitHub Pages / Netlify): publish the repo root and leave
`API_BASE` on the Render backend, or point at your own with `?api=`.

## Security posture

- All user- and server-supplied text is HTML-escaped before rendering (no DOM XSS).
- Unreachable scanners produce an explicit *"Could Not Complete the Scan"* state — a
  failed check is never shown as "Safe".
- Server validates every URL (scheme allowlist, host checks, blocks loopback/private ranges),
  caps payload size, applies per-IP rate limits and request timeouts upstream.
- No accounts, no cookies, no analytics, no stored scan history.
