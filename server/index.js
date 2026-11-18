'use strict';

/**
 * RehoCheck API — server entry point.
 *
 * Endpoints used by index.html:
 *   POST /api/safebrowsing
 *   POST /api/virustotal
 *   GET  /api/virustotal/analysis/:id
 *   POST /api/verify-news
 *   GET  /api/health
 *
 * Secrets (Google, VirusTotal, Anthropic) exist only in this process.
 */

const path = require('path');
const express = require('express');

const { loadEnv } = require('./lib/env');
loadEnv();

const { rateLimit } = require('./lib/rate-limit');
const { ApiError } = require('./lib/validate');
const safebrowsing = require('./routes/safebrowsing');
const virustotal = require('./routes/virustotal');
const news = require('./routes/news');

const app = express();
const VERSION = require('./package.json').version;

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render / any reverse proxy

/* ---------- body parsing (small limits: these are URLs and headlines) ---- */

app.use(express.json({ limit: '32kb' }));

/* ---------- CORS -------------------------------------------------------- */

const allowedOrigins = (process.env.CORS_ORIGINS || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const wildcard = allowedOrigins.includes('*');

  if (wildcard) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') return res.status(204).end();
  return next();
});

/* ---------- request logging (opt-in) ------------------------------------ */

if (process.env.LOG_REQUESTS === '1') {
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      // Never log bodies — they can contain user-submitted personal messages.
      console.log(`${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started}ms)`);
    });
    next();
  });
}

/* ---------- routes ------------------------------------------------------ */

const apiLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 60,
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptime_seconds: Math.round(process.uptime()),
    services: {
      safebrowsing: Boolean(process.env.GOOGLE_SAFE_BROWSING_KEY),
      virustotal: Boolean(process.env.VIRUSTOTAL_API_KEY),
      news: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  });
});

app.use('/api/safebrowsing', apiLimiter, safebrowsing);
app.use('/api/virustotal', apiLimiter, virustotal);
app.use('/api/verify-news', apiLimiter, news);

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown endpoint ${req.method} ${req.baseUrl}${req.path}` });
});

/* ---------- static front-end (local dev / single-service deploy) --------- */

if (process.env.SERVE_STATIC !== '0') {
  const root = path.join(__dirname, '..');
  app.use(express.static(root, { extensions: ['html'], maxAge: '1h' }));
  app.get('/', (req, res) => res.sendFile(path.join(root, 'index.html')));
}

/* ---------- error handling ---------------------------------------------- */

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ApiError ? err.status : Number(err.status) || 500;

  // Log unexpected failures only; ApiError is a deliberate, client-safe answer.
  if (status >= 500 && !(err instanceof ApiError)) {
    console.error('[error]', req.method, req.path, '-', err.message);
  }

  if (res.headersSent) return;

  res.status(status).json({
    // Only expose messages we generated; hide unexpected internals.
    error: status >= 500 && !(err instanceof ApiError)
      ? 'Something went wrong on our side. Please try again.'
      : err.message,
    ...(err.details ? { details: err.details } : {}),
  });
});

/* ---------- boot -------------------------------------------------------- */

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    const configured = ['GOOGLE_SAFE_BROWSING_KEY', 'VIRUSTOTAL_API_KEY', 'ANTHROPIC_API_KEY']
      .map((key) => `${key}=${process.env[key] ? 'set' : 'missing'}`)
      .join('  ');
    console.log(`RehoCheck API v${VERSION} listening on http://${HOST}:${PORT}`);
    console.log(`  ${configured}`);
    if (!process.env.GOOGLE_SAFE_BROWSING_KEY || !process.env.VIRUSTOTAL_API_KEY) {
      console.log('  ⚠  URL scans will return 503 until the missing keys are set.');
    }
    if (process.env.SERVE_STATIC !== '0') {
      console.log('  Serving the front-end from the repository root.');
    }
  });
}

module.exports = app;
