'use strict';

/**
 * Minimal .env loader (no dependency). Real environment variables win,
 * so Render/Vercel settings are never overwritten by a stray file.
 */

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env is normal in production
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

module.exports = { loadEnv };
