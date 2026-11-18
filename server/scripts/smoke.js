'use strict';

/**
 * Smoke test — boots the app on an ephemeral port and checks every route.
 * Works with or without provider keys: missing keys must yield a clean 503,
 * not a hang or a 500.
 *
 *   npm run smoke
 */

process.env.SERVE_STATIC = process.env.SERVE_STATIC || '0';
process.env.RATE_LIMIT_MAX = '1000';

const app = require('../index');

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;

async function check(name, fn, expectStatus, validate) {
  try {
    const res = await fn();
    const body = await res.json().catch(() => null);
    const okStatus = Array.isArray(expectStatus)
      ? expectStatus.includes(res.status)
      : res.status === expectStatus;
    const okBody = !validate || validate(body);
    if (okStatus && okBody) {
      console.log(`  PASS  ${name} (${res.status})`);
    } else {
      failures++;
      console.log(`  FAIL  ${name} -> ${res.status} ${JSON.stringify(body)}`);
    }
  } catch (err) {
    failures++;
    console.log(`  FAIL  ${name} -> ${err.message}`);
  }
}

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

(async () => {
  console.log('\nRehoCheck API smoke test\n');

  await check('GET /api/health', () => fetch(base + '/api/health'), 200, (b) => b.status === 'ok');

  await check(
    'POST /api/safebrowsing without url',
    () => post('/api/safebrowsing', {}),
    400,
    (b) => typeof b.error === 'string'
  );

  await check(
    'POST /api/safebrowsing rejects loopback',
    () => post('/api/safebrowsing', { url: 'http://127.0.0.1/admin' }),
    400
  );

  await check(
    'POST /api/safebrowsing rejects javascript:',
    () => post('/api/safebrowsing', { url: 'javascript:alert(1)' }),
    400
  );

  await check(
    'POST /api/safebrowsing valid url',
    () => post('/api/safebrowsing', { url: 'https://example.com' }),
    process.env.GOOGLE_SAFE_BROWSING_KEY ? [200, 502] : 503,
    (b) => (b.matches ? Array.isArray(b.matches) : typeof b.error === 'string')
  );

  await check(
    'POST /api/virustotal valid url',
    () => post('/api/virustotal', { url: 'https://example.com' }),
    process.env.VIRUSTOTAL_API_KEY ? [200, 502] : 503,
    (b) => (b.data ? Boolean(b.data.id || b.data.attributes) : typeof b.error === 'string')
  );

  await check(
    'GET /api/virustotal/analysis/bad-id',
    () => fetch(base + '/api/virustotal/analysis/%%%'),
    400
  );

  await check(
    'POST /api/verify-news too short',
    () => post('/api/verify-news', { headline: 'hi' }),
    400
  );

  await check(
    'POST /api/verify-news valid',
    () => post('/api/verify-news', { headline: 'CBN suspends cash withdrawals in Nigeria' }),
    process.env.ANTHROPIC_API_KEY ? [200, 502] : 503
  );

  await check('GET /api/nope -> 404', () => fetch(base + '/api/nope'), 404);

  await check(
    'CORS preflight',
    () =>
      fetch(base + '/api/safebrowsing', {
        method: 'OPTIONS',
        headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' },
      }),
    204,
    null
  );

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
  server.close(() => process.exit(failures === 0 ? 0 : 1));
})();
